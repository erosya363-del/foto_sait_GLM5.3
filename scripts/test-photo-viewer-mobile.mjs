/**
 * E2E MOBILE PHASE2 · BLOCK 1 — Photo Viewer Stability (ТЗ 1.11).
 *
 * Сценарии (390×844 — полный набор; 393×852 и 430×932 — компактный повтор):
 *   open photo → next/previous (свайпы) → pinch zoom → pan →
 *   close (кнопка ×) → reopen (зум начинается с 1x) →
 *   action sheet open/close → share fallback → copy link →
 *   close while zoomed → rapid open/close ×10.
 *
 * Контроль:
 *   console.error=0, pageerror=0, unexpected requestfailed=0;
 *   body scroll locked while viewer open; scroll restored after close;
 *   ровно ОДИН экземпляр .pswp; нет оставшихся оверлеев после close;
 *   строки action sheet ≥ 48px; кнопка × ≥ 44×44.
 *
 * Тест ТОЛЬКО ЧИТАЮЩИЙ (данные не мутирует), но запуск — fail-closed через
 * явный E2E_BASE (изоляция run-isolated.sh — production-сборка на :3100):
 *   bash scripts/run-isolated.sh bun scripts/test-photo-viewer-mobile.mjs
 *
 * Артефакты: $E2E_SHOTS (по умолч. tool-results/mobile-phase2/viewer/)
 *   01..06 PNG + video-raw → photo-viewer-final.mp4 (ffmpeg при наличии).
 */
import "./e2e-guard.mjs";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, unlinkSync, renameSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE;
const SHOTS = process.env.E2E_SHOTS || join(process.cwd(), "tool-results", "mobile-phase2", "viewer");
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

/* ── Синтетические pointer-жесты (pswp слушает pointerdown на scrollWrap,
      pointermove/up на window; setPointerCapture НЕ использует) ── */
async function pointerSwipe(page, opts) {
  const { x0, y0, x1, y1, steps = 10, delay = 22 } = opts;
  await page.evaluate(async ({ x0, y0, x1, y1, steps, delay }) => {
    const target = document.elementFromPoint(x0, y0) ?? document.querySelector(".pswp");
    const fire = (type, x, y, id = 1, extra = {}) =>
      (type === "pointerdown" ? target : window).dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          pointerId: id, pointerType: "touch", isPrimary: id === 1,
          clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1, ...extra,
        })
      );
    fire("pointerdown", x0, y0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      fire("pointermove", x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      await new Promise((r) => setTimeout(r, delay));
    }
    fire("pointerup", x1, y1);
  }, { x0, y0, x1, y1, steps, delay });
}

async function pinchZoom(page, cx, cy, from = 60, to = 130, steps = 12) {
  await page.evaluate(async ({ cx, cy, from, to, steps }) => {
    const target = document.elementFromPoint(cx, cy) ?? document.querySelector(".pswp");
    const fire = (type, x, y, id) =>
      (type === "pointerdown" ? target : window).dispatchEvent(
        new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          pointerId: id, pointerType: "touch", isPrimary: id === 1,
          clientX: x, clientY: y, buttons: 1,
        })
      );
    fire("pointerdown", cx - from, cy, 1);
    fire("pointerdown", cx + from, cy, 2);
    for (let i = 1; i <= steps; i++) {
      const r = from + ((to - from) * i) / steps;
      fire("pointermove", cx - r, cy, 1);
      fire("pointermove", cx + r, cy, 2);
      await new Promise((res) => setTimeout(res, 24));
    }
    fire("pointerup", cx - to, cy, 1);
    fire("pointerup", cx + to, cy, 2);
  }, { cx, cy, from, to, steps });
}

/** Масштаб текущего слайда: pswp 5.4.4 зумит через РАЗМЕР контента
 *  (img width/height) + translate zoom-wrap'а, а scale в матрице остаётся 1 —
 *  поэтому меряем ширину img относительно базовой (fit) ширины. */
async function slideScale(page) {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll(".pswp__item .pswp__img"));
    const w = Math.max(0, ...imgs.map((i) => parseFloat(getComputedStyle(i).width) || 0));
    return w || null;
  });
}

