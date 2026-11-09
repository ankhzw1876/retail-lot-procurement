"use client";

/**
 * CSV 导入。对应 docs/02 §4 与 docs/04 §2。
 * 预检 → 错误列表（行号/字段/原值/修正要求）→ 零错误才确认 → 事务写入。
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace";
import { parseQuoteCsv, ParseQuoteCsvResult } from "@/import/quote-csv";
import { formatFen, formatInt } from "@/domain/money";

export default function ImportPage() {
  const { batches, importBatch } = useWorkspace();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ParseQuoteCsvResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setFileName(file.name);
    setWriteError(null);
    if (file.size > 2 * 1024 * 1024) {
      setResult({
        ok: false,
        errors: [
          { row: 0, field: "file", code: "FILE_TOO_LARGE", value: "", message: "文件超过 2MB 上限" },
        ],
      });
      return;
    }
    const text = await file.text();
    setResult(parseQuoteCsv(text, batches.map((b) => b.id)));
  };

  const onConfirm = async () => {
    if (!result || !result.ok) return;
    setConfirming(true);
    setWriteError(null);
    try {
      // 确认时再次校验 + 检查 ID（事务内）
      await importBatch(result.batch);
      router.push(`/opportunities/${encodeURIComponent(result.batch.id)}`);
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    }
  };

  return (
    <>
      <h1>导入报价 CSV</h1>
      <p className="muted">
        仅支持 UTF-8 CSV（可带 BOM），文件 ≤2MB、数据行 ≤1,000，一次一个批次、最多四条尺码行。
        预览不写库，确认后才原子写入；已存在的批次号会被拒绝。
      </p>
      <div className="panel">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="选择 CSV 文件"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            选择 CSV 文件
          </button>
          <a className="btn" href="/demo/empty_import_template.csv" download>
            下载空模板
          </a>
          <a className="btn" href="/demo/import_template.csv" download>
            下载可用示例
          </a>
          {fileName && <span className="small muted">已选：{fileName}</span>}
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="small">标准字段说明</summary>
          <p className="small muted" style={{ fontFamily: "var(--mono)" }}>
            batch_id, batch_name, brand, category, supplier_name, size, quantity,
            unit_cost_cny, supplier_floor_cny, quote_valid_until, arrival_date, selling_end_date
          </p>
          <p className="small muted">
            金额最多两位小数；日期为合法日历日期；category 仅支持 hoodie；尺码仅 S/M/L/XL。
          </p>
        </details>
      </div>

      {result && !result.ok && (
        <div className="panel">
          <h2>预检失败：共 {result.errors.length} 个错误</h2>
          <p className="small muted">一次返回全部错误，修正后重新选择文件。数据未写入。</p>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>行号</th><th>字段</th><th>错误代码</th><th>原值</th><th>修正要求</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((e, i) => (
                  <tr key={i}>
                    <td>{e.row || "—"}</td>
                    <td className="mono">{e.field}</td>
                    <td className="mono">{e.code}</td>
                    <td className="mono">{e.value || "—"}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && result.ok && (
        <div className="panel">
          <h2>预检通过</h2>
          {result.warnings.map((w, i) => (
            <div key={i} className="alert warn">{w.message}</div>
          ))}
          <dl className="kv">
            <dt>批次</dt><dd>{result.batch.id} · {result.batch.name}</dd>
            <dt>品牌 / 供应商</dt><dd>{result.batch.brand} / {result.batch.supplier_name}</dd>
            <dt>数据行</dt><dd>{result.summary.total_rows} 行（四尺码 S/M/L/XL）</dd>
            <dt>总件数</dt><dd>{formatInt(result.summary.total_units)} 件</dd>
            <dt>统一报价</dt><dd className="money">{formatFen(result.summary.unit_cost_fen)} / 件</dd>
            <dt>供应商底价</dt><dd className="money">{result.batch.supplier_floor_fen !== null ? formatFen(result.batch.supplier_floor_fen) : "未提供"}</dd>
            <dt>报价有效期</dt><dd>{result.batch.quote_valid_until}</dd>
            <dt>到货 / 截止</dt><dd>{result.batch.arrival_date} / {result.batch.selling_end_date}</dd>
            <dt>需求组</dt><dd>{result.batch.demand_group_id}（演示默认组，可后续修改）</dd>
          </dl>
          <div className="alert info">
            导入后进入“资料待补”：报价可用，但不会自动生成经营预测；需要填写情景、选择参考资料并确认后才产生建议。
          </div>
          {writeError && <div className="alert error">{writeError}</div>}
          <button className="btn primary" onClick={onConfirm} disabled={confirming}>
            {confirming ? "正在写入…" : "确认导入"}
          </button>
        </div>
      )}

      <p className="small muted">
        <Link href="/opportunities">← 返回采购机会列表</Link>
      </p>
    </>
  );
}
