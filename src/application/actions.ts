/**
 * 统一业务动作入口（Codex 1107 复验架构建议 B/C/D）。
 * 读取当前输入 → 前置校验（含跨页非法编辑闸门）→ domain 重算 →
 * 指纹/版本核对 → 单事务保存 → 可区分的结构化错误。
 * 页面与 React Context 只负责界面状态和调用，不各自维护阻断规则。
 */

import {
  ActualReview,
  Batch,
  DecisionSnapshot,
  EvaluationDraft,
  Evidence,
  HumanDecision,
} from "@/domain/types";
import { EvaluationBundle, runEvaluation, StaticData } from "./evaluate";
import { createDecisionSnapshot } from "./snapshots";
import { explainByRules } from "@/ai/rules";
import { calculateReview, validateActualReview } from "@/domain/review";
import type { ProcurementDB } from "@/data/repository";

export type ActionErrorCode =
  | "INVALID_EDIT_PENDING"
  | "VERSION_CONFLICT"
  | "NOT_FOUND"
  | "AMOUNT_OVERFLOW"
  | "VALIDATION_FAILED"
  | "STORAGE_FAILED";

/** 结构化动作错误：页面据 code 区分展示，不靠按钮状态猜。 */
export class ActionError extends Error {
  code: ActionErrorCode;
  constructor(code: ActionErrorCode, message: string) {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

/**
 * 跨页编辑有效性登记：scope → field → message。
 * scope 取 batch:<batchId>；字段卸载不静默清除登记，
 * 重访页面时字段以最后合法值重置并显式清除对应登记。
 */
export type EditValidityRegistry = Record<string, Record<string, string>>;

export function batchScope(batchId: string): string {
  return `batch:${batchId}`;
}

/** 确认/保存入口统一闸门：存在未修正的非法编辑即拒绝。 */
export function assertNoInvalidEdits(
  registry: EditValidityRegistry,
  batchId: string
): void {
  const entries = Object.values(registry[batchScope(batchId)] ?? {});
  if (entries.length > 0) {
    throw new ActionError(
      "INVALID_EDIT_PENDING",
      `存在未修正的非法输入（${entries.join("；")}）。这些输入未生效，页面数字按最后一次合法输入计算；请返回情景测算页修正，或重访该页确认以最后合法值为准后再操作。`
    );
  }
}

/** 快照版本分配：必须在写入事务内调用，多标签页并发不重复编号。 */
export function nextSnapshotVersion(existing: { version: number }[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing.map((s) => s.version)) + 1;
}

/** 键序无关的稳定序列化：结构化比较持久化数据与调用方所持数据是否一致。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * 输入版本比对（Codex 第三轮复验）：调用方所持的批次/草稿必须与
 * 持久化当前值一致，否则说明其他标签页已修改输入，旧页面禁止落库。
 * 批次比较排除 status（保存决策本身会把 evaluating 推进为 decided）。
 */
export function assertInputUnchanged(
  persistedBatch: Batch | undefined,
  persistedDraft: EvaluationDraft | undefined,
  seenBatch: Batch,
  seenDraft: EvaluationDraft
): void {
  if (!persistedBatch || !persistedDraft) {
    throw new ActionError("NOT_FOUND", "批次或评估草稿不存在，可能已被重置；请刷新页面后重试");
  }
  const { status: _p, ...persistedRest } = persistedBatch;
  const { status: _s, ...seenRest } = seenBatch;
  if (
    stableStringify(persistedRest) !== stableStringify(seenRest) ||
    stableStringify(persistedDraft) !== stableStringify(seenDraft)
  ) {
    throw new ActionError(
      "VERSION_CONFLICT",
      "该批次的报价/情景/证据等输入已在其他标签页或窗口被修改，本页面显示的是旧数据，已阻止保存。请关闭弹窗并刷新页面，重新核对后再保存决策。"
    );
  }
}

export interface SaveDecisionParams {
  db: ProcurementDB;
  batch: Batch;
  draft: EvaluationDraft;
  staticData: StaticData;
  allEvidence: Evidence[];
  evaluationDate: string;
  humanDecision: HumanDecision;
  reason: string;
  registry: EditValidityRegistry;
  now?: string;
  id?: string;
}

/**
 * 保存人工决策（确认/保存入口之一）：
 * 非法编辑闸门 → 理由校验 → 对最新输入重算 → 版本分配+快照写入+批次状态更新同一事务。
 */
export async function saveDecision(
  params: SaveDecisionParams
): Promise<DecisionSnapshot> {
  const { db, batch, draft, staticData, allEvidence, evaluationDate } = params;
  assertNoInvalidEdits(params.registry, batch.id);
  const reason = params.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new ActionError("VALIDATION_FAILED", "决策理由须为 10–500 字");
  }
  const bundle: EvaluationBundle = await runEvaluation(
    evaluationDate,
    batch,
    draft,
    staticData,
    allEvidence
  );
  const explanation = explainByRules(bundle.input, bundle.result);
  const explanationText = [
    explanation.summary,
    ...explanation.reasons.map((r) => `· ${r}`),
  ].join("\n");
  // 指纹计算等异步工作必须在事务外完成（Dexie 事务内 await 非 Dexie Promise 会提前提交）。
  // 版本不参与任何哈希，先在事务外用占位版本构造内容，事务内只做同步的版本分配与写入。
  const prepared = await createDecisionSnapshot({
    bundle,
    batchId: batch.id,
    version: 0,
    humanDecision: params.humanDecision,
    reason,
    explanationMode: "rules",
    explanationText,
    allEvidence,
    createdAt: params.now ?? new Date().toISOString(),
    id: params.id ?? crypto.randomUUID(),
    confirmedForHash: draft.confirmed_for_hash,
  });
  try {
    // 单事务：输入版本比对、版本分配、快照写入、批次状态更新四者原子完成
    // （Codex 架构建议 C + 第三轮复验版本一致性要求）
    return await db.transaction("rw", [db.snapshots, db.batches, db.drafts], async () => {
      const persistedBatch = await db.batches.get(batch.id);
      const persistedDraft = await db.drafts.get(batch.id);
      assertInputUnchanged(persistedBatch, persistedDraft, batch, draft);
      const existing = await db.snapshots
        .where("batch_id")
        .equals(batch.id)
        .toArray();
      const snapshot: DecisionSnapshot = {
        ...prepared,
        version: nextSnapshotVersion(existing),
      };
      await db.snapshots.add(snapshot);
      await db.batches.put({ ...persistedBatch!, status: "decided" });
      return snapshot;
    });
  } catch (e) {
    if (e instanceof ActionError) throw e;
    throw new ActionError(
      "STORAGE_FAILED",
      `快照保存失败：${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * 提交期末复盘（保存入口）：完整校验 + 试算通过后才落库；
 * 失败不落库并返回可区分错误，页面保留表单。
 */
export async function submitReview(
  db: Pick<ProcurementDB, "reviews">,
  snapshot: DecisionSnapshot | undefined,
  review: ActualReview
): Promise<void> {
  if (!snapshot) {
    throw new ActionError("NOT_FOUND", "关联的决策快照不存在，复盘未保存");
  }
  const issues = validateActualReview(snapshot, review);
  if (issues.length > 0) {
    throw new ActionError(
      "VALIDATION_FAILED",
      issues.map((i) => i.message).join("；")
    );
  }
  try {
    calculateReview(snapshot, review);
  } catch {
    throw new ActionError(
      "AMOUNT_OVERFLOW",
      "金额计算超出安全整数范围（AMOUNT_OVERFLOW），复盘未保存"
    );
  }
  try {
    await db.reviews.add(review);
  } catch (e) {
    throw new ActionError(
      "STORAGE_FAILED",
      `复盘保存失败：${e instanceof Error ? e.message : String(e)}`
    );
  }
}
