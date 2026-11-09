"use client";

/**
 * 工作区状态：IndexedDB 持久化 + 确定性评估重算。
 * 草稿变更立即更新内存并去抖写库；核心结果由代码立即重算。
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActualReview,
  Batch,
  DecisionSnapshot,
  EvaluationDraft,
  Evidence,
} from "@/domain/types";
import { getDb, storageAvailable } from "@/data/repository";
import {
  ensureSeeded,
  getStaticCache,
  resetWorkspace,
  exportWorkspace,
  evaluationDateFor,
  StaticCache,
} from "@/data/seed";
import { EvaluationBundle, runEvaluation } from "@/application/evaluate";
import {
  ActionError,
  assertNoInvalidEdits,
  EditValidityRegistry,
  saveDecision as saveDecisionAction,
  submitReview,
} from "@/application/actions";

interface WorkspaceContextValue {
  ready: boolean;
  storageOk: boolean;
  staticData: StaticCache | null;
  batches: Batch[];
  drafts: Record<string, EvaluationDraft>;
  snapshots: DecisionSnapshot[];
  reviews: ActualReview[];
  bundles: Record<string, EvaluationBundle>;
  /** 内置证据 + 用户创建的人工证据（评估与快照统一使用这份合并清单） */
  allEvidence: Evidence[];
  /** 跨页编辑有效性登记（scope→field→message）；确认/保存入口统一检查 */
  editValidity: EditValidityRegistry;
  reportFieldValidity: (scope: string, key: string, error: string | null) => void;
  saveBatch: (batch: Batch) => void;
  saveDraft: (draft: EvaluationDraft) => void;
  /** 显式确认：等待草稿落库后以当前输入指纹确认；存在未修正非法输入时拒绝 */
  confirmDraft: (batchId: string) => Promise<void>;
  importBatch: (batch: Batch) => Promise<void>;
  /** 保存人工决策：应用层统一入口，版本分配与写入单事务 */
  saveDecision: (params: {
    batch: Batch;
    draft: EvaluationDraft;
    evaluationDate: string;
    humanDecision: DecisionSnapshot["human_decision"];
    reason: string;
  }) => Promise<DecisionSnapshot>;
  saveReview: (review: ActualReview) => Promise<void>;
  addEvidence: (evidence: Evidence) => Promise<void>;
  resetAll: () => Promise<void>;
  exportAll: () => Promise<string>;
  flushPending: () => Promise<void>;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace 必须在 WorkspaceProvider 内使用");
  return v;
}

/**
 * 表单级非法输入跟踪（跨页共享）。scope 例：`batch:${batchId}`。
 * 字段卸载不清除登记；重访页面时字段以最后合法值重置并清除登记，
 * 任何确认/保存入口在此之前都被 assertNoInvalidEdits 拦截。
 */
export function useFieldValidity(scope: string): {
  invalidFields: Record<string, string>;
  hasInvalid: boolean;
  reportValidity: (key: string) => (error: string | null) => void;
} {
  const { editValidity, reportFieldValidity } = useWorkspace();
  const invalidFields = editValidity[scope] ?? {};
  const reportValidity = useCallback(
    (key: string) => (error: string | null) =>
      reportFieldValidity(scope, key, error),
    [scope, reportFieldValidity]
  );
  return {
    invalidFields,
    hasInvalid: Object.keys(invalidFields).length > 0,
    reportValidity,
  };
}

