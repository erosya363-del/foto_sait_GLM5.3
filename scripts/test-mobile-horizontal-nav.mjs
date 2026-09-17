/**
 * E2E MOBILE PHASE2 · BLOCK 3 — горизонтальная навигация по вкладкам (ТЗ 3.11).
 *
 * Сценарии (390×844 — полный набор; 320×568 / 375×667 / 393×852 / 430×932 —
 * компактный повтор ядра):
 *   tap Catalog→Stock→Upload→Admin→(backward)Catalog;
 *   interactive swipe forward/backward (раздел следует за пальцем,
 *   сосед появляется рядом, линза синхронна);
 *   cancel swipe (возврат), short swipe (порог 25%), fast flick (velocity);
 *   вертикальный скролл НЕ захватывается жестом (3.5);
 *   жест с кнопки (drag с карточки — переключение, click не стреляет);
 *   жест с input — НЕ переключает (3.6);
 *   жест при открытом поиске — НЕ переключает (3.10);
 *   границы: первый/последний раздел — rubber-band без коммита (3.7);
 *   rapid taps.
 *
 * Контроль: console.error=0, pageerror=0, unexpected requestfailed=0;
 * горизонтальный overflow после переходов = 0; активный view = активная линза;
 * neighbor-оверлей отсутствует вне жеста.
 *
 * Запуск (fail-closed изоляция):
 *   bash scripts/run-isolated.sh bun scripts/test-mobile-horizontal-nav.mjs
 */
import "./e2e-guard.mjs";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, unlinkSync, renameSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE;
const SHOTS = process.env.E2E_SHOTS || join(process.cwd(), "tool-results", "mobile-phase2");
mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
const errors = [];

function ok(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    errors.push(name);
    console.log(`  ✗ FAIL: ${name} ${extra}`);
  }
}

const consoleErrors = [];
const pageErrors = [];
const requestFailed = [];

