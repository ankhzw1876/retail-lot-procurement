/**
 * 输入、日期、金额、数量和情景验证。对应 docs/03 §1、§2 与 docs/04。
 */

import {
  Batch,
  EvaluationInput,
  Scenario,
  ScenarioKey,
  SCENARIO_KEYS,
  ValidationError,
} from "./types";
import { safeAdd, safeMul } from "./money";

/** 合法 ISO 日期 YYYY-MM-DD，且必须是真实日历日期。 */
export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/** 按日期字符串比较（YYYY-MM-DD 字典序即时间序）。a > b 返回 true。 */
export function dateAfter(a: string, b: string): boolean {
  return a > b;
}

function err(field: string, code: string, message: string): ValidationError {
  return { field, code, message };
}

/** 单情景合法性：q1+q2<=Q；p1>=p2>=v>=0；金额乘法不溢出。 */
export function validateScenario(
  scenario: Scenario,
  quantity: number,
  prefix: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  const [s1, s2] = scenario.stages;
  const v = scenario.residual_unit_value_fen;
  for (const [i, st] of scenario.stages.entries()) {
    if (!Number.isSafeInteger(st.units) || st.units < 0) {
      errors.push(err(`${prefix}.stages.${i}.units`, "INVALID_INTEGER", "件数须为非负整数"));
    }
    if (!Number.isSafeInteger(st.price_fen) || st.price_fen < 0) {
      errors.push(err(`${prefix}.stages.${i}.price_fen`, "INVALID_MONEY", "售价须为非负金额"));
    }
  }
  if (!Number.isSafeInteger(v) || v < 0) {
    errors.push(err(`${prefix}.residual_unit_value_fen`, "INVALID_MONEY", "残值须为非负金额"));
  }
  if (errors.length > 0) return errors;

  const totalUnits = safeAdd(s1.units, s2.units);
  if (totalUnits === null) {
    errors.push(err(`${prefix}.stages`, "AMOUNT_OVERFLOW", "数量合计超出安全整数范围"));
  } else if (totalUnits > quantity) {
    errors.push(
      err(
        `${prefix}.stages`,
        "TOTAL_EXCEEDED",
        `两段销量合计 ${totalUnits} 件超过批次总量 ${quantity} 件`
      )
    );
  }
  if (!(s1.price_fen >= s2.price_fen && s2.price_fen >= v)) {
    errors.push(
      err(
        `${prefix}.stages`,
        "PRICE_ORDER_INVALID",
        "价格须满足：首段售价 ≥ 折价段售价 ≥ 期末净残值单价"
      )
    );
  }
  return errors;
}

/** 情景回收总额（销售收入+期末回收），用于三情景顺序校验。 */
export function scenarioRecoveryTotal(
  scenario: Scenario,
  quantity: number
): number | null {
  const [s1, s2] = scenario.stages;
  const r = quantity - s1.units - s2.units;
  const p1 = safeMul(s1.price_fen, s1.units);
  const p2 = safeMul(s2.price_fen, s2.units);
  const rv = safeMul(scenario.residual_unit_value_fen, r);
  if (p1 === null || p2 === null || rv === null) return null;
  return safeAdd(p1, p2, rv);
}

/** 三情景回收总额须满足 悲观<=基准<=乐观。不自动交换标签。 */
export function validateScenarioOrder(
  scenarios: Scenario[],
  quantity: number
): ValidationError[] {
  const totals = new Map<ScenarioKey, number | null>();
  for (const sc of scenarios) {
    totals.set(sc.key, scenarioRecoveryTotal(sc, quantity));
  }
  const d = totals.get("downside");
  const b = totals.get("base");
  const u = totals.get("upside");
  if (d == null || b == null || u == null) {
    return [err("scenarios", "AMOUNT_OVERFLOW", "金额计算超出安全整数范围")];
  }
  if (!(d <= b && b <= u)) {
    return [
      err(
        "scenarios",
        "SCENARIO_ORDER_INVALID",
        "三情景回收总额须满足 悲观 ≤ 基准 ≤ 乐观；请重新命名或调整输入，系统不自动交换标签"
      ),
    ];
  }
  return [];
}

