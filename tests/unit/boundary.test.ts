/**
 * 边界与异常验收：A08–A12、A16–A20。
 */

import { describe, it, expect } from "vitest";
import { loadSeed, evaluateConfirmed, buildInput } from "../helpers";
import { allocateBatch } from "@/domain/allocation";
import {
  evaluateBatch,
  evaluateBatchWithHash,
  normalizeEvaluationInput,
} from "@/domain/recommendation";
import { validateEvaluation } from "@/domain/validation";
import { fingerprint } from "@/domain/fingerprint";
import { SIZES } from "@/domain/types";

const seed = loadSeed();

describe("A08：两段销量合计 1001 件 → INVALID，不保留旧建议", () => {
  it("数量超限报 TOTAL_EXCEEDED", async () => {
    const { input } = buildInput(seed, "LOT-B", {
      batch: {
        scenarios: seed.batches[1].scenarios.map((s) =>
          s.key === "downside"
            ? {
                ...s,
                stages: [
                  { price_fen: 12900, units: 651 },
                  { price_fen: 7900, units: 350 },
                ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
              }
            : s
        ),
      },
    });
    const v = validateEvaluation(input);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.code === "TOTAL_EXCEEDED")).toBe(true);
    const result = await evaluateBatch(
      input,
      allocateBatch(input.batch.lines, seed.stores, seed.store_demand, seed.inventory, input.selected_store_ids),
      null
    );
    expect(result.recommendation).toBe("INVALID");
    expect(result.scenarios).toBeNull();
  });
});

describe("A09：售价顺序 p1<p2 → INVALID", () => {
  it("PRICE_ORDER_INVALID", () => {
    const { input } = buildInput(seed, "LOT-B", {
      batch: {
        scenarios: seed.batches[1].scenarios.map((s) =>
          s.key === "downside"
            ? {
                ...s,
                stages: [
                  { price_fen: 7900, units: 400 },
                  { price_fen: 12900, units: 350 },
                ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
              }
            : s
        ),
      },
    });
    const v = validateEvaluation(input);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.code === "PRICE_ORDER_INVALID")).toBe(true);
  });
});

describe("A10：悲观回收额高于基准 → INVALID", () => {
  it("SCENARIO_ORDER_INVALID", () => {
    const { input } = buildInput(seed, "LOT-B", {
      batch: {
        scenarios: seed.batches[1].scenarios.map((s) => {
          if (s.key === "downside") {
            return {
              ...s,
              stages: [
                { price_fen: 12900, units: 700 },
                { price_fen: 7900, units: 200 },
              ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
            };
          }
          if (s.key === "base") {
            return {
              ...s,
              stages: [
                { price_fen: 12900, units: 300 },
                { price_fen: 7900, units: 300 },
              ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
            };
          }
          return s;
        }),
      },
    });
    const v = validateEvaluation(input);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.code === "SCENARIO_ORDER_INVALID")).toBe(true);
  });
});

describe("A11/A12：未确认或确认后改假设 → NEEDS_DATA，可预览但非正式建议", () => {
  it("confirmed_for_hash 为 null → NEEDS_DATA", async () => {
    const result = await evaluateBatch(
      buildInput(seed, "LOT-A").input,
      allocateBatch(
        seed.batches[0].lines,
        seed.stores,
        seed.store_demand,
        seed.inventory,
        seed.drafts[0].selected_store_ids
      ),
      null
    );
    expect(result.recommendation).toBe("NEEDS_DATA");
    expect(result.reason_codes).toContain("NOT_CONFIRMED");
    // 数字完整时仍可预览
    expect(result.scenarios).not.toBeNull();
  });

  it("确认后修改单价 → 指纹失配 → NEEDS_DATA", async () => {
    const before = await evaluateConfirmed(seed, "LOT-B");
    expect(before.result.recommendation).toBe("NEGOTIATE");
    const { input } = buildInput(seed, "LOT-B", { batch: { unit_cost_fen: 5600 } });
    const allocation = allocateBatch(
      input.batch.lines,
      seed.stores,
      seed.store_demand,
      seed.inventory,
      input.selected_store_ids
    );
    // 沿用旧确认指纹 → 失配
    const result = await evaluateBatch(input, allocation, before.inputHash);
    expect(result.recommendation).toBe("NEEDS_DATA");
    expect(result.reason_codes).toContain("NOT_CONFIRMED");
  });

  it("确定性重跑分店不改变输入指纹", async () => {
    const a = await evaluateConfirmed(seed, "LOT-A");
    const b = await evaluateConfirmed(seed, "LOT-A");
    expect(a.inputHash).toBe(b.inputHash);
    expect(JSON.stringify(a.allocation)).toBe(JSON.stringify(b.allocation));
  });
});

