/**
 * PHASE 2.3 supplement J — ОБЯЗАТЕЛЬНЫЕ КОНТРОЛЬНЫЕ КАДРЫ + ВИДЕО.
 *
 * Кадры (полный вьюпорт 390×844, тёмная; 06–08 — светлая):
 *   01-rest-catalog.png            REST, линза внутри панели
 *   02-press-catalog.png           PRESS, линза вспухла выше панели
 *   03-bridge-catalog-stock.png    мост Каталог↔Остатки (середина)
 *   04-bridge-stock-upload.png     мост Остатки↔Загрузка (середина)
 *   05-release-stock.png           после release-коммита на Остатках
 *   06-light-rest.png              светлая REST
 *   07-light-press.png             светлая PRESS
 *   08-light-bridge.png            светлая BRIDGE
 *   09-search-morph-midpoint.png   середина морфа NAV→SEARCH (~130 мс)
 *
 * Видео dynamic-liquid-lens.mp4 — МЕДЛЕННЫЙ жест (§J):
 *   Каталог → press → drag 25% → стоп → 50% → стоп → 75% →
 *   release на Остатках → обратный drag к Каталогу (с bridges).
 *
 * Запуск (нужен живой сервер): E2E_BASE=http://localhost:3100 bun scripts/dbg-p23-shots.mjs
 * (используется внутри run-isolated либо против дев/стенда; файлы — в tool-results/p23/, вне Git)
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = process.env.E2E_SHOTS || join(process.cwd(), "tool-results", "p23");
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "video-raw"), { recursive: true });

const browser = await chromium.launch();

/* ── ТЁМНАЯ СЕРИЯ (с записью видео) ── */
const ctxD = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  recordVideo: { dir: join(OUT, "video-raw"), size: { width: 390, height: 844 } },
});
const p = await ctxD.newPage();
await p.goto(BASE, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);

const shot = (name) => p.screenshot({ path: join(OUT, name) });
const down = (x, y) =>
  p.evaluate(({ x, y }) => {
    document.querySelector(".pill-shell").dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })
    );
  }, { x, y });
const move = async (x, y, pause = 60) => {
  await p.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
  }, { x, y });
  await p.waitForTimeout(pause);
};
const up = (x, y) =>
  p.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 0 }));
  }, { x, y });

const tabs = await p.evaluate(() =>
  [...document.querySelectorAll(".pill-item")].map((el) => {
    const r = el.getBoundingClientRect();
    return { label: el.textContent.trim(), cx: r.left + r.width / 2 };
  })
);
const cy = await p.evaluate(() => {
  const s = document.querySelector(".pill-shell").getBoundingClientRect();
  return s.top + s.height / 2;
});
const T = Object.fromEntries(tabs.map((t) => [t.label, t.cx]));
const lerp = (a, b, t) => a + (b - a) * t;

/* 01 REST */
await shot("01-rest-catalog.png");

/* 02 PRESS (пружине нужно ~0.45 c на вспухание) */
await down(T["Каталог"], cy);
await p.waitForTimeout(500);
await shot("02-press-catalog.png");

/* 03 BRIDGE Каталог↔Остатки — палец ровно посередине, ждём пружины */
await move(lerp(T["Каталог"], T["Остатки"], 0.5), cy, 90);
await move(lerp(T["Каталог"], T["Остатки"], 0.5), cy, 300);
await shot("03-bridge-catalog-stock.png");

/* 04 BRIDGE Остатки↔Загрузка */
await move(T["Остатки"], cy, 120);
await move(lerp(T["Остатки"], T["Загрузка"], 0.5), cy, 90);
await move(lerp(T["Остатки"], T["Загрузка"], 0.5), cy, 300);
await shot("04-bridge-stock-upload.png");

/* 05 RELEASE на Остатках → сбор линзы */
/* сначала вернуться к Остаткам (палец на середине моста 2) */
await move(lerp(T["Остатки"], T["Загрузка"], 0.25), cy, 80);
await move(T["Остатки"], cy, 80);
await up(T["Остатки"], cy);
await p.waitForTimeout(750);
await shot("05-release-stock.png");

