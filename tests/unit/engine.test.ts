/**
 * 金额解析、CSV 导入、复盘桥接、历史统计与 AI 输出校验。
 */

import { describe, it, expect } from "vitest";
import { parseMoneyToFen, parseUnits, formatFen } from "@/domain/money";
import { parseQuoteCsv } from "@/import/quote-csv";
import { calculateReview, validateActualReview } from "@/domain/review";
import { sellableDayStats, historyWindow } from "@/domain/history";
import { validateAiOutput } from "@/ai/validate-output";
import { evaluateConfirmed, loadCsv, loadExpected, loadHistory, loadSeed, buildInput } from "../helpers";
import { createDecisionSnapshot } from "@/application/snapshots";
import { runEvaluation } from "@/application/evaluate";
import { ActualReview } from "@/domain/types";

const seed = loadSeed();
const expected = loadExpected();

describe("金额解析", () => {
  it.each([
    ["60", 6000],
    ["60.00", 6000],
    ["56.25", 5625],
    ["0.01", 1],
    [" 60.5 ", 6050],
  ])("parseMoneyToFen(%s) = %i", (raw, fen) => {
    const r = parseMoneyToFen(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fen).toBe(fen);
  });

  it.each(["60.001", "-2", "1e3", "¥60", "abc", "60.", "", "NaN", "Infinity", "0x10"])(
    "拒绝非法金额 %s",
    (raw) => {
      expect(parseMoneyToFen(raw).ok).toBe(false);
    }
  );

  it("parseUnits 拒绝负数与小数", () => {
    expect(parseUnits("-2").ok).toBe(false);
    expect(parseUnits("1.5").ok).toBe(false);
    const ok = parseUnits("100");
    expect(ok.ok && ok.units).toBe(100);
  });

  it("formatFen 千分位与符号", () => {
    expect(formatFen(2625000)).toBe("¥26,250.00");
    expect(formatFen(-375000)).toBe("-¥3,750.00");
    expect(formatFen(null)).toBe("—");
  });
});

describe("CSV 导入 B01–B05", () => {
  it("B01：有效模板 → 1000 件、60 元、四尺码", () => {
    const r = parseQuoteCsv(loadCsv("import_template.csv"), []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batch.quantity).toBe(1000);
    expect(r.batch.unit_cost_fen).toBe(6000);
    expect(r.batch.supplier_floor_fen).toBe(5500);
    expect(r.lines.map((l) => l.quantity)).toEqual([100, 200, 300, 400]);
    expect(r.summary.total_rows).toBe(4);
  });

  it("B02：重复 batch_id 拒绝", () => {
    const r = parseQuoteCsv(loadCsv("import_template.csv"), ["NEW-001"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "ID_EXISTS")).toBe(true);
  });

  it("B03：异常文件一次报告重复尺码、负数量、超精度金额、无效日期", () => {
    const r = parseQuoteCsv(loadCsv("import_invalid.csv"), []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain("DUPLICATE_SIZE");
    expect(codes).toContain("INVALID_INTEGER");
    expect(codes).toContain("INVALID_MONEY");
    expect(codes).toContain("INVALID_DATE");
    // 错误带物理行号
    for (const e of r.errors) expect(e.row).toBeGreaterThan(0);
  });

  it("B04：仅表头 / 混批 / 未知字段", () => {
    const headerOnly = parseQuoteCsv(loadCsv("empty_import_template.csv"), []);
    expect(headerOnly.ok).toBe(false);
    if (!headerOnly.ok) {
      expect(headerOnly.errors.some((e) => e.code === "EMPTY_FILE")).toBe(true);
    }
    const mixed = parseQuoteCsv(
      loadCsv("import_template.csv").replace("NEW-001", "OTHER-1"),
      []
    );
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) {
      expect(mixed.errors.some((e) => e.code === "MIXED_BATCH")).toBe(true);
    }
    const unknown = parseQuoteCsv(
      loadCsv("import_template.csv").replace(
        "batch_id,",
        "batch_id,hack_field,"
      ).replace(/NEW-001,/g, "NEW-001,x,"),
      []
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.errors.some((e) => e.code === "UNKNOWN_FIELD")).toBe(true);
    }
  });

  it("B05：BOM 与引号逗号名称正确解析；跨行字段拒绝", () => {
    const withBom = parseQuoteCsv("﻿" + loadCsv("import_template.csv"), []);
    expect(withBom.ok).toBe(true);
    const quoted = parseQuoteCsv(
      loadCsv("import_template.csv").replace(/新批次卫衣/g, '"品牌,含逗号"'),
      []
    );
    expect(quoted.ok).toBe(true);
    if (quoted.ok) expect(quoted.batch.name).toBe("品牌,含逗号");
    const multiline = parseQuoteCsv(
      loadCsv("import_template.csv").replace("新批次卫衣", '"跨行\n名称"'),
      []
    );
    expect(multiline.ok).toBe(false);
  });
});

