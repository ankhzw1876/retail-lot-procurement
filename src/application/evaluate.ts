/**
 * 校验、分配、计算、确认状态串联。对应 docs/06 阶段A。
 */

import {
  AllocationResult,
  Batch,
  EvaluationDraft,
  EvaluationInput,
  EvaluationResult,
  Evidence,
  Inventory,
  Store,
  StoreDemand,
} from "@/domain/types";
import { allocateBatch } from "@/domain/allocation";
import {
  evaluateBatch,
  evaluateBatchWithHash,
  normalizeEvaluationInput,
} from "@/domain/recommendation";
import { fingerprint } from "@/domain/fingerprint";

export interface StaticData {
  stores: Store[];
  store_demand: StoreDemand[];
  inventory: Inventory[];
  evidence: Evidence[];
}

/** 由批次、草稿与静态数据组装规范评估输入。 */
export function buildEvaluationInput(
  evaluationDate: string,
  batch: Batch,
  draft: EvaluationDraft,
  staticData: StaticData,
  allEvidence: Evidence[]
): EvaluationInput {
  const { status: _status, ...batchWithoutStatus } = batch;
  // 导入批次的报价 CSV 本身就是该批次的人工证据（与内置批次 E-LOT-*-QUOTE 同语义），
  // 自动生成且不可移除；用户可在详情页继续新增人工证据。
  const importQuoteEvidence: Evidence | null =
    batch.origin === "import"
      ? {
          id: `E-${batch.id}-QUOTE`,
          type: "manual",
          source_ref: "import:csv-quote",
          summary: "导入的供应商报价（CSV），数量与尺码固定；非真实供应条件。",
        }
      : null;
  return {
    evaluation_date: evaluationDate,
    batch: batchWithoutStatus,
    stores: staticData.stores,
    store_demand: staticData.store_demand.filter(
      (d) => d.demand_group_id === batch.demand_group_id
    ),
    inventory: staticData.inventory.filter(
      (i) => i.demand_group_id === batch.demand_group_id
    ),
    selected_store_ids: draft.selected_store_ids,
    scenario_basis: draft.scenario_basis,
    evidence: [
      ...(importQuoteEvidence ? [importQuoteEvidence] : []),
      ...allEvidence.filter((e) => draft.evidence_ids.includes(e.id)),
    ],
  };
}

export interface EvaluationBundle {
  input: EvaluationInput;
  inputHash: string;
  allocation: AllocationResult;
  result: EvaluationResult;
}

/** 一次完整的评估：构造输入、算指纹、分店、推荐。 */
export async function runEvaluation(
  evaluationDate: string,
  batch: Batch,
  draft: EvaluationDraft,
  staticData: StaticData,
  allEvidence: Evidence[]
): Promise<EvaluationBundle> {
  const input = buildEvaluationInput(
    evaluationDate,
    batch,
    draft,
    staticData,
    allEvidence
  );
  const allocation = allocateBatch(
    batch.lines,
    staticData.stores,
    input.store_demand,
    input.inventory,
    draft.selected_store_ids
  );
  const inputHash = await fingerprint(normalizeEvaluationInput(input));
  const result = evaluateBatchWithHash(
    input,
    allocation,
    draft.confirmed_for_hash,
    inputHash
  );
  return { input, inputHash, allocation, result };
}
