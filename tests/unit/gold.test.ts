/**
 * 金标验收 A01–A07、A13–A15：对照 data/expected_results.json 逐字段核对。
 * 测试调用真实实现（validate→fingerprint→allocate→evaluate），不读期望值做运行时结果。
 */

import { describe, it, expect } from "vitest";
import { loadSeed, loadExpected, evaluateConfirmed } from "../helpers";

const seed = loadSeed();
const expected = loadExpected();

describe("金标案例 A01–A03：三批次确认后的完整结果", () => {
  for (const caseExp of expected.cases as any[]) {
    it(`${caseExp.batch_id} 推荐 ${caseExp.recommendation} 且全部字段一致`, async () => {
      const { result, allocation } = await evaluateConfirmed(seed, caseExp.batch_id);

      expect(result.recommendation).toBe(caseExp.recommendation);
      expect(result.safe_max_price_fen).toBe(caseExp.safe_max_price_fen);
      expect(result.budget_max_price_fen).toBe(caseExp.budget_max_price_fen);
      expect(result.cash_outlay_fen).toBe(caseExp.cash_outlay_fen);

      for (const key of ["downside", "base", "upside"] as const) {
        const got = result.scenarios![key];
        const exp = caseExp.scenarios[key];
        expect(got.sold_units, `${key}.sold_units`).toBe(exp.sold_units);
        expect(got.residual_units, `${key}.residual_units`).toBe(exp.residual_units);
        expect(got.sales_revenue_fen, `${key}.sales_revenue_fen`).toBe(exp.sales_revenue_fen);
        expect(got.residual_recovery_fen, `${key}.residual_recovery_fen`).toBe(exp.residual_recovery_fen);
        expect(got.procurement_cost_fen, `${key}.procurement_cost_fen`).toBe(exp.procurement_cost_fen);
        expect(got.other_costs_fen, `${key}.other_costs_fen`).toBe(exp.other_costs_fen);
        expect(got.contribution_fen, `${key}.contribution_fen`).toBe(exp.contribution_fen);
        expect(got.max_price_fen, `${key}.max_price_fen`).toBe(exp.max_price_fen);
        expect(got.break_even_price_fen, `${key}.break_even_price_fen`).toBe(exp.break_even_price_fen);
      }

      // 分店守恒与逐店分配
      expect(allocation.total_allocated).toBe(caseExp.allocation.total_allocated);
      expect(allocation.total_unallocated).toBe(caseExp.allocation.total_unallocated);
      for (const size of ["S", "M", "L", "XL"] as const) {
        const un = allocation.unallocated.find((u) => u.size === size)!;
        expect(un.units, `unallocated.${size}`).toBe(
          caseExp.allocation.unallocated_by_size[size]
        );
      }
      const storeIds = [...new Set(allocation.lines.map((l) => l.store_id))];
      for (const storeId of storeIds) {
        for (const size of ["S", "M", "L", "XL"] as const) {
          const line = allocation.lines.find(
            (l) => l.store_id === storeId && l.size === size
          )!;
          expect(line.units, `${storeId}.${size}`).toBe(
            caseExp.allocation.per_store_units[size]
          );
        }
      }
      // 总分配 + 总留仓 = Q
      expect(allocation.total_allocated + allocation.total_unallocated).toBe(1000);
    });
  }
});

describe("敏感性 A04–A06：LOT-B 议价边界", () => {
  for (const s of expected.sensitivity as any[]) {
    it(`报价 ${s.unit_cost_fen} 分 → ${s.recommendation}`, async () => {
      const { result } = await evaluateConfirmed(seed, "LOT-B", {
        batch: { unit_cost_fen: s.unit_cost_fen },
      });
      expect(result.recommendation).toBe(s.recommendation);
      expect(result.scenarios!.downside.contribution_fen).toBe(
        s.contributions_fen.downside
      );
      expect(result.scenarios!.base.contribution_fen).toBe(
        s.contributions_fen.base
      );
      expect(result.scenarios!.upside.contribution_fen).toBe(
        s.contributions_fen.upside
      );
    });
  }
});

describe("A07：预算收紧导致 REJECT，原因指向预算", () => {
  it("预算 50000 元，底价 55 元高于预算上限 50 元", async () => {
    const { result } = await evaluateConfirmed(seed, "LOT-B", {
      batch: { policy: { other_costs_fen: 800000, target_contribution_fen: 2000000, budget_fen: 5000000 } },
    });
    expect(result.recommendation).toBe("REJECT");
    expect(result.budget_max_price_fen).toBe(5000);
    expect(result.reason_codes).toContain("BUDGET_LIMIT");
    expect(result.reason_codes).toContain("FLOOR_ABOVE_SAFE_PRICE");
  });
});

describe("A15：LOT-A 仅选一店 → 财务达标但 REWORK，留仓 800", () => {
  it("REWORK 且留仓 800 件", async () => {
    const { result, allocation } = await evaluateConfirmed(seed, "LOT-A", {
      draft: { selected_store_ids: ["ST-01"] },
    });
    expect(result.recommendation).toBe("REWORK");
    expect(result.reason_codes).toContain("UNALLOCATED_REMAINS");
    expect(allocation.total_unallocated).toBe(800);
    expect(allocation.total_allocated).toBe(200);
  });
});
