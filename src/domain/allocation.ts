/**
 * 简版分店算法（确定性启发式）。对应 docs/03 §6。
 * 逐批独立测算，不对库存或容量做真实预占；比例比较用交叉相乘避免浮点不稳定。
 */

import {
  AllocationLine,
  AllocationResult,
  BatchLine,
  Inventory,
  SIZES,
  Size,
  Store,
  StoreDemand,
  ALLOCATION_VERSION,
} from "./types";

export function allocateBatch(
  batchLines: BatchLine[],
  stores: Store[],
  storeDemand: StoreDemand[],
  inventory: Inventory[],
  selectedStoreIds: string[]
): AllocationResult {
  const activeStores = stores
    .filter((s) => s.active && selectedStoreIds.includes(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const demandOf = new Map<string, number>();
  for (const d of storeDemand) {
    demandOf.set(`${d.store_id}|${d.size}`, d.demand_proxy_units);
  }
  const inventoryOf = new Map<string, number>();
  for (const inv of inventory) {
    inventoryOf.set(`${inv.store_id}|${inv.size}`, inv.units);
  }

  // 每店已分配总量（跨尺码累计）
  const assignedTotal = new Map<string, number>();
  // 每店每尺码已分配
  const assignedSize = new Map<string, number>();
  for (const s of activeStores) {
    assignedTotal.set(s.id, 0);
    for (const size of SIZES) assignedSize.set(`${s.id}|${size}`, 0);
  }

  const lines: AllocationLine[] = [];
  const unallocated: { size: Size; units: number }[] = [];

  for (const size of SIZES) {
    let remaining =
      batchLines.find((l) => l.size === size)?.quantity ?? 0;

    // 本尺码候选上限：min(gap, cap-已分总量)，按本尺码开始时的已分总量确定
    const sizeStartLimit = new Map<string, number>();
    for (const store of activeStores) {
      const key = `${store.id}|${size}`;
      const D = demandOf.get(key) ?? 0;
      const I = inventoryOf.get(key) ?? 0;
      const gap = Math.max(0, D - I);
      const capLeft =
        store.incremental_capacity - (assignedTotal.get(store.id) ?? 0);
      sizeStartLimit.set(store.id, Math.max(0, Math.min(gap, capLeft)));
    }

    while (remaining > 0) {
      // 候选：D>0 且仍有上限的门店
      let best: { storeId: string } | null = null;
      for (const store of activeStores) {
        const key = `${store.id}|${size}`;
        const D = demandOf.get(key) ?? 0;
        if (D <= 0) continue; // D=0 不参与
        const limit = sizeStartLimit.get(store.id) ?? 0;
        const already = assignedSize.get(key) ?? 0;
        if (limit - already <= 0) continue;
        const I = inventoryOf.get(key) ?? 0;
        if (best === null) {
          best = { storeId: store.id };
          continue;
        }
        // 比率 (I + assigned)/D 最低优先；交叉相乘比较
        const bKey = `${best.storeId}|${size}`;
        const bD = demandOf.get(bKey) ?? 0;
        const bI = inventoryOf.get(bKey) ?? 0;
        const bAssigned = assignedSize.get(bKey) ?? 0;
        const lhs = (I + already) * bD;
        const rhs = (bI + bAssigned) * D;
        if (lhs < rhs || (lhs === rhs && store.id < best.storeId)) {
          best = { storeId: store.id };
        }
      }
      if (best === null) break; // 没有候选：本尺码剩余全部留仓
      const key = `${best.storeId}|${size}`;
      assignedSize.set(key, (assignedSize.get(key) ?? 0) + 1);
      assignedTotal.set(best.storeId, (assignedTotal.get(best.storeId) ?? 0) + 1);
      remaining -= 1;
    }

    if (remaining > 0) {
      unallocated.push({ size, units: remaining });
    }
  }

  // 汇总行（含零数量行，保证四尺码都有值）
  for (const store of activeStores) {
    for (const size of SIZES) {
      lines.push({
        store_id: store.id,
        size,
        units: assignedSize.get(`${store.id}|${size}`) ?? 0,
      });
    }
  }
  const unallocatedBySize = new Map<Size, number>(
    SIZES.map((s) => [s, 0] as [Size, number])
  );
  for (const u of unallocated) {
    unallocatedBySize.set(u.size, u.units);
  }
  // 保证四尺码留仓都有值
  const fullUnallocated = SIZES.map((size) => ({
    size,
    units: unallocatedBySize.get(size) ?? 0,
  }));
  const totalAllocated = lines.reduce((acc, l) => acc + l.units, 0);
  const totalUnallocated = fullUnallocated.reduce((acc, u) => acc + u.units, 0);

  return {
    lines,
    unallocated: fullUnallocated,
    total_allocated: totalAllocated,
    total_unallocated: totalUnallocated,
    store_remaining_capacity: activeStores.map((s) => ({
      store_id: s.id,
      units: s.incremental_capacity - (assignedTotal.get(s.id) ?? 0),
    })),
    algorithm_version: ALLOCATION_VERSION,
  };
}
