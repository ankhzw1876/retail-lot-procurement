/**
 * AI 输出白名单验证。对应 docs/05 §2、§7。
 * schema、证据存在性、metric_key 白名单、推荐一致性任一不符则整段拒绝。
 */

import { z } from "zod";
import { Recommendation } from "@/domain/types";

export const AI_RESPONSE_METRIC_WHITELIST = [
  "scenarios.downside.contribution_fen",
  "scenarios.downside.max_price_fen",
  "scenarios.downside.residual_units",
  "scenarios.downside.sales_revenue_fen",
  "scenarios.base.contribution_fen",
  "scenarios.base.max_price_fen",
  "scenarios.base.residual_units",
  "scenarios.base.sales_revenue_fen",
  "scenarios.upside.contribution_fen",
  "scenarios.upside.max_price_fen",
  "scenarios.upside.residual_units",
  "scenarios.upside.sales_revenue_fen",
  "safe_max_price_fen",
  "budget_max_price_fen",
  "cash_outlay_fen",
  "allocation_summary.total_unallocated",
  "policy.target_contribution_fen",
  "policy.budget_fen",
] as const;

const RECOMMENDATIONS = [
  "BUY",
  "NEGOTIATE",
  "REJECT",
  "REWORK",
  "NEEDS_DATA",
  "INVALID",
] as const;

export const aiResponseSchema = z.object({
  recommendation: z.enum(RECOMMENDATIONS),
  summary: z.string().min(1).max(150),
  reasons: z
    .array(
      z.object({
        text: z.string().min(1).max(120),
        evidence_ids: z.array(z.string()).max(10),
        metric_keys: z.array(z.string()).max(10),
      })
    )
    .max(5),
  risks: z.array(z.string().min(1).max(120)).max(5),
  questions_to_verify: z.array(z.string().min(1).max(120)).max(5),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;

export interface AiValidationResult {
  ok: boolean;
  errors: string[];
  value?: AiResponse;
}

/** 完整校验：schema、推荐一致、证据存在、metric_key 白名单。 */
export function validateAiOutput(
  raw: unknown,
  expectedRecommendation: Recommendation,
  allowedEvidenceIds: string[]
): AiValidationResult {
  const errors: string[] = [];
  const parsed = aiResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `schema: ${i.path.join(".")} ${i.message}`),
    };
  }
  const value = parsed.data;
  if (value.recommendation !== expectedRecommendation) {
    errors.push(
      `推荐不一致：模型返回 ${value.recommendation}，引擎结果为 ${expectedRecommendation}`
    );
  }
  const evidenceSet = new Set(allowedEvidenceIds);
  for (const reason of value.reasons) {
    for (const id of reason.evidence_ids) {
      if (!evidenceSet.has(id)) {
        errors.push(`引用了不存在的证据：${id}`);
      }
    }
    for (const key of reason.metric_keys) {
      if (!(AI_RESPONSE_METRIC_WHITELIST as readonly string[]).includes(key)) {
        errors.push(`引用了白名单之外的指标：${key}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, value: errors.length === 0 ? value : undefined };
}
