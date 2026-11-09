"use client";

/**
 * 决策记录。对应 docs/02 §8：只读历史版本列表。
 */

import Link from "next/link";
import { useWorkspace } from "@/components/workspace";
import { RecommendationBadge } from "@/components/ui";
import { formatFen, formatDateTime } from "@/domain/money";
import { RECOMMENDATION_LABEL } from "@/ai/rules";

const DECISION_LABEL: Record<string, string> = {
  buy: "采购",
  negotiate: "议价",
  reject: "放弃",
  hold: "暂缓",
};

export default function DecisionsPage() {
  const { snapshots, batches, reviews } = useWorkspace();

  const rows = [...snapshots].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );

  return (
    <>
      <h1>决策记录</h1>
      <p className="muted">保存后的决策快照为只读，不随后续报价或情景修改而变化。</p>
      {rows.length === 0 ? (
        <div className="panel empty-state">
          <div className="icon">🗂️</div>
          <p>还没有已保存的决策。打开一个采购批次，确认情景后保存决策。</p>
          <Link className="btn primary" href="/opportunities">前往采购机会</Link>
        </div>
      ) : (
        <div className="panel table-scroll" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>快照</th>
                <th>批次</th>
                <th>保存时间</th>
                <th>系统建议</th>
                <th>人工决定</th>
                <th className="num">当时采购价</th>
                <th className="num">基准贡献</th>
                <th>复盘</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const batch = batches.find((b) => b.id === s.batch_id);
                const hasReview = reviews.some((r) => r.snapshot_id === s.id);
                return (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/decisions/${s.id}`}>v{s.version}</Link>
                    </td>
                    <td>
                      {batch?.name ?? s.batch_id}
                      <div className="small muted">{s.batch_id}</div>
                    </td>
                    <td className="small">{formatDateTime(s.created_at)}</td>
                    <td><RecommendationBadge value={s.system_recommendation} /></td>
                    <td>
                      {DECISION_LABEL[s.human_decision]}
                      {s.human_decision !== defaultOf(s.system_recommendation) && (
                        <span className="badge orange" style={{ marginLeft: 6 }}>人工覆盖</span>
                      )}
                    </td>
                    <td className="num money">{formatFen(s.input.batch.unit_cost_fen)}</td>
                    <td className="num money">
                      {s.result.scenarios ? formatFen(s.result.scenarios.base.contribution_fen) : "—"}
                    </td>
                    <td>{hasReview ? <span className="badge green">已复盘</span> : <span className="badge gray">未复盘</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function defaultOf(rec: string): string {
  return { BUY: "buy", NEGOTIATE: "negotiate", REJECT: "reject" }[rec] ?? "hold";
}
