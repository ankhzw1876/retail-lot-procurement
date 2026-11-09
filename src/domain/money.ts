/**
 * 金额解析与格式化。人民币字符串 -> 整数分；超过两位小数直接报错，不静默截断。
 * 对应 docs/03 §1。
 */

export type MoneyParseResult =
  | { ok: true; fen: number }
  | { ok: false; code: "INVALID_MONEY"; message: string };

const MONEY_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/** 解析用户输入的人民币金额（元）。允许 "60"、"60.00"、"56.25"；拒绝科学计数法、负数、货币符号、超过两位小数。 */
export function parseMoneyToFen(raw: string): MoneyParseResult {
  const s = raw.trim();
  if (s === "") {
    return { ok: false, code: "INVALID_MONEY", message: "金额不能为空" };
  }
  if (!MONEY_RE.test(s)) {
    if (/[eE]/.test(s)) {
      return { ok: false, code: "INVALID_MONEY", message: "不允许科学计数法，请按普通金额填写" };
    }
    if (/^-/.test(s)) {
      return { ok: false, code: "INVALID_MONEY", message: "金额不能为负数" };
    }
    if (/^\d+\.\d{3,}$/.test(s)) {
      return { ok: false, code: "INVALID_MONEY", message: "金额最多两位小数，不能静默截断" };
    }
    return { ok: false, code: "INVALID_MONEY", message: "金额格式不正确，应为最多两位小数的数字" };
  }
  const [, intPart, decPart] = s.match(MONEY_RE)!;
  const fenStr = intPart.replace(/^0+(?=\d)/, "") + (decPart ?? "").padEnd(2, "0");
  const fen = Number(fenStr === "" ? "0" : fenStr);
  if (!Number.isSafeInteger(fen) || fen < 0) {
    return { ok: false, code: "INVALID_MONEY", message: "金额超出可安全表示范围" };
  }
  return { ok: true, fen };
}

/** 非负整数字符串解析（件数）。 */
export function parseUnits(raw: string): { ok: true; units: number } | { ok: false; code: "INVALID_INTEGER"; message: string } {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) {
    return { ok: false, code: "INVALID_INTEGER", message: "件数须为非负整数" };
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) {
    return { ok: false, code: "INVALID_INTEGER", message: "件数超出可安全表示范围" };
  }
  return { ok: true, units: n };
}

/** 安全整数乘法，溢出返回 null（调用方报 AMOUNT_OVERFLOW）。 */
export function safeMul(a: number, b: number): number | null {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  const r = a * b;
  return Number.isSafeInteger(r) ? r : null;
}

/** 安全整数加法，溢出返回 null。 */
export function safeAdd(...values: number[]): number | null {
  let acc = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) return null;
    acc += v;
    if (!Number.isSafeInteger(acc)) return null;
  }
  return acc;
}

/** 格式化整数分为人民币展示字符串：12900 -> "129.00" */
export function formatFen(fen: number | null | undefined): string {
  if (fen === null || fen === undefined) return "—";
  const sign = fen < 0 ? "-" : "";
  const abs = Math.abs(fen);
  const yuan = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  const grouped = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}¥${grouped}.${cents}`;
}

/** 格式化整数分为纯数字元字符串（千分位）：2625000 -> "26,250.00" */
export function formatFenPlain(fen: number | null | undefined): string {
  if (fen === null || fen === undefined) return "—";
  return formatFen(fen).replace("¥", "");
}

/** 整数分 -> 输入框用的元字符串（两位小数）：5625 -> "56.25" */
export function fenToInput(fen: number): string {
  const sign = fen < 0 ? "-" : "";
  const abs = Math.abs(fen);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 百分比展示；rate 为 0..1 的小数或 null。 */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** 千分位整数。 */
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** ISO 时间戳 → 本地展示（Asia/Shanghai 演示口径）：YYYY-MM-DD HH:mm */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  return d
    .toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/\//g, "-");
}
