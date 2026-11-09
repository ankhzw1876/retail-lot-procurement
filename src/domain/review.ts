/**
 * 复盘与差异桥接。对应 docs/03 §7。
 * 实际贡献 = 实际销售收入 + 实际净残值 - 实际采购成本 - 实际其他成本。
 * 桥接四项之和 = 实际贡献 - 基准贡献。
 */

import { ActualReview, DecisionSnapshot, ReviewResult } from "./types";
import { safeAdd, safeMul } from "./money";
import { AmountOverflowError } from "./scenario";
import { isValidDate, dateAfter } from "./validation";

export interface ReviewValidationIssue {
  field: string;
  code: string;
  message: string;
}

/** 复盘输入校验：数量守恒、closed_window、review_date 不早于销售截止日。 */
export function validateActualReview(
  snapshot: DecisionSnapshot,
  review: Pick<
    ActualReview,
    | "review_date"
    | "closed_window"
    | "actual_stages"
    | "residual_unit_value_fen"
    | "procurement_total_fen"
    | "other_costs_fen"
  >
): ReviewValidationIssue[] {
  const issues: ReviewValidationIssue[] = [];
  if (snapshot.human_decision !== "buy") {
    issues.push({
      field: "snapshot",
      code: "NOT_PURCHASED",
      message: "仅人工决定为“采购”的快照可以录入实际经营结果",
    });
  }
  if (review.closed_window !== true) {
    issues.push({
      field: "closed_window",
      code: "WINDOW_NOT_CLOSED",
      message: "销售窗口未结束，不能提交最终复盘",
    });
  }
  if (!isValidDate(review.review_date)) {
    issues.push({
      field: "review_date",
      code: "INVALID_DATE",
      message: "复盘日期不是合法日历日期",
    });
  } else if (
    dateAfter(snapshot.input.batch.selling_end_date, review.review_date)
  ) {
    issues.push({
      field: "review_date",
      code: "INVALID_DATE",
      message: "复盘日期必须不早于快照销售截止日",
    });
  }
  const Q = snapshot.input.batch.quantity;
  const totalUnits = safeAdd(
    review.actual_stages[0].units,
    review.actual_stages[1].units
  );
  if (totalUnits === null) {
    issues.push({
      field: "actual_stages",
      code: "AMOUNT_OVERFLOW",
      message: "数量合计超出安全整数范围",
    });
  } else if (totalUnits > Q) {
    issues.push({
      field: "actual_stages",
      code: "TOTAL_EXCEEDED",
      message: `实际销量合计 ${totalUnits} 件超过快照批次总量 ${Q} 件，数量不守恒`,
    });
  }
  for (const [i, st] of review.actual_stages.entries()) {
    if (!Number.isSafeInteger(st.price_fen) || st.price_fen < 0) {
      issues.push({
        field: `actual_stages.${i}.price_fen`,
        code: "INVALID_MONEY",
        message: "实际售价须为非负金额",
      });
    }
    if (!Number.isSafeInteger(st.units) || st.units < 0) {
      issues.push({
        field: `actual_stages.${i}.units`,
        code: "INVALID_INTEGER",
        message: "实际件数须为非负整数",
      });
    }
  }
  for (const [f, v] of [
    ["residual_unit_value_fen", review.residual_unit_value_fen],
    ["procurement_total_fen", review.procurement_total_fen],
    ["other_costs_fen", review.other_costs_fen],
  ] as const) {
    if (!Number.isSafeInteger(v) || v < 0) {
      issues.push({
        field: f,
        code: "INVALID_MONEY",
        message: "金额须为非负整数分",
      });
    }
  }
  return issues;
}

export function calculateReview(
  snapshot: DecisionSnapshot,
  review: ActualReview
): ReviewResult {
  const Q = snapshot.input.batch.quantity;
  const [s1, s2] = review.actual_stages;
  const residualUnits = Q - s1.units - s2.units;
  if (residualUnits < 0) {
    throw new Error("实际销量合计超过批次总量");
  }
  const p1 = safeMul(s1.price_fen, s1.units);
  const p2 = safeMul(s2.price_fen, s2.units);
  const salesRevenue = safeAdd(p1 ?? NaN, p2 ?? NaN);
  const residualRecovery = safeMul(review.residual_unit_value_fen, residualUnits);
  const contribution = safeAdd(
    salesRevenue ?? NaN,
    residualRecovery ?? NaN,
    -review.procurement_total_fen,
    -review.other_costs_fen
  );
  if (salesRevenue === null || residualRecovery === null || contribution === null) {
    throw new AmountOverflowError();
  }

  // 基准 = 快照中的 base 情景结果
  const baseline = snapshot.result.scenarios?.base;
  if (!baseline) {
    throw new Error("快照缺少基准情景结果，无法复盘");
  }
  const bridgeSales = salesRevenue - baseline.sales_revenue_fen;
  const bridgeResidual = residualRecovery - baseline.residual_recovery_fen;
  const bridgeProcurement =
    baseline.procurement_cost_fen - review.procurement_total_fen;
  const bridgeOther = baseline.other_costs_fen - review.other_costs_fen;
  const delta = safeAdd(
    bridgeSales,
    bridgeResidual,
    bridgeProcurement,
    bridgeOther
  );
  if (delta === null) throw new AmountOverflowError();

  return {
    actual_sales_revenue_fen: salesRevenue,
    actual_residual_recovery_fen: residualRecovery,
    actual_contribution_fen: contribution,
    baseline_contribution_fen: baseline.contribution_fen,
    delta_fen: delta,
    bridge_fen: {
      sales_fen: bridgeSales,
      residual_fen: bridgeResidual,
      procurement_fen: bridgeProcurement,
      other_costs_fen: bridgeOther,
    },
  };
}
