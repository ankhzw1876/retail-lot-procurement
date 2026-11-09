/**
 * 应用层统一动作入口测试（Codex 1107 复验架构建议 B/C/D）。
 * 跨页非法编辑闸门、快照版本单事务分配、结构化错误、复盘存储失败路径。
 */

import { describe, it, expect } from "vitest";
import {
  ActionError,
  assertInputUnchanged,
  assertNoInvalidEdits,
  batchScope,
  nextSnapshotVersion,
  saveDecision,
  stableStringify,
  submitReview,
  EditValidityRegistry,
} from "@/application/actions";
import { loadSeed, evaluateConfirmed } from "../helpers";
import { createDecisionSnapshot } from "@/application/snapshots";
import type { ProcurementDB } from "@/data/repository";
import { ActualReview, Batch, DecisionSnapshot } from "@/domain/types";

const seed = loadSeed();
const staticData = seed as never;

const lotA = structuredClone(seed.batches.find((b) => b.id === "LOT-A")!);
const lotADraft = structuredClone(seed.drafts.find((d) => d.batch_id === "LOT-A")!);

/** 内存存根：记录调用顺序，验证版本分配+写入+状态更新在同一事务闭包内。 */
function makeStubDb(
  batch: Batch,
  initial: DecisionSnapshot[] = [],
  persisted?: { batch?: Batch; draft?: typeof lotADraft }
) {
  const snapshots = [...initial];
  const calls: string[] = [];
  const db = {
    async transaction<T>(_mode: string, _tables: unknown[], fn: () => Promise<T>) {
      calls.push("tx:begin");
      const r = await fn();
      calls.push("tx:end");
      return r;
    },
    snapshots: {
      where: () => ({
        equals: (v: string) => ({
          toArray: async () => snapshots.filter((s) => s.batch_id === v),
        }),
      }),
      add: async (s: DecisionSnapshot) => {
        calls.push(`snapshot.add:v${s.version}`);
        snapshots.push(s);
      },
    },
    batches: {
      get: async (id: string) =>
        id === batch.id ? structuredClone(persisted?.batch ?? batch) : undefined,
      put: async (b: Batch) => {
        calls.push(`batch.put:${b.status}`);
      },
    },
    drafts: {
      get: async (id: string) =>
        id === batch.id ? structuredClone(persisted?.draft ?? lotADraft) : undefined,
    },
  } as unknown as ProcurementDB;
  return { db, snapshots, calls };
}

function decisionParams(db: ProcurementDB, registry: EditValidityRegistry = {}) {
  return {
    db,
    batch: structuredClone(lotA),
    draft: structuredClone(lotADraft),
    staticData,
    allEvidence: seed.evidence,
    evaluationDate: seed.workspace.evaluation_date,
    humanDecision: "hold" as const,
    reason: "资料未确认暂缓采购，留待后续核实",
    registry,
  };
}

describe("跨页非法编辑闸门（assertNoInvalidEdits）", () => {
  it("登记为空时放行", () => {
    expect(() => assertNoInvalidEdits({}, "LOT-A")).not.toThrow();
    expect(() => assertNoInvalidEdits({ [batchScope("LOT-B")]: { "c.cost": "x" } }, "LOT-A")).not.toThrow();
  });

  it("本批次存在未修正非法输入时抛 INVALID_EDIT_PENDING", () => {
    const registry: EditValidityRegistry = {
      [batchScope("LOT-A")]: { "c.cost": "金额最多两位小数" },
    };
    try {
      assertNoInvalidEdits(registry, "LOT-A");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ActionError);
      expect((e as ActionError).code).toBe("INVALID_EDIT_PENDING");
      expect((e as ActionError).message).toContain("金额最多两位小数");
    }
  });
});

describe("快照版本分配（nextSnapshotVersion）", () => {
  it("空历史为 1，否则取最大版本 +1", () => {
    expect(nextSnapshotVersion([])).toBe(1);
    expect(nextSnapshotVersion([{ version: 1 }, { version: 3 }])).toBe(4);
  });
});

