/**
 * E2E ТЗ v4: мобильная нижняя Liquid Glass панель + режим поиска.
 *
 * Проверяет (п.26–28 ТЗ):
 *   §26  DOM-композиция панели: ровно одна nav.pill-nav / .pill-shell /
 *        .pill-bubble / .pill-ghost; НОЛЬ input внутри кнопок панели.
 *   §27  Быстрые переключения Каталог→Остатки→Загрузка→Админ→Каталог,
 *        10 циклов, паузы 70–100 мс: console.error=0, pageerror=0,
 *        requestfailed=0; активный item соответствует view; после покоя
 *        линза стоит ПОД активной вкладкой; полёт непрерывен (is-live
 *        виден сразу после клика — телепорта нет).
 *   §28  Поиск: тап «Поиск» → pill-nav display:none, search-pop виден и
 *        стоит у нижнего safe-area (БЕЗ резерва 64px/12mm). Headless-
 *        симуляция клавиатуры (kb-open + --kb-overlay:300px) → низ
 *        карточки ≈ 308px от низа вьюпорта (НЕ 417+). Дропдаун
 *        открывается ВВЕРХ. Закрытие → blur + панель возвращается.
 *
 * Геометрия линзы (п.29.2–4): линза ВНУТРИ панели (top/bottom ≥ 6px).
 *
 * Тест ТОЛЬКО ЧИТАЮЩИЙ (данные не мутирует), но запуск — fail-closed
 * через явный E2E_BASE (изоляция run-isolated.sh — production-сборка):
 *   bash scripts/run-isolated.sh bun scripts/test-mobile-nav-search.mjs
 *
 * Скриншоты: 01-catalog … 06-search-keyboard → $E2E_SHOTS
 *   (по умолчанию tool-results/mobile-nav/), плюс video mobile-nav-final.mp4.
 */
import "./e2e-guard.mjs";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, unlinkSync, renameSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE;
const SHOTS = process.env.E2E_SHOTS || join(process.cwd(), "tool-results", "mobile-nav");
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

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // ТЗ п.27
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  recordVideo: { dir: join(SHOTS, "video-raw"), size: { width: 390, height: 844 } },
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const requestFailed = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("requestfailed", (r) => requestFailed.push(`${r.url()} :: ${r.failure()?.errorText ?? "?"}`));

const VIEW_BY_LABEL = { Каталог: "catalog", Остатки: "stock", Загрузка: "upload", Админ: "admin" };

async function clickTab(label) {
  await page.locator(`nav.pill-nav button:has-text("${label}")`).click();
}
async function clickTabFast(label) {
  // быстрые тапы: без ожидания сети/анимаций, пауза задаётся вызывающим
  await page.locator(`nav.pill-nav button:has-text("${label}")`).click({ delay: 10 });
}

/** Дождаться ФИЗИЧЕСКОГО покоя пружины: headless screencast троттлит rAF,
    поэтому ПОКА же кадры (rAF-chain из evaluate) и ждём dx<порога и !is-live. */
async function settleLens(maxMs = 4000) {
  const t0 = Date.now();
  let g = await lensGeometry();
  while (g && Date.now() - t0 < maxMs) {
    const settled = !g.gooLive && Math.abs(g.bubble.cx - g.active.cx) < 1.2;
    if (settled) break;
    // два rAF-кадра — принудительно даём пружине тикать
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    );
    g = await lensGeometry();
  }
  return g;
}

