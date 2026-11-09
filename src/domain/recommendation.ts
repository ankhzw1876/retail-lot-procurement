/**
 * 推荐规则与优先级。对应 docs/03 §3。
 * 按顺序返回第一条命中的主状态，同时保留风险/原因列表。
 */

import {
  AllocationResult,
  AllocationSummary,
  EvaluationInput,
  EvaluationResult,
  ReasonCode,
  Recommendation,
  ScenarioResult,
  SIZES,
  ENGINE_VERSION,
} from "./types";
import { validateEvaluation, findMissingFields, dateAfter } from "./validation";
import { calculateScenario, budgetMaxPrice, AmountOverflowError } from "./scenario";
import { fingerprint } from "./fingerprint";

export function allocationSummaryOf(a: AllocationResult): AllocationSummary {
  return {
    total_allocated: a.total_allocated,
    total_unallocated: a.total_unallocated,
    unallocated_by_size: {
      S: a.unallocated.find((u) => u.size === "S")?.units ?? 0,
      M: a.unallocated.find((u) => u.size === "M")?.units ?? 0,
      L: a.unallocated.find((u) => u.size === "L")?.units ?? 0,
      XL: a.unallocated.find((u) => u.size === "XL")?.units ?? 0,
    },
  };
}

function emptySummary(): AllocationSummary {
  return {
    total_allocated: 0,
    total_unallocated: 0,
    unallocated_by_size: { S: 0, M: 0, L: 0, XL: 0 },
  };
}

/**
 * 评估主函数。confirmedForHash 与当前输入指纹不一致时，正式推荐回到 NEEDS_DATA。
 * NEEDS_DATA 下若数字完整，scenarios 等仍给出预览值。
 */
export async function evaluateBatch(
  input: EvaluationInput,
  allocation: AllocationResult,
  confirmedForHash: string | null
): Promise<EvaluationResult> {
  const inputHash = await fingerprint(normalizeEvaluationInput(input));
  return evaluateBatchWithHash(input, allocation, confirmedForHash, inputHash);
}

/** 与 evaluateBatch 相同，但由调用方提供已算好的输入指纹（避免重复计算）。 */
export function evaluateBatchWithHash(
  input: EvaluationInput,
  allocation: AllocationResult,
  confirmedForHash: string | null,
  inputHash: string
): EvaluationResult {
  const summary = allocationSummaryOf(allocation);
  const base: Omit<EvaluationResult, "recommendation" | "reason_codes"> = {
    engine_version: ENGINE_VERSION,
    scenarios: null,
    safe_max_price_fen: null,
    budget_max_price_fen: null,
    cash_outlay_fen: null,
    allocation_summary: summary,
    missing_fields: [],
    evidence_strength: "normal",
  };

  // 1. 输入非法 → INVALID
  const validation = validateEvaluation(input);
  if (!validation.ok) {
    return {
      ...base,
      recommendation: "INVALID",
      reason_codes: ["INVALID_INPUT"],
      allocation_summary: emptySummary(),
    };
  }

  // 计算三情景（此时输入合法，公式不会抛数量错误；溢出仍可能）
  let scenarios: Record<string, ScenarioResult>;
  try {
    scenarios = {
      downside: calculateScenario(
        input.batch.quantity,
        input.batch.unit_cost_fen,
        input.batch.policy,
        input.batch.scenarios.find((s) => s.key === "downside")!
      ),
      base: calculateScenario(
        input.batch.quantity,
        input.batch.unit_cost_fen,
        input.batch.policy,
        input.batch.scenarios.find((s) => s.key === "base")!
      ),
      upside: calculateScenario(
        input.batch.quantity,
        input.batch.unit_cost_fen,
        input.batch.policy,
        input.batch.scenarios.find((s) => s.key === "upside")!
      ),
    };
  } catch (e) {
    if (e instanceof AmountOverflowError) {
      return {
        ...base,
        recommendation: "INVALID",
        reason_codes: ["INVALID_INPUT"],
        allocation_summary: emptySummary(),
      };
    }
    throw e;
  }

  const typedScenarios = scenarios as EvaluationResult["scenarios"];
  const downsideMax = scenarios.downside.max_price_fen;
  const budgetMax = budgetMaxPrice(input.batch.policy.budget_fen, input.batch.quantity);
  const safeMax = Math.min(downsideMax, budgetMax);
  const cashOutlay =
    scenarios.downside.procurement_cost_fen + input.batch.policy.other_costs_fen;

  const computed: Omit<EvaluationResult, "recommendation" | "reason_codes"> = {
    ...base,
    scenarios: typedScenarios,
    safe_max_price_fen: safeMax,
    budget_max_price_fen: budgetMax,
    cash_outlay_fen: cashOutlay,
  };

  const hasComparable = input.batch.comparable_style_id !== null;
  const explicitNoComparable = /无可比依据/.test(input.scenario_basis);
  const evidenceStrength =
    !hasComparable && explicitNoComparable ? "low" : "normal";

  // 2. 缺资料或没有确认 → NEEDS_DATA
  const missing = findMissingFields(input);
  const confirmed = confirmedForHash !== null && confirmedForHash === inputHash;
  if (missing.length > 0 || !confirmed) {
    const codes: ReasonCode[] = [];
    if (missing.length > 0) codes.push("MISSING_REQUIRED");
    if (!confirmed) codes.push("NOT_CONFIRMED");
    return {
      ...computed,
      recommendation: "NEEDS_DATA",
      reason_codes: codes,
      missing_fields: missing,
      evidence_strength: evidenceStrength,
    };
  }

  const decision = decideFormal(input, scenarios, safeMax, budgetMax, downsideMax, summary);
  return {
    ...computed,
    recommendation: decision.recommendation,
    reason_codes: decision.reason_codes,
    missing_fields: [],
    evidence_strength: evidenceStrength,
  };
}

