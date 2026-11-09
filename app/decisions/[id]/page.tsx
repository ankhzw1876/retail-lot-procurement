"use client";

/**
 * 决策快照与复盘。对应 docs/02 §8、§9。
 * 快照只读；“以此版本继续评估”生成草稿，不覆写。
 * 仅人工决定为“采购”的快照可录入期末实际结果；桥接四项闭合。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useWorkspace, useFieldValidity } from "@/components/workspace";
import { MoneyField, IntField, RecommendationBadge } from "@/components/ui";
import { formatFen, formatInt, formatDateTime } from "@/domain/money";
import {
  ActualReview,
  DecisionSnapshot,
  SCENARIO_KEYS,
  ScenarioKey,
  SIZES,
} from "@/domain/types";
import { calculateReview, validateActualReview } from "@/domain/review";
import { RECOMMENDATION_LABEL } from "@/ai/rules";

const SC_LABEL: Record<ScenarioKey, string> = { downside: "悲观", base: "基准", upside: "乐观" };
const DECISION_LABEL: Record<string, string> = { buy: "采购", negotiate: "议价", reject: "放弃", hold: "暂缓" };

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { snapshots, reviews, staticData, saveReview, batches, drafts, saveDraft, saveBatch } =
    useWorkspace();
  const snapshot = snapshots.find((s) => s.id === params.id);
  const review = reviews.find((r) => r.snapshot_id === params.id);
  const [showReviewForm, setShowReviewForm] = useState(false);

  if (!snapshot) {
    return (
      <div className="empty-state">
        <h1>该记录不存在</h1>
        <Link className="btn primary" href="/decisions">返回决策记录</Link>
      </div>
    );
  }

  const fixture = staticData?.actual_review_fixture;
  const fixtureApplicable =
    fixture &&
    snapshot.batch_id === fixture.required_batch_id &&
    snapshot.input.batch.unit_cost_fen === fixture.required_unit_cost_fen;

  const reviewResult = useMemo(() => {
    if (!snapshot || !review) return null;
    try {
      return calculateReview(snapshot, review);
    } catch {
      return null;
    }
  }, [snapshot, review]);

  /** 以此版本继续评估：把快照输入写回草稿与批次，不覆写快照。 */
  const continueFromSnapshot = async () => {
    const batch = batches.find((b) => b.id === snapshot.batch_id);
    const draft = drafts[snapshot.batch_id];
    if (!batch || !draft) return;
    saveBatch({
      ...batch,
      ...snapshot.input.batch,
      status: "evaluating",
    });
    saveDraft({
      ...draft,
      selected_store_ids: [...snapshot.input.selected_store_ids],
      scenario_basis: snapshot.input.scenario_basis,
      evidence_ids: snapshot.input.evidence.map((e) => e.id),
      confirmed_for_hash: snapshot.confirmed_for_hash,
      updated_at: new Date().toISOString(),
    });
    router.push(`/opportunities/${encodeURIComponent(snapshot.batch_id)}`);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>
          决策快照 v{snapshot.version} · {snapshot.input.batch.name}
        </h1>
        <span className="badge gray">只读</span>
        <RecommendationBadge value={snapshot.system_recommendation} />
        <Link className="btn sm" style={{ marginLeft: "auto" }} href="/decisions">
          ← 返回决策记录
        </Link>
      </div>
      <p className="small muted">
        保存于 {formatDateTime(snapshot.created_at)} · 引擎 {snapshot.engine_version} ·
        解释模式：{snapshot.explanation_mode === "rules" ? "规则解释" : "AI 解释"}
      </p>

      <div className="grid-2">
        <div>
          <section className="panel">
            <h2>快照内容（保存时点，不可修改）</h2>
            <dl className="kv">
              <dt>输入指纹</dt><dd className="mono small">{snapshot.input_hash}</dd>
              <dt>结果指纹</dt><dd className="mono small">{snapshot.result_hash}</dd>
              <dt>采购价</dt><dd className="money">{formatFen(snapshot.input.batch.unit_cost_fen)} / 件 × {formatInt(snapshot.input.batch.quantity)} 件</dd>
              <dt>供应商底价</dt><dd className="money">{snapshot.input.batch.supplier_floor_fen !== null ? formatFen(snapshot.input.batch.supplier_floor_fen) : "未知"}</dd>
              <dt>安全达标价</dt><dd className="money">{formatFen(snapshot.result.safe_max_price_fen)}</dd>
              <dt>人工决定</dt>
              <dd>
                <strong>{DECISION_LABEL[snapshot.human_decision]}</strong>
                {snapshot.human_decision !==
                  (({ BUY: "buy", NEGOTIATE: "negotiate", REJECT: "reject" } as Record<string, string>)[snapshot.system_recommendation] ?? "hold") && (
                  <span className="badge orange" style={{ marginLeft: 6 }}>人工覆盖建议</span>
                )}
              </dd>
              <dt>决策理由</dt><dd style={{ whiteSpace: "pre-line" }}>{snapshot.reason}</dd>
            </dl>
            <h3 style={{ marginTop: 12 }}>三情景（保存时点）</h3>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>情景</th>
                    <th className="num">贡献</th>
                    <th className="num">剩余件数</th>
                    <th className="num">达标价</th>
                  </tr>
                </thead>
                <tbody>
                  {SCENARIO_KEYS.map((k) => {
                    const r = snapshot.result.scenarios?.[k];
                    return (
                      <tr key={k}>
                        <td>{SC_LABEL[k]}</td>
                        <td className="num money">{r ? formatFen(r.contribution_fen) : "—"}</td>
                        <td className="num">{r ? formatInt(r.residual_units) : "—"}</td>
                        <td className="num money">{r ? formatFen(r.max_price_fen) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <h3 style={{ marginTop: 12 }}>分店结果</h3>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>门店</th>
                    {SIZES.map((s) => <th key={s} className="num">{s}</th>)}
                    <th className="num">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(snapshot.allocation.lines.map((l) => l.store_id))].map((sid) => {
                    const lines = snapshot.allocation.lines.filter((l) => l.store_id === sid);
                    return (
                      <tr key={sid}>
                        <td className="small">{sid}</td>
                        {SIZES.map((size) => (
                          <td key={size} className="num">{lines.find((l) => l.size === size)?.units ?? 0}</td>
                        ))}
                        <td className="num"><strong>{lines.reduce((a, l) => a + l.units, 0)}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {snapshot.allocation.total_unallocated > 0 && (
              <p className="small" style={{ color: "var(--orange)" }}>
                留仓 {formatInt(snapshot.allocation.total_unallocated)} 件。
              </p>
            )}
            <h3 style={{ marginTop: 12 }}>规则解释（保存时点）</h3>
            <p className="small" style={{ whiteSpace: "pre-line" }}>{snapshot.explanation_text}</p>
            <h3 style={{ marginTop: 12 }}>证据</h3>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
              {snapshot.evidence.map((e) => (
                <li key={e.id}><span className="mono">{e.id}</span>：{e.summary}</li>
              ))}
            </ul>
            <div style={{ marginTop: 16 }}>
              <button className="btn" onClick={continueFromSnapshot}>
                以此版本继续评估（生成草稿，不覆写快照）
              </button>
            </div>
          </section>
        </div>

        <div>
          <section className="panel" aria-label="复盘">
            <h2>期末复盘</h2>
            {snapshot.human_decision !== "buy" ? (
              <p className="muted">
                人工决定为「{DECISION_LABEL[snapshot.human_decision]}」，未采购，无实际经营结果。
                不允许虚构结果；如需备注请联系业务归档。
              </p>
            ) : review && reviewResult ? (
              <>
                <dl className="kv">
                  <dt>复盘日期</dt><dd>{review.review_date}（模拟期末，非真实已实现收益）</dd>
                  <dt>实际销售收入</dt><dd className="money">{formatFen(reviewResult.actual_sales_revenue_fen)}</dd>
                  <dt>实际净残值</dt><dd className="money">{formatFen(reviewResult.actual_residual_recovery_fen)}</dd>
                  <dt>实际采购成本</dt><dd className="money">{formatFen(review.procurement_total_fen)}</dd>
                  <dt>实际其他成本</dt><dd className="money">{formatFen(review.other_costs_fen)}</dd>
                  <dt>实际贡献</dt><dd className="money"><strong>{formatFen(reviewResult.actual_contribution_fen)}</strong></dd>
                  <dt>基准贡献</dt><dd className="money">{formatFen(reviewResult.baseline_contribution_fen)}</dd>
                  <dt>差异</dt>
                  <dd className="money" style={{ color: reviewResult.delta_fen < 0 ? "var(--red)" : "var(--green)", fontWeight: 700 }}>
                    {reviewResult.delta_fen >= 0 ? "+" : ""}{formatFen(reviewResult.delta_fen)}
                  </dd>
                </dl>
                <h3 style={{ marginTop: 12 }}>差异桥接（观察到差异，非因果断言）</h3>
                <table className="data">
                  <tbody>
                    <tr><td>销售收入差异</td><td className="num money">{formatFen(reviewResult.bridge_fen.sales_fen)}</td></tr>
                    <tr><td>期末残值差异</td><td className="num money">{formatFen(reviewResult.bridge_fen.residual_fen)}</td></tr>
                    <tr><td>采购成本影响</td><td className="num money">{formatFen(reviewResult.bridge_fen.procurement_fen)}</td></tr>
                    <tr><td>其他成本影响</td><td className="num money">{formatFen(reviewResult.bridge_fen.other_costs_fen)}</td></tr>
                    <tr>
                      <td><strong>合计</strong></td>
                      <td className="num money"><strong>{formatFen(reviewResult.delta_fen)}</strong></td>
                    </tr>
                  </tbody>
                </table>
                {review.note && <p className="small muted" style={{ marginTop: 8 }}>备注：{review.note}</p>}
              </>
            ) : (
              <>
                <p className="muted">
                  尚未复盘。销售窗口结束（{snapshot.input.batch.selling_end_date}）且全部数量可核对后，录入期末实际结果。
                </p>
                {fixtureApplicable && (
                  <div className="alert info small">
                    可载入内置模拟期末结果（演示）：两段销量 550/300 件，售价 129.00/79.00 元，
                    残余 150 件 × 20.00 元，采购 56,000.00 元，其他成本 9,000.00 元。
                  </div>
                )}
                <button className="btn primary" onClick={() => setShowReviewForm(true)}>
                  录入期末实际结果
                </button>
              </>
            )}
          </section>
        </div>
      </div>

      {showReviewForm && snapshot.human_decision === "buy" && (
        <ReviewForm
          snapshot={snapshot}
          fixture={fixtureApplicable ? fixture : null}
          onCancel={() => setShowReviewForm(false)}
          onSaved={async (r) => {
            await saveReview(r);
            setShowReviewForm(false);
          }}
        />
      )}
    </>
  );
}

function ReviewForm({
  snapshot,
  fixture,
  onCancel,
  onSaved,
}: {
  snapshot: DecisionSnapshot;
  fixture: {
    actual_stages: [{ price_fen: number; units: number }, { price_fen: number; units: number }];
    residual_unit_value_fen: number;
    procurement_total_fen: number;
    other_costs_fen: number;
    note: string;
    review_date: string;
  } | null;
  onCancel: () => void;
  onSaved: (r: ActualReview) => Promise<void>;
}) {
  const snapshotId = snapshot.id;
  const quantity = snapshot.input.batch.quantity;
  const [s1p, setS1p] = useState(12900);
  const [s1u, setS1u] = useState(0);
  const [s2p, setS2p] = useState(7900);
  const [s2u, setS2u] = useState(0);
  const [rv, setRv] = useState(2000);
  const [proc, setProc] = useState(0);
  const [other, setOther] = useState(0);
  const [reviewDate, setReviewDate] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const { invalidFields, hasInvalid, reportValidity } = useFieldValidity(`review:${snapshot.id}`);

  const loadFixture = () => {
    if (!fixture) return;
    setS1p(fixture.actual_stages[0].price_fen);
    setS1u(fixture.actual_stages[0].units);
    setS2p(fixture.actual_stages[1].price_fen);
    setS2u(fixture.actual_stages[1].units);
    setRv(fixture.residual_unit_value_fen);
    setProc(fixture.procurement_total_fen);
    setOther(fixture.other_costs_fen);
    setReviewDate(fixture.review_date);
    setNote(fixture.note);
  };

  const submit = async () => {
    // Codex P2-⑤：落库前必须完整校验并成功试算；失败保留表单、不落库
    const candidate: ActualReview = {
      id: crypto.randomUUID(),
      snapshot_id: snapshotId,
      review_date: reviewDate,
      closed_window: true,
      actual_stages: [
        { price_fen: s1p, units: s1u },
        { price_fen: s2p, units: s2u },
      ],
      residual_unit_value_fen: rv,
      procurement_total_fen: proc,
      other_costs_fen: other,
      note,
      created_at: new Date().toISOString(),
    };
    const nextErrors: string[] = [];
    if (hasInvalid) {
      nextErrors.push(
        `存在未通过校验的输入（${Object.values(invalidFields).join("；")}），请先修正`
      );
    }
    nextErrors.push(...validateActualReview(snapshot, candidate).map((i) => i.message));
    if (nextErrors.length === 0) {
      try {
        calculateReview(snapshot, candidate);
      } catch {
        nextErrors.push(
          "金额计算超出安全整数范围（AMOUNT_OVERFLOW）：请调低金额或件数；本次未保存，不会产生无法显示的记录"
        );
      }
    }
    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }
    setSaving(true);
    try {
      await onSaved(candidate);
    } catch (e) {
      // 仓库层复核失败：保留表单，允许修改重试
      setErrors([e instanceof Error ? e.message : String(e)]);
      setSaving(false);
    }
  };

  return (
    <div className="modal-mask">
      <div className="modal" role="dialog" aria-modal="true" aria-label="录入期末实际结果">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>录入期末实际结果</h2>
          <button className="btn sm" onClick={onCancel}>取消</button>
        </div>
        <p className="small muted">
          仅最终复盘：销售窗口已结束且全部数量可核对（≤ {formatInt(quantity)} 件）。
          阶段未结束不能提交。
        </p>
        {fixture && (
          <button className="btn sm" onClick={loadFixture} style={{ marginBottom: 12 }}>
            载入内置模拟期末结果（标注为模拟）
          </button>
        )}
        <div className="grid-3">
          <MoneyField label="首段实际售价（元）" valueFen={s1p} onChange={setS1p} onValidityChange={reportValidity("rv.s1p")} />
          <IntField label="首段实际销量（件）" value={s1u} onChange={setS1u} onValidityChange={reportValidity("rv.s1u")} />
          <MoneyField label="期末净残值单价（元）" valueFen={rv} onChange={setRv} onValidityChange={reportValidity("rv.rv")} />
          <MoneyField label="折价段实际售价（元）" valueFen={s2p} onChange={setS2p} onValidityChange={reportValidity("rv.s2p")} />
          <IntField label="折价段实际销量（件）" value={s2u} onChange={setS2u} onValidityChange={reportValidity("rv.s2u")} />
          <div className="field">
            <label htmlFor="rd">复盘日期</label>
            <input id="rd" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
          </div>
          <MoneyField label="实际采购总成本（元）" valueFen={proc} onChange={setProc} onValidityChange={reportValidity("rv.proc")} />
          <MoneyField label="实际其他成本（元）" valueFen={other} onChange={setOther} onValidityChange={reportValidity("rv.other")} />
        </div>
        <div className="field">
          <label htmlFor="note">备注（可选）</label>
          <textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {errors.length > 0 && (
          <div className="alert error small">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? "保存中…" : "提交复盘"}
          </button>
        </div>
      </div>
    </div>
  );
}
