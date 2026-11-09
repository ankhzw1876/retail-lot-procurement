/**
 * 截图脚本：按面试演示流程操作并保存关键页面截图到 qa/screenshots/。
 * 运行前先 npm run build && npm run start -- -p 3100。
 */

import { chromium } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(__dirname, "..", "qa", "screenshots");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    baseURL: "http://localhost:3100",
  } as Parameters<typeof browser.newPage>[0]);

  // 1. 列表
  await page.goto("http://localhost:3100/opportunities");
  await page.getByText("晨岚基础卫衣").waitFor();
  await page.screenshot({ path: path.join(OUT, "01_采购机会列表.png"), fullPage: false });

  // 2. LOT-B 情景测算：确认 → 改价 56 → 再确认 → 可采购
  await page.goto("http://localhost:3100/opportunities/LOT-B/scenario");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认情景" }).click();
  await page.getByText("需议价").first().waitFor();
  const price = page.getByLabel("采购单价（元/件，假设报价）");
  await price.fill("56.00");
  await page.getByText("资料待补").first().waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "确认情景" }).click();
  await page.getByText("可采购").first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, "02_情景测算_议价后可采购.png"), fullPage: false });

  // 3. 保存采购决策
  await page.goto("http://localhost:3100/opportunities/LOT-B");
  await page.getByRole("button", { name: "保存决策" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("人工决定").selectOption("buy");
  await dialog
    .getByLabel(/决策理由/)
    .fill("议价至 56 元后悲观情景达标，五店可全部承接，决定采购。");
  await dialog.getByRole("button", { name: "保存决策" }).click();
  await page.waitForURL(/\/decisions\//, { timeout: 10000 });
  await page.getByText("只读").first().waitFor();

  // 4. 复盘
  await page.getByRole("button", { name: "录入期末实际结果" }).click();
  await page.getByRole("button", { name: /载入内置模拟期末结果/ }).click();
  await page.getByRole("button", { name: "提交复盘" }).click();
  await page.getByText("-¥3,500.00").first().waitFor();
  await page.screenshot({ path: path.join(OUT, "03_决策快照与复盘.png"), fullPage: true });

  await browser.close();
  console.log("screenshots saved to", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
