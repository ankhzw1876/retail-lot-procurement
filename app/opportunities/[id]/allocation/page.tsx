"use client";

/**
 * 门店分配。对应 docs/02 §7。
 * 行=门店，列=四尺码、总量、剩余容量、依据；右侧汇总每尺码采购/分配/留仓。
 * 允许勾选参与门店后重跑；P0 不允许手填分货量。
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkspace } from "@/components/workspace";
import { RecommendationBadge } from "@/components/ui";
import { formatInt } from "@/domain/money";
import { SIZES } from "@/domain/types";

export default function AllocationPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { batches, drafts, bundles, staticData, saveDraft } = useWorkspace();

  const batch = batches.find((b) => b.id === id);
  const draft = drafts[id];
  const bundle = bundles[id];

  if (!batch || !draft || !staticData) {
    return (
      <div className="empty-state">
        <h1>该记录不存在</h1>
        <Link className="btn primary" href="/opportunities">返回列表</Link>
      </div>
    );
  }

  const allocation = bundle?.allocation;
  const result = bundle?.result;

  const toggleStore = (storeId: string) => {
    const selected = draft.selected_store_ids.includes(storeId)
      ? draft.selected_store_ids.filter((s) => s !== storeId)
      : [...draft.selected_store_ids, storeId];
    saveDraft({ ...draft, selected_store_ids: selected, updated_at: new Date().toISOString() });
  };

  const unallocatedTotal = allocation?.total_unallocated ?? 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>门店分配 · {batch.name}</h1>
        {result && <RecommendationBadge value={result.recommendation} />}
        <Link className="btn sm" style={{ marginLeft: "auto" }} href={`/opportunities/${encodeURIComponent(id)}`}>
          ← 返回详情
        </Link>
      </div>
      <p className="small muted">
        按尺码、需求代理量和门店承接上限分配；未合并其他采购批次，不包含仓网优化。
        需求缺口 = 需求代理量 − 同类现有库存。勾选门店变化属于输入变化，确认将失效。
      </p>
      {unallocatedTotal > 0 && (
        <div className="alert warn">
          当前承接不足：{formatInt(unallocatedTotal)} 件（
          {((unallocatedTotal / batch.quantity) * 100).toFixed(1)}%）无法分配到门店，将留在仓内。
          请调整销售假设、选店或采购条件；最终建议为「方案待调整」。
        </div>
      )}

      <div className="grid-2">
        <section className="panel table-scroll" aria-label="分店明细">
          <table className="data">
            <thead>
              <tr>
                <th>参与</th>
                <th>门店</th>
                {SIZES.map((s) => (
                  <th key={s} className="num">{s}</th>
                ))}
                <th className="num">合计</th>
                <th className="num">剩余容量</th>
                <th>依据（需求代理量 / 现有库存）</th>
              </tr>
            </thead>
            <tbody>
              {staticData.stores.map((store) => {
                const selected = draft.selected_store_ids.includes(store.id);
                const lines = allocation?.lines.filter((l) => l.store_id === store.id) ?? [];
                const total = lines.reduce((a, l) => a + l.units, 0);
                const remainingCap =
                  allocation?.store_remaining_capacity.find((c) => c.store_id === store.id)
                    ?.units ?? store.incremental_capacity;
                return (
                  <tr key={store.id} style={!selected || !store.active ? { opacity: 0.55 } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`参与门店 ${store.name}`}
                        checked={selected}
                        disabled={!store.active}
                        onChange={() => toggleStore(store.id)}
                      />
                    </td>
                    <td>
                      {store.name}
                      <div className="small muted">
                        {store.id} · {store.region}
                        {!store.active && " · 未激活"}
                      </div>
                    </td>
                    {SIZES.map((size) => (
                      <td key={size} className="num num">
                        {lines.find((l) => l.size === size)?.units ?? 0}
                      </td>
                    ))}
                    <td className="num num"><strong>{total}</strong></td>
                    <td className="num num">{remainingCap} / {store.incremental_capacity}</td>
                    <td className="small muted">
                      {SIZES.map((size) => {
                        const d = staticData.store_demand.find(
                          (x) => x.store_id === store.id && x.size === size && x.demand_group_id === batch.demand_group_id
                        );
                        const inv = staticData.inventory.find(
                          (x) => x.store_id === store.id && x.size === size && x.demand_group_id === batch.demand_group_id
                        );
                        return `${size}:${d?.demand_proxy_units ?? 0}/${inv?.units ?? 0}`;
                      }).join("　")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="panel" aria-label="留仓汇总">
          <h2>尺码汇总（采购 = 分配 + 留仓）</h2>
          <table className="data">
            <thead>
              <tr>
                <th>尺码</th>
                <th className="num">采购量</th>
                <th className="num">分配量</th>
                <th className="num">留仓量</th>
              </tr>
            </thead>
            <tbody>
              {SIZES.map((size) => {
                const purchased = batch.lines.find((l) => l.size === size)?.quantity ?? 0;
                const allocated =
                  allocation?.lines
                    .filter((l) => l.size === size)
                    .reduce((a, l) => a + l.units, 0) ?? 0;
                const un =
                  allocation?.unallocated.find((u) => u.size === size)?.units ?? 0;
                return (
                  <tr key={size}>
                    <td>{size}</td>
                    <td className="num num">{formatInt(purchased)}</td>
                    <td className="num num">{formatInt(allocated)}</td>
                    <td className="num num" style={un > 0 ? { color: "var(--orange)", fontWeight: 700 } : undefined}>
                      {formatInt(un)}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td><strong>合计</strong></td>
                <td className="num num"><strong>{formatInt(batch.quantity)}</strong></td>
                <td className="num num"><strong>{formatInt(allocation?.total_allocated ?? 0)}</strong></td>
                <td className="num num"><strong>{formatInt(unallocatedTotal)}</strong></td>
              </tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 12 }}>
            算法 {allocation?.algorithm_version}：确定性启发式，每批独立评估，不预占其他批次容量。
            容量不足时留仓，不强行分满、不丢件。
          </p>
        </section>
      </div>
    </>
  );
}
