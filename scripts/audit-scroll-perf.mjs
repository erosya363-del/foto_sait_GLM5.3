/**
 * PHASE2 ТЗ 2.7 — ИЗМЕРЕНИЕ производительности скролла (мобильный профиль).
 *
 * Метод: на длинном списке «Остатки» выполняется scripted wheel-скролл,
 * одновременно собираются:
 *   • кадры через rAF-сэмплер: число «провалов» (gap > 32 мс) и max gap;
 *   • long tasks через PerformanceObserver (счётчик + суммарная длительность).
 *
 * Прогоняется БАЗА и варианты с поочерёдно выключенными «подозреваемыми»
 * (инжект CSS в рантайме, данные не мутируются):
 *   no-aurora   — три анимированных аврора-градиента;
 *   no-grain    — плёночное зерно (фикс. слой с бесконечной анимацией);
 *   no-pill-bf  — backdrop-filter нижней панели;
 *   no-goo      — SVG goo-фильтр линзы;
 *   no-vignette — виньетка/зерно поверх контента.
 *
 * Вывод: JSON в $E2E_SHOTS/scroll-perf.json + таблица в stdout.
 * Интерпретация: вариант, который заметно снижает jank относительно базы,
 * и есть самый дорогой слой (решение об оптимизации принимается по цифрам).
 *
 * Запуск (fail-closed изоляция):
 *   bash scripts/run-isolated.sh bun scripts/audit-scroll-perf.mjs
 */
import "./e2e-guard.mjs";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE;
const SHOTS = process.env.E2E_SHOTS || join(process.cwd(), "tool-results", "mobile-phase2");
mkdirSync(SHOTS, { recursive: true });

const VARIANTS = [
  { name: "base", css: "" },
  { name: "no-aurora", css: ".aurora{display:none!important}" },
  { name: "old-aurora", css: ".aurora{filter:blur(110px)!important}" },
  { name: "old-grain", css: ".fx-grain{inset:-50%!important}" },
  { name: "no-pause", css: "html.is-scrolling .fx-grain,html.is-scrolling .aurora{animation-play-state:running!important}" },
  { name: "no-grain", css: ".fx-grain{display:none!important}" },
  { name: "no-pill-bf", css: ".pill-shell{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}" },
  { name: "no-goo", css: ".pill-goo{filter:none!important}" },
  { name: "no-vignette", css: ".fx-vignette{display:none!important}" },
];

const browser = await chromium.launch();
/* ТЗ 2.7: headless-десктоп без тормозов не воспроизводит мобильный jank —
   применяем CPU-throttling ×6 (стандартная симуляция слабого мобильного CPU) */
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
  console.log("── CPU throttling ×6 включён (симуляция мобильного CPU)");
} catch (e) {
  console.log(`── CPU throttling недоступен (${String(e).slice(0, 60)}) — измерения на полной скорости`);
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
/* Длинный список: каталог-корень помещается в один экран, «Остатки» — нет */
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
    const frames = w.__frames.slice(2); // первые кадры — прогрев сэмплера
    const gaps = frames.filter((d) => d > 32).length;
    const gaps50 = frames.filter((d) => d > 50).length;
    return {
      frames: frames.length,
      gaps32: gaps,
      gaps50,
      maxGap: frames.length ? Math.round(Math.max(...frames)) : 0,
      longTasks: w.__long.length,
      longTotal: w.__long.reduce((a, b) => a + b, 0),
    };
  });
}

const results = {};
for (const variant of VARIANTS) {
  const runs = [];
  for (let run = 0; run < 3; run++) {
    if (variant.css) {
      await page.evaluate((css) => {
        let el = document.getElementById("__perf-probe");
        if (!el) {
          el = document.createElement("style");
          el.id = "__perf-probe";
          document.head.appendChild(el);
        }
        el.textContent = css;
      }, variant.css);
    }
    // вернуть список наверх
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(350);
    await installSampler();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(195, 420);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(200);
    const m = await collect();
    runs.push(m);
  }
  const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  results[variant.name] = {
    gaps32: median(runs.map((r) => r.gaps32)),
    gaps50: median(runs.map((r) => r.gaps50)),
    maxGap: median(runs.map((r) => r.maxGap)),
    longTasks: median(runs.map((r) => r.longTasks)),
    longTotal: median(runs.map((r) => r.longTotal)),
    runs,
  };
  console.log(
    `${variant.name.padEnd(12)} gaps32=${results[variant.name].gaps32}  gaps50=${results[variant.name].gaps50}  maxGap=${results[variant.name].maxGap}ms  longTasks=${results[variant.name].longTasks}  longTotal=${results[variant.name].longTotal}ms`
  );
}

/* Убрать probe-CSS */
await page.evaluate(() => document.getElementById("__perf-probe")?.remove());
await browser.close();

writeFileSync(join(SHOTS, "scroll-perf.json"), JSON.stringify(results, null, 2));
console.log(`\n── Сохранено: ${join(SHOTS, "scroll-perf.json")}`);
console.log("Интерпретация: вариант с заметно меньшим gaps32/longTotal против base — самый дорогой слой.");