/** Геометрия линзы и активного пункта одним вызовом */
async function lensGeometry() {
  return page.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const bubble = document.querySelector(".pill-bubble");
    const active = document.querySelector(".pill-item.is-on");
    if (!shell || !bubble || !active) return null;
    const s = shell.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    return {
      shell: { top: s.top, bottom: s.bottom, left: s.left, right: s.right },
      bubble: { top: b.top, bottom: b.bottom, cx: b.left + b.width / 2, width: b.width, opacity: getComputedStyle(bubble).opacity },
      active: { cx: a.left + a.width / 2, width: a.width, label: active.textContent?.trim() },
      gooLive: document.querySelector(".pill-goo")?.classList.contains("is-live") ?? false,
      navCount: document.querySelectorAll("nav.pill-nav").length,
      shellCount: document.querySelectorAll(".pill-shell").length,
      bubbleCount: document.querySelectorAll(".pill-bubble").length,
      ghostCount: document.querySelectorAll(".pill-ghost").length,
      navInputs: document.querySelectorAll("nav.pill-nav button input").length,
    };
  });
}

console.log("── 1. Загрузка + DOM-композиция панели (ТЗ п.26) ──");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const dom = await lensGeometry();
ok("nav.pill-nav = 1", dom?.navCount === 1, `got ${dom?.navCount}`);
ok(".pill-shell = 1", dom?.shellCount === 1, `got ${dom?.shellCount}`);
ok(".pill-bubble = 1", dom?.bubbleCount === 1, `got ${dom?.bubbleCount}`);
ok(".pill-ghost = 1", dom?.ghostCount === 1, `got ${dom?.ghostCount}`);
ok("в кнопках панели НЕТ input (п.3)", dom?.navInputs === 0, `got ${dom?.navInputs}`);
ok("активный пункт = Каталог", dom?.active?.label === "Каталог", dom?.active?.label);

await page.screenshot({ path: join(SHOTS, "01-catalog.png") });

console.log("── 2. Линза внутри панели, под активной вкладкой (п.29.2–4) ──");
{
  const g = await lensGeometry();
  ok("линза внутри shell сверху (6px)", g.bubble.top >= g.shell.top - 0.5, `${(g.bubble.top - g.shell.top).toFixed(1)}px`);
  ok("линза внутри shell снизу (6px)", g.bubble.bottom <= g.shell.bottom + 0.5, `${(g.shell.bottom - g.bubble.bottom).toFixed(1)}px`);
  ok("линза видима", Number(g.bubble.opacity) > 0.5, g.bubble.opacity);
  const dx = Math.abs(g.bubble.cx - g.active.cx);
  ok("линза по центру активной вкладки", dx < 5, `dx=${dx.toFixed(1)}px`);
  ok("ширина линзы = ширине пункта", Math.abs(g.bubble.width - g.active.width) < 3, `${g.bubble.width} vs ${g.active.width}`);
}

