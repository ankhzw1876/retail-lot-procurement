/**
 * 历史可售日统计。对应 docs/03 §5。
 * 可售日均销量 = sum(units_sold) / count(in_stock=true)；可售天数为 0 返回 null。
 * 缺货天数单独报告，不把缺货日当作零需求。
 */

import { DailySale, SellableDayStat, Size, SIZES } from "./types";

export function sellableDayStats(
  sales: DailySale[],
  styleId: string
): SellableDayStat[] {
  const acc = new Map<string, SellableDayStat>();
  for (const row of sales) {
    if (row.style_id !== styleId) continue;
    const key = `${row.store_id}|${row.size}`;
    let stat = acc.get(key);
    if (!stat) {
      stat = {
        store_id: row.store_id,
        size: row.size,
        total_units_sold: 0,
        sellable_days: 0,
        out_of_stock_days: 0,
        avg_units_per_sellable_day: null,
      };
      acc.set(key, stat);
    }
    if (row.in_stock) {
      stat.sellable_days += 1;
      stat.total_units_sold += row.units_sold;
    } else {
      stat.out_of_stock_days += 1;
    }
  }
  const result = [...acc.values()];
  for (const s of result) {
    s.avg_units_per_sellable_day =
      s.sellable_days === 0 ? null : s.total_units_sold / s.sellable_days;
  }
  const sizeOrder = new Map(SIZES.map((s, i) => [s, i]));
  result.sort((a, b) =>
    a.store_id === b.store_id
      ? (sizeOrder.get(a.size) ?? 0) - (sizeOrder.get(b.size) ?? 0)
      : a.store_id < b.store_id
        ? -1
        : 1
  );
  return result;
}

/** 历史窗口（起止日期，含端点）。 */
export function historyWindow(sales: DailySale[]): {
  start: string | null;
  end: string | null;
  days: number;
} {
  if (sales.length === 0) return { start: null, end: null, days: 0 };
  const dates = [...new Set(sales.map((s) => s.date))].sort();
  return { start: dates[0], end: dates[dates.length - 1], days: dates.length };
}