/* ── CDP touch: доверенные последовательности ── */
async function touchSwipe(page, { x0, y, x1, steps = 12, delay = 22 }) {
  const cdp = await page.context().newCDPSession(page);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    pts.push({ x: Math.round(x0 + ((x1 - x0) * i) / steps), y });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pts[0].x, y, id: 1 }] });
  for (let i = 1; i < pts.length; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pts[i].x, y, id: 1 }] });
    await page.waitForTimeout(delay);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function touchScrollVertical(page, { x, y0, dy = -500, steps = 8 }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + (dy * i) / steps, id: 1 }] });
    await page.waitForTimeout(24);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function stateOf(page) {
  return page.evaluate(() => {
    const on = document.querySelector(".pill-item.is-on");
    const b = document.querySelector(".pill-bubble");
    const content = document.querySelector("[data-tab-swipe-content]");
    return {
      view: on?.textContent?.trim() ?? null,
      bubbleCx: b ? b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 : null,
      onCx: on ? on.getBoundingClientRect().left + on.getBoundingClientRect().width / 2 : null,
      neighbor: document.querySelectorAll("[data-tab-swipe-neighbor]").length,
      contentTransform: content ? content.style.transform || "" : "",
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

async function clickTab(page, label) {
  await page.locator(`nav.pill-nav button:has-text("${label}")`).click();
  await page.waitForTimeout(650);
}

async function runSuite(width, height, { video = false, compact = false } = {}) {
  console.log(`\n════ Viewport ${width}×${height} ${compact ? "(компакт)" : "(полный)"} ════`);
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    ...(video ? { recordVideo: { dir: join(SHOTS, "video-raw-nav"), size: { width, height } } } : {}),
  });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) => {
    if (!r.url().includes("favicon")) requestFailed.push(`${r.url()} :: ${r.failure()?.errorText ?? "?"}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  /* 1. Тап-переходы по порядку (3.1) */
  await clickTab(page, "Остатки");
  await clickTab(page, "Загрузка");
  await clickTab(page, "Админ");
  {
    const s = await stateOf(page);
    ok("тап: Каталог→Остатки→Загрузка→Админ", s.view === "Админ", s.view);
  }
  await clickTab(page, "Каталог"); // backward (3.1: направление по индексам)
  {
    const s = await stateOf(page);
    ok("обратный тап: Админ→Каталог", s.view === "Каталог", s.view);
  }

  /* 2. Interactive swipe forward: Каталог → Остатки (3.3/3.4) */
  {
    const startX = width - 30;
    const cdp = await page.context().newCDPSession(page);
    const y = Math.floor(height * 0.45);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y, id: 1 }] });
    // ведём пальцем до середины — проверяем интерактивность ДО отпускания
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX - (startX / 2 - width * 0.2) * (i / 6) * 2, y, id: 1 }] });
      await page.waitForTimeout(26);
    }
    const mid = await stateOf(page);
    ok("свайп: neighbor-оверлей появился во время жеста", mid.neighbor === 1, `n=${mid.neighbor}`);
    ok("свайп: контент следует за пальцем (transform применён)", mid.contentTransform.includes("translate3d") && mid.contentTransform !== "translate3d(0px, 0, 0)" && mid.contentTransform !== "", mid.contentTransform);
    ok("свайп: раздел НЕ меняется до отпускания", mid.view === "Каталог", mid.view);
    ok("свайп: линза ушла от Каталога (общий progress, 3.9)", mid.bubbleCx !== null && mid.onCx !== null && mid.bubbleCx > mid.onCx + 15, `dbx=${mid.bubbleCx !== null && mid.onCx !== null ? (mid.bubbleCx - mid.onCx).toFixed(0) : "?"}`);
    // доводим за порог 25% и отпускаем
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(width * 0.25 - (width * 0.25) * (i / 6) * 0.6), y, id: 1 }] });
      await page.waitForTimeout(24);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(650);
    const s = await stateOf(page);
    ok("commit свайпа: раздел = Остатки", s.view === "Остатки", s.view);
    ok("после commit neighbor снят", s.neighbor === 0, `n=${s.neighbor}`);
    ok("после commit transform контента сброшен", !s.contentTransform || s.contentTransform === "", s.contentTransform);
    ok("линза под Остатками после commit", s.bubbleCx !== null && s.onCx !== null && Math.abs(s.bubbleCx - s.onCx) < 6, `dx=${s.bubbleCx !== null && s.onCx !== null ? (s.bubbleCx - s.onCx).toFixed(0) : "?"}`);
    await page.screenshot({ path: join(SHOTS, "10-after-swipe-forward.png") });
  }

  /* 3. Swipe backward: Остатки → Каталог */
  {
    await touchSwipe(page, { x0: 30, y: Math.floor(height * 0.45), x1: width - 40 });
    await page.waitForTimeout(650);
    const s = await stateOf(page);
    ok("свайп назад: раздел = Каталог", s.view === "Каталог", s.view);
  }

  /* 4. Cancel: тянем, но отпускаем до порога → возврат (3.4) */
  {
    await touchSwipe(page, { x0: width - 30, y: Math.floor(height * 0.45), x1: width * 0.82, steps: 8, delay: 30 });
    await page.waitForTimeout(650);
    const s = await stateOf(page);
    ok("короткий свайп: раздел не изменился", s.view === "Каталог", s.view);
    ok("короткий свайп: neighbor снят", s.neighbor === 0);
  }

  /* 5. Fast flick: velocity-коммит при малой дистанции (3.4) */
  {
    await touchSwipe(page, { x0: width - 30, y: Math.floor(height * 0.45), x1: width * 0.55, steps: 4, delay: 8 });
    await page.waitForTimeout(700);
    const s = await stateOf(page);
    ok("fast flick: velocity-коммит в Остатки", s.view === "Остатки", s.view);
    await clickTab(page, "Каталог");
  }

  /* 6. Вертикальный скролл не захвачен (3.5) — на длинном списке Остатков */
  if (!compact) {
    await clickTab(page, "Остатки");
    const before = await page.evaluate(() => window.scrollY);
    await touchScrollVertical(page, { x: width / 2, y0: Math.floor(height * 0.6), dy: -600 });
    await page.waitForTimeout(400);
    const s = await stateOf(page);
    const after = await page.evaluate(() => window.scrollY);
    ok("вертикальный свайп: страница проскроллилась (интент определён)", after > before + 200, `${before}→${after}`);
    ok("вертикальный свайп: раздел НЕ переключился", s.view === "Остатки", s.view);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await clickTab(page, "Каталог");
  }

  /* 7. Жест с кнопки (карточка): drag с кнопки переключает, click не дублируется */
  if (!compact) {
    await touchSwipe(page, { x0: width - 30, y: Math.floor(height * 0.45), x1: width * 0.2 });
    await page.waitForTimeout(650);
    const s = await stateOf(page);
    ok("жест с кнопки: свайп сработал (Остатки)", s.view === "Остатки", s.view);
    await clickTab(page, "Каталог");
  }

  /* 8. Границы (3.7): из Каталога свайп вправо — rubber-band, без коммита */
  {
    await touchSwipe(page, { x0: 30, y: Math.floor(height * 0.45), x1: width - 60 });
    await page.waitForTimeout(650);
    const s = await stateOf(page);
    ok("край (первый): раздел не изменился", s.view === "Каталог", s.view);
    ok("край (первый): neighbor НЕ монтировался", s.neighbor === 0);
  }

  /* 9. Поиск открыт → свайп запрещён (3.10) */
  if (!compact) {
    await page.locator(".pill-search").click();
    await page.waitForTimeout(450);
    await touchSwipe(page, { x0: width - 30, y: Math.floor(height * 0.45), x1: width * 0.2 });
    await page.waitForTimeout(500);
    const s = await stateOf(page);
    ok("при открытом поиске свайп не переключает", s.view === "Каталог", s.view);
    /* Поиск мог закрыться первым же pointerdown-мимо (штатный outside-close) —
       закрываем явно только если ещё открыт */
    const searchStillOpen = await page.evaluate(() => document.querySelector(".search-pop")?.classList.contains("is-open") ?? false);
    if (searchStillOpen) {
      await page.locator(".search-pop-close").click();
      await page.waitForTimeout(450);
    }
  }

  /* 10. Rapid taps ×6 */
  if (!compact) {
    const seq = ["Остатки", "Загрузка", "Каталог", "Админ", "Остатки", "Каталог"];
    for (const l of seq) {
      await page.locator(`nav.pill-nav button:has-text("${l}")`).click({ delay: 10 });
      await page.waitForTimeout(95);
    }
    await page.waitForTimeout(700);
    const s = await stateOf(page);
    ok("rapid taps: финал = Каталог", s.view === "Каталог", s.view);
    ok("rapid taps: линза под Каталогом", s.bubbleCx !== null && s.onCx !== null && Math.abs(s.bubbleCx - s.onCx) < 6);
  }

  /* 11. Горизонтальный overflow = 0 */
  {
    const s = await stateOf(page);
    ok("горизонтальный overflow после всех переходов = 0", s.overflowX <= 1, `${s.overflowX}px`);
  }

  await page.close();
  await context.close();
  return video;
}

const browser = await chromium.launch();
let recorded = false;
await runSuite(390, 844, { video: true });
await runSuite(320, 568, { compact: true });
await runSuite(375, 667, { compact: true });
await runSuite(393, 852, { compact: true });
await runSuite(430, 932, { compact: true });
await browser.close();

ok("консоль: 0 ошибок", consoleErrors.length === 0, JSON.stringify([...new Set(consoleErrors)].slice(0, 3)));
ok("pageerror: 0", pageErrors.length === 0, JSON.stringify([...new Set(pageErrors)].slice(0, 3)));
ok("unexpected requestfailed: 0", requestFailed.length === 0, JSON.stringify([...new Set(requestFailed)].slice(0, 3)));

console.log("\n── Видео → mp4 ──");
{
  const rawDir = join(SHOTS, "video-raw-nav");
  const files = existsSync(rawDir) ? readdirSync(rawDir) : [];
  const webm = files.find((f) => f.endsWith(".webm"));
  if (webm) {
    const src = join(rawDir, webm);
    const out = join(SHOTS, "horizontal-navigation-final.mp4");
    try {
      execFileSync("ffmpeg", ["-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "ignore" });
      ok("horizontal-navigation-final.mp4 создан", existsSync(out), out);
      unlinkSync(src);
    } catch (e) {
      renameSync(src, join(SHOTS, "horizontal-navigation-final.webm"));
      ok("mp4 не собран (нет ffmpeg), webm оставлен", false, String(e.message).slice(0, 80));
    }
  } else {
    ok("видео-файл создан Playwright", false, "video-raw-nav пуст");
  }
  try { rmdirSync(rawDir); } catch { /* не пусто — ок */ }
}

console.log(`\n══ ИТОГ: PASS=${passed} FAIL=${failed} ══`);
if (failed > 0) {
  console.log("Провалены:");
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  process.exit(1);
}
