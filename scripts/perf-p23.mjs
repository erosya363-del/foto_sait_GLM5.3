/**
 * PHASE 2.3 §7/§17 — ПОВТОРНЫЙ perf-аудит Liquid Glass v5 + panel-drag.
 *
 * A. SCROLL (методика audit-scroll-perf.mjs — rAF-сэмплер + longtask,
 *    CPU-throttling ×6, список «Остатки», 3 прогона на вариант, median):
 *    варианты blur: 40px (production) / 32px / 24px — инжект CSS-override
 *    --glass-blur в рантайме (данные и production-значение не мутируются).
 *
 * B. PANEL DRAG (§17): записать кадры во время МЕДЛЕННОГО drag по панели
 *    (press → bridge ×2 → release) — сравнить с REST-скроллом той же сессии:
 *    не стал ли дорогим press-lens (больше площадь стекла + goo-фильтр).
 *
 * Вывод: JSON $E2E_SHOTS/perf-p23.json + таблица stdout.
 * Запуск: bash scripts/run-isolated.sh bun scripts/perf-p23.mjs
 */
import "./e2e-guard.mjs";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE;
const SHOTS = process.env.E2E_SHOTS || join(process.cwd(), "tool-results", "mobile-phase2");
mkdirSync(SHOTS, { recursive: true });

const BLUR_VARIANTS = [
  { name: "blur-40px (production)", css: "" },
  { name: "blur-32px", css: ":root{--glass-blur:32px!important}" },
  { name: "blur-24px", css: ":root{--glass-blur:24px!important}" },
];

const browser = await chromium.launch();
const cdp = await browser.newBrowserCDPSession?.() ?? null;
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const cdpPage = await context.newCDPSession(page);
try {
  await cdpPage.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  console.log("── CPU throttling ×6 включён");
} catch {
  console.log("── CPU throttling недоступен — измерения на полной скорости");
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.locator('nav.pill-nav button:has-text("Остатки")').click();
await page.waitForTimeout(1100);

async function installSampler() {
  await page.evaluate(() => {
    const w = window;
    w.__frames = [];
    w.__long = [];
    w.__loopOn = true;
    let last = performance.now();
    const loop = (t) => {
      if (!w.__loopOn) return;
      w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    w.__po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(Math.round(e.duration));
    });
    try { w.__po.observe({ entryTypes: ["longtask"] }); } catch { /* нет longtask */ }
  });
}

async function collect() {
  return page.evaluate(() => {
    const w = window;
    w.__loopOn = false;
    const frames = w.__frames.slice(2);
    return {
      frames: frames.length,
      gaps32: frames.filter((d) => d > 32).length,
      gaps50: frames.filter((d) => d > 50).length,
      maxGap: frames.length ? Math.round(Math.max(...frames)) : 0,
      longTasks: w.__long.length,
      longTotal: w.__long.reduce((a, b) => a + b, 0),
    };
  });
}

async function setCss(css) {
  await page.evaluate((text) => {
    let el = document.getElementById("__perf-probe");
    if (!el) {
      el = document.createElement("style");
      el.id = "__perf-probe";
      document.head.appendChild(el);
    }
    el.textContent = text;
  }, css);
}

const median = (arr) => arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const results = { scroll: {}, panelDrag: {} };

/* ── A. SCROLL по вариантам blur ── */
console.log("\n── A. SCROLL: blur-варианты (3 прогона, median) ──");
for (const variant of BLUR_VARIANTS) {
  const runs = [];
  for (let run = 0; run < 3; run++) {
    await setCss(variant.css);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(350);
    await installSampler();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(195, 420);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(200);
    runs.push(await collect());
  }
  const m = {
    gaps32: median(runs.map((r) => r.gaps32)),
    gaps50: median(runs.map((r) => r.gaps50)),
    maxGap: median(runs.map((r) => r.maxGap)),
    longTasks: median(runs.map((r) => r.longTasks)),
    longTotal: median(runs.map((r) => r.longTotal)),
    runs,
  };
  results.scroll[variant.name] = m;
  console.log(`${variant.name.padEnd(24)} gaps32=${m.gaps32}  gaps50=${m.gaps50}  maxGap=${m.maxGap}ms  longTasks=${m.longTasks}  longTotal=${m.longTotal}ms`);
}

/* ── B. PANEL DRAG (§17): press → bridge ×2 → release, медленно ── */
console.log("\n── B. PANEL DRAG (press + два моста + release), по вариантам blur ──");
{
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll(".pill-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim(), cx: r.left + r.width / 2 };
    })
  );
  const byLabel = (l) => tabs.find((t) => t.label === l);
  const cy = await page.evaluate(() => {
    const s = document.querySelector(".pill-shell").getBoundingClientRect();
    return s.top + s.height / 2;
  });
  const cat = byLabel("Каталог");
  const stock = byLabel("Остатки");
  const upload = byLabel("Загрузка");

  const dragScenario = async () => {
    // press (возврат в Каталог сделан ДО включения сэмплера)
    await page.evaluate(({ x, y }) => {
      document.querySelector(".pill-shell").dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })
      );
    }, { x: cat.cx, y: cy });
    await page.waitForTimeout(320);
    // мост Каталог↔Остатки: 12 шагов с паузами (медленно, как в ТЗ §J-видео)
    for (let i = 1; i <= 12; i++) {
      const x = cat.cx + ((stock.cx - cat.cx) * i) / 12;
      await page.evaluate(({ x, y }) => {
        window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
      }, { x, y: cy });
      await page.waitForTimeout(55);
    }
    // мост Остатки↔Загрузка
    for (let i = 1; i <= 12; i++) {
      const x = stock.cx + ((upload.cx - stock.cx) * i) / 12;
      await page.evaluate(({ x, y }) => {
        window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
      }, { x, y: cy });
      await page.waitForTimeout(55);
    }
    // release
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 0 }));
    }, { x: upload.cx, y: cy });
    await page.waitForTimeout(450);
  };

  for (const variant of BLUR_VARIANTS) {
    const runs = [];
    for (let run = 0; run < 3; run++) {
      await setCss(variant.css);
      await page.waitForTimeout(300);
      /* подготовка ДО сэмплера: возврат в Каталог (рендер раздела не меряем) */
      await page.locator('nav.pill-nav button:has-text("Каталог")').click();
      await page.waitForTimeout(700);
      await installSampler();
      await dragScenario();
      await page.waitForTimeout(150);
      runs.push(await collect());
    }
    const m = {
      gaps32: median(runs.map((r) => r.gaps32)),
      gaps50: median(runs.map((r) => r.gaps50)),
      maxGap: median(runs.map((r) => r.maxGap)),
      longTasks: median(runs.map((r) => r.longTasks)),
      longTotal: median(runs.map((r) => r.longTotal)),
      runs,
    };
    results.panelDrag[variant.name] = m;
    console.log(`${variant.name.padEnd(24)} gaps32=${m.gaps32}  gaps50=${m.gaps50}  maxGap=${m.maxGap}ms  longTasks=${m.longTasks}  longTotal=${m.longTotal}ms`);
  }
}

await setCss("");
await page.evaluate(() => document.getElementById("__perf-probe")?.remove());
await browser.close();

writeFileSync(join(SHOTS, "perf-p23.json"), JSON.stringify(results, null, 2));
console.log(`\n── Сохранено: ${join(SHOTS, "perf-p23.json")}`);
console.log("Интерпретация: если 40px заметно хуже 32/24 — рекомендация в отчёте (§7.1/23.6).");