function decideFormal(
  input: EvaluationInput,
  scenarios: Record<"downside" | "base" | "upside", ScenarioResult>,
  safeMax: number,
  budgetMax: number,
  downsideMax: number,
  summary: AllocationSummary
): { recommendation: Recommendation; reason_codes: ReasonCode[] } {
  const { batch } = input;
  const budgetLimited = budgetMax < downsideMax;

  // 3. 报价不可执行
  if (dateAfter(input.evaluation_date, batch.quote_valid_until)) {
    return { recommendation: "REJECT", reason_codes: ["QUOTE_EXPIRED"] };
  }
  if (dateAfter(batch.arrival_date, batch.selling_end_date)) {
    return { recommendation: "REJECT", reason_codes: ["ARRIVAL_AFTER_SELLING_END"] };
  }
  // 4. 零采购价也无法达标
  if (safeMax < 0) {
    const codes: ReasonCode[] = ["TARGET_UNREACHABLE"];
    if (budgetLimited) codes.push("BUDGET_LIMIT");
    return { recommendation: "REJECT", reason_codes: codes };
  }
  // 5./6. 当前价高于安全达标价
  if (batch.unit_cost_fen > safeMax) {
    const codes: ReasonCode[] = ["PRICE_ABOVE_SAFE_PRICE"];
    if (budgetLimited) codes.push("BUDGET_LIMIT");
    if (batch.supplier_floor_fen !== null && batch.supplier_floor_fen > safeMax) {
      codes.push("FLOOR_ABOVE_SAFE_PRICE");
      return { recommendation: "REJECT", reason_codes: codes };
    }
    if (batch.supplier_floor_fen === null) {
      codes.push("FLOOR_UNKNOWN");
    }
    return { recommendation: "NEGOTIATE", reason_codes: codes };
  }
  // 7. 财务达标但存在留仓
  if (summary.total_unallocated > 0) {
    return { recommendation: "REWORK", reason_codes: ["UNALLOCATED_REMAINS"] };
  }
  // 8. 可采购
  return { recommendation: "BUY", reason_codes: ["OK"] };
}

/**
 * 规范输入对象：数组按键序/枚举序排列后用于指纹。
 * batch 移除 status；不含 draft/confirmed_for_hash；时间戳、AI 文本不进入。
 */
export function normalizeEvaluationInput(input: EvaluationInput): unknown {
  const sizeOrder = new Map(SIZES.map((s, i) => [s, i]));
  const scenarioOrder = new Map([
    ["downside", 0],
    ["base", 1],
    ["upside", 2],
  ]);
  const byId = <T extends { id: string }>(arr: T[]) =>
    [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const { status: _status, ...batchRest } = input.batch as typeof input.batch & {
    status?: string;
  };
  return {
    evaluation_date: input.evaluation_date,
    batch: {
      ...batchRest,
      lines: [...input.batch.lines].sort(
        (a, b) => (sizeOrder.get(a.size) ?? 0) - (sizeOrder.get(b.size) ?? 0)
      ),
      scenarios: [...input.batch.scenarios].sort(
        (a, b) => (scenarioOrder.get(a.key) ?? 0) - (scenarioOrder.get(b.key) ?? 0)
      ),
    },
    stores: byId(input.stores),
    store_demand: [...input.store_demand].sort((a, b) =>
      a.store_id === b.store_id
        ? (sizeOrder.get(a.size) ?? 0) - (sizeOrder.get(b.size) ?? 0)
        : a.store_id < b.store_id
          ? -1
          : 1
    ),
    inventory: [...input.inventory].sort((a, b) =>
      a.store_id === b.store_id
        ? (sizeOrder.get(a.size) ?? 0) - (sizeOrder.get(b.size) ?? 0)
        : a.store_id < b.store_id
          ? -1
          : 1
    ),
    selected_store_ids: [...input.selected_store_ids].sort(),
    scenario_basis: input.scenario_basis,
    evidence: byId(input.evidence),
  };
}
