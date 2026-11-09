/**
 * Codex 独立验收发现的六项缺陷的回归测试（单元/引擎层）。
 * ②快照确认状态、④底价静默清空、①证据闭环、⑤复盘落库校验。
 * AI 协议⑥见 ai-route.test.ts；非法输入上送③由 e2e 真实交互覆盖。
 */

import { describe, it, expect } from "vitest";
import { loadSeed, loadCsv, buildInput, evaluateConfirmed } from "../helpers";
import { runEvaluation } from "@/application/evaluate";
import { buildEvaluationInput } from "@/application/evaluate";
import { createDecisionSnapshot } from "@/application/snapshots";
import { evaluateBatchWithHash } from "@/domain/recommendation";
import { validateEvaluation } from "@/domain/validation";
import { applyQuotedPrice, clearSupplierFloor, floorConflicts } from "@/application/batch-edits";
import { parseQuoteCsv } from "@/import/quote-csv";
import { validateActualReview, calculateReview } from "@/domain/review";
import { ActualReview, EvaluationDraft } from "@/domain/types";

const seed = loadSeed();

async function bundleOf(batchId = "LOT-A", draftOverrides?: Partial<EvaluationDraft>) {
  const batch = structuredClone(seed.batches.find((b) => b.id === batchId)!);
  const draft = {
    ...structuredClone(seed.drafts.find((d) => d.batch_id === batchId)!),
    ...(draftOverrides ?? {}),
  };
  return {
    batch,
    draft,
    bundle: await runEvaluation(seed.workspace.evaluation_date, batch, draft, seed, seed.evidence),
  };
}

describe("缺陷②：快照必须如实保留确认状态", () => {
  it("未确认评估保存的快照 confirmed_for_hash 为 null，恢复后仍 NEEDS_DATA", async () => {
    const { bundle } = await bundleOf();
    expect(bundle.result.recommendation).toBe("NEEDS_DATA");
    const snapshot = await createDecisionSnapshot({
      bundle,
      batchId: "LOT-A",
      version: 1,
      humanDecision: "hold",
      reason: "资料未确认暂缓采购，留待后续核实",
      explanationMode: "rules",
      explanationText: "test",
      allEvidence: seed.evidence,
      createdAt: new Date().toISOString(),
      id: "reg-2a",
      confirmedForHash: null,
    });
    expect(snapshot.confirmed_for_hash).toBeNull();
    expect(snapshot.confirmed_for_hash).not.toBe(snapshot.input_hash);
    // 模拟“以此版本继续评估”：用快照保存的确认状态恢复，绝不变成已确认
    const restored = evaluateBatchWithHash(
      snapshot.input,
      snapshot.allocation,
      snapshot.confirmed_for_hash,
      snapshot.input_hash
    );
    expect(restored.recommendation).toBe("NEEDS_DATA");
    expect(restored.reason_codes).toContain("NOT_CONFIRMED");
  });

  it("缺省 confirmedForHash 参数按未确认处理（不伪造）", async () => {
    const { bundle } = await bundleOf();
    const snapshot = await createDecisionSnapshot({
      bundle,
      batchId: "LOT-A",
      version: 2,
      humanDecision: "hold",
      reason: "兼容旧调用：缺省参数不得伪造已确认",
      explanationMode: "rules",
      explanationText: "test",
      allEvidence: seed.evidence,
      createdAt: new Date().toISOString(),
      id: "reg-2b",
    });
    expect(snapshot.confirmed_for_hash).toBeNull();
  });

  it("已确认评估保存的快照保留确认指纹，恢复后仍为正式建议", async () => {
    const confirmed = await evaluateConfirmed(seed, "LOT-A");
    expect(confirmed.result.recommendation).toBe("BUY");
    const bundle = {
      input: confirmed.input,
      inputHash: confirmed.inputHash,
      allocation: confirmed.allocation,
      result: confirmed.result,
    };
    const snapshot = await createDecisionSnapshot({
      bundle,
      batchId: "LOT-A",
      version: 3,
      humanDecision: "buy",
      reason: "悲观情景达标且五店可承接，按建议采购",
      explanationMode: "rules",
      explanationText: "test",
      allEvidence: seed.evidence,
      createdAt: new Date().toISOString(),
      id: "reg-2c",
      confirmedForHash: confirmed.inputHash,
    });
    expect(snapshot.confirmed_for_hash).toBe(snapshot.input_hash);
    const restored = evaluateBatchWithHash(
      snapshot.input,
      snapshot.allocation,
      snapshot.confirmed_for_hash,
      snapshot.input_hash
    );
    expect(restored.recommendation).toBe("BUY");
  });
});

describe("缺陷④：改价不得静默删除供应商底价", () => {
  it("报价低于底价时 applyQuotedPrice 保留底价，校验显式报冲突", () => {
    const batch = structuredClone(seed.batches.find((b) => b.id === "LOT-A")!); // 50 元，底价 48
    const next = applyQuotedPrice(batch, 4700);
    expect(next.unit_cost_fen).toBe(4700);
    expect(next.supplier_floor_fen).toBe(4800); // 不静默清空
    expect(floorConflicts(next)).toBe(true);
    const { input } = buildInput(seed, "LOT-A", { batch: { unit_cost_fen: 4700 } });
    const v = validateEvaluation(input);
    expect(v.ok).toBe(false);
    expect(
      v.errors.some(
        (e) => e.field === "batch.supplier_floor_fen" && e.code === "PRICE_ORDER_INVALID"
      )
    ).toBe(true);
  });

  it("只有显式 clearSupplierFloor 才能把底价设为未知", () => {
    const batch = structuredClone(seed.batches.find((b) => b.id === "LOT-A")!);
    const cleared = clearSupplierFloor(batch);
    expect(cleared.supplier_floor_fen).toBeNull();
    expect(floorConflicts(cleared)).toBe(false);
    // 原对象不被修改
    expect(batch.supplier_floor_fen).toBe(4800);
  });
});

