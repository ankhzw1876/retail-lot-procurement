"use client";

/**
 * 数据说明。对应 docs/02 §2、§10。
 * 数据来源、样例重置（二次确认）、本地 JSON 导出。导出按钮先于删除按钮。
 */

import { useState } from "react";
import { useWorkspace } from "@/components/workspace";
import { Modal } from "@/components/ui";

export default function DataPage() {
  const { staticData, batches, snapshots, reviews, exportAll, resetAll, storageOk } =
    useWorkspace();
  const [showReset, setShowReset] = useState(false);
  const [ackText, setAckText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const onExport = async () => {
    setExportError(null);
    try {
      const json = await exportAll();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `procurement-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // 导出失败显示失败，不伪成功
      setExportError(e instanceof Error ? e.message : String(e));
    }
  };

  const onReset = async () => {
    await resetAll();
    setShowReset(false);
    setAckText("");
    setMsg("本地工作区已重置为演示样例（仅影响当前浏览器）。");
  };

  return (
    <>
      <h1>数据说明</h1>

      <section className="panel">
        <h2>数据来源与边界</h2>
        <ul>
          <li>全部品牌、门店、供应商、订单与经营数据均为<strong>合成数据</strong>，不代表 BiGOFFS 或任何真实公司的经营事实。</li>
          <li>历史销售为 12 周 × 5 店 × 4 尺码的合成可比记录（{staticData?.history.length ?? "—"} 条），用于展示可售日统计方法，不是销量预测。</li>
          <li>情景贡献是使用者假设下的测算，<strong>不是</strong>会计净利润；未含固定费用、资金成本与替代损失。</li>
          <li>分店为容量与需求代理量的启发式建议，未合并其他采购批次，不宣称全局最优。</li>
          <li>评估日固定为 {staticData?.workspace.evaluation_date}（演示评估日），不随系统时间变化。</li>
        </ul>
      </section>

      <section className="panel">
        <h2>本地工作区</h2>
        <dl className="kv">
          <dt>存储位置</dt>
          <dd>当前浏览器 IndexedDB（库名 procurement-demo，schema_version=1）</dd>
          <dt>持久化状态</dt>
          <dd>{storageOk ? "可用：刷新后可恢复" : "不可用：当前为临时会话，刷新不会保留"}</dd>
          <dt>批次</dt><dd>{batches.length} 个</dd>
          <dt>决策快照</dt><dd>{snapshots.length} 个</dd>
          <dt>复盘记录</dt><dd>{reviews.length} 条</dd>
        </dl>
        <p className="small muted">
          不做共享账号或多用户同步；不同浏览器互不共享。任何页面显示的“已保存”均指当前浏览器。
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={onExport}>
            导出本地工作区 JSON
          </button>
          <button className="btn danger" onClick={() => setShowReset(true)}>
            重置为演示样例…
          </button>
        </div>
        {exportError && <div className="alert error" style={{ marginTop: 12 }}>导出失败：{exportError}</div>}
        {msg && <div className="alert ok" style={{ marginTop: 12 }}>{msg}</div>}
      </section>

      <section className="panel">
        <h2>原始交接材料</h2>
        <p className="small muted">
          规范文档、金标数据与校验工具保留在项目目录的 docs/、data/、contracts/、qa/ 下；
          应用运行不修改这些材料。
        </p>
        <p className="small">
          <a href="/demo/demo_seed.json" download>下载演示种子 JSON</a>
          {" · "}
          <a href="/demo/import_template.csv" download>下载 CSV 导入示例</a>
        </p>
      </section>

      {showReset && (
        <Modal title="重置本地工作区" onClose={() => setShowReset(false)}>
          <div className="alert warn">
            影响范围：清空当前浏览器中的全部批次、草稿、决策快照与复盘，并重新载入演示样例。
            此操作不可撤销；其他浏览器不受影响。建议先导出 JSON 备份。
          </div>
          <div className="field">
            <label htmlFor="ack">输入「重置」以确认</label>
            <input
              id="ack"
              type="text"
              value={ackText}
              onChange={(e) => setAckText(e.target.value)}
              placeholder="重置"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setShowReset(false)}>
              取消（数据不变）
            </button>
            <button className="btn danger" disabled={ackText !== "重置"} onClick={onReset}>
              确认重置
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