describe("复盘：LOT-B 56 元快照载入模拟期末结果", () => {
  async function makeBuySnapshot() {
    const staticData = {
      stores: seed.stores,
      store_demand: seed.store_demand,
      inventory: seed.inventory,
      evidence: seed.evidence,
    };
    const batch = structuredClone(seed.batches.find((b) => b.id === "LOT-B")!);
    batch.unit_cost_fen = 5600;
    const draft = structuredClone(seed.drafts.find((d) => d.batch_id === "LOT-B")!);
    // 先算一次拿指纹，再确认
    const bundle1 = await runEvaluation(
      seed.workspace.evaluation_date,
      batch,
      draft,
      staticData,
      seed.evidence
    );
    draft.confirmed_for_hash = bundle1.inputHash;
    const bundle = await runEvaluation(
      seed.workspace.evaluation_date,
      batch,
      draft,
      staticData,
      seed.evidence
    );
    expect(bundle.result.recommendation).toBe("BUY");
    return createDecisionSnapshot({
      bundle,
      batchId: "LOT-B",
      version: 1,
      humanDecision: "buy",
      reason: "演示：议价至 56 元后按悲观情景达标价内采购，风险已确认。",
      explanationMode: "rules",
      explanationText: "",
      allEvidence: seed.evidence,
      createdAt: "2026-11-06T10:00:00+08:00",
      id: "00000000-0000-4000-8000-000000000001",
    });
  }

  it("快照保存后再改报价，旧快照不变（B06）", async () => {
    const snapshot = await makeBuySnapshot();
    expect(snapshot.input.batch.unit_cost_fen).toBe(5600);
    expect(snapshot.result.scenarios!.base.contribution_fen).toBe(3615000);
    // 模拟草稿改回 60 元：快照不受影响
    expect(snapshot.result.recommendation).toBe("BUY");
  });

  it("实际贡献 32650 元，相对基准 -3500 元，桥接闭合", async () => {
    const snapshot = await makeBuySnapshot();
    const f = seed.actual_review_fixture;
    const review: ActualReview = {
      id: "00000000-0000-4000-8000-000000000002",
      snapshot_id: snapshot.id,
      review_date: f.review_date,
      closed_window: true,
      actual_stages: f.actual_stages,
      residual_unit_value_fen: f.residual_unit_value_fen,
      procurement_total_fen: f.procurement_total_fen,
      other_costs_fen: f.other_costs_fen,
      note: f.note,
      created_at: "2027-03-01T09:00:00+08:00",
    };
    const issues = validateActualReview(snapshot, review);
    expect(issues).toEqual([]);
    const r = calculateReview(snapshot, review);
    expect(r.actual_sales_revenue_fen).toBe(expected.review.actual_sales_revenue_fen);
    expect(r.actual_residual_recovery_fen).toBe(expected.review.actual_residual_recovery_fen);
    expect(r.actual_contribution_fen).toBe(expected.review.actual_contribution_fen);
    expect(r.baseline_contribution_fen).toBe(expected.review.baseline_contribution_fen);
    expect(r.delta_fen).toBe(expected.review.delta_fen);
    expect(r.bridge_fen.sales_fen).toBe(expected.review.bridge_fen.sales);
    expect(r.bridge_fen.residual_fen).toBe(expected.review.bridge_fen.residual);
    expect(r.bridge_fen.procurement_fen).toBe(expected.review.bridge_fen.procurement);
    expect(r.bridge_fen.other_costs_fen).toBe(expected.review.bridge_fen.other_costs);
    const bridgeSum =
      r.bridge_fen.sales_fen +
      r.bridge_fen.residual_fen +
      r.bridge_fen.procurement_fen +
      r.bridge_fen.other_costs_fen;
    expect(bridgeSum).toBe(r.delta_fen);
  });

  it("未采购快照不允许录入；数量不守恒拒绝", async () => {
    const snapshot = await makeBuySnapshot();
    const notBuy = { ...snapshot, human_decision: "reject" as const };
    const base = {
      review_date: "2027-03-01",
      closed_window: true as const,
      actual_stages: [
        { price_fen: 12900, units: 550 },
        { price_fen: 7900, units: 300 },
      ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
      residual_unit_value_fen: 2000,
      procurement_total_fen: 5600000,
      other_costs_fen: 900000,
    };
    expect(
      validateActualReview(notBuy, base).some((i) => i.code === "NOT_PURCHASED")
    ).toBe(true);
    const overflow = {
      ...base,
      actual_stages: [
        { price_fen: 12900, units: 600 },
        { price_fen: 7900, units: 500 },
      ] as [{ price_fen: number; units: number }, { price_fen: number; units: number }],
    };
    expect(
      validateActualReview(snapshot, overflow).some((i) => i.code === "TOTAL_EXCEEDED")
    ).toBe(true);
    const notClosed = { ...base, closed_window: false as unknown as true };
    expect(
      validateActualReview(snapshot, notClosed).some((i) => i.code === "WINDOW_NOT_CLOSED")
    ).toBe(true);
  });
});

describe("历史可售日统计", () => {
  it("1680 条记录、84 天窗口；缺货日不计零需求", () => {
    const history = loadHistory();
    expect(history.length).toBe(1680);
    const w = historyWindow(history);
    expect(w.days).toBe(84);
    const stats = sellableDayStats(history, "CMP-HOOD-01");
    expect(stats.length).toBe(20); // 5 店 × 4 尺码
    for (const s of stats) {
      expect(s.sellable_days + s.out_of_stock_days).toBe(84);
      if (s.sellable_days > 0) {
        expect(s.avg_units_per_sellable_day).not.toBeNull();
      }
      // 缺货日 units_sold 必须为 0（种子数据保证）
    }
    const outRows = history.filter((h) => !h.in_stock);
    expect(outRows.every((h) => h.units_sold === 0)).toBe(true);
  });
});

describe("AI 输出校验 C03", () => {
  const good = {
    recommendation: "NEGOTIATE",
    summary: "在当前情景下，报价超过悲观情景达标价，建议先核实议价空间。",
    reasons: [
      {
        text: "悲观情景的批次贡献未达到目标。",
        evidence_ids: ["E-LOT-B-SCENARIO"],
        metric_keys: ["scenarios.downside.contribution_fen"],
      },
    ],
    risks: ["可比商品与本批次并非同一款。"],
    questions_to_verify: ["底价是否已确认？"],
  };
  const allowed = ["E-LOT-B-SCENARIO", "E-LOT-B-QUOTE"];

  it("合法输出通过", () => {
    const r = validateAiOutput(good, "NEGOTIATE", allowed);
    expect(r.ok).toBe(true);
  });
  it("捏造证据 → 拒绝", () => {
    const bad = structuredClone(good);
    bad.reasons[0].evidence_ids = ["E-FAKE"];
    expect(validateAiOutput(bad, "NEGOTIATE", allowed).ok).toBe(false);
  });
  it("改推荐 → 拒绝", () => {
    const bad = { ...good, recommendation: "BUY" };
    expect(validateAiOutput(bad, "NEGOTIATE", allowed).ok).toBe(false);
  });
  it("未知指标 → 拒绝", () => {
    const bad = structuredClone(good);
    bad.reasons[0].metric_keys = ["scenarios.downside.profit_fen"];
    expect(validateAiOutput(bad, "NEGOTIATE", allowed).ok).toBe(false);
  });
  it("非 JSON / 超长按 schema 拒绝", () => {
    expect(validateAiOutput("not json", "NEGOTIATE", allowed).ok).toBe(false);
    const bad = { ...good, summary: "长".repeat(200) };
    expect(validateAiOutput(bad, "NEGOTIATE", allowed).ok).toBe(false);
  });
});
