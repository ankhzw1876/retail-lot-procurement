"use client";

/**
 * 情景测算。对应 docs/02 §6。
 * 三情景编辑、并排摘要、共用约束区、敏感性表、显式确认。
 * 任何财务输入/证据引用改变后确认失效；勾选门店变化同样失效（在门店分配页处理）。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkspace, useFieldValidity } from "@/components/workspace";
import { MoneyField, IntField, RecommendationBadge } from "@/components/ui";
import { formatFen, formatInt, formatRate, safeAdd } from "@/domain/money";
import {
  Batch,
  SCENARIO_KEYS,
  ScenarioKey,
  Scenario,
} from "@/domain/types";
import { calculateScenario } from "@/domain/scenario";
import { validateEvaluation } from "@/domain/validation";
import { applyQuotedPrice, clearSupplierFloor, floorConflicts } from "@/application/batch-edits";
import { RECOMMENDATION_LABEL } from "@/ai/rules";

const SC_LABEL: Record<ScenarioKey, string> = {
  downside: "悲观",
  base: "基准",
  upside: "乐观",
};

export default function ScenarioPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { batches, drafts, bundles, saveBatch, saveDraft, confirmDraft, staticData } =
    useWorkspace();
  const [tab, setTab] = useState<ScenarioKey>("downside");
  const [ack, setAck] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // 表单级非法输入跟踪（跨页共享登记）：非法编辑不进入批次状态，
  // 离页不静默清除；确认/保存决策入口统一被拦截（Codex 1107 复验 P1-③）
  const { invalidFields, hasInvalid, reportValidity } = useFieldValidity(`batch:${id}`);

  const batch = batches.find((b) => b.id === id);
  const draft = drafts[id];
  const bundle = bundles[id];

  const validation = useMemo(
    () => (bundle ? validateEvaluation(bundle.input) : null),
    [bundle]
  );

  if (!batch || !draft) {
    return (
      <div className="empty-state">
        <h1>该记录不存在</h1>
        <Link className="btn primary" href="/opportunities">返回列表</Link>
      </div>
    );
  }

  const updateBatch = (patch: Partial<Batch>) => {
    setAck(false);
    saveBatch({ ...batch, ...patch, status: batch.status === "decided" ? "evaluating" : batch.status });
    setConfirmMsg(null);
  };
  const updatePolicy = (patch: Partial<Batch["policy"]>) =>
    updateBatch({ policy: { ...batch.policy, ...patch } });
  const updateScenario = (key: ScenarioKey, next: Scenario) =>
    updateBatch({
      scenarios: batch.scenarios.map((s) => (s.key === key ? next : s)),
    });
  const updateBasis = (basis: string) => {
    setAck(false);
    saveDraft({ ...draft, scenario_basis: basis, updated_at: new Date().toISOString() });
    setConfirmMsg(null);
  };

  const confirmed =
    bundle && draft.confirmed_for_hash === bundle.inputHash;
  const result = bundle?.result;
  const current = batch.scenarios.find((s) => s.key === tab)!;
  const downside = batch.scenarios.find((s) => s.key === "downside")!;
  const downsideResult = result?.scenarios?.downside;
  const targetMargin = downsideResult
    ? safeAdd(downsideResult.contribution_fen, -batch.policy.target_contribution_fen)
    : null;
  const lossPerUnit = downside.stages[0].price_fen - downside.residual_unit_value_fen;
  const unitsOfHeadroom = targetMargin !== null && targetMargin >= 0 && lossPerUnit > 0
    ? Math.min(downside.stages[0].units, Math.floor(targetMargin / lossPerUnit))
    : null;

  // 敏感性表：当前价、底价、悲观达标价（去重）
  const sensitivity = useMemo(() => {
    if (!bundle || !result?.scenarios) return [];
    const prices = new Set<number>();
    prices.add(batch.unit_cost_fen);
    if (batch.supplier_floor_fen !== null) prices.add(batch.supplier_floor_fen);
    if (result.safe_max_price_fen !== null && result.safe_max_price_fen >= 0) {
      prices.add(result.safe_max_price_fen);
    }
    return [...prices].sort((a, b) => a - b).map((p) => {
      const rows = SCENARIO_KEYS.map((k) => {
        const sc = batch.scenarios.find((s) => s.key === k)!;
        try {
          return calculateScenario(batch.quantity, p, batch.policy, sc);
        } catch {
          return null;
        }
      });
      const safeMax = result.safe_max_price_fen!;
      const floor = batch.supplier_floor_fen;
      let status: string;
      if (p <= safeMax) status = "达标（在当前假设下）";
      else if (floor !== null && floor > safeMax && p >= floor) status = "不可达标（底价高于安全价）";
      else status = "需议价";
      return { price: p, rows, status, isCurrent: p === batch.unit_cost_fen };
    });
  }, [bundle, result, batch]);

  const onConfirm = async () => {
    if (!validation?.ok) return;
    setConfirmError(null);
    try {
      await confirmDraft(id);
      setAck(false);
      setConfirmMsg("已核对当前假设。下方可查看这组条件下的系统建议。");
    } catch (e) {
      setConfirmMsg(null);
      setConfirmError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>情景测算 · {batch.name}</h1>
        {hasInvalid ? (
          <span className="badge gray">待修正</span>
        ) : (
          result && <RecommendationBadge value={result.recommendation} />
        )}
        <span className="small muted">
          {hasInvalid
            ? "输入待修正：非法输入未生效，页面数字仍按最后一次合法输入计算"
            : confirmed
              ? "情景已确认"
              : "情景待确认：确认前不形成正式建议"}
        </span>
        <Link className="btn sm" style={{ marginLeft: "auto" }} href={`/opportunities/${encodeURIComponent(id)}`}>
          ← 返回详情
        </Link>
      </div>

      {validation && !validation.ok && (
        <div className="alert error">
          输入待修正：
          <ul style={{ margin: "4px 0 0" }}>
            {validation.errors.map((e, i) => (
              <li key={i}><span className="mono small">{e.field}</span>：{e.message}</li>
            ))}
          </ul>
        </div>
      )}
      {hasInvalid && (
        <div className="alert error">
          存在未通过校验的输入：{Object.values(invalidFields).join("；")}。
          这些输入没有生效，页面仍按最后一次合法输入计算；修正后才能确认情景或保存依赖这些输入的决策。
        </div>
      )}
      <nav className="scenario-jumps" aria-label="情景测算步骤">
        <a href="#purchase-conditions">填写条件</a>
        <a href="#price-comparison">比较采购价</a>
        <a href="#scenario-confirmation">确认情景</a>
        <a href="#scenario-results">查看结果</a>
      </nav>

      {/* 共用约束区 */}
      <div className="panel" id="purchase-conditions">
        <h2>1. 采购条件与约束（三情景共用）</h2>
        <p className="small muted">整批模式：货量 {formatInt(batch.quantity)} 件不可在此修改；议价只改变统一采购价。</p>
        <div className="grid-3">
          <MoneyField
            label="采购单价（元/件，假设报价）"
            valueFen={batch.unit_cost_fen}
            onValidityChange={reportValidity("c.cost")}
            onChange={(fen) => {
              // 只改报价；报价低于已知底价时保留底价并显式报错，绝不静默清空（Codex P1-④）
              updateBatch(applyQuotedPrice(batch, fen));
            }}
            hint={
              floorConflicts(batch)
                ? "报价低于供应商底价：底价保留不变，请提高报价或显式将底价设为未知"
                : undefined
            }
          />
          {batch.supplier_floor_fen !== null ? (
            <div>
              <MoneyField
                label="供应商底价（元/件，已知底价或估计）"
                valueFen={batch.supplier_floor_fen}
                onValidityChange={reportValidity("c.floor")}
                onChange={(fen) => updateBatch({ supplier_floor_fen: fen })}
                hint="不清楚可设为未知；底价未知时议价可行性未核实"
              />
              <button
                type="button"
                className="btn sm"
                style={{ marginTop: -4 }}
                onClick={() => updateBatch(clearSupplierFloor(batch))}
              >
                将底价设为未知
              </button>
            </div>
          ) : (
            <div className="field">
              <label>供应商底价（元/件，已知底价或估计）</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge gray">未知</span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => updateBatch({ supplier_floor_fen: batch.unit_cost_fen })}
                >
                  填写底价
                </button>
              </div>
              <span className="small muted">底价未知时议价可行性未核实；只有显式操作才能改回已知底价</span>
            </div>
          )}
          <MoneyField
            label="其他增量成本 K（元，整批总额）"
            valueFen={batch.policy.other_costs_fen}
            onValidityChange={reportValidity("c.k")}
            onChange={(fen) => updatePolicy({ other_costs_fen: fen })}
          />
          <MoneyField
            label="目标贡献 T（元，整批总额）"
            valueFen={batch.policy.target_contribution_fen}
            onValidityChange={reportValidity("c.t")}
            onChange={(fen) => updatePolicy({ target_contribution_fen: fen })}
          />
          <MoneyField
            label="采购预算（元，仅约束采购额）"
            valueFen={batch.policy.budget_fen}
            onValidityChange={reportValidity("c.budget")}
            onChange={(fen) => updatePolicy({ budget_fen: fen })}
          />
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="basis">情景依据说明（无可比依据时须显式注明“无可比依据”）</label>
          <textarea
            id="basis"
            rows={3}
            value={draft.scenario_basis}
            onChange={(e) => updateBasis(e.target.value)}
          />
        </div>
      </div>

      {/* 三情景编辑 */}
      <div className="panel">
        <h2>2. 销售假设</h2>
        <div className="tabs" role="tablist">
          {SCENARIO_KEYS.map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : undefined} onClick={() => setTab(k)}>
              {SC_LABEL[k]}情景
            </button>
          ))}
        </div>
        <p className="small muted">
          两段销售：较高售价阶段与折价阶段；期末剩余自动计算（{formatInt(batch.quantity - current.stages[0].units - current.stages[1].units)} 件），只可编辑净残值单价。允许某段数量为零。
        </p>
        <div className="grid-3">
          <MoneyField
            label="首段售价（元/件）"
            valueFen={current.stages[0].price_fen}
            onValidityChange={reportValidity("sc.price1")}
            onChange={(fen) =>
              updateScenario(tab, {
                ...current,
                stages: [{ price_fen: fen, units: current.stages[0].units }, current.stages[1]],
              })
            }
          />
          <IntField
            label="首段销量（件）"
            value={current.stages[0].units}
            onValidityChange={reportValidity("sc.units1")}
            onChange={(n) =>
              updateScenario(tab, {
                ...current,
                stages: [{ price_fen: current.stages[0].price_fen, units: n }, current.stages[1]],
              })
            }
          />
          <MoneyField
            label="期末净残值单价（元/件）"
            valueFen={current.residual_unit_value_fen}
            onValidityChange={reportValidity("sc.residual")}
            onChange={(fen) => updateScenario(tab, { ...current, residual_unit_value_fen: fen })}
          />
          <MoneyField
            label="折价段售价（元/件）"
            valueFen={current.stages[1].price_fen}
            onValidityChange={reportValidity("sc.price2")}
            onChange={(fen) =>
              updateScenario(tab, {
                ...current,
                stages: [current.stages[0], { price_fen: fen, units: current.stages[1].units }],
              })
            }
          />
          <IntField
            label="折价段销量（件）"
            value={current.stages[1].units}
            onValidityChange={reportValidity("sc.units2")}
            onChange={(n) =>
              updateScenario(tab, {
                ...current,
                stages: [current.stages[0], { price_fen: current.stages[1].price_fen, units: n }],
              })
            }
          />
        </div>
      </div>

      {/* 敏感性 */}
      <div className="panel scenario-anchor" id="price-comparison">
        <h2>3. 比较采购价（采购价敏感性）</h2>
        <p className="small muted">
          把当前报价、供应商底价和买方最高进货价放在一起试算。点击「将报价改为此价格」只会替换上面的采购单价，销量、售价和其他成本照旧。实际成交价需与供应商确认。
        </p>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th className="num">采购单价</th>
                <th>价格来源</th>
                <th className="num">悲观贡献</th>
                <th className="num">基准贡献</th>
                <th className="num">乐观贡献</th>
                <th>贡献与预算</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sensitivity.map((row) => (
                <tr key={row.price} style={row.isCurrent ? { background: "var(--blue-bg)" } : undefined}>
                  <td className="num money">
                    {formatFen(row.price)}
                  </td>
                  <td>
                    {[
                      row.isCurrent && "当前报价",
                      row.price === batch.supplier_floor_fen && "供应商底价",
                      row.price === result?.safe_max_price_fen && "最高进货价",
                    ].filter(Boolean).join(" / ")}
                  </td>
                  {row.rows.map((r, i) => (
                    <td key={i} className="num money">{r ? formatFen(r.contribution_fen) : "溢出"}</td>
                  ))}
                  <td>{row.status}</td>
                  <td>
                    {!row.isCurrent && (
                      <button
                        className="btn sm"
                        onClick={() => {
                          // 只改报价；低于已知底价时保留底价并显式报错（Codex P1-④）
                          updateBatch(applyQuotedPrice(batch, row.price));
                        }}
                      >
                        将报价改为此价格
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* 确认 */}
      <div className="panel scenario-anchor" id="scenario-confirmation">
        <h2>4. 确认情景</h2>
        <p className="small muted">
          试算会随输入更新。勾选并确认，表示你核对过这组条件，允许系统用它给出正式建议。改价、改销售假设、改证据或选店后，需要重新确认。
        </p>
        <label className="checkbox-row" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          我已核对采购条件、三种销售假设和它们的依据
        </label>
        <button
          className="btn primary"
          disabled={!ack || !validation?.ok || hasInvalid}
          onClick={onConfirm}
        >
          确认情景
        </button>
        {" "}<a href="#scenario-results">先看测算结果</a>
        {!validation?.ok && (
          <span className="small" style={{ marginLeft: 8, color: "var(--red)" }}>
            输入存在错误，修正后才能确认
          </span>
        )}
        {hasInvalid && (
          <span className="small" style={{ marginLeft: 8, color: "var(--red)" }}>
            存在未修正的非法输入，修正后才能确认
          </span>
        )}
        {confirmMsg && <p className="alert ok" role="status">{confirmMsg}</p>}
        {confirmError && <p className="alert error" role="alert">{confirmError}</p>}
      </div>

      <section className="scenario-anchor" id="scenario-results" aria-labelledby="scenario-results-heading">
        <h2 id="scenario-results-heading">测算结果</h2>
        {result && downsideResult && !hasInvalid && validation?.ok && (
          <section className="panel risk-summary" aria-labelledby="risk-heading">
            <div className="risk-heading">
              <h2 id="risk-heading">采购风险摘要</h2>
              <span className="badge blue">
                {result.recommendation === "NEEDS_DATA" ? "试算 · 待补资料或确认" : "按当前情景与约束"}
              </span>
            </div>
            <dl className="risk-metrics">
              <div>
                <dt>悲观贡献与目标的差额</dt>
                <dd className="money" data-tone={targetMargin === null ? undefined : targetMargin < 0 ? "short" : "met"}>
                  {targetMargin === null ? "—" : targetMargin < 0
                    ? `差 ${formatFen(-targetMargin)}`
                    : targetMargin === 0 ? "刚好达标" : `余 ${formatFen(targetMargin)}`}
                </dd>
              </div>
              <div>
                <dt>最高进货价（含预算约束）</dt>
                <dd className="money">
                  {result.safe_max_price_fen !== null && result.safe_max_price_fen < 0
                    ? "零采购价也无法达标" : formatFen(result.safe_max_price_fen)}
                </dd>
              </div>
              <div>
                <dt>当前分店后的留仓</dt>
                <dd><span className="num">{formatInt(result.allocation_summary.total_unallocated)}</span> 件</dd>
              </div>
            </dl>
            {unitsOfHeadroom !== null && downside.stages[0].units > 0 && (
              <p className="risk-note">
                仅变动悲观情景的首段销量：每少卖 1 件并转为期末清货，贡献少
                {" "}<span className="money">{formatFen(lossPerUnit)}</span>。
                在其他条件不变时，最多可少卖 <strong>{formatInt(unitsOfHeadroom)} 件</strong>仍达到贡献目标。
              </p>
            )}
            <div className="risk-links">
              <a href="#purchase-conditions">调整采购条件</a>
              <a href="#scenario-confirmation">返回确认情景</a>
              <Link href={`/opportunities/${encodeURIComponent(id)}/allocation`}>核对门店承接</Link>
            </div>
          </section>
        )}

        {/* 并排摘要 */}
        <div className="scenario-cards">
          {SCENARIO_KEYS.map((k) => {
            const r = result?.scenarios?.[k];
            return (
              <div key={k} className="scenario-card">
                <h3>{SC_LABEL[k]} {r && <span className="small muted">已售 {formatInt(r.sold_units)} 件</span>}</h3>
                <div className="big money">{r ? formatFen(r.contribution_fen) : "—"}</div>
                {r && (
                  <div className="small muted">
                    剩余 {formatInt(r.residual_units)} 件 · 贡献率 {formatRate(r.contribution_rate)}
                    <br />
                    达标价 <span className="money">{formatFen(r.max_price_fen)}</span>
                    {" · "}盈亏平衡 <span className="money">{formatFen(r.break_even_price_fen)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </section>
    </>
  );
}
