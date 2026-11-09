/**
 * 缺陷⑥：AI 接口确认状态协议的服务边界测试。
 * 直接调用真实 POST 处理函数：合法已确认请求必须进入模型/降级分支（503），
 * 伪造结果、变更输入、错误分店、非法确认状态必须被拒绝（400）。
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/ai/explain/route";
import { loadSeed, buildInput, evaluateConfirmed } from "../helpers";
import { evaluateBatchWithHash, normalizeEvaluationInput } from "@/domain/recommendation";
import { allocateBatch } from "@/domain/allocation";
import { fingerprint } from "@/domain/fingerprint";
import { AllocationResult } from "@/domain/types";

const seed = loadSeed();

function makeRequest(payload: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function evidencePayload(input: ReturnType<typeof buildInput>["input"]) {
  return input.evidence.map((e) => ({
    id: e.id,
    type: e.type,
    source_ref: e.source_ref,
    text: e.summary,
  }));
}

async function confirmedLotA() {
  const { input, allocation, result, inputHash } = await evaluateConfirmed(seed, "LOT-A");
  expect(result.recommendation).toBe("BUY");
  return {
    input,
    allocation,
    result,
    inputHash,
    resultHash: await fingerprint(result),
  };
}

function basePayload(
  ctx: Awaited<ReturnType<typeof confirmedLotA>>,
  extra?: Record<string, unknown>
) {
  return {
    request_id: "reg-6",
    input_hash: ctx.inputHash,
    result_hash: ctx.resultHash,
    question: "请解释当前评估建议",
    input: ctx.input,
    allocation: ctx.allocation,
    evidence: evidencePayload(ctx.input),
    ...(extra ?? {}),
  };
}

describe("缺陷⑥：/api/ai/explain 确认状态协议", () => {
  it("合法已确认请求（显式 confirmed_for_hash）通过核对进入降级分支 503", async () => {
    const ctx = await confirmedLotA();
    const res = await POST(
      makeRequest(basePayload(ctx, { confirmed_for_hash: ctx.inputHash }))
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("AI_UNAVAILABLE");
  });

  it("旧协议请求（省略 confirmed_for_hash）的已确认结果同样被接受（验收断言2）", async () => {
    const ctx = await confirmedLotA();
    const res = await POST(makeRequest(basePayload(ctx)));
    expect(res.status).toBe(503);
  });

  it("未确认请求（confirmed_for_hash=null）以未确认状态核对通过进入 503", async () => {
    const { input } = buildInput(seed, "LOT-A");
    const batch = seed.batches.find((b) => b.id === "LOT-A")!;
    const allocation = allocateBatch(
      batch.lines,
      seed.stores,
      seed.store_demand,
      seed.inventory,
      input.selected_store_ids
    );
    const inputHash = await fingerprint(normalizeEvaluationInput(input));
    const result = evaluateBatchWithHash(input, allocation, null, inputHash);
    expect(result.recommendation).toBe("NEEDS_DATA");
    const res = await POST(
      makeRequest({
        request_id: "reg-6c",
        input_hash: inputHash,
        result_hash: await fingerprint(result),
        question: "请解释当前评估建议",
        input,
        allocation,
        evidence: evidencePayload(input),
        confirmed_for_hash: null,
      })
    );
    expect(res.status).toBe(503);
  });

  it("伪造结果指纹 → 400 HASH_MISMATCH result_hash", async () => {
    const ctx = await confirmedLotA();
    const res = await POST(
      makeRequest(
        basePayload(ctx, {
          result_hash: "0".repeat(64),
          confirmed_for_hash: ctx.inputHash,
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "HASH_MISMATCH", field: "result_hash" });
  });

  it("变更输入但保留旧 input_hash → 400 HASH_MISMATCH input_hash", async () => {
    const ctx = await confirmedLotA();
    const tampered = structuredClone(ctx.input);
    tampered.batch.unit_cost_fen += 100;
    const res = await POST(makeRequest(basePayload(ctx, { input: tampered })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "HASH_MISMATCH", field: "input_hash" });
  });

  it("篡改分店结果 → 400 HASH_MISMATCH allocation", async () => {
    const ctx = await confirmedLotA();
    const tampered: AllocationResult = structuredClone(ctx.allocation);
    tampered.lines[0].units += 1;
    const res = await POST(makeRequest(basePayload(ctx, { allocation: tampered })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "HASH_MISMATCH", field: "allocation" });
  });

  it("confirmed_for_hash 为非法值（非 null 且不等于 input_hash）→ 400", async () => {
    const ctx = await confirmedLotA();
    const res = await POST(
      makeRequest(basePayload(ctx, { confirmed_for_hash: "deadbeef" }))
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe("confirmed_for_hash");
  });
});
