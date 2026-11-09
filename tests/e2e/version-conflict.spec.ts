/**
 * Codex 第三轮复验回归：双标签页版本一致性。
 * 1) 两个标签页同时保存同一输入版本 → 单事务编号分配生成 v1/v2，不重复；
 * 2) 标签 B 修改输入并重新确认后，标签 A 的旧弹窗必须拒绝保存（VERSION_CONFLICT）。
 * 复现脚本来源：Codex reaudit-round3/version.spec.cjs。
 */

import { test, expect, Page } from "@playwright/test";

async function openDecision(page: Page) {
  await page.getByRole("button", { name: "保存决策", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("人工决定").selectOption("buy");
  await dialog.getByLabel(/决策理由/).fill("独立验收复现，检查双标签页的决策快照与版本。");
  return dialog;
}

test.describe("双标签页版本一致性（Codex 第三轮复验）", () => {
  test("双标签同时保存同一版，版本号各不相同", async ({ page, context }) => {
    await page.goto("/opportunities/LOT-A");
    const other = await context.newPage();
    await other.goto("/opportunities/LOT-A");
    const [a, b] = await Promise.all([openDecision(page), openDecision(other)]);
    await Promise.all([
      a.getByRole("button", { name: "保存决策", exact: true }).click(),
      b.getByRole("button", { name: "保存决策", exact: true }).click(),
    ]);
    await Promise.all([
      page.waitForURL("**/decisions/**"),
      other.waitForURL("**/decisions/**"),
    ]);
    const titles = await Promise.all([
      page.locator("h1").innerText(),
      other.locator("h1").innerText(),
    ]);
    expect(titles.map((t) => t.match(/v(\d+)/)?.[1]).sort()).toEqual(["1", "2"]);
  });

  test("旧详情页持有旧输入时，保存必须被拒绝并提示刷新", async ({ page, context }) => {
    // 标签 A：确认 50 元 → 可采购，返回详情并打开保存弹窗（不提交）
    await page.goto("/opportunities/LOT-A/scenario");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认情景", exact: true }).click();
    await expect(page.getByText("情景已确认", { exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByRole("link", { name: "← 返回详情" }).click();
    const oldDialog = await openDecision(page);

    // 标签 B：改价 51 元并重新确认，刷新验证已持久化
    const other = await context.newPage();
    await other.goto("/opportunities/LOT-A/scenario");
    const price = other.getByLabel("采购单价（元/件，假设报价）");
    await price.fill("51.00");
    await expect(other.getByText(/情景待确认/).first()).toBeVisible({ timeout: 5000 });
    await other.getByRole("checkbox").check();
    await other.getByRole("button", { name: "确认情景", exact: true }).click();
    await expect(other.getByText("情景已确认", { exact: true })).toBeVisible({ timeout: 5000 });
    await other.reload();
    await expect(price).toHaveValue("51.00");
    await expect(other.getByText("情景已确认", { exact: true })).toBeVisible();

    // 标签 A 提交旧输入：必须被 VERSION_CONFLICT 拦截，不得落库跳转
    await oldDialog.getByRole("button", { name: "保存决策", exact: true }).click();
    await expect(
      oldDialog.getByText(/已在其他标签页或窗口被修改/)
    ).toBeVisible({ timeout: 5000 });
    expect(page.url()).not.toContain("/decisions/");

    // 标签 A 刷新后重新核对：新价 51 元可见，可正常保存
    await page.reload();
    await expect(page.getByText("¥51.00").first()).toBeVisible({ timeout: 5000 });
  });
});
