"use client";

/**
 * 采购机会列表。对应 docs/02 §3。
 * 筛选：关键词、建议状态、采购状态；默认需处理优先、最后修改倒序。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/workspace";
import { RecommendationBadge, StatusBadge } from "@/components/ui";
import { formatFen, formatInt } from "@/domain/money";
import { Recommendation } from "@/domain/types";

const REC_OPTIONS: { value: "" | Recommendation; label: string }[] = [
  { value: "", label: "全部建议状态" },
  { value: "BUY", label: "可采购" },
  { value: "NEGOTIATE", label: "需议价" },
  { value: "REJECT", label: "建议放弃" },
  { value: "REWORK", label: "方案待调整" },
  { value: "NEEDS_DATA", label: "资料待补" },
  { value: "INVALID", label: "输入待修正" },
];

/** 需处理优先级：NEEDS_DATA/REWORK/NEGOTIATE 靠前，INVALID 最前。 */
const PRIORITY: Record<Recommendation, number> = {
  INVALID: 0,
  NEEDS_DATA: 1,
  REWORK: 2,
  NEGOTIATE: 3,
  REJECT: 4,
  BUY: 5,
};

export default function OpportunitiesPage() {
  const { batches, drafts, bundles, staticData } = useWorkspace();
  const [keyword, setKeyword] = useState("");
  const [recFilter, setRecFilter] = useState<"" | Recommendation>("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortByDeadline, setSortByDeadline] = useState(false);

  const rows = useMemo(() => {
    let list = batches.map((b) => ({
      batch: b,
      draft: drafts[b.id],
      bundle: bundles[b.id],
    }));
    if (keyword.trim()) {
      const k = keyword.trim();
      list = list.filter(
        (r) =>
          r.batch.name.includes(k) ||
          r.batch.brand.includes(k) ||
          r.batch.id.includes(k) ||
          r.batch.supplier_name.includes(k)
      );
    }
    if (recFilter) {
      list = list.filter((r) => r.bundle?.result.recommendation === recFilter);
    }
    if (statusFilter) {
      list = list.filter((r) => r.batch.status === statusFilter);
    }
    list.sort((a, b) => {
      if (sortByDeadline) {
        return a.batch.selling_end_date.localeCompare(b.batch.selling_end_date);
      }
      const pa = PRIORITY[a.bundle?.result.recommendation ?? "NEEDS_DATA"];
      const pb = PRIORITY[b.bundle?.result.recommendation ?? "NEEDS_DATA"];
      if (pa !== pb) return pa - pb;
      // updated_at 可能混合带时区偏移与 UTC Z 两种格式，须按时间值比较而非字典序
      const ta = Date.parse(a.draft?.updated_at ?? "") || 0;
      const tb = Date.parse(b.draft?.updated_at ?? "") || 0;
      return tb - ta;
    });
    return list;
  }, [batches, drafts, bundles, keyword, recFilter, statusFilter, sortByDeadline]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>采购机会</h1>
        <span className="muted small">
          评估日 {staticData?.workspace.evaluation_date ?? "—"}（演示评估日）
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Link className="btn" href="/data">
            数据说明
          </Link>
          <Link className="btn primary" href="/opportunities/import">
            导入报价 CSV
          </Link>
        </div>
      </div>

      <div className="panel tight" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label className="small muted" htmlFor="kw">关键词</label>
        <input
          id="kw"
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="批次 / 品牌 / 供应商"
        />
        <label className="small muted" htmlFor="rec">建议状态</label>
        <select id="rec" value={recFilter} onChange={(e) => setRecFilter(e.target.value as typeof recFilter)}>
          {REC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <label className="small muted" htmlFor="st">采购状态</label>
        <select id="st" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部</option>
          <option value="new">资料待补</option>
          <option value="evaluating">评估中</option>
          <option value="decided">已决策</option>
        </select>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={sortByDeadline}
            onChange={(e) => setSortByDeadline(e.target.checked)}
          />
          按销售截止日排序
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="panel empty-state">
          <div className="icon">📦</div>
          {batches.length === 0 ? (
            <>
              <p>本地工作区还没有采购批次。</p>
              <Link className="btn primary" href="/opportunities/import">
                导入报价
              </Link>
            </>
          ) : (
            <p>没有符合筛选条件的批次。</p>
          )}
        </div>
      ) : (
        <div className="panel table-scroll" style={{ padding: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>批次 / 品牌 / 品类</th>
                <th className="num">数量</th>
                <th className="num">单位报价</th>
                <th className="num">采购总额</th>
                <th>报价有效期</th>
                <th>评估状态</th>
                <th>采购状态</th>
                <th className="num">悲观贡献</th>
                <th>最后修改</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ batch, draft, bundle }) => (
                <tr
                  key={batch.id}
                  className="clickable"
                  onClick={() => (window.location.href = `/opportunities/${encodeURIComponent(batch.id)}`)}
                >
                  <td>
                    <Link href={`/opportunities/${encodeURIComponent(batch.id)}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{batch.name}</strong>
                    </Link>
                    <div className="small muted">
                      {batch.id} · {batch.brand} · {batch.category} · {batch.supplier_name}
                    </div>
                  </td>
                  <td className="num num">{formatInt(batch.quantity)} 件</td>
                  <td className="num money">{formatFen(batch.unit_cost_fen)}</td>
                  <td className="num money">{formatFen(batch.unit_cost_fen * batch.quantity)}</td>
                  <td>{batch.quote_valid_until}</td>
                  <td>
                    {bundle ? (
                      <RecommendationBadge value={bundle.result.recommendation} />
                    ) : (
                      <span className="badge gray">待测算</span>
                    )}
                    {bundle?.result.recommendation === "NEEDS_DATA" &&
                      bundle.result.reason_codes.includes("NOT_CONFIRMED") && (
                        <div className="small muted">情景待确认</div>
                      )}
                  </td>
                  <td><StatusBadge status={batch.status} /></td>
                  <td className="num money">
                    {bundle?.result.scenarios
                      ? formatFen(bundle.result.scenarios.downside.contribution_fen)
                      : "待测算"}
                  </td>
                  <td className="small muted">{draft?.updated_at?.slice(0, 10) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