/* ── ВИДЕО (§J): медленный жест с ОСТАНОВКАМИ в промежуточных состояниях ──
   Каталог: press → drag 25% → стоп → 50% → стоп → 75% → release Остатки →
   обратный drag (Остатки → Каталог, с мостом) → release. */
await p.locator('nav.pill-nav button:has-text("Каталог")').click();
await p.waitForTimeout(900);
await down(T["Каталог"], cy);
await p.waitForTimeout(600); // press-вспухание в кадре
for (const t of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75]) {
  await move(lerp(T["Каталог"], T["Остатки"], t), cy, 40);
  await p.waitForTimeout(260); // ОСТАНОВКА — форма капли в промежуточном состоянии
}
await up(T["Остатки"], cy);
await p.waitForTimeout(800); // settle на Остатках
// обратный drag: Остатки → Каталог
await down(T["Остатки"], cy);
await p.waitForTimeout(450);
for (const t of [0.75, 0.5, 0.25, 0]) {
  await move(lerp(T["Остатки"], T["Каталог"], t), cy, 40);
  await p.waitForTimeout(240);
}
await up(T["Каталог"], cy);
await p.waitForTimeout(700);

await p.close();
await ctxD.close(); // финализирует видео

/* ── СВЕТЛАЯ СЕРИЯ (06–08) ── */
const ctxL = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const pl = await ctxL.newPage();
await pl.addInitScript(() => {
  try { localStorage.setItem("theme", "light"); } catch {}
});
await pl.goto(BASE, { waitUntil: "networkidle" });
await pl.waitForTimeout(1200);
await pl.evaluate(() => document.documentElement.classList.add("light"));
await pl.waitForTimeout(300);

const tabsL = await pl.evaluate(() =>
  [...document.querySelectorAll(".pill-item")].map((el) => {
    const r = el.getBoundingClientRect();
    return { label: el.textContent.trim(), cx: r.left + r.width / 2 };
  })
);
const TL = Object.fromEntries(tabsL.map((t) => [t.label, t.cx]));
const cyL = await pl.evaluate(() => {
  const s = document.querySelector(".pill-shell").getBoundingClientRect();
  return s.top + s.height / 2;
});

await pl.screenshot({ path: join(OUT, "06-light-rest.png") });
await pl.evaluate(({ x, y }) => {
  document.querySelector(".pill-shell").dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })
  );
}, { x: TL["Каталог"], y: cyL });
await pl.waitForTimeout(500);
await pl.screenshot({ path: join(OUT, "07-light-press.png") });
await pl.evaluate(({ x, y }) => {
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
}, { x: lerp(TL["Каталог"], TL["Остатки"], 0.5), y: cyL });
await pl.waitForTimeout(360);
await pl.screenshot({ path: join(OUT, "08-light-bridge.png") });
await pl.evaluate(({ x, y }) => {
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 0 }));
}, { x: lerp(TL["Каталог"], TL["Остатки"], 0.5), y: cyL });
await pl.waitForTimeout(400);

/* 09 SEARCH MORPH MIDPOINT — кадр в середине морфа (~130 мс от клика) */
await pl.locator(".pill-search").click();
await pl.waitForTimeout(125);
await pl.screenshot({ path: join(OUT, "09-search-morph-midpoint.png") });
await pl.waitForTimeout(400);
await pl.locator(".search-pop-close").click();

await ctxL.close();

/* ── видео → mp4 ── */
const rawDir = join(OUT, "video-raw");
const files = existsSync(rawDir) ? readdirSync(rawDir) : [];
const webm = files.find((f) => f.endsWith(".webm"));
if (webm) {
  const src = join(rawDir, webm);
  const out = join(OUT, "dynamic-liquid-lens.mp4");
  try {
    execFileSync("ffmpeg", ["-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "ignore" });
    unlinkSync(src);
    console.log("VIDEO OK:", out);
  } catch (e) {
    console.log("ffmpeg недоступен, webm оставлен:", src, String(e.message).slice(0, 80));
  }
} else {
  console.log("WARN: video-raw пуст — видео не записано");
}

await browser.close();
console.log("FRAMES DONE →", OUT);
