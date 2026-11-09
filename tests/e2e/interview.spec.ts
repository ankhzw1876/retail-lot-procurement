import { test, expect } from "@playwright/test";

test("首页进入云杉案例，风险摘要随报价和销量变化", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "这批货，多少钱能接？" })).toBeVisible();

  await page.getByRole("link", { name: "开始云杉卫衣案例" }).click();
  await page.getByRole("link", { name: "情景测算", exact: true }).click();

  const sections = await page.locator("main h2").allTextContents();
  expect(sections.slice(0, 5)).toEqual([
    "1. 采购条件与约束（三情景共用）",
    "2. 销售假设",
    "3. 比较采购价（采购价敏感性）",
    "4. 确认情景",
    "测算结果",
  ]);
  const priceTable = page.getByRole("table");
  await expect(priceTable.getByRole("row").filter({ hasText: "供应商底价" })).toContainText("¥55.00");
  await expect(priceTable.getByRole("row").filter({ hasText: "最高进货价" })).toContainText("¥56.25");

  const summary = page.getByRole("region", { name: "采购风险摘要" });
  await expect(summary.getByText("试算 · 待补资料或确认")).toBeVisible();
  await expect(summary.getByText("差 ¥3,750.00")).toBeVisible();
  await expect(summary.getByText("¥56.25", { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认情景" }).click();
  await expect(summary.getByText("按当前情景与约束")).toBeVisible();
  await expect(summary.getByText("差 ¥3,750.00")).toBeVisible();

  const quote = page.getByLabel("采购单价（元/件，假设报价）");
  await summary.getByRole("link", { name: "调整采购条件" }).click();
  await quote.fill("56");
  await expect(summary.getByText("余 ¥250.00")).toBeVisible();
  await expect(summary.getByText("2 件", { exact: true })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认情景" }).click();
  await expect(page.getByText("可采购").first()).toBeVisible();

  await page.getByLabel("首段销量（件）").fill("390");
  await expect(summary.getByText("差 ¥840.00")).toBeVisible();
  await expect(summary.getByText("¥55.16", { exact: true })).toBeVisible();
  await expect(summary.getByText("2 件", { exact: true })).toHaveCount(0);
  await quote.fill("56.251");
  await expect(summary).toHaveCount(0);
});