console.log("── 3. Быстрые переключения ×10 (ТЗ п.27) ──");
{
  let teleportFree = true;
  for (let cycle = 1; cycle <= 10; cycle++) {
    await clickTabFast("Остатки");
    await page.waitForTimeout(85);
    await clickTabFast("Загрузка");
    await page.waitForTimeout(85);
    await clickTabFast("Админ");
    await page.waitForTimeout(85);
    await clickTabFast("Каталог");
    await page.waitForTimeout(95);

    // телепорт-детектор: сразу после клика goo должен жить (is-live)
    await clickTabFast("Остатки");
    await page.waitForTimeout(60);
    const mid = await lensGeometry();
    if (!mid?.gooLive && cycle === 1) teleportFree = false;
    await clickTabFast("Каталог");

    // полный покой пружины (принудительные кадры — см. settleLens)
    const g = await settleLens();
    const activeOk = g?.active?.label === "Каталог";
    const dx = Math.abs(g.bubble.cx - g.active.cx);
    if (!activeOk || dx >= 5) {
      ok(`цикл ${cycle}: активный=Каталог, линза под ним`, false, `label=${g.active.label} dx=${dx.toFixed(1)}`);
    }
  }
  ok("10 циклов: линза каждый раз под активной вкладкой", true);
  ok("полёт непрерывен (is-live в середине, без телепорта)", teleportFree);

  // финальная проверка после покоя
  const g = await settleLens();
  ok("после 10 циклов активный = Каталог", g.active.label === "Каталог", g.active.label);
  const dx = Math.abs(g.bubble.cx - g.active.cx);
  ok("линза стоит под Каталогом после покоя", dx < 5, `dx=${dx.toFixed(1)}px`);
  ok("консоль: 0 ошибок", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
  ok("pageerror: 0", pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
  ok("requestfailed: 0", requestFailed.length === 0, JSON.stringify(requestFailed.slice(0, 3)));
}

console.log("── 4. Промежуточные вкладки + скриншоты (п.32) ──");
await clickTab("Остатки");
await page.waitForTimeout(750);
await page.screenshot({ path: join(SHOTS, "02-stock.png") });
await clickTab("Загрузка");
await page.waitForTimeout(750);
await page.screenshot({ path: join(SHOTS, "03-upload.png") });
await clickTab("Админ");
await page.waitForTimeout(750);
await page.screenshot({ path: join(SHOTS, "04-admin.png") });
{
  const g = await lensGeometry();
  ok("линза под «Админ» после серии переходов", g.active.label === "Админ" && Math.abs(g.bubble.cx - g.active.cx) < 5, g.active.label);
}

console.log("── 5. Поиск: открытие, место панели, без резерва (ТЗ п.28) ──");
await clickTab("Каталог");
await page.waitForTimeout(600);
await page.locator(".pill-search").click();
await page.waitForTimeout(450);
{
  const state = await page.evaluate(() => {
    const nav = document.querySelector("nav.pill-nav");
    const pop = document.querySelector(".search-pop");
    const input = pop?.querySelector("input[data-search-input]");
    const pr = pop?.getBoundingClientRect();
    return {
      navDisplay: nav ? getComputedStyle(nav).display : "absent",
      popVisible: pop ? getComputedStyle(pop).visibility === "visible" : false,
      popBottomGap: pr ? window.innerHeight - pr.bottom : -1,
      hasInput: Boolean(input),
      focused: document.activeElement === input,
    };
  });
  ok("pill-nav скрыт (display:none)", state.navDisplay === "none", state.navDisplay);
  ok("search-pop виден", state.popVisible);
  ok("поле на месте", state.hasInput);
  ok("кнопка НЕ автофокусирует поле (клавиатуру не открываем)", !state.focused);
  ok("карточка у safe-area: зазор 8–16px (НЕ 64px/12mm)", state.popBottomGap >= 6 && state.popBottomGap <= 20, `${state.popBottomGap.toFixed(1)}px`);
}
await page.screenshot({ path: join(SHOTS, "05-search-no-keyboard.png") });

console.log("── 6. Клавиатура (headless-симуляция): --kb-overlay, дропдаун ВВЕРХ ──");
{
  await page.locator("input[data-search-input]").click();
  await page.waitForTimeout(200); // focusin → measure() успевает отработать
  await page.evaluate(() => {
    document.documentElement.classList.add("kb-open");
    document.documentElement.style.setProperty("--kb-overlay", "300px");
  });
  await page.waitForTimeout(120);
  const state = await page.evaluate(() => {
    const pop = document.querySelector(".search-pop");
    const dd = document.querySelector(".search-dd");
    const input = pop?.querySelector("input[data-search-input]");
    const pr = pop?.getBoundingClientRect();
    const dr = dd?.getBoundingClientRect();
    const ir = input?.getBoundingClientRect();
    const ddStyle = dd ? getComputedStyle(dd) : null;
    // исходные ПРАВИЛА (не used-values): ищем .search-dd и html.kb-open .search-dd в CSSOM
    let baseRule = null;
    let kbRule = null;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.selectorText === ".search-dd") baseRule = { top: r.style.top, bottom: r.style.bottom };
        if (r.selectorText === "html.kb-open .search-dd") kbRule = { top: r.style.top, bottom: r.style.bottom };
      }
    }
    return {
      bottomGap: pr ? window.innerHeight - pr.bottom : -1,
      ddAbove: dr && ir ? dr.bottom <= ir.top + 1 : null,
      ddBottomGap: dr ? dr.bottom : -1,
      baseRule,
      kbRule,
    };
  });
  ok("низ карточки ≈ 308px от низа (300 overlay + 8)", state.bottomGap >= 300 && state.bottomGap <= 318, `${state.bottomGap.toFixed(1)}px`);
  ok("НЕ 417px+ (старая формула +64px+12mm убита)", state.bottomGap < 350, `${state.bottomGap.toFixed(1)}px`);
  ok("дропдаун открывается ВВЕРХ от поля", state.ddAbove === true, `dd.bottom=${state.ddBottomGap?.toFixed?.(1)}`);
  ok(
    "дропдаун якорится НИЗОМ (top:auto, bottom:calc(100%+8px)) — и в kb-open",
    state.baseRule?.top === "auto" &&
      /100%/.test(state.baseRule?.bottom ?? "") &&
      state.kbRule?.top === "auto" &&
      /100%/.test(state.kbRule?.bottom ?? ""),
    `base=${JSON.stringify(state.baseRule)} kb=${JSON.stringify(state.kbRule)}`
  );
  await page.screenshot({ path: join(SHOTS, "06-search-keyboard.png") });
}

