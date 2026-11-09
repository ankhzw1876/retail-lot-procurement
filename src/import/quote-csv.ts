/**
 * CSV 报价导入：预检与标准化。对应 docs/04 §2。
 * 自定义解析器：支持引号与逗号，拒绝跨行引号字段；一次返回全部错误；不写库。
 */

import {
  Batch,
  BatchLine,
  CostPolicy,
  CsvError,
  Scenario,
  Size,
  SIZES,
} from "@/domain/types";
import { parseMoneyToFen, parseUnits } from "@/domain/money";
import { isValidDate } from "@/domain/validation";

export const CSV_FIELDS = [
  "batch_id",
  "batch_name",
  "brand",
  "category",
  "supplier_name",
  "size",
  "quantity",
  "unit_cost_cny",
  "supplier_floor_cny",
  "quote_valid_until",
  "arrival_date",
  "selling_end_date",
] as const;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DATA_ROWS = 1000;
const MAX_TOTAL_QUANTITY = 100000;
const ALLOWED_CATEGORY = "hoodie";
export const DEFAULT_DEMAND_GROUP = "G-HOOD-AW";

export interface CsvWarning {
  code: string;
  message: string;
}

export type ParseQuoteCsvResult =
  | {
      ok: true;
      batch: Batch;
      lines: BatchLine[];
      warnings: CsvWarning[];
      summary: {
        total_rows: number;
        total_units: number;
        unit_cost_fen: number;
        duplicate_keys: string[];
      };
    }
  | { ok: false; errors: CsvError[] };

interface RawRow {
  rowNumber: number; // CSV 物理行号（含表头从 1 起）
  fields: Record<string, string>;
}

/** 解析 CSV 文本为物理行。拒绝跨行引号字段。 */
function parseRows(text: string): { rows: string[][]; error: string | null } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  const pushRow = () => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
  };
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        return {
          rows,
          error: "检测到跨行引号字段；本系统不支持字段内换行，请检查第 " + (rows.length + 1) + " 行附近",
        };
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (i + 1 < n && text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) {
    return { rows, error: "引号未闭合，文件可能被截断" };
  }
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  return { rows, error: null };
}

function err(
  row: number,
  field: string,
  code: string,
  value: string,
  message: string
): CsvError {
  return { row, field, code, value, message };
}

