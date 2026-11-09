"use client";

/**
 * 解释组件：规则解释始终可用；可选 AI 解释（未配置时按钮禁用并说明）。
 * 对应 docs/05：模型只解释已算出的结果，失败一律回退规则解释。
 */

import { useState } from "react";
import { EvaluationInput, EvaluationResult, Evidence } from "@/domain/types";
import { explainByRules, RECOMMENDATION_LABEL } from "@/ai/rules";

interface AiState {
  status: "idle" | "loading" | "ok" | "fallback";
  text?: string;
  mode?: "model" | "rules";
}

export function ExplanationPanel({
  input,
  result,
  inputHash,
  resultHash,
  evidence,
  allocation,
  confirmedForHash,
}: {
  input: EvaluationInput;
  result: EvaluationResult;
  inputHash: string;
  resultHash: string;
  evidence: Evidence[];
  allocation: unknown;
  /** 当前草稿的真实确认指纹；服务端以同一状态重算核对 */
  confirmedForHash: string | null;
}) {
  const rules = explainByRules(input, result);
  const [ai, setAi] = useState<AiState>({ status: "idle" });

  const askAi = async () => {
    setAi({ status: "loading" });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          input_hash: inputHash,
          result_hash: resultHash,
          confirmed_for_hash: confirmedForHash,
          question: "请解释当前评估建议",
          facts: { batch_name: input.batch.name, currency: "CNY" },
          input,
          allocation,
          evidence: evidence.map((e) => ({
            id: e.id,
            type: e.type,
            source_ref: e.source_ref,
            text: e.summary,
          })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.result_hash !== resultHash || data.input_hash !== inputHash) {
        throw new Error("指纹不匹配，丢弃过期响应");
      }
      setAi({
        status: "ok",
        mode: "model",
        text: `${data.analysis.summary}\n${data.analysis.reasons
          .map((r: { text: string }) => `· ${r.text}`)
          .join("\n")}`,
      });
    } catch {
      // C02/C04：任一失败回退规则解释，不改任何数值
      setAi({ status: "fallback", mode: "rules" });
    }
  };

  return (
    <section aria-label="建议解释">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>解释</h3>
        <span className="badge gray">规则解释</span>
        {ai.mode === "model" && <span className="badge blue">AI 解释</span>}
        <button className="btn sm" onClick={askAi} disabled={ai.status === "loading"}>
          {ai.status === "loading" ? "请求中…" : "尝试 AI 解释"}
        </button>
      </div>
      {ai.status === "fallback" && (
        <div className="alert info small">
          在线模型未配置或不可用，已自动使用规则解释；所有数值与建议不受影响。
        </div>
      )}
      {ai.status === "ok" && ai.text && (
        <div className="panel tight" style={{ whiteSpace: "pre-line", background: "var(--blue-bg)" }}>
          {ai.text}
        </div>
      )}
      <p>{rules.summary}</p>
      {rules.reasons.length > 0 && (
        <>
          <h3>主要理由</h3>
          <ul>
            {rules.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {rules.risks.length > 0 && (
        <>
          <h3>风险</h3>
          <ul>
            {rules.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {rules.questions_to_verify.length > 0 && (
        <>
          <h3>待验证问题</h3>
          <ul>
            {rules.questions_to_verify.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      <p className="small muted">
        建议标签「{RECOMMENDATION_LABEL[result.recommendation]}」由确定性引擎（{result.engine_version}）计算；解释只组织语言，不产生数字。
      </p>
    </section>
  );
}
