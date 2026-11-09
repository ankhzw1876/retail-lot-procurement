/**
 * Codex 独立验收六项缺陷的真实交互回归（浏览器端到端）。
 * ① 新导入批次全流程闭环；③ 非法输入上送（MoneyField/IntField 分别覆盖）；
 * ④ 底价冲突保留并显式设为未知。②⑤⑥由 tests/unit 引擎与服务边界用例覆盖。
 * 每个测试使用全新浏览器上下文（IndexedDB 为空 → 自动载入演示样例）。
 */

import { test, expect } from "@playwright/test";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

test.describe("Codex 验收缺陷回归", () => {
  test("① 新导入批次：补证据→补情景→确认→正式建议→快照→复盘 全流程", async ({ page }) => {
    // 1. 导入模板批次 NEW-001（60 元，底价 55，1000 件）
    await page.goto("/opportunities/import");
    await page
      .getByLabel("选择 CSV 文件")
      .setInputFiles(path.join(ROOT, "data", "import_template.csv"));
    await expect(page.getByText("预检通过")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "确认导入" }).click();
    await expect(page).toHaveURL(/\/opportunities\/NEW-001/, { timeout: 10000 });
    await expect(page.getByText("资料待补").first()).toBeVisible();

    // 2. 证据面板：导入报价证据自动生成；新增一条人工证据
    await expect(page.getByText("E-NEW-001-QUOTE")).toBeVisible();
    await page.getByLabel(/来源（文件、链接、沟通记录等）/).fill("供应商微信报价记录 2026-11-06");
    await page.getByLabel("摘要").fill("供应商确认整批 1,000 件尺码结构与 60 元报价");
    await page.getByRole("button", { name: "新增并引用到本批次" }).click();
    await expect(page.getByText("供应商微信报价记录 2026-11-06")).toBeVisible({ timeout: 5000 });

    // 3. 情景测算：按买手假设补齐三情景与政策
    await page.goto("/opportunities/NEW-001/scenario");
    const fillScenario = async (
      tab: "悲观" | "基准" | "乐观",
      u1: string,
      u2: string
    ) => {
      await page.getByRole("tab", { name: `${tab}情景` }).click();
      await page.getByLabel("首段售价（元/件）").fill("129.00");
      await page.getByLabel("首段销量（件）").fill(u1);
      await page.getByLabel("折价段售价（元/件）").fill("79.00");
      await page.getByLabel("折价段销量（件）").fill(u2);
      await page.getByLabel("期末净残值单价（元/件）").fill("20.00");
    };
    await fillScenario("悲观", "400", "350");
    await fillScenario("基准", "600", "250");
    await fillScenario("乐观", "750", "200");
    await page.getByLabel("其他增量成本 K（元，整批总额）").fill("8000.00");
    await page.getByLabel("目标贡献 T（元，整批总额）").fill("20000.00");
    await page.getByLabel("采购预算（元，仅约束采购额）").fill("100000.00");
    await page
      .getByLabel(/情景依据说明/)
      .fill("无可比依据：三情景为买手人工假设，参考供应商尺码结构与历史动销经验，已逐项核实。");

    // 4. 确认 → 正式建议（60 元高于安全达标价 → 需议价，而非永远资料待补）
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("需议价").first()).toBeVisible({ timeout: 5000 });

    // 5. 保存人工“采购”决策（人工覆盖需议价，记录真实判断）
    await page.goto("/opportunities/NEW-001");
    await page.getByRole("button", { name: "保存决策" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("人工决定").selectOption("buy");
    await dialog
      .getByLabel(/决策理由/)
      .fill("供应商交期紧张且底价 55 元有议价空间，人工覆盖建议先行锁定货源。");
    await dialog.getByRole("button", { name: "保存决策" }).click();
    await expect(page).toHaveURL(/\/decisions\//, { timeout: 10000 });
    await expect(page.getByText("只读").first()).toBeVisible();

    // 6. 录入期末实际结果（手工填写，非内置 fixture）→ 复盘闭环
    await page.getByRole("button", { name: "录入期末实际结果" }).click();
    const reviewDialog = page.getByRole("dialog");
    await reviewDialog.getByLabel("首段实际售价（元）").fill("129.00");
    await reviewDialog.getByLabel("首段实际销量（件）").fill("550");
    await reviewDialog.getByLabel("折价段实际售价（元）").fill("79.00");
    await reviewDialog.getByLabel("折价段实际销量（件）").fill("300");
    await reviewDialog.getByLabel("期末净残值单价（元）").fill("20.00");
    await reviewDialog.getByLabel("实际采购总成本（元）").fill("56000.00");
    await reviewDialog.getByLabel("实际其他成本（元）").fill("9000.00");
    await reviewDialog.getByLabel("复盘日期").fill("2027-03-01");
    await reviewDialog.getByRole("button", { name: "提交复盘" }).click();
    await expect(page.getByText("实际销售收入").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("差异桥接").first()).toBeVisible();
  });

  test("③ 非法金额输入（MoneyField）：上送表单层，显示待修正并阻断确认", async ({ page }) => {
    await page.goto("/opportunities/LOT-A/scenario");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });

    // 输入 56.251：非法，不生效；页面必须明示待修正而不是继续展示“可采购/已确认”
    await page.getByLabel("采购单价（元/件，假设报价）").fill("56.251");
    await expect(page.getByText(/存在未通过校验的输入/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/输入待修正：非法输入未生效/).first()).toBeVisible();
    await expect(page.getByText("待修正").first()).toBeVisible();
    // 计算仍按最后合法值：敏感性表当前行仍是 50.00
    await expect(page.getByText("¥50.00").first()).toBeVisible();
    // 阻断确认
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: "确认情景" })).toBeDisabled();
    // 修正后恢复
    await page.getByLabel("采购单价（元/件，假设报价）").fill("50.00");
    await expect(page.getByText("情景已确认").first()).toBeVisible({ timeout: 5000 });
  });

  test("③ 非法件数输入（IntField）：同样上送并阻断确认", async ({ page }) => {
    await page.goto("/opportunities/LOT-A/scenario");
    await page.getByLabel("首段销量（件）").fill("1.5");
    await expect(page.getByText(/存在未通过校验的输入/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/输入待修正：非法输入未生效/).first()).toBeVisible();
    await page.getByRole("checkbox").check();
    await expect(page.getByRole("button", { name: "确认情景" })).toBeDisabled();
  });

  test("④ 报价低于底价：底价保留并显式报错，可显式设为未知", async ({ page }) => {
    await page.goto("/opportunities/LOT-A/scenario");
    // LOT-A：报价 50，底价 48；改为 47 → 底价不得被静默删除
    await page.getByLabel("采购单价（元/件，假设报价）").fill("47.00");
    await expect(page.getByText("供应商底价不能高于当前报价").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/报价低于供应商底价：底价保留不变/).first()).toBeVisible();
    await expect(page.getByLabel("供应商底价（元/件，已知底价或估计）")).toHaveValue("48.00");

    // 显式设为未知 → 冲突解除，底价展示“未知”而非 0.00
    await page.getByRole("button", { name: "将底价设为未知" }).click();
    await expect(page.getByText("未知").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("供应商底价不能高于当前报价")).toHaveCount(0);
    // 可显式填回底价
    await page.getByRole("button", { name: "填写底价" }).click();
    await expect(page.getByLabel("供应商底价（元/件，已知底价或估计）")).toHaveValue("47.00");
  });
});