describe("缺陷①：新导入批次必须能补齐证据并完成正式评估", () => {
  it("CSV 导入批次带 origin=import，评估输入自动生成报价证据", () => {
    const parsed = parseQuoteCsv(loadCsv("import_template.csv"), []);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.batch.origin).toBe("import");
    const draft: EvaluationDraft = {
      batch_id: parsed.batch.id,
      selected_store_ids: seed.stores.map((s) => s.id),
      scenario_basis: "",
      evidence_ids: [],
      confirmed_for_hash: null,
      updated_at: new Date().toISOString(),
    };
    const input = buildEvaluationInput(
      seed.workspace.evaluation_date,
      parsed.batch,
      draft,
      seed,
      seed.evidence
    );
    const quoteEvidence = input.evidence.find((e) => e.id === `E-${parsed.batch.id}-QUOTE`);
    expect(quoteEvidence).toBeDefined();
    expect(quoteEvidence?.type).toBe("manual");
    // 不硬塞其他批次证据：除自动报价证据外没有任何引用
    expect(input.evidence).toHaveLength(1);
  });

  it("导入批次补齐三情景/政策/依据并确认后形成正式建议（验收断言3）", async () => {
    const parsed = parseQuoteCsv(loadCsv("import_template.csv"), []);
    if (!parsed.ok) throw new Error("csv parse failed");
    const batch = {
      ...parsed.batch,
      policy: structuredClone(seed.batches[1].policy),
      scenarios: structuredClone(seed.batches[1].scenarios),
    };
    const draft: EvaluationDraft = {
      batch_id: batch.id,
      selected_store_ids: seed.stores.map((s) => s.id),
      scenario_basis: "无可比依据，依据买手人工假设，已逐项核实",
      evidence_ids: [],
      confirmed_for_hash: null,
      updated_at: new Date().toISOString(),
    };
    const bundle = await runEvaluation(
      seed.workspace.evaluation_date,
      batch,
      draft,
      seed,
      seed.evidence
    );
    const confirmed = evaluateBatchWithHash(
      bundle.input,
      bundle.allocation,
      bundle.inputHash,
      bundle.inputHash
    );
    expect(confirmed.recommendation).not.toBe("NEEDS_DATA");
    expect(confirmed.missing_fields).toEqual([]);
  });

  it("内置批次不产生自动证据（证据仍完全来自草稿引用）", () => {
    const { input, draft } = buildInput(seed, "LOT-A");
    expect(input.evidence.length).toBeGreaterThan(0);
    expect(input.evidence.every((e) => draft.evidence_ids.includes(e.id))).toBe(true);
  });
});

describe("缺陷⑤：复盘必须落库前校验并成功试算", () => {
  async function buySnapshotAt5600() {
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
      id: "reg-5",
      confirmedForHash: confirmed.inputHash,
    });
  }

  it("单价为安全整数但乘积溢出：校验通过、试算抛溢出，落库前被拦截", async () => {
    const snapshot = await buySnapshotAt5600();
    const review: ActualReview = {
      id: "reg-5a",
      snapshot_id: snapshot.id,
      review_date: "2027-03-01",
      closed_window: true,
      actual_stages: [
        { price_fen: 9007199254740991, units: 1000 }, // 安全整数单价 × 1000 → 乘积溢出
        { price_fen: 0, units: 0 },
      ],
      residual_unit_value_fen: 0,
      procurement_total_fen: 0,
      other_costs_fen: 0,
      note: "",
      created_at: new Date().toISOString(),
    };
    // 字段级校验全部通过（这正是原缺陷：只校验字段就落库）
    expect(validateActualReview(snapshot, review)).toEqual([]);
    // 试算溢出 → 必须阻止落库
    expect(() => calculateReview(snapshot, review)).toThrow();
  });

  it("金标复盘（LOT-B 56 元快照）试算成功且差异 -3,500 元", async () => {
    const snapshot = await buySnapshotAt5600();
    const fixture = seed.actual_review_fixture;
    const review: ActualReview = {
      id: "reg-5b",
      snapshot_id: snapshot.id,
      review_date: fixture.review_date,
      closed_window: true,
      actual_stages: fixture.actual_stages,
      residual_unit_value_fen: fixture.residual_unit_value_fen,
      procurement_total_fen: fixture.procurement_total_fen,
      other_costs_fen: fixture.other_costs_fen,
      note: fixture.note,
      created_at: new Date().toISOString(),
    };
    expect(validateActualReview(snapshot, review)).toEqual([]);
    const result = calculateReview(snapshot, review);
    expect(result.delta_fen).toBe(-350000);
    expect(result.actual_contribution_fen).toBe(3265000);
  });
});
