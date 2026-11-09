/**
 * 离线规则解释。对应 docs/05 §1、§6。
 * 始终可用，无需 API Key；数字由确定性引擎提供，模板只组织语言。
 */

import {
  EvaluationResult,
  EvaluationInput,
  Recommendation,
} from "@/domain/types";
import { formatFen, formatInt } from "@/domain/money";

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  BUY: "可采购",
  NEGOTIATE: "需议价",
  REJECT: "建议放弃",
  REWORK: "方案待调整",
  NEEDS_DATA: "资料待补",
  INVALID: "输入待修正",
};

const TEMPLATES: Record<Recommendation, string> = {
  BUY: "在已确认情景下，当前报价满足悲观贡献目标与采购预算，门店能够承接本批次。请核实销售假设与供应条件后决定。",
  NEGOTIATE:
    "当前报价未满足全部约束。参考悲观情景达标价与预算价上限议价；底价未知时不能确认能谈成。",
  REJECT:
    "按当前报价或已知底价，至少一项硬约束无法满足。查看具体原因，不等同于该品牌永远不值得采购。",
  REWORK:
    "财务情景达标，但存在无法分配到门店的库存。需要修改承接方案并重新核对销售情景。",
  NEEDS_DATA: "资料或情景确认不完整，当前数字仅作预览，暂不形成正式建议。",
  INVALID: "输入待修正，当前不显示正式建议。",
};

export interface RuleExplanation {
  mode: "rules";
  recommendation: Recommendation;
  summary: string;
  reasons: string[];
  risks: string[];
  questions_to_verify: string[];
}

/** 根据 reason_codes 与结构化数字生成规则解释。 */
export function explainByRules(
  input: EvaluationInput,
  result: EvaluationResult
): RuleExplanation {
  const reasons: string[] = [];
  const risks: string[] = [];
  const questions: string[] = [];
  const codes = result.reason_codes;
  const downside = result.scenarios?.downside;
  const base = result.scenarios?.base;

  if (codes.includes("INVALID_INPUT")) {
    reasons.push("存在非法输入（数量、价格顺序或金额精度），请按行内提示修正。");
  }
  if (codes.includes("NOT_CONFIRMED")) {
    reasons.push("情景或关键假设在确认后发生变化，需重新确认后才形成正式建议。");
  }
  if (codes.includes("MISSING_REQUIRED")) {
    reasons.push(`缺少必要资料：${result.missing_fields.join("、")}。`);
  }
  if (codes.includes("QUOTE_EXPIRED")) {
    reasons.push(
      `评估日 ${input.evaluation_date} 晚于报价有效期 ${input.batch.quote_valid_until}，当前报价不可执行。`
    );
  }
  if (codes.includes("ARRIVAL_AFTER_SELLING_END")) {
    reasons.push(
      `到货日期 ${input.batch.arrival_date} 晚于销售截止日 ${input.batch.selling_end_date}，窗口不可执行。`
    );
  }
  if (codes.includes("TARGET_UNREACHABLE")) {
    reasons.push(
      `即使采购价为零，悲观情景也无法达到目标贡献 ${formatFen(input.batch.policy.target_contribution_fen)}。`
    );
  }
  if (codes.includes("PRICE_ABOVE_SAFE_PRICE")) {
    reasons.push(
      `当前报价 ${formatFen(input.batch.unit_cost_fen)} 高于安全达标价 ${formatFen(result.safe_max_price_fen)}（取悲观情景达标价与预算价上限的较低者）。`
    );
  }
  if (codes.includes("BUDGET_LIMIT")) {
    reasons.push(
      `采购预算 ${formatFen(input.batch.policy.budget_fen)} 对应的单价上限为 ${formatFen(result.budget_max_price_fen)}，约束来自预算而非商品本身亏损。`
    );
  }
  if (codes.includes("FLOOR_ABOVE_SAFE_PRICE")) {
    reasons.push(
      `已知供应商底价 ${formatFen(input.batch.supplier_floor_fen)} 仍高于安全达标价 ${formatFen(result.safe_max_price_fen)}，议价也无法达标。`
    );
  }
  if (codes.includes("FLOOR_UNKNOWN")) {
    questions.push("供应商底价是已确认条件还是买手估计？议价可行性未核实。");
  }
  if (codes.includes("UNALLOCATED_REMAINS")) {
    reasons.push(
      `分店后仍有 ${formatInt(result.allocation_summary.total_unallocated)} 件无法承接（留仓），超出部分没有销售去处。`
    );
  }
  if (codes.includes("OK") && downside && base) {
    reasons.push(
      `悲观情景贡献 ${formatFen(downside.contribution_fen)} 达到目标 ${formatFen(input.batch.policy.target_contribution_fen)}；基准情景贡献 ${formatFen(base.contribution_fen)}。`
    );
    reasons.push(
      `采购总支出（含其他增量成本）${formatFen(result.cash_outlay_fen)}，在预算约束内；五档约束均满足。`
    );
  }
  if (result.evidence_strength === "low") {
    risks.push("本批次无可比商品参考，情景依据为显式人工假设，证据强度低。");
  }
  if (downside && downside.contribution_rate === null) {
    risks.push("悲观情景回收总额为零，贡献率不可计算（显示为“—”）。");
  }
  if (result.allocation_summary.total_unallocated > 0) {
    risks.push(
      "留仓商品没有门店承接，若强行采购需要额外清仓渠道，相关损失未计入情景。"
    );
  }
  if (input.batch.comparable_style_id) {
    risks.push("可比商品与本批次并非同一款，销量假设仍需业务验证。");
  }
  if (questions.length === 0 && result.recommendation === "BUY") {
    questions.push("销售窗口内的实际动销是否与悲观假设一致？到货时间是否影响首段销售？");
  }

  return {
    mode: "rules",
    recommendation: result.recommendation,
    summary: TEMPLATES[result.recommendation],
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 5),
    questions_to_verify: questions.slice(0, 5),
  };
}
