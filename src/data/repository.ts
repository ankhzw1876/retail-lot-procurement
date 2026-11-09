/**
 * IndexedDB 本地持久化。对应 docs/04 §4。
 * 数据库 procurement-demo v2；stores：batches、drafts、snapshots、reviews、evidence、settings、seedMeta。
 * v2 新增 evidence：用户在详情页创建的人工证据（内置证据仍在静态缓存）。
 */

import Dexie, { Table } from "dexie";
import {
  ActualReview,
  Batch,
  DecisionSnapshot,
  EvaluationDraft,
  Evidence,
} from "@/domain/types";

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface SeedMetaRow {
  key: string;
  seeded_at: string;
  seed_version: string;
}

export class ProcurementDB extends Dexie {
  batches!: Table<Batch, string>;
  drafts!: Table<EvaluationDraft, string>;
  snapshots!: Table<DecisionSnapshot, string>;
  reviews!: Table<ActualReview, string>;
  evidence!: Table<Evidence, string>;
  settings!: Table<SettingRow, string>;
  seedMeta!: Table<SeedMetaRow, string>;

  constructor() {
    super("procurement-demo");
    this.version(1).stores({
      batches: "id, status",
      drafts: "batch_id",
      snapshots: "id, batch_id, [batch_id+version], created_at",
      reviews: "id, snapshot_id",
      settings: "key",
      seedMeta: "key",
    });
    this.version(2).stores({
      evidence: "id",
    });
  }
}

let dbInstance: ProcurementDB | null = null;

export function getDb(): ProcurementDB {
  if (!dbInstance) dbInstance = new ProcurementDB();
  return dbInstance;
}

/** 浏览器存储不可用检测（隐私模式等）。 */
export async function storageAvailable(): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined") return false;
    const db = getDb();
    await db.settings.get("__probe__");
    return true;
  } catch {
    return false;
  }
}
