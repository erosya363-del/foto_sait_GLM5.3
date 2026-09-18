/* Диагностика «пустой полосы под нижней панелью при запуске»:
   грузим страницу, снимаем геометрию/видимость всех кандидатов внизу экрана
   ДО первого взаимодействия, затем кликаем по другой вкладке и снимаем again.
   Запуск: bash scripts/run-isolated.sh bun scripts/dbg-strip.mjs */
import { chromium } from "playwright";

const base = process.env.E2E_BASE || "http://localhost:3100";
const shots = process.env.E2E_SHOTS || "tool-results";

const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 780 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const p = await ctx.newPage();

const dump = async (label) => {
  const data = await p.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        opacity: cs.opacity,
        visibility: cs.visibility,
        display: cs.display,
        bottom: cs.bottom,
        transform: cs.transform,
        bg: cs.backgroundColor,
      };
    };
    const html = document.documentElement;
    const at = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      return el.tagName.toLowerCase() + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(" ").slice(0, 3).join(".");
    };
    return {
      htmlClasses: html.className,
      sab: getComputedStyle(html).getPropertyValue("--sab").trim(),
      kbH: getComputedStyle(html).getPropertyValue("--kb-h").trim(),
      innerH: window.innerHeight,
      scrollH: document.documentElement.scrollHeight,
      pillNav: pick(".pill-nav"),
      pillWrap: pick(".pill-wrap"),
      pillShell: pick(".pill-shell"),
      pillGoo: pick(".pill-goo"),
      pillBubble: pick(".pill-bubble"),
      pillGhost: pick(".pill-ghost"),
      searchPop: pick(".search-pop"),
      searchChip: pick(".search-chip"),
      fabTop: pick(".fab-top"),
      bootSplash: pick(".boot-splash, [class*='boot']"),
      at_bottom_5: at(195, window.innerHeight - 5),
      at_bottom_20: at(195, window.innerHeight - 20),
      at_bottom_45: at(195, window.innerHeight - 45),
      at_bottom_80: at(195, window.innerHeight - 80),
      at_bottom_120: at(195, window.innerHeight - 120),
    };
  });
  console.log(`\n======== ${label} ========`);
  console.log(JSON.stringify(data, null, 1));
  await p.screenshot({ path: `${shots}/strip-${label}.png`, clip: { x: 0, y: 780 - 200, width: 390, height: 200 } });
};

await p.goto(base, { waitUntil: "networkidle" });
await p.waitForTimeout(1200); // splash + first paint + fonts
await dump("1-startup");

await p.waitForTimeout(1500); // наблюдение без взаимодействия
await dump("2-startup-later");

// тап по второй вкладке (Остатки)
const tabs = p.locator(".pill-item");
await tabs.nth(1).click();
await p.waitForTimeout(900);
await dump("3-after-tab");

await b.close();
console.log("\nDONE");
