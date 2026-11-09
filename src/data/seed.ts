/**
 * 种子初始化与重置。对应 docs/06 阶段B。
 * 幂等：不覆盖已有用户草稿；重置需用户确认后原子清空业务 store 并重新载入 seed。
 */

import { getDb } from "./repository";
import {
  ActualReview,
  Batch,
  ComparableStyle,
  DailySale,
  EvaluationDraft,
  Evidence,
  Inventory,
  Store,
  StoreDemand,
  Workspace,
} from "@/domain/types";

export interface DemoSeed {
  workspace: Workspace;
  batches: Batch[];
  stores: Store[];
  store_demand: StoreDemand[];
  inventory: Inventory[];
  comparables: ComparableStyle[];
  drafts: EvaluationDraft[];
  evidence: Evidence[];
  actual_review_fixture: {
    required_batch_id: string;
    required_unit_cost_fen: number;
    closed_window: true;
    actual_stages: [{ price_fen: number; units: number }, { price_fen: number; units: number }];
    residual_unit_value_fen: number;
    procurement_total_fen: number;
    other_costs_fen: number;
    note: string;
    review_date: string;
  };
}

export interface StaticCache {
  workspace: Workspace;
  stores: Store[];
  store_demand: StoreDemand[];
  inventory: Inventory[];
  comparables: ComparableStyle[];
  evidence: Evidence[];
  history: DailySale[];
  actual_review_fixture: DemoSeed["actual_review_fixture"];
  /** 内置演示批次：固定使用演示评估日；导入批次用浏览器当天 */
  seed_batch_ids: string[];
}

/** 每批次评估日（docs/03 §1）：内置案例固定演示评估日；新导入批次用浏览器 Asia/Shanghai 当天。 */
export function evaluationDateFor(batchId: string, staticData: StaticCache): string {
  if ((staticData.seed_batch_ids ?? []).includes(batchId)) {
    return staticData.workspace.evaluation_date;
  }
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

const SEED_VERSION = "demo-seed/1.0.0";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载静态资源失败：${url}（HTTP ${res.status}）`);
  return (await res.json()) as T;
}

export async function loadStaticSeed(): Promise<{
  seed: DemoSeed;
  history: DailySale[];
}> {
  const [seed, history] = await Promise.all([
    fetchJson<DemoSeed>("/demo/demo_seed.json"),
    fetchJson<DailySale[]>("/demo/historical_sales.json"),
  ]);
  return { seed, history };
}

/** 首次进入载入示例：幂等，已有草稿/快照不清空。 */
export async function ensureSeeded(): Promise<{ already: boolean }> {
  const db = getDb();
  const meta = await db.seedMeta.get("demo");
  const staticSeed = await loadStaticSeed();

  // 静态数据（门店/需求/库存/可比/证据/历史）缓存到 settings，供离线恢复
  const staticCache: StaticCache = {
    workspace: staticSeed.seed.workspace,
    stores: staticSeed.seed.stores,
    store_demand: staticSeed.seed.store_demand,
    inventory: staticSeed.seed.inventory,
    comparables: staticSeed.seed.comparables,
    evidence: staticSeed.seed.evidence,
    history: staticSeed.history,
    actual_review_fixture: staticSeed.seed.actual_review_fixture,
    seed_batch_ids: staticSeed.seed.batches.map((b) => b.id),
  };
  await db.settings.put({ key: "static", value: staticCache });

  if (meta) return { already: true };

  await db.transaction("rw", [db.batches, db.drafts, db.seedMeta], async () => {
    for (const batch of staticSeed.seed.batches) {
      const exists = await db.batches.get(batch.id);
      if (!exists) await db.batches.add(batch);
    }
    for (const draft of staticSeed.seed.drafts) {
      const exists = await db.drafts.get(draft.batch_id);
      if (!exists) await db.drafts.add(draft);
    }
    await db.seedMeta.put({
      key: "demo",
      seeded_at: new Date().toISOString(),
      seed_version: SEED_VERSION,
    });
  });
  return { already: false };
}

/** 读取静态缓存。 */
export async function getStaticCache(): Promise<StaticCache | null> {
  const db = getDb();
  const row = await db.settings.get("static");
  return (row?.value as StaticCache) ?? null;
}

/** 重置：原子清空业务 store 并重新载入 seed。只影响当前浏览器。 */
export async function resetWorkspace(): Promise<void> {
  const db = getDb();
  const { seed } = await loadStaticSeed();
  await db.transaction(
    "rw",
    [db.batches, db.drafts, db.snapshots, db.reviews, db.evidence, db.seedMeta],
    async () => {
      await Promise.all([
        db.batches.clear(),
        db.drafts.clear(),
        db.snapshots.clear(),
        db.reviews.clear(),
        db.evidence.clear(),
        db.seedMeta.clear(),
      ]);
      await db.batches.bulkAdd(seed.batches);
      await db.drafts.bulkAdd(seed.drafts);
      await db.seedMeta.put({
        key: "demo",
        seeded_at: new Date().toISOString(),
        seed_version: SEED_VERSION,
      });
    }
  );
}

/** 导出整个本地工作区（含 schema_version）。 */
export async function exportWorkspace(): Promise<string> {
  const db = getDb();
  const [batches, drafts, snapshots, reviews, evidence] = await Promise.all([
    db.batches.toArray(),
    db.drafts.toArray(),
    db.snapshots.toArray(),
    db.reviews.toArray(),
    db.evidence.toArray(),
  ]);
  const payload = {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    note: "采购系统本地工作区导出；仅包含当前浏览器数据。",
    batches,
    drafts,
    snapshots,
    reviews: reviews as ActualReview[],
    evidence,
  };
  return JSON.stringify(payload, null, 2);
}
