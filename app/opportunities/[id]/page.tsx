"use client";

/**
 * 评估详情。对应 docs/02 §5。
 * 左 65%：尺码表、报价条款、成本预算、历史可比卡与按店/尺码可售日销量。
 * 右 35%：建议标签、理由、悲观贡献、目标贡献、议价条件、待补信息。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace";
import { Modal, RecommendationBadge, StatusBadge } from "@/components/ui";
import { ExplanationPanel } from "@/features/explanation";
import { SaveDecisionModal } from "@/features/decision-modal";
import { formatFen, formatInt } from "@/domain/money";
import { sellableDayStats, historyWindow } from "@/domain/history";
import { Evidence, SIZES } from "@/domain/types";
import { RECOMMENDATION_LABEL } from "@/ai/rules";
import { DecisionSnapshot } from "@/domain/types";
import { fingerprint } from "@/domain/fingerprint";
import { evaluationDateFor } from "@/data/seed";

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(params.id);
  const {
    batches, drafts, bundles, staticData, snapshots, saveDraft, addEvidence,
  } = useWorkspace();
  const [showBasis, setShowBasis] = useState(false);
  const [showDecision, setShowDecision] = useState(false);
  const [resultHash, setResultHash] = useState<string>("");
  const [evSource, setEvSource] = useState("");
  const [evSummary, setEvSummary] = useState("");
  const [evError, setEvError] = useState<string | null>(null);

  const batch = batches.find((b) => b.id === id);
  const draft = drafts[id];
  const bundle = bundles[id];

  const comparable = useMemo(
    () =>
      staticData?.comparables.find((c) => c.id === batch?.comparable_style_id) ??
      null,
    [staticData, batch]
  );
  const historyStats = useMemo(() => {
    if (!staticData || !comparable) return [];
    return sellableDayStats(staticData.history, comparable.id);
  }, [staticData, comparable]);
  const window_ = useMemo(
    () => (staticData ? historyWindow(staticData.history) : null),
    [staticData]
  );

  // 结果指纹（供 AI 请求与页面引用）
  useMemo(() => {
    if (bundle) {
      fingerprint(bundle.result).then(setResultHash);
    }
  }, [bundle]);

  if (!batch) {
    return (
      <div className="empty-state">
        <div className="icon">🔍</div>
        <h1>该记录不存在</h1>
        <p className="muted">本地工作区中没有批次「{id}」。</p>
        <Link className="btn primary" href="/opportunities">返回采购机会列表</Link>
      </div>
    );
  }

  const result = bundle?.result;
  const latestSnapshots = snapshots
    .filter((s) => s.batch_id === id)
    .sort((a, b) => b.version - a.version);

  /** 移除人工证据引用：输入指纹随之变化，已确认状态自动失效 */
  const removeEvidenceRef = (evidenceId: string) => {
    if (!draft) return;
    saveDraft({
      ...draft,
      evidence_ids: draft.evidence_ids.filter((x) => x !== evidenceId),
      updated_at: new Date().toISOString(),
    });
  };

  /** 新增人工证据并引用到本批次（Codex P1-①：新批次必须能补齐证据） */
  const onAddEvidence = async () => {
    if (!draft) return;
    const source = evSource.trim();
    const summary = evSummary.trim();
    if (!source || !summary) {
      setEvError("证据来源与摘要都不能为空");
      return;
    }
    const ev: Evidence = {
      id: `E-M-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      type: "manual",
      source_ref: source,
      summary,
    };
    try {
      await addEvidence(ev);
      saveDraft({
        ...draft,
        evidence_ids: [...draft.evidence_ids, ev.id],
        updated_at: new Date().toISOString(),
      });
      setEvSource("");
      setEvSummary("");
      setEvError(null);
    } catch (e) {
      setEvError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>{batch.name}</h1>
        <StatusBadge status={batch.status} />
        {result && <RecommendationBadge value={result.recommendation} />}
        <span className="muted small">
          {batch.id} · {batch.brand} · 数据截至 {staticData ? evaluationDateFor(id, staticData) : "—"} · 情景测算，非销售承诺
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "8px 0 16px", flexWrap: "wrap" }}>
        <Link className="btn" href={`/opportunities/${encodeURIComponent(id)}/scenario`}>
          情景测算
        </Link>
        <Link className="btn" href={`/opportunities/${encodeURIComponent(id)}/allocation`}>
          门店分配
        </Link>
        <button className="btn" onClick={() => setShowBasis(true)}>
          计算依据
        </button>
        <button className="btn primary" onClick={() => setShowDecision(true)}>
          保存决策
        </button>
      </div>
      <p className="small muted" style={{ marginTop: -8 }}>
        草稿自动保存到本地浏览器；修改后所有数字立即由引擎重算。
      </p>

      {result?.recommendation === "NEEDS_DATA" && (
        <div className="alert warn">
          资料或情景确认不完整，当前数字仅作预览，暂不形成正式建议。
          {result.missing_fields.length > 0 && (
            <> 待补：{result.missing_fields.join("、")}。</>
          )}
          {result.reason_codes.includes("NOT_CONFIRMED") && (
            <> 请前往「情景测算」核对并确认情景。</>
          )}
        </div>
      )}
      {result?.recommendation === "INVALID" && (
        <div className="alert error">输入待修正：存在非法数量、价格顺序或金额精度，修正前不显示正式建议。</div>
      )}
      {result?.recommendation === "REWORK" && (
        <div className="alert warn">
          当前承接不足：仍有 {formatInt(result.allocation_summary.total_unallocated)} 件留仓，
          请调整销售假设、选店或采购条件。
        </div>
      )}

      <div className="grid-2">
        <div>
          <section className="panel" aria-label="批次与报价">
            <h2>批次与报价条款</h2>
            <div className="stat-row" style={{ marginBottom: 12 }}>
              <div className="stat">
                <div className="label">采购数量</div>
                <div className="value">{formatInt(batch.quantity)} 件</div>
              </div>
              <div className="stat">
                <div className="label">单位报价</div>
                <div className="value money">{formatFen(batch.unit_cost_fen)}</div>
              </div>
              <div className="stat">
                <div className="label">采购总额</div>
                <div className="value money">{formatFen(batch.unit_cost_fen * batch.quantity)}</div>
              </div>
              <div className="stat">
                <div className="label">供应商底价</div>
                <div className="value money">
                  {batch.supplier_floor_fen !== null ? formatFen(batch.supplier_floor_fen) : "未知"}
                </div>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr><th>尺码（SKU 维度）</th><th className="num">件数</th><th className="num">占比</th></tr>
                </thead>
                <tbody>
                  {SIZES.map((size) => {
                    const q = batch.lines.find((l) => l.size === size)?.quantity ?? 0;
                    return (
                      <tr key={size}>
                        <td>{size}</td>
                        <td className="num num">{formatInt(q)}</td>
                        <td className="num">{batch.quantity > 0 ? `${((q / batch.quantity) * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>供应商</dt><dd>{batch.supplier_name}（模拟）</dd>
              <dt>报价有效期至</dt><dd>{batch.quote_valid_until}（含当天）</dd>
              <dt>到货日期</dt><dd>{batch.arrival_date}</dd>
              <dt>销售截止日</dt><dd>{batch.selling_end_date}</dd>
              <dt>其他增量成本 K</dt><dd className="money">{formatFen(batch.policy.other_costs_fen)}</dd>
              <dt>目标贡献 T</dt><dd className="money">{formatFen(batch.policy.target_contribution_fen)}</dd>
              <dt>采购预算</dt><dd className="money">{formatFen(batch.policy.budget_fen)}（仅约束采购额，不含 K）</dd>
            </dl>
          </section>

          <section className="panel" aria-label="历史可比">
            <h2>历史可比参考 <span className="badge blue">历史参考</span></h2>
            {comparable ? (
              <>
                <dl className="kv">
                  <dt>可比商品</dt><dd>{comparable.name}（{comparable.id}）</dd>
                  <dt>可比原因</dt><dd>{comparable.why_comparable}</dd>
                  <dt>主要差异</dt><dd>{comparable.differences}</dd>
                  <dt>样本期间</dt>
                  <dd>
                    {window_?.start} ~ {window_?.end}（{window_?.days} 天，合成数据）
                  </dd>
                </dl>
                <p className="small muted">
                  下表为「可售日均销量」：缺货日不计为零需求，缺货天数单独列出。历史参考不是本批次的销售预测。
                </p>
                <div className="table-scroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>门店</th><th>尺码</th>
                        <th className="num">可售日均销量</th>
                        <th className="num">可售天数</th>
                        <th className="num">缺货天数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyStats.map((s) => (
                        <tr key={`${s.store_id}-${s.size}`}>
                          <td>{staticData?.stores.find((x) => x.id === s.store_id)?.name ?? s.store_id}</td>
                          <td>{s.size}</td>
                          <td className="num num">
                            {s.avg_units_per_sellable_day !== null
                              ? s.avg_units_per_sellable_day.toFixed(2)
                              : "—"}
                          </td>
                          <td className="num">{s.sellable_days}</td>
                          <td className="num">
                            {s.out_of_stock_days > 0 ? (
                              <span style={{ color: "var(--orange)" }}>{s.out_of_stock_days}</span>
                            ) : (
                              0
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="muted">本批次未关联可比商品。若无可比依据，请在情景依据中显式说明（将标注低证据强度）。</p>
            )}
          </section>

          <section className="panel" aria-label="证据与引用">
            <h2>证据与引用</h2>
            <p className="small muted">
              正式建议要求至少一条证据。导入批次的报价证据按导入文件自动生成、不可移除；
              人工证据保存在本地浏览器。新增或移除引用会使情景确认失效，需重新确认。
            </p>
            {draft && (
              <>
                {(bundle?.input.evidence.length ?? 0) === 0 && (
                  <div className="alert warn small">当前没有已引用证据：请至少新增一条人工证据，否则无法形成正式建议。</div>
                )}
                <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                  {(bundle?.input.evidence ?? []).map((e) => {
                    const removable = draft.evidence_ids.includes(e.id);
                    return (
                      <li key={e.id} className="small" style={{ marginBottom: 6 }}>
                        <span className="mono">{e.id}</span>
                        <span className="badge gray" style={{ margin: "0 6px" }}>
                          {e.type === "historical" ? "历史参考" : "人工录入"}
                        </span>
                        <span className="mono small muted">{e.source_ref}</span>
                        <div>{e.summary}</div>
                        {removable && (
                          <button
                            type="button"
                            className="btn sm"
                            style={{ marginTop: 2 }}
                            onClick={() => removeEvidenceRef(e.id)}
                          >
                            移除引用
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <h3>新增人工证据</h3>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="ev-source">来源（文件、链接、沟通记录等）</label>
                    <input
                      id="ev-source"
                      type="text"
                      value={evSource}
                      onChange={(e) => setEvSource(e.target.value)}
                      placeholder="如：供应商微信报价记录 2026-11-06"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ev-summary">摘要</label>
                    <input
                      id="ev-summary"
                      type="text"
                      value={evSummary}
                      onChange={(e) => setEvSummary(e.target.value)}
                      placeholder="如：供应商确认整批 1,000 件尺码结构与报价"
                    />
                  </div>
                </div>
                {evError && <div className="alert error small">{evError}</div>}
                <button type="button" className="btn primary sm" onClick={onAddEvidence}>
                  新增并引用到本批次
                </button>
              </>
            )}
          </section>
        </div>

        <div>
          <section className="panel" aria-label="评估建议">
            <h2>评估建议</h2>
            {result ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <RecommendationBadge value={result.recommendation} />
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {RECOMMENDATION_LABEL[result.recommendation]}
                    {result.recommendation === "BUY" && "（在当前假设下）"}
                  </div>
                </div>
                <dl className="kv">
                  <dt>悲观贡献</dt>
                  <dd className="money">
                    {result.scenarios ? formatFen(result.scenarios.downside.contribution_fen) : "—"}
                  </dd>
                  <dt>基准贡献</dt>
                  <dd className="money">
                    {result.scenarios ? formatFen(result.scenarios.base.contribution_fen) : "—"}
                  </dd>
                  <dt>目标贡献</dt>
                  <dd className="money">{formatFen(batch.policy.target_contribution_fen)}</dd>
                  <dt>议价条件</dt>
                  <dd>
                    安全达标价{" "}
                    <span className="money">{formatFen(result.safe_max_price_fen)}</span>
                    <div className="small muted">
                      取悲观情景达标价与预算价上限（{formatFen(result.budget_max_price_fen)}）的较低者
                    </div>
                  </dd>
                  <dt>总现金支出</dt>
                  <dd className="money">{formatFen(result.cash_outlay_fen)}（采购额 + K）</dd>
                  <dt>留仓</dt>
                  <dd>{formatInt(result.allocation_summary.total_unallocated)} 件</dd>
                </dl>
                {result.missing_fields.length > 0 && (
                  <div className="alert warn small" style={{ marginTop: 12 }}>
                    待补信息：{result.missing_fields.join("、")}
                  </div>
                )}
                <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }} />
                {bundle && draft && (
                  <ExplanationPanel
                    input={bundle.input}
                    result={result}
                    inputHash={bundle.inputHash}
                    resultHash={resultHash}
                    evidence={bundle.input.evidence}
                    allocation={bundle.allocation}
                    confirmedForHash={draft.confirmed_for_hash}
                  />
                )}
              </>
            ) : (
              <p className="muted">待测算</p>
            )}
          </section>

          {latestSnapshots.length > 0 && (
            <section className="panel" aria-label="历史决策">
              <h2>已保存决策</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {latestSnapshots.slice(0, 3).map((s) => (
                  <li key={s.id} className="small">
                    <Link href={`/decisions/${s.id}`}>
                      v{s.version} · {s.created_at.slice(0, 10)} · 系统建议 {RECOMMENDATION_LABEL[s.system_recommendation]}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {showBasis && bundle && (
        <Modal title="计算依据" onClose={() => setShowBasis(false)} wide>
          <h3>输入</h3>
          <dl className="kv">
            <dt>输入指纹</dt><dd className="mono small">{bundle.inputHash}</dd>
            <dt>结果指纹</dt><dd className="mono small">{resultHash}</dd>
            <dt>评估日</dt><dd>{bundle.input.evaluation_date}（演示评估日）</dd>
            <dt>采购数量 Q</dt><dd>{formatInt(batch.quantity)} 件（整批，统一单价）</dd>
            <dt>单位采购价 c</dt><dd className="money">{formatFen(batch.unit_cost_fen)}</dd>
            <dt>其他增量成本 K</dt><dd className="money">{formatFen(batch.policy.other_costs_fen)}</dd>
            <dt>目标贡献 T</dt><dd className="money">{formatFen(batch.policy.target_contribution_fen)}</dd>
            <dt>采购预算</dt><dd className="money">{formatFen(batch.policy.budget_fen)}</dd>
          </dl>
          <h3>公式（情景贡献，非净利润）</h3>
          <p className="small mono">
            贡献 = 首段售价×首段销量 + 折价售价×折价销量 + 净残值×剩余件数 − c×Q − K<br />
            达标价 = ⌊(销售收入 + 期末回收 − K − T) ÷ Q⌋（向下取整到分，可为负）<br />
            安全达标价 = min(悲观情景达标价, ⌊预算 ÷ Q⌋)
          </p>
          <h3>证据记录</h3>
          <table className="data">
            <thead>
              <tr><th>证据 ID</th><th>类型</th><th>来源</th><th>摘要</th></tr>
            </thead>
            <tbody>
              {bundle.input.evidence.map((e) => (
                <tr key={e.id}>
                  <td className="mono small">{e.id}</td>
                  <td>{e.type === "historical" ? "历史参考" : "人工录入"}</td>
                  <td className="mono small">{e.source_ref}</td>
                  <td className="small">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>分店约束</h3>
          <p className="small muted">
            算法 {bundle.allocation.algorithm_version}：按尺码字典序、需求代理量与新增承接上限逐件分配；
            未合并其他采购批次，不含仓网优化。
          </p>
        </Modal>
      )}

      {showDecision && (
        <SaveDecisionModal
          batch={batch}
          onClose={() => setShowDecision(false)}
          onSaved={(s: DecisionSnapshot) => {
            setShowDecision(false);
            router.push(`/decisions/${s.id}`);
          }}
        />
      )}
    </>
  );
}
