/**
 * 领域实体与结果类型。对应 docs/04 数据模型与接口契约。
 * 金额一律整数分；数量为非负整数。
 */

export const SIZES = ["S", "M", "L", "XL"] as const;
export type Size = (typeof SIZES)[number];

export const SCENARIO_KEYS = ["downside", "base", "upside"] as const;
export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

export const ENGINE_VERSION = "batch-eval/1.0.0";
export const ALLOCATION_VERSION = "greedy-size/1.0.0";

export interface Workspace {
  id: string;
  schema_version: number;
  currency: "CNY";
  evaluation_date: string; // YYYY-MM-DD
  engine_version: string;
  synthetic: boolean;
}

export interface BatchLine {
  batch_id: string;
  size: Size;
  quantity: number;
}

export interface CostPolicy {
  other_costs_fen: number;
  target_contribution_fen: number;
  budget_fen: number;
}

export interface ScenarioStage {
  price_fen: number;
  units: number;
}

export interface Scenario {
  key: ScenarioKey;
  stages: [ScenarioStage, ScenarioStage];
  residual_unit_value_fen: number;
}

export type BatchStatus = "new" | "evaluating" | "decided";

export interface Batch {
  id: string;
  name: string;
  brand: string;
  category: string; // P0 仅 hoodie
  demand_group_id: string;
  comparable_style_id: string | null;
  supplier_name: string;
  quantity: number;
  unit_cost_fen: number;
  supplier_floor_fen: number | null;
  quote_valid_until: string;
  arrival_date: string;
  selling_end_date: string;
  /** 导入来源标记：CSV 导入的批次为 "import"；内置批次无此字段 */
  origin?: "import";
  status: BatchStatus;
  lines: BatchLine[];
  policy: CostPolicy;
  scenarios: Scenario[];
}

export interface Store {
  id: string;
  name: string;
  region: string;
  active: boolean;
  incremental_capacity: number;
}

export interface StoreDemand {
  store_id: string;
  demand_group_id: string;
  size: Size;
  demand_proxy_units: number;
}

export interface Inventory {
  store_id: string;
  demand_group_id: string;
  size: Size;
  units: number;
}

export interface ComparableStyle {
  id: string;
  name: string;
  category: string;
  season: string;
  reference_price_fen: number;
  demand_group_id: string;
  why_comparable: string;
  differences: string;
}

export interface DailySale {
  date: string;
  store_id: string;
  style_id: string;
  size: Size;
  units_sold: number;
  in_stock: boolean;
}

export type EvidenceType = "historical" | "manual";

export interface Evidence {
  id: string;
  type: EvidenceType;
  source_ref: string;
  summary: string;
}

export interface EvaluationDraft {
  batch_id: string;
  selected_store_ids: string[];
  scenario_basis: string;
  evidence_ids: string[];
  /** 确认时对应的输入指纹；输入变化后失配即失效 */
  confirmed_for_hash: string | null;
  updated_at: string;
}

export type HumanDecision = "buy" | "negotiate" | "reject" | "hold";
export type ExplanationMode = "rules" | "model";

export interface DecisionSnapshot {
  id: string;
  batch_id: string;
  version: number;
  created_at: string;
  engine_version: string;
  input_hash: string;
  result_hash: string;
  /** 保存快照当时的确认指纹；未确认时为 null，恢复后不得伪造已确认 */
  confirmed_for_hash: string | null;
  input: EvaluationInput;
  result: EvaluationResult;
  allocation: AllocationResult;
  evidence: Evidence[];
  system_recommendation: Recommendation;
  human_decision: HumanDecision;
  reason: string;
  explanation_mode: ExplanationMode;
  explanation_text: string;
}

export interface ActualReview {
  id: string;
  snapshot_id: string;
  review_date: string;
  closed_window: true;
  actual_stages: [ScenarioStage, ScenarioStage];
  residual_unit_value_fen: number;
  procurement_total_fen: number;
  other_costs_fen: number;
  note: string;
  created_at: string;
}

/* ---------- 计算结果 ---------- */

export interface ScenarioResult {
  key: ScenarioKey;
  sold_units: number;
  residual_units: number;
  sales_revenue_fen: number;
  residual_recovery_fen: number;
  procurement_cost_fen: number;
  other_costs_fen: number;
  contribution_fen: number;
  /** 回收总额为零时为 null，界面展示“—” */
  contribution_rate: number | null;
  max_price_fen: number;
  break_even_price_fen: number;
}

export type Recommendation =
  | "BUY"
  | "NEGOTIATE"
  | "REJECT"
  | "REWORK"
  | "NEEDS_DATA"
  | "INVALID";

export type ReasonCode =
  | "INVALID_INPUT"
  | "MISSING_REQUIRED"
  | "NOT_CONFIRMED"
  | "QUOTE_EXPIRED"
  | "ARRIVAL_AFTER_SELLING_END"
  | "TARGET_UNREACHABLE"
  | "FLOOR_ABOVE_SAFE_PRICE"
  | "PRICE_ABOVE_SAFE_PRICE"
  | "FLOOR_UNKNOWN"
  | "BUDGET_LIMIT"
  | "UNALLOCATED_REMAINS"
  | "OK";

export interface AllocationSummary {
  total_allocated: number;
  total_unallocated: number;
  unallocated_by_size: Record<Size, number>;
}

export type EvidenceStrength = "normal" | "low";

export interface EvaluationResult {
  engine_version: string;
  recommendation: Recommendation;
  reason_codes: ReasonCode[];
  scenarios: Record<ScenarioKey, ScenarioResult> | null;
  safe_max_price_fen: number | null;
  budget_max_price_fen: number | null;
  cash_outlay_fen: number | null;
  allocation_summary: AllocationSummary;
  missing_fields: string[];
  evidence_strength: EvidenceStrength;
}

/* ---------- 分店 ---------- */

export interface AllocationLine {
  store_id: string;
  size: Size;
  units: number;
}

export interface AllocationResult {
  lines: AllocationLine[];
  unallocated: { size: Size; units: number }[];
  total_allocated: number;
  total_unallocated: number;
  store_remaining_capacity: { store_id: string; units: number }[];
  algorithm_version: string;
}

/* ---------- 评估输入（指纹规范对象） ---------- */

export interface EvaluationInput {
  evaluation_date: string;
  batch: Omit<Batch, "status">;
  stores: Store[];
  store_demand: StoreDemand[];
  inventory: Inventory[];
  selected_store_ids: string[];
  scenario_basis: string;
  evidence: Evidence[];
}

/* ---------- 复盘 ---------- */

export interface ReviewBridge {
  sales_fen: number;
  residual_fen: number;
  procurement_fen: number;
  other_costs_fen: number;
}

export interface ReviewResult {
  actual_sales_revenue_fen: number;
  actual_residual_recovery_fen: number;
  actual_contribution_fen: number;
  baseline_contribution_fen: number;
  delta_fen: number;
  bridge_fen: ReviewBridge;
}

/* ---------- 历史统计 ---------- */

export interface SellableDayStat {
  store_id: string;
  size: Size;
  total_units_sold: number;
  sellable_days: number;
  out_of_stock_days: number;
  /** 可售日数为 0 时为 null */
  avg_units_per_sellable_day: number | null;
}

/* ---------- 校验 ---------- */

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface CsvError {
  row: number;
  field: string;
  code: string;
  value: string;
  message: string;
}
