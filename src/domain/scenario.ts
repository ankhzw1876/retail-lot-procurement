/**
 * 单情景贡献、达标价与盈亏平衡价。对应 docs/03 §2。
 * 全部整数分计算；maxPriceFen 向下取整，可为负，不截成 0。
 */

import { CostPolicy, Scenario, ScenarioResult } from "./types";
import { safeAdd, safeMul } from "./money";

export class AmountOverflowError extends Error {
  code = "AMOUNT_OVERFLOW" as const;
  constructor() {
    super("金额计算超出安全整数范围");
  }
}

export function calculateScenario(
  quantity: number,
  unitCostFen: number,
  policy: CostPolicy,
  scenario: Scenario
): ScenarioResult {
  const [s1, s2] = scenario.stages;
  const r = quantity - s1.units - s2.units;
  if (r < 0) {
    throw new Error("两段销量合计超过批次总量，应先通过输入校验");
  }
  const p1 = safeMul(s1.price_fen, s1.units);
  const p2 = safeMul(s2.price_fen, s2.units);
  const salesRevenue = safeAdd(p1 ?? NaN, p2 ?? NaN);
  const residualRecovery = safeMul(scenario.residual_unit_value_fen, r);
  const procurementCost = safeMul(unitCostFen, quantity);
  if (salesRevenue === null || residualRecovery === null || procurementCost === null) {
    throw new AmountOverflowError();
  }
  const totalRecovery = safeAdd(salesRevenue, residualRecovery);
  const contribution = safeAdd(
    totalRecovery ?? NaN,
    -procurementCost,
    -policy.other_costs_fen
  );
  if (totalRecovery === null || contribution === null) {
    throw new AmountOverflowError();
  }
  const contributionRate =
    totalRecovery === 0 ? null : contribution / totalRecovery;
  // floor 除法：maxPriceFen 可为负
  const maxPrice = Math.floor(
    (totalRecovery - policy.other_costs_fen - policy.target_contribution_fen) /
      quantity
  );
  const breakEvenPrice = Math.floor(
    (totalRecovery - policy.other_costs_fen) / quantity
  );
  if (!Number.isSafeInteger(maxPrice) || !Number.isSafeInteger(breakEvenPrice)) {
    throw new AmountOverflowError();
  }
  return {
    key: scenario.key,
    sold_units: s1.units + s2.units,
    residual_units: r,
    sales_revenue_fen: salesRevenue,
    residual_recovery_fen: residualRecovery,
    procurement_cost_fen: procurementCost,
    other_costs_fen: policy.other_costs_fen,
    contribution_fen: contribution,
    contribution_rate: contributionRate,
    max_price_fen: maxPrice,
    break_even_price_fen: breakEvenPrice,
  };
}

/** 预算价上限：floor(budget/Q)。预算只约束 c*Q，不包含 K。 */
export function budgetMaxPrice(budgetFen: number, quantity: number): number {
  return Math.floor(budgetFen / quantity);
}
