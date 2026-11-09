/**
 * 批次报价/底价编辑的纯函数。对应 docs/03 §5。
 * 改价永不静默修改供应商底价：报价低于已知底价时保留底价，
 * 由 validateEvaluation 报 PRICE_ORDER_INVALID 显式冲突；
 * 只有用户显式操作才能把底价设为未知。
 */

import { Batch } from "@/domain/types";

/** 修改假设报价。只动 unit_cost_fen，绝不动 supplier_floor_fen。 */
export function applyQuotedPrice(batch: Batch, priceFen: number): Batch {
  return { ...batch, unit_cost_fen: priceFen };
}

/** 显式将供应商底价设为未知（唯一的清空入口）。 */
export function clearSupplierFloor(batch: Batch): Batch {
  return { ...batch, supplier_floor_fen: null };
}

/** 当前报价与已知底价冲突（报价低于底价）。 */
export function floorConflicts(batch: Batch): boolean {
  return (
    batch.supplier_floor_fen !== null &&
    batch.unit_cost_fen < batch.supplier_floor_fen
  );
}