describe("saveDecision 统一入口", () => {
  it("版本分配、快照写入、批次状态更新在同一事务内完成", async () => {
    const { db, calls } = makeStubDb(lotA);
    const snapshot = await saveDecision(decisionParams(db));
    expect(snapshot.version).toBe(1);
    expect(snapshot.confirmed_for_hash).toBeNull();
    const txBegin = calls.indexOf("tx:begin");
    const txEnd = calls.indexOf("tx:end");
    const addIdx = calls.indexOf("snapshot.add:v1");
    const putIdx = calls.indexOf("batch.put:decided");
    expect(txBegin).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(txBegin);
    expect(putIdx).toBeGreaterThan(txBegin);
    expect(addIdx).toBeLessThan(txEnd);
    expect(putIdx).toBeLessThan(txEnd);
  });

  it("同批次连续保存版本递增（重试/并发下由事务内重查保证）", async () => {
    const { db } = makeStubDb(lotA);
    const s1 = await saveDecision(decisionParams(db));
    const s2 = await saveDecision(decisionParams(db));
    expect(s1.version).toBe(1);
    expect(s2.version).toBe(2);
  });

  it("存在未修正非法编辑时不进入任何事务", async () => {
    const { db, calls } = makeStubDb(lotA);
    const registry: EditValidityRegistry = {
      [batchScope("LOT-A")]: { "c.cost": "金额最多两位小数" },
    };
    await expect(saveDecision(decisionParams(db, registry))).rejects.toMatchObject({
      code: "INVALID_EDIT_PENDING",
    });
    expect(calls).toEqual([]);
  });

  it("理由长度非法 → VALIDATION_FAILED", async () => {
    const { db } = makeStubDb(lotA);
    const p = { ...decisionParams(db), reason: "太短" };
    await expect(saveDecision(p)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("持久层失败 → STORAGE_FAILED，不假装成功", async () => {
    const { db } = makeStubDb(lotA);
    (db.snapshots as { add: (s: DecisionSnapshot) => Promise<unknown> }).add = async () => {
      throw new Error("QuotaExceededError");
    };
    await expect(saveDecision(decisionParams(db))).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });
  });
});

describe("输入版本一致性（assertInputUnchanged / stableStringify）", () => {
  it("键序不同但内容相同视为一致", () => {
    const a = { x: 1, y: { p: "a", q: [1, 2] } };
    const b = { y: { p: "a", q: [1, 2] }, x: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("持久化报价被其他标签页修改 → VERSION_CONFLICT，不落库", async () => {
    const changed = structuredClone(lotA);
    changed.unit_cost_fen += 100;
    const { db, snapshots } = makeStubDb(lotA, [], { batch: changed });
    await expect(saveDecision(decisionParams(db))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(snapshots).toHaveLength(0);
  });

  it("持久化草稿被其他标签页修改 → VERSION_CONFLICT，不落库", async () => {
    const changed = structuredClone(lotADraft);
    changed.scenario_basis = "其他标签页更新了情景依据";
    changed.updated_at = new Date().toISOString();
    const { db, snapshots } = makeStubDb(lotA, [], { draft: changed });
    await expect(saveDecision(decisionParams(db))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    expect(snapshots).toHaveLength(0);
  });

  it("批次状态推进不视为冲突（decided 与 evaluating 内容一致仍放行）", async () => {
    const decided = { ...structuredClone(lotA), status: "decided" as const };
    const { db } = makeStubDb(lotA, [], { batch: decided });
    const snapshot = await saveDecision(decisionParams(db));
    expect(snapshot.version).toBe(1);
  });
});

describe("submitReview 统一入口", () => {
  async function buySnapshot() {
    const confirmed = await evaluateConfirmed(seed, "LOT-B", {
      batch: { unit_cost_fen: 5600 },
    });
    return createDecisionSnapshot({
      bundle: {
        input: confirmed.input,
        inputHash: confirmed.inputHash,
        allocation: confirmed.allocation,
        result: confirmed.result,
      },
      batchId: "LOT-B",
      version: 1,
      humanDecision: "buy",
      reason: "议价至 56 元后悲观情景达标，决定采购",
      explanationMode: "rules",
      explanationText: "test",
      allEvidence: seed.evidence,
      createdAt: new Date().toISOString(),
      id: "act-5",
      confirmedForHash: confirmed.inputHash,
    });
  }

  function reviewOf(overrides?: Partial<ActualReview>): ActualReview {
    const fixture = seed.actual_review_fixture;
    return {
      id: "act-r1",
      snapshot_id: "act-5",
      review_date: fixture.review_date,
      closed_window: true,
      actual_stages: structuredClone(fixture.actual_stages),
      residual_unit_value_fen: fixture.residual_unit_value_fen,
      procurement_total_fen: fixture.procurement_total_fen,
      other_costs_fen: fixture.other_costs_fen,
      note: "",
      created_at: new Date().toISOString(),
      ...(overrides ?? {}),
    };
  }

  it("快照不存在 → NOT_FOUND", async () => {
    const db = { reviews: { add: async () => undefined } } as unknown as ProcurementDB;
    await expect(submitReview(db, undefined, reviewOf())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("溢出 → AMOUNT_OVERFLOW 且不调用落库", async () => {
    const snapshot = await buySnapshot();
    let added = 0;
    const db = {
      reviews: { add: async () => { added += 1; } },
    } as unknown as ProcurementDB;
    await expect(
      submitReview(db, snapshot, reviewOf({
        actual_stages: [
          { price_fen: 9007199254740991, units: 1000 },
          { price_fen: 0, units: 0 },
        ],
      }))
    ).rejects.toMatchObject({ code: "AMOUNT_OVERFLOW" });
    expect(added).toBe(0);
  });

  it("落库异常 → STORAGE_FAILED", async () => {
    const snapshot = await buySnapshot();
    const db = {
      reviews: { add: async () => { throw new Error("ConstraintError"); } },
    } as unknown as ProcurementDB;
    await expect(submitReview(db, snapshot, reviewOf())).rejects.toMatchObject({
      code: "STORAGE_FAILED",
    });
  });

  it("金标复盘正常落库", async () => {
    const snapshot = await buySnapshot();
    let added = 0;
    const db = {
      reviews: { add: async () => { added += 1; } },
    } as unknown as ProcurementDB;
    await expect(submitReview(db, snapshot, reviewOf())).resolves.toBeUndefined();
    expect(added).toBe(1);
  });
});
