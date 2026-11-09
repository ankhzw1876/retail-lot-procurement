"use client";

/**
 * 保存决策弹窗。对应 docs/02 §8。
 * 人工决定：采购/议价/放弃/暂缓；理由 10–500 字；与系统默认不同标记“人工覆盖建议”。
 * 保存走应用层统一入口 saveDecision：非法编辑闸门 → 重算 → 版本分配与写入单事务。
 */

import { useState } from "react";
import { Modal, RecommendationBadge } from "@/components/ui";
import { useWorkspace } from "@/components/workspace";
import {
  Batch,
  DecisionSnapshot,
  HumanDecision,
  Recommendation,
} from "@/domain/types";
import { RECOMMENDATION_LABEL } from "@/ai/rules";
import { formatFen } from "@/domain/money";
import { evaluationDateFor } from "@/data/seed";

const DEFAULT_DECISION: Record<Recommendation, HumanDecision> = {
  BUY: "buy",
  NEGOTIATE: "negotiate",
  REJECT: "reject",
  NEEDS_DATA: "hold",
  REWORK: "hold",
  INVALID: "hold",
};

const DECISION_LABEL: Record<HumanDecision, string> = {
  buy: "采购",
  negotiate: "议价",
  reject: "放弃",
  hold: "暂缓",
};

export function SaveDecisionModal({
  batch,
  onClose,
  onSaved,
}: {
  batch: Batch;
  onClose: () => void;
  onSaved: (snapshot: DecisionSnapshot) => void;
}) {
  const { drafts, staticData, bundles, saveDecision, flushPending } = useWorkspace();
  const [decision, setDecision] = useState<HumanDecision | "">("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = drafts[batch.id];
  const reasonLen = reason.trim().length;
  const reasonValid = reasonLen >= 10 && reasonLen <= 500;

  const onSave = async () => {
    if (!draft || !staticData || decision === "") return;
    setSaving(true);
    setError(null);
    try {
      // 保存决策前必须显式等待草稿提交成功
      await flushPending();
      // 统一入口：存在未修正非法输入（含其他页面遗留）时抛 INVALID_EDIT_PENDING
      const snapshot = await saveDecision({
        batch,
        draft,
        evaluationDate: evaluationDateFor(batch.id, staticData),
        humanDecision: decision,
        reason,
      });
      onSaved(snapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const bundle = bundles[batch.id];
  const systemRec = bundle?.result.recommendation ?? "NEEDS_DATA";
  const defaultDecision = DEFAULT_DECISION[systemRec];
  const isOverride = decision !== "" && decision !== defaultDecision;
  const needsOverrideNote =
    isOverride || (systemRec !== "BUY" && decision === "buy");

  return (
    <Modal title={`保存决策 · ${batch.name}`} onClose={onClose}>
      <div className="panel tight" style={{ background: "var(--panel-alt)" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>最新引擎结果：</span>
          <RecommendationBadge value={systemRec} />
          {bundle?.result.scenarios && (
            <span className="small muted">
              悲观贡献 <span className="money">{formatFen(bundle.result.scenarios.downside.contribution_fen)}</span>
              {" · "}基准 <span className="money">{formatFen(bundle.result.scenarios.base.contribution_fen)}</span>
            </span>
          )}
        </div>
        {(systemRec === "NEEDS_DATA" || systemRec === "INVALID") && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            当前未形成正式建议；仍可保存“暂缓”以记录真实判断，其他决定需确认风险。
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="decision">人工决定</label>
        <select
          id="decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value as HumanDecision)}
        >
          <option value="">请选择…</option>
          {(Object.keys(DECISION_LABEL) as HumanDecision[]).map((d) => (
            <option key={d} value={d}>
              {DECISION_LABEL[d]}
              {d === defaultDecision ? "（系统默认）" : ""}
            </option>
          ))}
        </select>
      </div>
      {isOverride && (
        <div className="alert warn small">
          人工覆盖建议：你的决定与系统默认（{DECISION_LABEL[defaultDecision]}）不同，快照将记录为人工覆盖。
        </div>
      )}
      {needsOverrideNote && decision === "buy" && systemRec !== "BUY" && (
        <div className="alert error small">
          风险提示：当前系统建议不是「可采购」，请确认已理解风险并在理由中说明依据。
        </div>
      )}

      <div className="field">
        <label htmlFor="reason">决策理由（10–500 字，已输入 {reasonLen} 字）</label>
        <textarea
          id="reason"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="记录当时判断依据；快照保存后不可修改。"
        />
        {!reasonValid && reasonLen > 0 && (
          <span className="error-text">理由须为 10–500 字</span>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose} disabled={saving}>
          取消
        </button>
        <button
          className="btn primary"
          onClick={onSave}
          disabled={saving || decision === "" || !reasonValid}
        >
          {saving ? "正在保存…" : "保存决策"}
        </button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        保存后生成新版本快照（只读），不会触发任何真实下单；后续修改报价不会改动本快照。
      </p>
    </Modal>
  );
}
