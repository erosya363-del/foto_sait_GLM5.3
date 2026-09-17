/* Покадровый захват полёта капли (CDP screencast) — проверка goo-морфа */
import fs from "fs";
import { chromium } from "playwright";

const OUT = "tool-results/flight";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(1400);

const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (e) => {
  frames.push({ data: e.data, ts: Date.now() });
  await cdp
    .send("Page.screencastFrameAck", { sessionId: e.sessionId })
    .catch(() => {});
});
await cdp.send("Page.startScreencast", {
  format: "jpeg",
  quality: 80,
  everyNthFrame: 1,
  maxWidth: 390,
  maxHeight: 844,
});

await page.evaluate(() => document.querySelectorAll(".pill-item")[2].click());
await page.waitForTimeout(1400);
await cdp.send("Page.stopScreencast");

frames.forEach((f, i) => {
  fs.writeFileSync(
    `${OUT}/f_${String(i).padStart(3, "0")}.jpg`,
    Buffer.from(f.data, "base64"),
  );
});
console.log("frames:", frames.length);
await browser.close();
