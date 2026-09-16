import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
const first = await page.evaluate(() => ({
  flag: sessionStorage.getItem("skovo-booted"),
  cls: document.documentElement.className,
}));
console.log("first load:", JSON.stringify(first));
await page.reload({ waitUntil: "domcontentloaded" });
const second = await page.evaluate(() => ({
  flag: sessionStorage.getItem("skovo-booted"),
  cls: document.documentElement.className,
  bootDisplay: (() => {
    const el = document.querySelector(".boot-bg");
    return el ? getComputedStyle(el).display : "absent";
  })(),
}));
console.log("after reload:", JSON.stringify(second));
// Где в HTML стоит скрипт?
const html = await page.content();
const idx = html.indexOf("skovo-booted");
const headEnd = html.indexOf("</head>");
console.log("script in head?", idx > -1 && idx < headEnd, "idx:", idx, "headEnd:", headEnd);
await browser.close();
