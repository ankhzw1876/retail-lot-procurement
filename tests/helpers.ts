/**
 * 测试辅助：从交接包 data/ 载入真实种子，调用真实实现进行评估。
 * 不把 expected_results 当运行时结果，只作为期望值对照。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Batch,
  DailySale,
  EvaluationDraft,
  EvaluationInput,
  Evidence,
  Inventory,
  Store,
  StoreDemand,
  ComparableStyle,
  Workspace,
} from "@/domain/types";
import { allocateBatch } from "@/domain/allocation";
import {
  evaluateBatchWithHash,
  normalizeEvaluationInput,
} from "@/domain/recommendation";
import { fingerprint } from "@/domain/fingerprint";

const ROOT = path.resolve(__dirname, "..");

export function loadSeed() {
  const seed = JSON.parse(
    readFileSync(path.join(ROOT, "data", "demo_seed.json"), "utf-8")
  ) as {
    workspace: Workspace;
    batches: Batch[];
    stores: Store[];
    store_demand: StoreDemand[];
    inventory: Inventory[];
    comparables: ComparableStyle[];
    drafts: EvaluationDraft[];
    evidence: Evidence[];
    actual_review_fixture: {
      required_batch_id: string;
      required_unit_cost_fen: number;
      closed_window: true;
      actual_stages: [
        { price_fen: number; units: number },
        { price_fen: number; units: number }
      ];
      residual_unit_value_fen: number;
      procurement_total_fen: number;
      other_costs_fen: number;
      note: string;
      review_date: string;
    };
  };
  return seed;
}

export function loadHistory(): DailySale[] {
  return JSON.parse(
    readFileSync(path.join(ROOT, "data", "historical_sales.json"), "utf-8")
  ) as DailySale[];
}

export function loadExpected() {
  return JSON.parse(
    readFileSync(path.join(ROOT, "data", "expected_results.json"), "utf-8")
  );
}

export function loadCsv(name: string): string {
  return readFileSync(path.join(ROOT, "data", name), "utf-8");
}

export function buildInput(
  seed: ReturnType<typeof loadSeed>,
  batchId: string,
  overrides?: {
    batch?: Partial<Batch>;
    draft?: Partial<EvaluationDraft>;
    evaluationDate?: string;
  }
): { input: EvaluationInput; draft: EvaluationDraft; batch: Batch } {
  const batch = structuredClone(
    seed.batches.find((b) => b.id === batchId)!
  ) as Batch;
  Object.assign(batch, overrides?.batch ?? {});
  const draft = structuredClone(
    seed.drafts.find((d) => d.batch_id === batchId)!
  ) as EvaluationDraft;
  Object.assign(draft, overrides?.draft ?? {});
  const { status: _status, ...batchNoStatus } = batch;
  const input: EvaluationInput = {
    evaluation_date:
      overrides?.evaluationDate ?? seed.workspace.evaluation_date,
    batch: batchNoStatus,
    stores: seed.stores,
    store_demand: seed.store_demand,
    inventory: seed.inventory,
    selected_store_ids: draft.selected_store_ids,
    scenario_basis: draft.scenario_basis,
    evidence: seed.evidence.filter((e) => draft.evidence_ids.includes(e.id)),
  };
  return { input, draft, batch };
}

/** 模拟“用户已确认”：先算输入指纹，再以该指纹评估。 */
export async function evaluateConfirmed(
  seed: ReturnType<typeof loadSeed>,
  batchId: string,
  overrides?: Parameters<typeof buildInput>[2]
) {
  const { input, batch } = buildInput(seed, batchId, overrides);
  const allocation = allocateBatch(
    batch.lines,
    seed.stores,
    seed.store_demand,
    seed.inventory,
    input.selected_store_ids
  );
  const inputHash = await fingerprint(normalizeEvaluationInput(input));
  const result = evaluateBatchWithHash(input, allocation, inputHash, inputHash);
  return { input, allocation, result, inputHash };
}
