import { chromium } from "@playwright/test";
const pages = ["/opportunities", "/opportunities/LOT-B", "/opportunities/LOT-B/scenario", "/opportunities/LOT-C/allocation", "/decisions", "/data"];
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 760, height: 800 }]) {
    const page = await browser.newPage({ viewport: vp, baseURL: "http://localhost:3100" } as any);
    for (const p of pages) {
      await page.goto("http://localhost:3100" + p, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`${vp.width}x${vp.height} ${p} overflowX=${overflow}`);
      if (overflow > 1) { console.error("FAIL horizontal overflow"); process.exitCode = 1; }
    }
    await page.close();
  }
  await browser.close();
})();