describe("A16：所有门店停用或容量 0 → 总分配 0，留仓 Q，无负库存", () => {
  it("全不选门店", async () => {
    const { allocation, result } = await evaluateConfirmed(seed, "LOT-A", {
      draft: { selected_store_ids: [] },
    });
    expect(allocation.total_allocated).toBe(0);
    expect(allocation.total_unallocated).toBe(1000);
    for (const u of allocation.unallocated) {
      expect(u.units).toBeGreaterThanOrEqual(0);
    }
  });

  it("容量全为 0", () => {
    const stores = seed.stores.map((s) => ({ ...s, incremental_capacity: 0 }));
    const allocation = allocateBatch(
      seed.batches[0].lines,
      stores,
      seed.store_demand,
      seed.inventory,
      stores.map((s) => s.id)
    );
    expect(allocation.total_allocated).toBe(0);
    expect(allocation.total_unallocated).toBe(1000);
    for (const l of allocation.lines) expect(l.units).toBe(0);
  });
});

describe("A17：评估日晚于报价有效期 → REJECT（报价过期）", () => {
  it("QUOTE_EXPIRED", async () => {
    const { result } = await evaluateConfirmed(seed, "LOT-A", {
      evaluationDate: "2027-01-15",
    });
    expect(result.recommendation).toBe("REJECT");
    expect(result.reason_codes).toEqual(["QUOTE_EXPIRED"]);
  });
});

describe("A18：p1=p2=v=0、K=0 → 贡献=-采购成本，贡献率 null，无 NaN", () => {
  it("贡献率为 null", async () => {
    const zeroScenarios = seed.batches[0].scenarios.map((s) => ({
      ...s,
      stages: [
        { price_fen: 0, units: 0 },
        { price_fen: 0, units: 0 },
      ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
      residual_unit_value_fen: 0,
    }));
    const { result } = await evaluateConfirmed(seed, "LOT-A", {
      batch: {
        scenarios: zeroScenarios,
        policy: { other_costs_fen: 0, target_contribution_fen: 0, budget_fen: 10000000 },
      },
    });
    const d = result.scenarios!.downside;
    expect(d.contribution_fen).toBe(-5000000);
    expect(d.contribution_rate).toBeNull();
    expect(Number.isNaN(d.contribution_rate)).toBe(false);
  });
});

describe("A19：收入不足覆盖 K+T → 保留负达标价并 REJECT，不显示 0 元即可买", () => {
  it("safe_max_price_fen < 0 → REJECT", async () => {
    const lowScenarios = seed.batches[0].scenarios.map((s) => ({
      ...s,
      stages: [
        { price_fen: 1000, units: 100 },
        { price_fen: 500, units: 100 },
      ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
      residual_unit_value_fen: 100,
    }));
    const { result } = await evaluateConfirmed(seed, "LOT-A", {
      batch: {
        scenarios: lowScenarios,
        unit_cost_fen: 0,
        supplier_floor_fen: null,
      },
    });
    expect(result.safe_max_price_fen).toBeLessThan(0);
    expect(result.recommendation).toBe("REJECT");
    expect(result.reason_codes).toContain("TARGET_UNREACHABLE");
    expect(result.scenarios!.downside.max_price_fen).toBeLessThan(0);
  });
});

describe("A20：金额乘积超过安全整数 → AMOUNT_OVERFLOW", () => {
  it("溢出被拒绝", async () => {
    const huge = seed.batches[0].scenarios.map((s) => ({
      ...s,
      stages: [
        { price_fen: Number.MAX_SAFE_INTEGER, units: 400 },
        { price_fen: 7900, units: 350 },
      ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
    }));
    const { result } = await evaluateConfirmed(seed, "LOT-A", {
      batch: { scenarios: huge },
    });
    expect(result.recommendation).toBe("INVALID");
    expect(result.scenarios).toBeNull();
  });
});

describe("指纹：键序无关、修改单价必变", () => {
  it("相同输入不同键序 → 相同指纹", async () => {
    const { input } = buildInput(seed, "LOT-A");
    const n1 = normalizeEvaluationInput(input);
    const h1 = await fingerprint(n1);
    // 打乱顶层键序
    const shuffled = Object.fromEntries(Object.entries(n1 as object).reverse());
    const h2 = await fingerprint(shuffled);
    expect(h1).toBe(h2);
  });

  it("修改单价 → 指纹改变", async () => {
    const a = await evaluateConfirmed(seed, "LOT-A");
    const b = await evaluateConfirmed(seed, "LOT-A", { batch: { unit_cost_fen: 5001 } });
    expect(a.inputHash).not.toBe(b.inputHash);
  });

  it("批次行顺序按 S/M/L/XL 枚举排列", () => {
    expect([...SIZES]).toEqual(["S", "M", "L", "XL"]);
  });
});