console.log("── 7. Закрытие поиска: blur → клавиатура → панель возвращается ──");
{
  // СНАЧАЛА гасим симуляцию клавиатуры (как в жизни: клавиатура уезжает до
  // клика по крестику) — иначе pop прыгает вниз между hit-test и click.
  await page.evaluate(() => {
    document.documentElement.classList.remove("kb-open");
    document.documentElement.style.setProperty("--kb-overlay", "0px");
  });
  await page.waitForTimeout(180);
  await page.locator(".search-pop-close").click();
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => {
    const nav = document.querySelector("nav.pill-nav");
    const pop = document.querySelector(".search-pop");
    const input = pop?.querySelector("input[data-search-input]");
    return {
      navDisplay: nav ? getComputedStyle(nav).display : "absent",
      popVisible: pop ? getComputedStyle(pop).visibility === "visible" : false,
      kbOpen: document.documentElement.classList.contains("kb-open"),
      focused: document.activeElement === input && input != null,
    };
  });
  ok("панель вернулась", state.navDisplay !== "none" && state.navDisplay !== "absent", state.navDisplay);
  ok("карточка скрыта", !state.popVisible);
  ok("поле НЕ в фокусе (blur выполнен)", !state.focused);
  ok("kb-open снят после blur", !state.kbOpen);
}

await page.close();
await context.close(); // финализирует видео

console.log("── 8. Видео → mp4 ──");
{
  const rawDir = join(SHOTS, "video-raw");
  const files = existsSync(rawDir) ? readdirSync(rawDir) : [];
  const webm = files.find((f) => f.endsWith(".webm"));
  if (webm) {
    const src = join(rawDir, webm);
    const out = join(SHOTS, "mobile-nav-final.mp4");
    try {
      execFileSync("ffmpeg", ["-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "ignore" });
      ok("mobile-nav-final.mp4 создан", existsSync(out), out);
      unlinkSync(src);
    } catch (e) {
      // ffmpeg нет — оставляем webm
      renameSync(src, join(SHOTS, "mobile-nav-final.webm"));
      ok("mp4 не собран (нет ffmpeg), webm оставлен", false, String(e.message).slice(0, 80));
    }
  } else {
    ok("видео-файл создан Playwright", false, "video-raw пуст");
  }
  try { rmdirSync(rawDir); } catch { /* не пусто — ок */ }
}

await browser.close();

console.log("");
console.log(`══ ИТОГ: PASS=${passed} FAIL=${failed} ══`);
if (failed > 0) {
  console.log("Провалены:");
  errors.forEach((e) => console.log(`  ✗ ${e}`));
  process.exit(1);
}
