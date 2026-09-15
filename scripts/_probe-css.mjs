import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
page.on("response", (r) => { if (!r.ok() && r.status() !== 304) errors.push(`HTTP ${r.status()} ${r.url().slice(-60)}`); });
await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 }).catch(e => errors.push("goto: " + e.message.slice(0,100)));
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const sh = document.querySelector(".pill-shell");
  const cs = sh ? getComputedStyle(sh) : null;
  const link = [...document.querySelectorAll("link[rel=stylesheet]")].map(l => l.href.split("/").pop());
  return {
    hasShell: !!sh,
    height: cs?.height, pos: cs?.position, backdrop: cs?.backdropFilter?.slice(0, 60),
    bg: cs?.background?.slice(0, 40) || cs?.backgroundColor,
    cssLinks: link,
    bodyBg: getComputedStyle(document.body).background.slice(0, 80),
    rim: !!document.querySelector(".pill-rim"),
    bootGone: !document.querySelector(".boot-bg"),
  };
});
console.log(JSON.stringify(info, null, 1));
console.log("ERRORS:", errors.slice(0, 6));
await b.close();