/** 评估输入整体校验。返回错误列表；为空表示输入合法。 */
export function validateEvaluation(input: EvaluationInput): {
  ok: boolean;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];
  const { batch } = input;

  if (!isValidDate(input.evaluation_date)) {
    errors.push(err("evaluation_date", "INVALID_DATE", "评估日不是合法日期"));
  }
  if (!batch.id || !/^[\x21-\x7E]+$/.test(batch.id)) {
    errors.push(err("batch.id", "MISSING_REQUIRED", "批次 ID 须为非空 ASCII 字符串"));
  }
  if (!Number.isSafeInteger(batch.quantity) || batch.quantity <= 0) {
    errors.push(err("batch.quantity", "INVALID_INTEGER", "采购数量须为正整数"));
  }
  if (!Number.isSafeInteger(batch.unit_cost_fen) || batch.unit_cost_fen < 0) {
    errors.push(err("batch.unit_cost_fen", "INVALID_MONEY", "采购单价须为非负金额"));
  }
  if (batch.supplier_floor_fen !== null) {
    if (
      !Number.isSafeInteger(batch.supplier_floor_fen) ||
      batch.supplier_floor_fen < 0
    ) {
      errors.push(err("batch.supplier_floor_fen", "INVALID_MONEY", "供应商底价须为非负金额"));
    } else if (batch.supplier_floor_fen > batch.unit_cost_fen) {
      errors.push(
        err("batch.supplier_floor_fen", "PRICE_ORDER_INVALID", "供应商底价不能高于当前报价")
      );
    }
  }
  for (const f of [
    ["quote_valid_until", batch.quote_valid_until, "报价有效期"],
    ["arrival_date", batch.arrival_date, "到货日期"],
    ["selling_end_date", batch.selling_end_date, "销售截止日"],
  ] as const) {
    if (!isValidDate(f[1])) {
      errors.push(err(`batch.${f[0]}`, "INVALID_DATE", `${f[2]}不是合法日历日期`));
    }
  }
  if (isValidDate(batch.arrival_date) && isValidDate(batch.selling_end_date)) {
    if (dateAfter(batch.arrival_date, batch.selling_end_date)) {
      errors.push(
        err("batch.arrival_date", "INVALID_DATE", "到货日期必须早于或等于销售截止日")
      );
    }
  }
  // 尺码行：四尺码齐全、数量守恒
  const lineTotal = safeAdd(...batch.lines.map((l) => l.quantity));
  if (lineTotal === null) {
    errors.push(err("batch.lines", "AMOUNT_OVERFLOW", "尺码数量合计超出安全整数范围"));
  } else if (lineTotal !== batch.quantity) {
    errors.push(
      err("batch.lines", "TOTAL_EXCEEDED", "尺码明细数量总和须等于批次总量")
    );
  }
  const sizes = new Set(batch.lines.map((l) => l.size));
  for (const s of ["S", "M", "L", "XL"] as const) {
    if (!sizes.has(s)) {
      errors.push(err("batch.lines", "MISSING_REQUIRED", `缺少尺码 ${s} 的明细行（可为 0 件）`));
    }
  }
  // 成本政策
  const policyFields: [string, number, string][] = [
    ["other_costs_fen", batch.policy.other_costs_fen, "其他增量成本"],
    ["target_contribution_fen", batch.policy.target_contribution_fen, "目标贡献"],
    ["budget_fen", batch.policy.budget_fen, "采购预算"],
  ];
  for (const [f, val, label] of policyFields) {
    if (!Number.isSafeInteger(val) || val < 0) {
      errors.push(err(`batch.policy.${f}`, "INVALID_MONEY", `${label}须为非负金额`));
    }
  }
  // 情景
  if (batch.quantity > 0) {
    const keys = new Set(batch.scenarios.map((s) => s.key));
    for (const k of SCENARIO_KEYS) {
      if (!keys.has(k)) {
        errors.push(err("batch.scenarios", "MISSING_REQUIRED", `缺少情景 ${k}`));
      }
    }
    for (const sc of batch.scenarios) {
      errors.push(...validateScenario(sc, batch.quantity, `batch.scenarios.${sc.key}`));
    }
    if (errors.length === 0) {
      errors.push(...validateScenarioOrder(batch.scenarios, batch.quantity));
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 必需信息检查（docs/03 §3）。返回缺失字段描述列表。
 * 缺资料 → NEEDS_DATA，与“输入非法 → INVALID”区分。
 */
export function findMissingFields(input: EvaluationInput): string[] {
  const missing: string[] = [];
  const { batch } = input;
  if (!batch.name.trim()) missing.push("批次名称");
  if (!batch.brand.trim()) missing.push("品牌");
  if (!batch.supplier_name.trim()) missing.push("供应商名称");
  if (!batch.quote_valid_until) missing.push("报价有效期");
  if (!batch.arrival_date) missing.push("到货日期");
  if (!batch.selling_end_date) missing.push("销售截止日");
  if (batch.lines.length === 0) missing.push("尺码明细");
  if (batch.scenarios.length < 3) missing.push("三情景假设");
  if (!input.scenario_basis.trim()) {
    missing.push("情景依据说明");
  }
  const hasComparable = batch.comparable_style_id !== null;
  const hasExplicitNoComparable = /无可比依据/.test(input.scenario_basis);
  if (!hasComparable && !hasExplicitNoComparable) {
    missing.push("可比参考（选择可比商品或显式说明“无可比依据”）");
  }
  if (input.evidence.length === 0) missing.push("证据引用");
  if (input.selected_store_ids.length === 0) missing.push("参与门店");
  if (input.store_demand.length === 0) missing.push("门店需求代理量");
  if (input.inventory.length === 0) missing.push("门店现有库存");
  return missing;
}