export function parseQuoteCsv(
  text: string,
  existingBatchIds: string[]
): ParseQuoteCsvResult {
  const errors: CsvError[] = [];
  const warnings: CsvWarning[] = [];

  // BOM
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);

  const byteLen = new TextEncoder().encode(body).length;
  if (byteLen > MAX_FILE_BYTES) {
    return {
      ok: false,
      errors: [err(0, "file", "FILE_TOO_LARGE", "", "文件超过 2MB 上限")],
    };
  }

  const { rows, error: parseError } = parseRows(body);
  if (parseError) {
    return {
      ok: false,
      errors: [err(0, "file", "PARSE_ERROR", "", parseError)],
    };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      errors: [err(0, "file", "EMPTY_FILE", "", "空文件，无法导入")],
    };
  }

  // 表头
  const header = rows[0].map((h) => h.trim());
  const headerSet = new Set(header);
  for (const f of header) {
    if (!(CSV_FIELDS as readonly string[]).includes(f)) {
      errors.push(err(1, f, "UNKNOWN_FIELD", f, `未知字段 "${f}"`));
    }
  }
  for (const f of CSV_FIELDS) {
    if (!headerSet.has(f)) {
      errors.push(err(1, f, "MISSING_FIELD", "", `缺少必需字段 "${f}"`));
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  if (dataRows.length === 0) {
    return {
      ok: false,
      errors: [err(1, "file", "EMPTY_FILE", "", "仅表头，没有数据行")],
    };
  }
  if (dataRows.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      errors: [
        err(0, "file", "FILE_TOO_LARGE", "", `数据行超过 ${MAX_DATA_ROWS} 行上限`),
      ],
    };
  }

  const idx = new Map(header.map((h, i) => [h, i]));
  const raw: RawRow[] = dataRows.map((r, i) => ({
    rowNumber: i + 2, // 物理行号：表头为第 1 行
    fields: Object.fromEntries(
      CSV_FIELDS.map((f) => [f, (r[idx.get(f)!] ?? "").trim()])
    ),
  }));

  // 单一 batch_id
  const batchIds = [...new Set(raw.map((r) => r.fields.batch_id))];
  if (batchIds.length > 1) {
    for (const r of raw) {
      if (r.fields.batch_id !== batchIds[0]) {
        errors.push(
          err(r.rowNumber, "batch_id", "MIXED_BATCH", r.fields.batch_id, "一次只允许导入一个批次")
        );
      }
    }
    return { ok: false, errors };
  }
  const batchId = batchIds[0];
  if (!/^[\x21-\x7E]+$/.test(batchId)) {
    errors.push(err(raw[0].rowNumber, "batch_id", "MISSING_REQUIRED", batchId, "批次 ID 须为非空 ASCII 字符串"));
  }
  if (existingBatchIds.includes(batchId)) {
    errors.push(
      err(raw[0].rowNumber, "batch_id", "ID_EXISTS", batchId, `批次 ${batchId} 已存在，请修改批次号；系统不会覆盖已有工作`)
    );
  }

  // 行数与尺码
  if (raw.length > 4) {
    errors.push(err(0, "file", "TOTAL_EXCEEDED", "", "一个批次最多四条尺码行"));
  }
  const seenSizes = new Set<string>();
  const duplicateKeys: string[] = [];
  for (const r of raw) {
    const key = `${r.fields.batch_id}+${r.fields.size}`;
    if (seenSizes.has(r.fields.size)) {
      duplicateKeys.push(key);
      errors.push(
        err(r.rowNumber, "size", "DUPLICATE_SIZE", r.fields.size, "同一批次同一尺码重复，请合并为一行；系统不自动合并")
      );
    }
    seenSizes.add(r.fields.size);
  }

  // 元数据逐行一致
  const metaFields = [
    "batch_name",
    "brand",
    "category",
    "supplier_name",
    "unit_cost_cny",
    "quote_valid_until",
    "arrival_date",
    "selling_end_date",
  ] as const;
  for (const f of metaFields) {
    const values = new Set(raw.map((r) => r.fields[f]));
    if (values.size > 1) {
      for (const r of raw) {
        errors.push(
          err(r.rowNumber, f, "INCONSISTENT_METADATA", r.fields[f], `字段 ${f} 在同一批次内必须逐行一致`)
        );
      }
    }
  }
  const floorValues = new Set(raw.map((r) => r.fields.supplier_floor_cny));
  if (floorValues.size > 1) {
    for (const r of raw) {
      errors.push(
        err(r.rowNumber, "supplier_floor_cny", "INCONSISTENT_METADATA", r.fields.supplier_floor_cny, "供应商底价非空时所有行必须相同")
      );
    }
  }

  const first = raw[0];
  // 枚举
  if (first.fields.category !== ALLOWED_CATEGORY) {
    errors.push(
      err(first.rowNumber, "category", "UNSUPPORTED_CATEGORY", first.fields.category, "第一版仅支持品类 hoodie")
    );
  }
  for (const r of raw) {
    if (!(SIZES as readonly string[]).includes(r.fields.size)) {
      errors.push(err(r.rowNumber, "size", "UNSUPPORTED_SIZE", r.fields.size, "尺码仅允许 S/M/L/XL"));
    }
  }

  // 数量
  let totalUnits = 0;
  let anyPositive = false;
  const lineQuantities = new Map<Size, number>();
  for (const r of raw) {
    const q = parseUnits(r.fields.quantity);
    if (!q.ok) {
      errors.push(err(r.rowNumber, "quantity", q.code, r.fields.quantity, q.message));
    } else {
      totalUnits += q.units;
      if (q.units > 0) anyPositive = true;
      lineQuantities.set(r.fields.size as Size, q.units);
    }
  }
  if (anyPositive === false && errors.length === 0) {
    errors.push(err(raw[0].rowNumber, "quantity", "INVALID_INTEGER", "", "至少一行数量须大于 0"));
  }
  if (totalUnits > MAX_TOTAL_QUANTITY) {
    errors.push(
      err(0, "quantity", "TOTAL_EXCEEDED", String(totalUnits), `批次总量 ${totalUnits} 超过 ${MAX_TOTAL_QUANTITY} 件上限`)
    );
  }

  // 金额
  const unitCost = parseMoneyToFen(first.fields.unit_cost_cny);
  if (!unitCost.ok) {
    errors.push(err(first.rowNumber, "unit_cost_cny", unitCost.code, first.fields.unit_cost_cny, unitCost.message));
  }
  let floorFen: number | null = null;
  const floorRaw = first.fields.supplier_floor_cny;
  if (floorRaw !== "") {
    const f = parseMoneyToFen(floorRaw);
    if (!f.ok) {
      errors.push(err(first.rowNumber, "supplier_floor_cny", f.code, floorRaw, f.message));
    } else {
      floorFen = f.fen;
      if (unitCost.ok && floorFen > unitCost.fen) {
        errors.push(
          err(first.rowNumber, "supplier_floor_cny", "PRICE_ORDER_INVALID", floorRaw, "供应商底价不能高于当前报价")
        );
      }
    }
  }

  // 日期
  const dateFields = [
    ["quote_valid_until", "报价有效期"],
    ["arrival_date", "到货日期"],
    ["selling_end_date", "销售截止日"],
  ] as const;
  for (const [f, label] of dateFields) {
    if (!isValidDate(first.fields[f])) {
      errors.push(err(first.rowNumber, f, "INVALID_DATE", first.fields[f], `${label}不是合法日历日期（如 2026-02-30 不存在）`));
    }
  }
  if (
    isValidDate(first.fields.arrival_date) &&
    isValidDate(first.fields.selling_end_date) &&
    first.fields.arrival_date > first.fields.selling_end_date
  ) {
    errors.push(
      err(first.rowNumber, "arrival_date", "INVALID_DATE", first.fields.arrival_date, "到货日期必须早于或等于销售截止日")
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors.sort((a, b) => a.row - b.row) };
  }

  // 过期报价允许导入但醒目提示
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai",
  });
  if (first.fields.quote_valid_until < today) {
    warnings.push({
      code: "QUOTE_EXPIRED",
      message: `报价有效期 ${first.fields.quote_valid_until} 已早于今天 ${today}，导入后该报价不可执行`,
    });
  }

  // 标准化：缺失尺码补零
  const lines: BatchLine[] = SIZES.map((size) => ({
    batch_id: batchId,
    size,
    quantity: lineQuantities.get(size) ?? 0,
  }));

  const emptyScenarios: Scenario[] = (
    [
      ["downside"],
      ["base"],
      ["upside"],
    ] as const
  ).map(([key]) => ({
    key,
    stages: [
      { price_fen: 0, units: 0 },
      { price_fen: 0, units: 0 },
    ],
    residual_unit_value_fen: 0,
  }));

  const policy: CostPolicy = {
    other_costs_fen: 0,
    target_contribution_fen: 0,
    budget_fen: 0,
  };

  const batch: Batch = {
    id: batchId,
    name: first.fields.batch_name,
    brand: first.fields.brand,
    category: first.fields.category,
    demand_group_id: DEFAULT_DEMAND_GROUP,
    comparable_style_id: null,
    supplier_name: first.fields.supplier_name,
    quantity: totalUnits,
    unit_cost_fen: unitCost.ok ? unitCost.fen : 0,
    supplier_floor_fen: floorFen,
    quote_valid_until: first.fields.quote_valid_until,
    arrival_date: first.fields.arrival_date,
    selling_end_date: first.fields.selling_end_date,
    origin: "import",
    status: "new",
    lines,
    policy,
    scenarios: emptyScenarios,
  };

  return {
    ok: true,
    batch,
    lines,
    warnings,
    summary: {
      total_rows: raw.length,
      total_units: totalUnits,
      unit_cost_fen: unitCost.ok ? unitCost.fen : 0,
      duplicate_keys: duplicateKeys,
    },
  };
}
