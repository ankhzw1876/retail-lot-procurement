/**
 * 决策快照创建。对应 docs/03 §7 与 docs/04 §1。
 * 快照复制完整输入、证据摘要、结果、分配与版本；后续更改不回写快照。
 */

import {
  DecisionSnapshot,
  Evidence,
  ExplanationMode,
  HumanDecision,
  ENGINE_VERSION,
} from "@/domain/types";
import { EvaluationBundle } from "./evaluate";
import { fingerprint } from "@/domain/fingerprint";

export interface CreateSnapshotParams {
  bundle: EvaluationBundle;
  batchId: string;
  version: number;
  humanDecision: HumanDecision;
  reason: string;
  explanationMode: ExplanationMode;
  explanationText: string;
  allEvidence: Evidence[];
  createdAt: string;
  id: string;
  /** 保存时点草稿的真实确认指纹；未确认传 null（缺省按 null 处理，绝不伪造） */
  confirmedForHash?: string | null;
}

export async function createDecisionSnapshot(
  params: CreateSnapshotParams
): Promise<DecisionSnapshot> {
  const { bundle } = params;
  if (bundle.result.recommendation === "NEEDS_DATA") {
    // 资料不足/未确认仍可保存“暂缓”，但必须明确这不是正式建议。
  }
  const resultForHash = { ...bundle.result } as Record<string, unknown>;
  delete resultForHash.result_hash;
  const resultHash = await fingerprint(bundle.result);
  return {
    id: params.id,
    batch_id: params.batchId,
    version: params.version,
    created_at: params.createdAt,
    engine_version: ENGINE_VERSION,
    input_hash: bundle.inputHash,
    result_hash: resultHash,
    confirmed_for_hash: params.confirmedForHash ?? null,
    input: bundle.input,
    result: bundle.result,
    allocation: bundle.allocation,
    evidence: bundle.input.evidence,
    system_recommendation: bundle.result.recommendation,
    human_decision: params.humanDecision,
    reason: params.reason,
    explanation_mode: params.explanationMode,
    explanation_text: params.explanationText,
  };
}