async function viewerState(page) {
  return page.evaluate(() => {
    const roots = document.querySelectorAll(".pswp");
    const closeBtn = document.querySelector(".pswp__button--close");
    const zoomWrap = document.querySelector(".pswp__zoom-wrap");
    const cb = closeBtn?.getBoundingClientRect();
    return {
      pswpCount: roots.length,
      open: roots.length === 1 && roots[0].classList.contains("pswp--open"),
      counter: document.querySelector(".pswp__counter")?.textContent?.trim() ?? null,
      closeSize: cb ? { w: cb.width, h: cb.height } : null,
      zoomWrapTransform: zoomWrap ? getComputedStyle(zoomWrap).transform : null,
      sheetVisible: (() => {
        const s = document.querySelector(".viewer-sheet-backdrop");
        return Boolean(s && getComputedStyle(s).display !== "none" && Number(getComputedStyle(s).opacity) > 0.5);
      })(),
      sheetRowMin: (() => {
        const r = document.querySelector(".viewer-sheet-row");
        return r ? Number(getComputedStyle(r).minHeight.replace("px", "")) : null;
      })(),
      htmlOverflow: document.documentElement.style.overflow,
      scrollY: window.scrollY,
    };
  });
}

async function openViewer(page, cardIndex = 0) {
  /* Гарантия исходного состояния: viewer закрыт (после любых предыдущих шагов) */
  await closeViewer(page);
  /* Если открыт товар (после закрытия viewer'а мы на его странице) —
     возвращаемся в каталог кнопкой «Назад» (внутренний dismiss-слой) */
  if (await page.locator(".photo-frame").count()) {
    await page.locator(".lg-back").first().click();
    await page.waitForTimeout(650);
  }
  await page.locator(".card-hover").nth(cardIndex).click();
  await page.waitForSelector(".photo-frame", { timeout: 8000 });
  await page.locator(".photo-frame").first().click();
  await page.waitForSelector(".pswp--open", { timeout: 8000 });
  await page.waitForTimeout(700); // открытие + зонд пропорций + fade
}

async function closeViewer(page) {
  const st = await viewerState(page);
  if (!st.open) return;
  await page.locator(".pswp__button--close").click();
  // Ждём ФАКТИЧЕСКОГО удаления корня pswp из DOM (fade-out ≈ 300мс)
  await page.waitForFunction(() => document.querySelectorAll(".pswp").length === 0, null, { timeout: 6000 });
  await page.waitForTimeout(200);
}

const consoleErrors = [];
const pageErrors = [];
const requestFailed = [];