function nowIso(): string {
  // 本地时间（Asia/Shanghai 演示口径用浏览器时区即可）
  return new Date().toISOString();
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [staticData, setStaticData] = useState<StaticCache | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EvaluationDraft>>({});
  const [snapshots, setSnapshots] = useState<DecisionSnapshot[]>([]);
  const [reviews, setReviews] = useState<ActualReview[]>([]);
  const [customEvidence, setCustomEvidence] = useState<Evidence[]>([]);
  const [bundles, setBundles] = useState<Record<string, EvaluationBundle>>({});
  const [editValidity, setEditValidity] = useState<EditValidityRegistry>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const reportFieldValidity = useCallback(
    (scope: string, key: string, error: string | null) => {
      setEditValidity((prev) => {
        const cur = prev[scope] ?? {};
        const has = Object.prototype.hasOwnProperty.call(cur, key);
        if (error === null) {
          if (!has) return prev;
          const nextScope = { ...cur };
          delete nextScope[key];
          const next = { ...prev };
          if (Object.keys(nextScope).length === 0) delete next[scope];
          else next[scope] = nextScope;
          return next;
        }
        if (cur[key] === error) return prev;
        return { ...prev, [scope]: { ...cur, [key]: error } };
      });
    },
    []
  );

  const pendingDrafts = useRef(new Map<string, EvaluationDraft>());
  const pendingBatches = useRef(new Map<string, Batch>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const db = getDb();
    const [b, d, s, r, ev, st] = await Promise.all([
      db.batches.toArray(),
      db.drafts.toArray(),
      db.snapshots.toArray(),
      db.reviews.toArray(),
      db.evidence.toArray(),
      getStaticCache(),
    ]);
    setBatches(b);
    setDrafts(Object.fromEntries(d.map((x) => [x.batch_id, x])));
    setSnapshots(s);
    setReviews(r);
    setCustomEvidence(ev);
    setStaticData(st);
  }, []);

  const allEvidence = useMemo(
    () => [...(staticData?.evidence ?? []), ...customEvidence],
    [staticData, customEvidence]
  );

  useEffect(() => {
    (async () => {
      try {
        const ok = await storageAvailable();
        setStorageOk(ok);
        if (ok) {
          await ensureSeeded();
          await reload();
        }
      } catch (e) {
        setStorageOk(false);
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setReady(true);
      }
    })();
  }, [reload]);

  const flushPending = useCallback(async () => {
    if (!storageOk) return;
    const db = getDb();
    const draftsToWrite = [...pendingDrafts.current.values()];
    const batchesToWrite = [...pendingBatches.current.values()];
    pendingDrafts.current.clear();
    pendingBatches.current.clear();
    if (draftsToWrite.length > 0) await db.drafts.bulkPut(draftsToWrite);
    if (batchesToWrite.length > 0) await db.batches.bulkPut(batchesToWrite);
  }, [storageOk]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flushPending().catch(() => setStorageOk(false));
    }, 400);
  }, [flushPending]);

  // 核心结果重算：输入（批次/草稿/静态数据/人工证据）变化后立即由代码重算
  useEffect(() => {
    if (!staticData) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, EvaluationBundle> = {};
      for (const batch of batches) {
        const draft = drafts[batch.id];
        if (!draft) continue;
        try {
          next[batch.id] = await runEvaluation(
            evaluationDateFor(batch.id, staticData),
            batch,
            draft,
            staticData,
            allEvidence
          );
        } catch {
          // 评估异常（如极端输入）跳过该批次，页面显示输入待修正
        }
      }
      if (!cancelled) setBundles(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [batches, drafts, staticData, allEvidence]);

  const saveBatch = useCallback(
    (batch: Batch) => {
      setBatches((prev) => {
        const i = prev.findIndex((b) => b.id === batch.id);
        const next = [...prev];
        if (i >= 0) next[i] = batch;
        else next.push(batch);
        return next;
      });
      pendingBatches.current.set(batch.id, batch);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const saveDraft = useCallback(
    (draft: EvaluationDraft) => {
      setDrafts((prev) => ({ ...prev, [draft.batch_id]: draft }));
      pendingDrafts.current.set(draft.batch_id, draft);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const confirmDraft = useCallback(
    async (batchId: string) => {
      await flushPending();
      // 统一闸门：存在未修正的非法编辑不得确认（跨页共享登记）
      assertNoInvalidEdits(editValidity, batchId);
      const draft = drafts[batchId];
      const bundle = bundles[batchId];
      if (!draft || !bundle) return;
      const next: EvaluationDraft = {
        ...draft,
        confirmed_for_hash: bundle.inputHash,
        updated_at: nowIso(),
      };
      setDrafts((prev) => ({ ...prev, [batchId]: next }));
      await getDb().drafts.put(next);
    },
    [drafts, bundles, flushPending, editValidity]
  );

  const importBatch = useCallback(
    async (batch: Batch) => {
      const db = getDb();
      const draft: EvaluationDraft = {
        batch_id: batch.id,
        selected_store_ids: staticData?.stores.map((s) => s.id) ?? [],
        scenario_basis: "",
        evidence_ids: [],
        confirmed_for_hash: null,
        updated_at: nowIso(),
      };
      await db.transaction("rw", [db.batches, db.drafts], async () => {
        const exists = await db.batches.get(batch.id);
        if (exists) throw new Error(`批次 ${batch.id} 已存在`);
        await db.batches.add(batch);
        await db.drafts.add(draft);
      });
      await reload();
    },
    [staticData, reload]
  );

  const saveDecision = useCallback(
    async (params: {
      batch: Batch;
      draft: EvaluationDraft;
      evaluationDate: string;
      humanDecision: DecisionSnapshot["human_decision"];
      reason: string;
    }): Promise<DecisionSnapshot> => {
      if (!staticData) throw new ActionError("NOT_FOUND", "静态数据未就绪");
      const snapshot = await saveDecisionAction({
        db: getDb(),
        staticData,
        allEvidence,
        registry: editValidity,
        ...params,
      });
      await reload();
      return snapshot;
    },
    [staticData, allEvidence, editValidity, reload]
  );

  const saveReview = useCallback(
    async (review: ActualReview) => {
      // 应用层统一入口：完整校验 + 试算通过后才落库（Codex P2-⑤/架构建议 B）
      const snapshot = snapshots.find((s) => s.id === review.snapshot_id);
      await submitReview(getDb(), snapshot, review);
      await reload();
    },
    [reload, snapshots]
  );

  const addEvidence = useCallback(async (evidence: Evidence) => {
    await getDb().evidence.add(evidence);
    setCustomEvidence((prev) => [...prev, evidence]);
  }, []);

  const resetAll = useCallback(async () => {
    await resetWorkspace();
    await reload();
  }, [reload]);

  const exportAll = useCallback(async () => exportWorkspace(), []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ready,
      storageOk,
      staticData,
      batches,
      drafts,
      snapshots,
      reviews,
      bundles,
      allEvidence,
      editValidity,
      reportFieldValidity,
      saveBatch,
      saveDraft,
      confirmDraft,
      importBatch,
      saveDecision,
      saveReview,
      addEvidence,
      resetAll,
      exportAll,
      flushPending,
    }),
    [
      ready, storageOk, staticData, batches, drafts, snapshots, reviews, bundles,
      allEvidence, editValidity, reportFieldValidity, saveBatch, saveDraft,
      confirmDraft, importBatch, saveDecision, saveReview, addEvidence,
      resetAll, exportAll, flushPending,
    ]
  );

  if (!ready) {
    return (
      <div className="container">
        <div className="empty-state">正在载入本地工作区…</div>
      </div>
    );
  }
  if (!storageOk) {
    return (
      <div className="container">
        <div className="alert error">
          浏览器本地存储不可用{loadError ? `：${loadError}` : ""}。
          当前为临时会话，刷新后数据不会保留；可在“数据说明”页下载 JSON 导出。
        </div>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
