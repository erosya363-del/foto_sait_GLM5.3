/* Синтетические фазы полёта капли — визуальная проверка goo-морфа */
import fs from "fs";
import { chromium } from "playwright";

const OUT = "tool-results/phases";
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

/* Активируем «Загрузку» (таб 2) и раскладываем каплю/призрак по фазам */
const phases = [
  { name: "1-separated", bubble: 0.5, ghost: 0.0 }, // отделилась
  { name: "2-neck", bubble: 0.72, ghost: 0.25 }, // шея тянется
  { name: "3-gathering", bubble: 0.95, ghost: 0.62 }, // собирается
  { name: "4-settled", bubble: 1.0, ghost: 1.0 }, // слилась
];

await page.evaluate(() => {
  const items = [...document.querySelectorAll(".pill-item")];
  items[2].click();
});
await page.waitForTimeout(150); // живой полёт начался — но мы замораживаем DOM
await page.evaluate(() => {
  const goo = document.querySelector(".pill-goo");
  goo.classList.remove("is-live"); // заморозка: сами фазы зададим ниже
});

for (const p of phases) {
  await page.evaluate(({ name, bubble }) => {
    const gooEl = document.querySelector(".pill-goo");
    const b = document.querySelector(".pill-bubble");
    const items = [...document.querySelectorAll(".pill-item")];
    const x0 = items[0].offsetLeft;
    const x1 = items[2].offsetLeft;
    const w = items[0].offsetWidth;
    gooEl.classList.add("is-live");
    const bx = x0 + (x1 - x0) * bubble;
    b.style.transition = "none";
    b.style.width = `${w}px`;
    b.style.transform = `translateX(${bx}px) scaleX(1.12) scaleY(0.93)`;
    b.style.opacity = "1";
    /* PHASE 2.2: .pill-ghost удалён — фазы призрака больше не рисуются */
  }, p);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${p.name}.png` });
  console.log("shot", p.name);
}

await browser.close();
console.log("done");