async function runSuite(width, height, { video = false, compact = false } = {}) {
  console.log(`\n════ Viewport ${width}×${height} ${compact ? "(компактный набор)" : "(полный набор)"} ════`);
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    ...(video ? { recordVideo: { dir: join(SHOTS, "video-raw"), size: { width, height } } } : {}),
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) => {
    const url = r.url();
    // провалы превью/фото — неожиданные; служебные (favicon) игнорируем
    if (!url.includes("favicon")) requestFailed.push(`${url} :: ${r.failure()?.errorText ?? "?"}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  /* 1. Открытие viewer'а */
  await openViewer(page);
  let st = await viewerState(page);
  ok("viewer открыт, ровно один .pswp", st.open && st.pswpCount === 1, JSON.stringify(st));
  ok("счётчик «1 / N»", /1\s*\/\s*\d+/.test(st.counter ?? ""), st.counter);
  ok(
    "кнопка × ≥ 44×44",
    st.closeSize ? st.closeSize.w >= 44 && st.closeSize.h >= 44 : false,
    JSON.stringify(st.closeSize)
  );
  ok("body scroll lock: html overflow=hidden", st.htmlOverflow === "hidden", st.htmlOverflow);

  /* 2. Скролл страницы недоступен при открытом viewer'е (user-level: wheel).
     Программный scrollTo при overflow:hidden по-прежнему работает — это норма
     (lock блокирует ПОЛЬЗОВАТЕЛЬСКИЙ ввод), поэтому проверяем доверенный wheel.
     Сравниваем ДЕЛЬТУ: клик по карточке мог уже проскроллить страницу. */
  {
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => window.scrollY);
    ok("wheel при открытом viewer не скроллит страницу", Math.abs(after - before) < 2, `scrollY ${before}→${after}`);
  }

  const baseScale = await slideScale(page);

  /* 3. Pinch zoom — зум растёт, viewer НЕ закрывается (pinchToClose только на pinch-in) */
  await pinchZoom(page, width / 2, height / 2, 50, 130, 12);
  await page.waitForTimeout(400);
  st = await viewerState(page);
  const zoomedScale = await slideScale(page);
  ok("pinch-out: зум вырос", st.open && zoomedScale !== null && baseScale !== null && zoomedScale > baseScale * 1.6, `${baseScale?.toFixed(0)}px→${zoomedScale?.toFixed(0)}px`);

  /* 4. Pan в зуме — вертикальный свайп НЕ закрывает (ТЗ 1.2: в зуме close запрещён) */
  await pointerSwipe(page, { x0: width / 2, y0: height / 2, x1: width / 2 - 30, y1: height / 2 - 260, steps: 9, delay: 20 });
  await page.waitForTimeout(400);
  st = await viewerState(page);
  ok("vertical swipe в зуме НЕ закрывает viewer", st.open, "");

  /* 5. Кнопка × закрывает СРАЗУ из зума (ТЗ 1.4), скролл восстановлен */
  const yBefore = await page.evaluate(() => window.scrollY);
  await page.locator(".pswp__button--close").click();
  await page.waitForTimeout(500);
  st = await viewerState(page);
  ok("close из зума: viewer закрыт, .pswp = 0", st.pswpCount === 0 && !st.open, `count=${st.pswpCount}`);
  ok("html overflow восстановлен", st.htmlOverflow !== "hidden", st.htmlOverflow);
  ok("нет оставшихся оверлеев (.pswp--open)", (await page.locator(".pswp--open").count()) === 0);

  /* 6. Повторное открытие — зум с 1x (ТЗ 1.5) */
  await openViewer(page);
  const reopenScale = await slideScale(page);
  ok("reopen: зум начинается с 1x", baseScale !== null && reopenScale !== null && Math.abs(reopenScale - baseScale) < 12, `${reopenScale?.toFixed(0)}px vs ${baseScale?.toFixed(0)}px`);

  if (!compact) {
    /* 7. next / previous горизонтальными свайпами */
    const c0 = (await viewerState(page)).counter;
    await pointerSwipe(page, { x0: width - 40, y0: height / 2, x1: 40, y1: height / 2, steps: 10, delay: 20 });
    await page.waitForTimeout(650);
    const c1 = (await viewerState(page)).counter;
    ok("horizontal swipe → next", c1 !== c0, `${c0}→${c1}`);
    await pointerSwipe(page, { x0: 40, y0: height / 2, x1: width - 40, y1: height / 2, steps: 10, delay: 20 });
    await page.waitForTimeout(900); // mainScroll обязан полностью осесть (иначе ось drag определится как 'x')
    const c2 = (await viewerState(page)).counter;
    ok("horizontal swipe → previous", c2 === c0, `${c1}→${c2}`);
    await page.screenshot({ path: join(SHOTS, "01-viewer-open.png") });

    /* 8. Vertical swipe down при 1x закрывает (native closeOnVerticalDrag).
       Свежее открытие = детерминированный mainScroll (после соседних свайпов
       ось drag может определиться как 'x' — interdependency убрана). */
    await closeViewer(page);
    await openViewer(page);
    await page.waitForTimeout(400);
    await pointerSwipe(page, { x0: width / 2, y0: 300, x1: width / 2 + 20, y1: 780, steps: 10, delay: 20 });
    await page.waitForTimeout(700);
    st = await viewerState(page);
    ok("vertical swipe при 1x закрывает viewer", st.pswpCount === 0, `count=${st.pswpCount}`);

    /* 9. Action sheet: открытие, ≥48px строки, закрытие «Отмена» */
    await openViewer(page);
    await page.locator(".pswp__button--actions").click();
    await page.waitForTimeout(400);
    st = await viewerState(page);
    ok("action sheet открыт", st.sheetVisible);
    ok("строки sheet ≥ 48px (ТЗ 1.6)", (st.sheetRowMin ?? 0) >= 48, `${st.sheetRowMin}`);
    await page.screenshot({ path: join(SHOTS, "02-action-sheet.png") });
    await page.locator(".viewer-sheet-cancel").click();
    await page.waitForTimeout(400);
    st = await viewerState(page);
    ok("sheet закрыт, viewer остался открыт", st.open && !st.sheetVisible);

    /* 10. Share: если navigator.share есть — системный вызов не ломает viewer;
       если НЕТ — строка «Поделиться…» скрыта, а sheet сам является fallback
       (Скачать/Скопировать ссылку/Открыть оригинал). Оба исхода — PASS. */
    await page.locator(".pswp__button--actions").click();
    await page.waitForTimeout(400);
    const shareRowCount = await page.locator(".viewer-sheet-row:has-text('Поделиться')").count();
    if (shareRowCount > 0) {
      await page.locator(".viewer-sheet-row:has-text('Поделиться')").click();
      await page.waitForTimeout(1000);
      st = await viewerState(page);
      ok("share: viewer не закрылся, без зависания", st.open, JSON.stringify({ open: st.open }));
      if (st.sheetVisible) {
        await page.locator(".viewer-sheet-cancel").click();
        await page.waitForTimeout(300);
      }
    } else {
      const altRows = await page.locator(".viewer-sheet-row").count();
      st = await viewerState(page);
      ok("share отсутствует: fallback-sheet с действиями на месте, viewer жив", st.open && altRows >= 3, `rows=${altRows}`);
    }
    await page.waitForTimeout(200);

    /* 11. Copy link: toast успеха, viewer жив (sheet мог остаться открытым после шага 10) */
    if (!(await viewerState(page)).sheetVisible) {
      await page.locator(".pswp__button--actions").click();
      await page.waitForTimeout(400);
    }
    await page.locator(".viewer-sheet-row:has-text('Скопировать ссылку')").click();
    await page.waitForTimeout(700);
    st = await viewerState(page);
    ok("копирование ссылки: viewer жив, sheet закрыт", st.open && !st.sheetVisible);
    await closeViewer(page);

    /* 12. Rapid open/close ×10 (ТЗ 1.11): один экземпляр, ноль ошибок */
    let rapidOk = true;
    for (let i = 0; i < 10; i++) {
      await openViewer(page, i % 3);
      const s1 = await viewerState(page);
      if (s1.pswpCount !== 1) rapidOk = false;
      await closeViewer(page);
      const s2 = await viewerState(page);
      if (s2.pswpCount !== 0) rapidOk = false;
    }
    ok("rapid open/close ×10: всегда ровно один экземпляр, чистое закрытие", rapidOk);
    await page.screenshot({ path: join(SHOTS, "03-after-rapid.png") });
  } else {
    await closeViewer(page);
  }

  /* 13. Скролл восстановлен после закрытия: запоминаем позицию НА МОМЕНТ
         открытия (клик Playwright сам подскролливает элемент — поэтому
         эталон = scrollY сразу после открытия, а не до него) */
  await page.evaluate(() => window.scrollTo({ top: 260, behavior: "instant" }));
  await page.waitForTimeout(250);
  await page.locator(".photo-frame").first().click();
  await page.waitForSelector(".pswp--open", { timeout: 8000 });
  await page.waitForTimeout(600);
  const yAtOpen = await page.evaluate(() => window.scrollY);
  await closeViewer(page);
  const yRestored = await page.evaluate(() => window.scrollY);
  ok("scroll restored после close", Math.abs(yRestored - yAtOpen) < 8, `open=${yAtOpen} restored=${yRestored}`);

  await page.close();
  await context.close(); // финализирует видео (если записывалось)
  return video;
}

const browser = await chromium.launch();

let recorded = false;
await runSuite(390, 844, { video: true });
await runSuite(393, 852, { compact: true });
await runSuite(430, 932, { compact: true });

await browser.close();

/* Контроль чистой консоли по ВСЕМ вьюпортам */
ok("консоль: 0 ошибок", consoleErrors.length === 0, JSON.stringify([...new Set(consoleErrors)].slice(0, 3)));
ok("pageerror: 0", pageErrors.length === 0, JSON.stringify([...new Set(pageErrors)].slice(0, 3)));
ok("unexpected requestfailed: 0", requestFailed.length === 0, JSON.stringify([...new Set(requestFailed)].slice(0, 3)));

console.log("\n── Видео → mp4 ──");
{
  const rawDir = join(SHOTS, "video-raw");
  const files = existsSync(rawDir) ? readdirSync(rawDir) : [];
  const webm = files.find((f) => f.endsWith(".webm"));
  if (webm) {
    const src = join(rawDir, webm);
    const out = join(SHOTS, "photo-viewer-final.mp4");
    try {
      execFileSync("ffmpeg", ["-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "ignore" });
      ok("photo-viewer-final.mp4 создан", existsSync(out), out);
      unlinkSync(src);
    } catch (e) {
      renameSync(src, join(SHOTS, "photo-viewer-final.webm"));
      ok("mp4 не собран (нет ffmpeg), webm оставлен", false, String(e.message).slice(0, 80));
    }
  } else {
    ok("видео-файл создан Playwright", false, "video-raw пуст");
  }
  try { rmdirSync(rawDir); } catch { /* не пусто — ок */ }
}

console.log(`\n══ ИТОГ: PASS=${passed} FAIL=${failed} ══`);
if (failed > 0) {
  console.log("Провалены:");
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  process.exit(1);
}
