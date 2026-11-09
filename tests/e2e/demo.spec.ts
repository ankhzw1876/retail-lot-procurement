/**
 * 端到端关键路径（对应 docs/07 §2–§4 的浏览器验收部分）。
 * 每个测试使用全新浏览器上下文（IndexedDB 为空 → 自动载入演示样例）。
 * 注意：同一测试内的操作共享一个工作区，按演示脚本顺序执行。
 */

import { test, expect } from "@playwright/test";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

test.describe("采购系统关键路径", () => {
  test("列表载入三案例并显示情景待确认", async ({ page }) => {
    await page.goto("/opportunities");
    await expect(page.getByText("晨岚基础卫衣")).toBeVisible();
    await expect(page.getByText("云杉运动卫衣")).toBeVisible();
    await expect(page.getByText("岩川厚卫衣")).toBeVisible();
    // 未确认 → 资料待补 + 情景待确认；悲观贡献可预览但不显示 0 占位
    await expect(page.getByText("情景待确认").first()).toBeVisible();
    await expect(page.getByText("演示数据").first()).toBeVisible();
  });

  test("LOT-B 完整决策闭环：确认→议价→改价→再确认→快照→复盘", async ({ page }) => {
    // 1. 打开云杉批次详情
    await page.goto("/opportunities/LOT-B");
    await expect(page.getByRole("heading", { name: /云杉运动卫衣/ })).toBeVisible();
    await expect(page.getByText("1,000 件").first()).toBeVisible();

    // 2. 情景测算：确认初始情景 → 需议价
    await page.goto("/opportunities/LOT-B/scenario");
    await expect(page.getByText("情景待确认")).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("需议价").first()).toBeVisible({ timeout: 5000 });
    // 悲观贡献预览 16,250.00
    await expect(page.getByText("¥16,250.00").first()).toBeVisible();

    // 3. 改价 56 元 → 确认失效（回到资料待补）→ 重新确认 → 可采购
    const priceInput = page.getByLabel("采购单价（元/件，假设报价）");
    await priceInput.fill("56.00");
    await expect(page.getByText("资料待补").first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("¥20,250.00").first()).toBeVisible();

    // 4. 56.25/56.26 边界（通过敏感性表按钮验证改价，重新确认）
    await page.getByRole("button", { name: "将报价改为此价格" }).first().click();
    // 改后确认失效，需重新确认；此处仅验证确认状态失效
    await expect(page.getByText("情景待确认").first()).toBeVisible({ timeout: 5000 });

    // 5. 恢复 56 元并确认后保存采购决策
    await priceInput.fill("56.00");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });

    await page.goto("/opportunities/LOT-B");
    await page.getByRole("button", { name: "保存决策" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("人工决定").selectOption("buy");
    await dialog
      .getByLabel(/决策理由/)
      .fill("议价至 56 元后悲观情景达标，五店可全部承接，决定采购。");
    await dialog.getByRole("button", { name: "保存决策" }).click();

    // 6. 快照页：只读、价格为 56 元
    await expect(page).toHaveURL(/\/decisions\//, { timeout: 10000 });
    await expect(page.getByText("只读").first()).toBeVisible();
    await expect(page.getByText("¥56.00").first()).toBeVisible();
    await expect(page.getByText("¥36,150.00").first()).toBeVisible();

    // 7. 改草稿回 60 元 → 旧快照仍为 56 元（B06）
    await page.goto("/opportunities/LOT-B/scenario");
    const priceInput2 = page.getByLabel("采购单价（元/件，假设报价）");
    await priceInput2.fill("60.00");
    await page.goBack();
    await expect(page.getByText("¥56.00").first()).toBeVisible();

    // 8. 复盘：载入模拟期末结果 → 差异 -3,500 元，桥接闭合
    await page.getByRole("button", { name: "录入期末实际结果" }).click();
    await page.getByRole("button", { name: /载入内置模拟期末结果/ }).click();
    await page.getByRole("button", { name: "提交复盘" }).click();
    await expect(page.getByText("-¥3,500.00").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("¥32,650.00").first()).toBeVisible();
    await expect(page.getByText("-¥2,500.00").first()).toBeVisible();
  });

  test("LOT-C 分店留仓 600 件且确认后建议放弃", async ({ page }) => {
    await page.goto("/opportunities/LOT-C/scenario");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("建议放弃").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("-¥3,750.00").first()).toBeVisible();

    await page.goto("/opportunities/LOT-C/allocation");
    await expect(page.getByText("600").first()).toBeVisible();
    await expect(page.getByText(/留仓/).first()).toBeVisible();
  });

  test("CSV 导入：异常文件报行级错误；模板导入成功进入资料待补", async ({ page }) => {
    await page.goto("/opportunities/import");
    // 异常文件
    await page
      .getByLabel("选择 CSV 文件")
      .setInputFiles(path.join(ROOT, "data", "import_invalid.csv"));
    await expect(page.getByText("DUPLICATE_SIZE")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("INVALID_INTEGER")).toBeVisible();
    await expect(page.getByText("INVALID_MONEY")).toBeVisible();
    await expect(page.getByText("INVALID_DATE")).toBeVisible();

    // 有效模板
    await page
      .getByLabel("选择 CSV 文件")
      .setInputFiles(path.join(ROOT, "data", "import_template.csv"));
    await expect(page.getByText("预检通过")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("¥60.00").first()).toBeVisible();
    await page.getByRole("button", { name: "确认导入" }).click();
    await expect(page).toHaveURL(/\/opportunities\/NEW-001/, { timeout: 10000 });
    await expect(page.getByText("资料待补").first()).toBeVisible();

    // 重复导入同一 batch_id 拒绝（B02）
    await page.goto("/opportunities/import");
    await page
      .getByLabel("选择 CSV 文件")
      .setInputFiles(path.join(ROOT, "data", "import_template.csv"));
    await expect(page.getByText("ID_EXISTS")).toBeVisible({ timeout: 5000 });
  });

  test("刷新后草稿保留（B07）；深链不存在记录显示空态（C09）", async ({ page }) => {
    await page.goto("/opportunities/LOT-A/scenario");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });

    await page.goto("/opportunities/NO-SUCH-BATCH");
    await expect(page.getByText("该记录不存在")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "返回采购机会列表" })
    ).toBeVisible();
  });

  test("重置数据：取消不变，确认后清空并重新载入样例（B10）", async ({ page }) => {
    await page.goto("/opportunities/LOT-A/scenario");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景" }).click();
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });

    await page.goto("/data");
    await page.getByRole("button", { name: "重置为演示样例…" }).click();
    await page.getByRole("button", { name: "取消（数据不变）" }).click();
    await page.goto("/opportunities/LOT-A/scenario");
    await expect(page.getByText("可采购").first()).toBeVisible({ timeout: 5000 });

    await page.goto("/data");
    await page.getByRole("button", { name: "重置为演示样例…" }).click();
    await page.getByLabel("输入「重置」以确认").fill("重置");
    await page.getByRole("button", { name: "确认重置" }).click();
    await expect(page.getByText("本地工作区已重置")).toBeVisible({ timeout: 5000 });
    await page.goto("/opportunities/LOT-A/scenario");
    await expect(page.getByText("情景待确认").first()).toBeVisible({ timeout: 5000 });
  });
});
