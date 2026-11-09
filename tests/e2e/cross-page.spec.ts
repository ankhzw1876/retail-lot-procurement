/**
 * Codex 1107 复验回归：跨页非法编辑闸门 + 非 1000 件新批次全流程。
 * 每个测试使用全新浏览器上下文（IndexedDB 为空 → 自动载入演示样例）。
 */

import { test, expect } from "@playwright/test";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

test.describe("跨页非法编辑闸门（1107 复验 P1-③）", () => {
  test("金额非法→返回详情→保存决策被拦截；重访修正后恢复正常保存", async ({ page }) => {
    // LOT-A 确认 50 元 → 可采购
    await page.goto("/opportunities/LOT-A/scenario");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });

    // 输入非法金额 56.251 → 本页待修正
    await page.getByLabel("采购单价（元/件，假设报价）").fill("56.251");
    await expect(page.getByText(/输入待修正：非法输入未生效/).first()).toBeVisible({ timeout: 5000 });

    // 不修正，直接返回详情 → 保存决策必须被拦截，不得静默丢弃错误态
    await page.getByRole("link", { name: "← 返回详情" }).click();
    await page.getByRole("button", { name: "保存决策" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("人工决定").selectOption("buy");
    await dialog.getByLabel(/决策理由/).fill("尝试在存在未修正非法输入时保存采购决策。");
    await dialog.getByRole("button", { name: "保存决策" }).click();
    await expect(dialog.getByText(/存在未修正的非法输入/)).toBeVisible({ timeout: 5000 });
    await expect(page).not.toHaveURL(/\/decisions\//);
    await dialog.getByRole("button", { name: "取消" }).click();

    // 重访情景页：字段以最后合法值 50.00 重置并清除登记 → 恢复正常保存
    await page.getByRole("link", { name: "情景测算" }).click();
    await expect(page.getByLabel("采购单价（元/件，假设报价）")).toHaveValue("50.00");
    await expect(page.getByText("情景已确认").first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("link", { name: "← 返回详情" }).click();
    await page.getByRole("button", { name: "保存决策" }).click();
    const dialog2 = page.getByRole("dialog");
    await dialog2.getByLabel("人工决定").selectOption("buy");
    await dialog2.getByLabel(/决策理由/).fill("非法输入已按最后合法值 50 元显式恢复，正常保存采购决策。");
    await dialog2.getByRole("button", { name: "保存决策" }).click();
    await expect(page).toHaveURL(/\/decisions\//, { timeout: 10000 });
    await expect(page.getByText("只读").first()).toBeVisible();
    await expect(page.getByText("¥50.00").first()).toBeVisible();
  });

  test("件数非法→切换页面→保存决策同样被拦截", async ({ page }) => {
    await page.goto("/opportunities/LOT-A/scenario");
    await page.getByLabel("首段销量（件）").fill("1.5");
    await expect(page.getByText(/存在未通过校验的输入/).first()).toBeVisible({ timeout: 5000 });

    await page.getByRole("link", { name: "← 返回详情" }).click();
    await page.getByRole("button", { name: "保存决策" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("人工决定").selectOption("hold");
    await dialog.getByLabel(/决策理由/).fill("尝试在件数非法未修正时保存暂缓决策。");
    await dialog.getByRole("button", { name: "保存决策" }).click();
    await expect(dialog.getByText(/存在未修正的非法输入/)).toBeVisible({ timeout: 5000 });
    await expect(page).not.toHaveURL(/\/decisions\//);
  });
});

test.describe("非 1000 件新批次全流程", () => {
  test("400 件导入批次：补证据→补情景→确认→可采购→快照→复盘", async ({ page }) => {
    // 1. 导入 400 件批次（40 元，底价 35）
    await page.goto("/opportunities/import");
    await page
      .getByLabel("选择 CSV 文件")
      .setInputFiles(path.join(ROOT, "tests", "e2e", "fixtures", "NEW-400.csv"));
    await expect(page.getByText("预检通过")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("400 件")).toBeVisible();
    await page.getByRole("button", { name: "确认导入" }).click();
    await expect(page).toHaveURL(/\/opportunities\/NEW-400/, { timeout: 10000 });

    // 2. 补人工证据
    await expect(page.getByText("E-NEW-400-QUOTE")).toBeVisible();
    await page.getByLabel(/来源（文件、链接、沟通记录等）/).fill("供应商邮件报价 2026-11-07");
    await page.getByLabel("摘要").fill("供应商确认 400 件小批量尺码结构与 40 元报价");
    await page.getByRole("button", { name: "新增并引用到本批次" }).click();
    await expect(page.getByText("供应商邮件报价 2026-11-07")).toBeVisible({ timeout: 5000 });

    // 3. 三情景与政策（按 400 件规模的人工假设）
    await page.goto("/opportunities/NEW-400/scenario");
    const fillScenario = async (tab: "悲观" | "基准" | "乐观", u1: string, u2: string) => {
      await page.getByRole("tab", { name: `${tab}情景` }).click();
      await page.getByLabel("首段售价（元/件）").fill("129.00");
      await page.getByLabel("首段销量（件）").fill(u1);
      await page.getByLabel("折价段售价（元/件）").fill("79.00");
      await page.getByLabel("折价段销量（件）").fill(u2);
      await page.getByLabel("期末净残值单价（元/件）").fill("20.00");
    };
    await fillScenario("悲观", "160", "140");
    await fillScenario("基准", "240", "100");
    await fillScenario("乐观", "300", "80");
    await page.getByLabel("其他增量成本 K（元，整批总额）").fill("4000.00");
    await page.getByLabel("目标贡献 T（元，整批总额）").fill("8000.00");
    await page.getByLabel("采购预算（元，仅约束采购额）").fill("40000.00");
    await page
      .getByLabel(/情景依据说明/)
      .fill("无可比依据：三情景为买手按 400 件小批量人工假设，已逐项核实。");

    // 4. 确认 → 可采购（40 元低于悲观达标价 54.25 元）
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });

    // 5. 保存采购决策 → 快照
    await page.goto("/opportunities/NEW-400");
    await page.getByRole("button", { name: "保存决策" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("人工决定").selectOption("buy");
    await dialog.getByLabel(/决策理由/).fill("400 件小批量报价低于悲观达标价，五店可承接，决定采购。");
    await dialog.getByRole("button", { name: "保存决策" }).click();
    await expect(page).toHaveURL(/\/decisions\//, { timeout: 10000 });

    // 6. 手工复盘 → 闭环
    await page.getByRole("button", { name: "录入期末实际结果" }).click();
    const reviewDialog = page.getByRole("dialog");
    await reviewDialog.getByLabel("首段实际售价（元）").fill("129.00");
    await reviewDialog.getByLabel("首段实际销量（件）").fill("220");
    await reviewDialog.getByLabel("折价段实际售价（元）").fill("79.00");
    await reviewDialog.getByLabel("折价段实际销量（件）").fill("120");
    await reviewDialog.getByLabel("期末净残值单价（元）").fill("20.00");
    await reviewDialog.getByLabel("实际采购总成本（元）").fill("16000.00");
    await reviewDialog.getByLabel("实际其他成本（元）").fill("4000.00");
    await reviewDialog.getByLabel("复盘日期").fill("2027-03-01");
    await reviewDialog.getByRole("button", { name: "提交复盘" }).click();
    await expect(page.getByText("实际销售收入").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("差异桥接").first()).toBeVisible();
  });
});
