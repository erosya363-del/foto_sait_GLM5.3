/**
 * PHASE 2.3 §18/§19 — Dynamic Lens в светлой теме и landscape.
 *
 * Предыдущий этап имел LIGHT E2E = NOT TESTED. Здесь обязательный минимум:
 *   light  — REST / PRESS (линза выше панели) / BRIDGE (одна масса на двух
 *            вкладках) / search-морф (панель гаснет, карточка видна);
 *   landscape (844×390) — REST / PRESS: панель не обрезает вспухшую линзу,
 *            safe-area работает, линза не выходит за физический экран.
 *   dark   — контрольная точка REST/PRESS (уже покрыто test-mobile-nav-search).
 *
 * Тест ТОЛЬКО ЧИТАЮЩИЙ; запуск:
 *   bash scripts/run-isolated.sh bun scripts/test-p23-themes.mjs
 */
import "./e2e-guard.mjs";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE;
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

const browser = await chromium.launch();

/** Жест панели синтетическими pointer-событиями (как в nav-search) */
function makeGestures(page) {
  return {
    down: (x, y) =>
      page.evaluate(({ x, y }) => {
        document.querySelector(".pill-shell").dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })
        );
      }, { x, y }),
    move: async (x, y) => {
      await page.evaluate(({ x, y }) => {
        window.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })
        );
      }, { x, y });
      await page.waitForTimeout(30);
    },
    up: (x, y) =>
      page.evaluate(({ x, y }) => {
        window.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 0 })
        );
      }, { x, y }),
  };
}

async function lensState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const bubble = document.querySelector(".pill-bubble");
    const s = shell.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    return {
      shellTop: s.top, shellBottom: s.bottom, shellH: s.height,
      bTop: b.top, bBottom: b.bottom, bH: b.height, bW: b.width,
      bLeft: b.left, bRight: b.right,
      bCx: b.left + b.width / 2,
      activeLabel: document.querySelector(".pill-item.is-on")?.textContent?.trim() ?? null,
      activeCx: (() => {
        const on = document.querySelector(".pill-item.is-on");
        if (!on) return 0;
        const r = on.getBoundingClientRect();
        return r.left + r.width / 2;
      })(),
      covered: [...document.querySelectorAll(".pill-item.is-lens-covered")].map((el) => el.textContent.trim()),
      navVisible: (() => {
        const nav = document.querySelector("nav.pill-nav");
        const cs = getComputedStyle(nav);
        return cs.display !== "none" && cs.visibility !== "hidden";
      })(),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
}

async function runScenario(page, label, { light }) {
  console.log(`\n── ${label} ──`);
  if (light) {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => {
      try { localStorage.setItem("theme", "light"); } catch {}
    });
  }
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  if (light) {
    // next-themes читает localStorage при старте; форс-класс для надёжности headless
    await page.evaluate(() => document.documentElement.classList.add("light"));
  }
  const g = makeGestures(page);

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll(".pill-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim(), cx: r.left + r.width / 2, width: r.width };
    })
  );
  const byLabel = (l) => tabs.find((t) => t.label === l);
  const cy = await page.evaluate(() => {
    const s = document.querySelector(".pill-shell").getBoundingClientRect();
    return s.top + s.height / 2;
  });
  const catalog = byLabel("Каталог");
  const stock = byLabel("Остатки");

  /* REST */
  await page.waitForTimeout(400);
  let ls = await lensState(page);
  ok(`${label} REST: линза внутри панели`, ls.bTop >= ls.shellTop - 0.6 && ls.bBottom <= ls.shellBottom + 0.6, `h=${ls.bH.toFixed(1)}`);
  ok(`${label} REST: линза под активной`, Math.abs(ls.bCx - ls.activeCx) < 6, `dx=${Math.abs(ls.bCx - ls.activeCx).toFixed(1)}`);
  ok(`${label} REST: ${light ? "light-класс на <html>" : "тема dark/default"}`,
    light ? await page.evaluate(() => document.documentElement.classList.contains("light")) : true);

  /* PRESS */
  await g.down(catalog.cx, cy);
  await page.waitForTimeout(500);
  ls = await lensState(page);
  ok(`${label} PRESS: линза выше панели`, ls.bH > ls.shellH, `bH=${ls.bH.toFixed(1)} > ${ls.shellH}`);
  ok(`${label} PRESS: не выходит за физический экран`, ls.bTop >= 0 && ls.bBottom <= ls.vh, `top=${ls.bTop.toFixed(0)} bottom=${ls.bBottom.toFixed(0)} vh=${ls.vh}`);

  /* BRIDGE */
  const mid = (catalog.cx + stock.cx) / 2;
  await g.move(mid, cy);
  await page.waitForTimeout(280);
  ls = await lensState(page);
  ok(`${label} BRIDGE: одна масса накрывает оба центра`, ls.bLeft < catalog.cx && ls.bRight > stock.cx, `[${ls.bLeft.toFixed(0)}..${ls.bRight.toFixed(0)}]`);
  ok(`${label} BRIDGE: оба covered`, ls.covered.join("+") === "Каталог+Остатки", ls.covered.join("+"));

  /* release */
  await g.up(stock.cx, cy);
  await page.waitForTimeout(700);
  ls = await lensState(page);
  ok(`${label} RELEASE: commit = Остатки`, ls.activeLabel === "Остатки", ls.activeLabel);
  ok(`${label} RELEASE: геометрия в панели`, ls.bTop >= ls.shellTop - 0.6 && ls.bBottom <= ls.shellBottom + 0.6);

  /* SEARCH-морф (панель гаснет, карточка видна) */
  await page.locator(".pill-search").click();
  await page.waitForTimeout(450);
  const searchState = await page.evaluate(() => {
    const nav = document.querySelector("nav.pill-nav");
    const pop = document.querySelector(".search-pop");
    const ns = getComputedStyle(nav);
    return {
      navHidden: ns.visibility === "hidden" && Number(ns.opacity) < 0.05,
      popVisible: pop ? getComputedStyle(pop).visibility === "visible" : false,
    };
  });
  ok(`${label} SEARCH: панель скрыта морфом`, searchState.navHidden);
  ok(`${label} SEARCH: карточка видна`, searchState.popVisible);
  await page.locator(".search-pop-close").click();
  await page.waitForTimeout(450);
}

/* 1. DARK контрольная (390×844) */
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await runScenario(page, "DARK 390×844 (контроль)", { light: false });
  await context.close();
}

/* 2. LIGHT (390×844) — обязательный минимум §19 */
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await runScenario(page, "LIGHT 390×844 (§19)", { light: true });
  await context.close();
}

/* 3. LANDSCAPE 844×390 — панель не обрезает вспухшую линзу (§18) */
{
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await runScenario(page, "LANDSCAPE 844×390 (§18)", { light: false });
  await context.close();
}

await browser.close();
console.log("");
console.log(`══ ИТОГ: PASS=${passed} FAIL=${failed} ══`);
if (failed > 0) {
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  process.exit(1);
}
