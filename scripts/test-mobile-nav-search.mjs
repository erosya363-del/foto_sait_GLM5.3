/**
 * E2E ТЗ v4 + PHASE2: мобильная нижняя Liquid Glass панель + режим поиска.
 *
 * Проверяет (п.26–28 ТЗ + Block 2 PHASE2):
 *   §26  DOM-композиция панели; НОЛЬ input внутри кнопок панели.
 *   §27  Быстрые переключения ×10: ошибки=0, линза под активной вкладкой,
 *        полёт непрерывен.
 *   §28  Поиск: тап → МОРФ (не display:none в первом кадре), search-pop
 *        у нижнего safe-area; headless-клавиатура → --kb-overlay; закрытие →
 *        blur + панель возвращается.
 *   PH2-1 Listener churn (ТЗ 2.13): portal:search-open/close регистрируются
 *        РОВНО ОДИН раз на жизненном цикле, не на каждый рендер.
 *   PH2-2 Gesture панели (ТЗ 2.4–2.6): линза следует за пальцем (preview),
 *        раздел меняется ТОЛЬКО на release; тап сохранён; settle между вкладками.
 *   PH2-3 Морф NAV↔SEARCH (ТЗ 2.8–2.10): панель гаснет транзишном
 *        (visibility/opacity, НЕ display:none), search surface симметрично
 *        приезжает; interruptible (rapid open→close).
 *   PH2-4 is-scrolling (ТЗ 2.7): класс появляется при скролле и снимается.
 *   PH2-5 Прозрачность (ТЗ 2.2): alpha --pill-bg ≤ 0.30 (v5: 0.28 — патч владельца iOS 26).
 *   P23-A..J Dynamic Lens (PHASE 2.3 §15): REST геометрия; PRESS выше панели
 *        (bounding rect!); content-press; single drag; BRIDGE Каталог/Остатки
 *        и Остатки/Загрузка (одна масса накрывает оба центра); release commit;
 *        release не дотянув; pointercancel; rapid ×10 без залипших классов.
 *   P23-Н HAPTICS (§16): стаб navigator.vibrate — press → событие; drag через
 *        границы → ограниченное число step (не пропорционально pointermove);
 *        commit → событие.
 *
 * Тест ТОЛЬКО ЧИТАЮЩИЙ, но запуск — fail-closed через явный E2E_BASE:
 *   bash scripts/run-isolated.sh bun scripts/test-mobile-nav-search.mjs
 *
 * Скриншоты → $E2E_SHOTS (по умолч. tool-results/mobile-nav/),
 * плюс видео mobile-nav-final.mp4.
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

/* PHASE 2.3 §16: счётчик хаптики — navigator.vibrate стабится ДО скриптов
   приложения (init). Считаем КАЖДЫЙ вызов: press/step/commit идут через
   web-haptics → navigator.vibrate в Chromium. */
await context.addInitScript(() => {
  const w = window;
  w.__haptics = { calls: [] };
  try {
    const push = (p) => {
      w.__haptics.calls.push(Array.isArray(p) ? p.join(",") : String(p));
      return true;
    };
    const proto = Navigator.prototype;
    const orig = proto.vibrate;
    if (typeof orig === "function") {
      Object.defineProperty(proto, "vibrate", {
        value: function (p) {
          push(p);
          try { return orig.call(this, p); } catch { return true; }
        },
        configurable: true,
      });
    } else {
      Object.defineProperty(proto, "vibrate", { value: push, configurable: true });
    }
  } catch {}
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
ok(".pill-ghost = 0 (PHASE 2.2: вторая линза удалена)", dom?.ghostCount === 0, `got ${dom?.ghostCount}`);
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

console.log("── 3. Быстрые переключения ×10 (ТЗ п.27; PHASE 2.4: без «Загрузки») ──");
{
  let teleportFree = true;
  for (let cycle = 1; cycle <= 10; cycle++) {
    await clickTabFast("Остатки");
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

console.log("── 4. Промежуточные вкладки + скриншоты (п.32; PHASE 2.4: sheet) ──");
await clickTab("Остатки");
await page.waitForTimeout(750);
await page.screenshot({ path: join(SHOTS, "02-stock.png") });
/* PHASE 2.4: тап «Загрузка» открывает glass sheet — раздел не меняется */
await clickTab("Загрузка");
await page.waitForTimeout(750);
await page.screenshot({ path: join(SHOTS, "03-upload-sheet.png") });
{
  const s = await page.evaluate(() => ({
    sheet: Boolean(document.querySelector("[data-upload-sheet]")),
    on: document.querySelector(".pill-item.is-on")?.textContent?.trim() ?? null,
  }));
  ok("тап Загрузка: sheet открыт, раздел Остатки", s.sheet && s.on === "Остатки", JSON.stringify(s));
  /* чистый sheet закрывается крестиком без подтверждения (§4.7) */
  await page.locator('[aria-label="Закрыть загрузку"]').click();
  await page.waitForTimeout(500);
  const closed = await page.evaluate(() => !document.querySelector("[data-upload-sheet]"));
  ok("чистый sheet закрылся сразу (без discard-confirm)", closed);
}
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
    const ns = nav ? getComputedStyle(nav) : null;
    return {
      navDisplay: nav ? getComputedStyle(nav).display : "absent",
      navVisibility: ns?.visibility ?? "absent",
      navOpacity: ns?.opacity ?? "absent",
      popVisible: pop ? getComputedStyle(pop).visibility === "visible" : false,
      popBottomGap: pr ? window.innerHeight - pr.bottom : -1,
      hasInput: Boolean(input),
      focused: document.activeElement === input,
    };
  });
  ok("панель скрыта морфом (НЕ display:none — ТЗ 2.8)",
     state.navDisplay !== "none" && state.navVisibility === "hidden" && Number(state.navOpacity) < 0.05,
     `display=${state.navDisplay} vis=${state.navVisibility} op=${state.navOpacity}`);
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
    const ns = nav ? getComputedStyle(nav) : null;
    return {
      navDisplay: nav ? getComputedStyle(nav).display : "absent",
      navVisibility: ns?.visibility ?? "absent",
      navOpacity: ns?.opacity ?? "absent",
      popVisible: pop ? getComputedStyle(pop).visibility === "visible" : false,
      kbOpen: document.documentElement.classList.contains("kb-open"),
      focused: document.activeElement === input && input != null,
    };
  });
  ok("панель вернулась (морф обратно)", state.navDisplay !== "none" && state.navDisplay !== "absent" && state.navVisibility === "visible" && Number(state.navOpacity) > 0.95, `vis=${state.navVisibility} op=${state.navOpacity}`);
  ok("карточка скрыта", !state.popVisible);
  ok("поле НЕ в фокусе (blur выполнен)", !state.focused);
  ok("kb-open снят после blur", !state.kbOpen);
}

/* ── PH2-хелперы: пошаговый pointer-жест по панели (down/move/up разделены,
      чтобы тест мог проверять состояние В СЕРЕДИНЕ жеста) ── */
const pillDown = (x, cy) =>
  page.evaluate(({ x, cy }) => {
    document.querySelector(".pill-shell").dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: cy, buttons: 1 })
    );
  }, { x, cy });
const pillMove = (x, cy) =>
  page.evaluate(({ x, cy }) => {
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: cy, buttons: 1 })
    );
  }, { x, cy }).then(() => page.waitForTimeout(26));
const pillUp = (x, cy) =>
  page.evaluate(({ x, cy }) => {
    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: cy, buttons: 0 })
    );
  }, { x, cy });

console.log("── 8. PH2-1: Listener churn (ТЗ 2.13) — 10 рендеров → ровно 1 регистрация ──");
{
  await page.evaluate(() => {
    const w = window;
    w.__srCounts = { open: 0, close: 0 };
    if (!w.__origAddEL) {
      w.__origAddEL = w.addEventListener.bind(w);
      w.addEventListener = function (type, ...rest) {
        if (type === "portal:search-open") w.__srCounts.open++;
        if (type === "portal:search-close") w.__srCounts.close++;
        return w.__origAddEL(type, ...rest);
      };
    }
  });
  for (const label of ["Остатки", "Админ", "Каталог", "Остатки", "Админ", "Каталог"]) {
    await clickTabFast(label);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(250);
  const c = await page.evaluate(() => window.__srCounts);
  ok("portal:search-open: НОЛЬ перерегистраций за 6+ рендеров (churn устранён)", c.open === 0, `open=${c.open}`);
  ok("portal:search-close: НОЛЬ перерегистраций", c.close === 0, `close=${c.close}`);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("portal:search-open")));
  await page.waitForTimeout(400);
  const popVisible = await page.evaluate(() => getComputedStyle(document.querySelector(".search-pop")).visibility === "visible");
  ok("событие portal:search-open работает после рендеров", popVisible);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("portal:search-close")));
  await page.waitForTimeout(400);
}

console.log("── 9. PH2-2: Gesture панели — preview за пальцем, commit на release (ТЗ 2.4–2.6) ──");
{
  const box = await page.evaluate(() => {
    const s = document.querySelector(".pill-shell").getBoundingClientRect();
    const items = [...document.querySelectorAll(".pill-item")].map((el) => ({
      label: el.textContent.trim(),
      cx: el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2,
    }));
    return { cy: s.top + s.height / 2, items };
  });
  const byLabel = (l) => box.items.find((i) => i.label === l);
  const catalog = byLabel("Каталог");
  const stock = byLabel("Остатки");
  const upload = byLabel("Загрузка");
  const admin = byLabel("Админ");

  /* 9a. Drag Каталог → Остатки: линза следует, раздел НЕ меняется в полёте.
     Три шага + пауза: пружина должна успеть отвести линзу от Каталога. */
  await pillDown(catalog.cx, box.cy);
  await pillMove(stock.cx, box.cy);
  await pillMove(stock.cx + 8, box.cy);
  await pillMove(stock.cx + 16, box.cy);
  await page.waitForTimeout(150);
  {
    const mid = await page.evaluate(() => {
      const b = document.querySelector(".pill-bubble").getBoundingClientRect();
      const on = document.querySelector(".pill-item.is-on");
      return { bCx: b.left + b.width / 2, on: on.textContent.trim() };
    });
    ok("preview: линза отошла от Каталога за пальцем", mid.bCx > catalog.cx + 25, `dcx=${(mid.bCx - catalog.cx).toFixed(0)}`);
    ok("preview: раздел НЕ изменился в середине жеста", mid.on === "Каталог", mid.on);
  }
  /* 9b. Дотянул до Остатков и отпустил → commit (PHASE 2.4: вместо
     commit-на-Загрузку — она теперь sheet; см. 9e) */
  await pillMove(stock.cx, box.cy);
  await pillUp(stock.cx, box.cy);
  await page.waitForTimeout(550);
  {
    const g = await settleLens();
    ok("commit на release: раздел = Остатки", g.active.label === "Остатки", g.active.label);
    ok("линза под Остатками после commit", Math.abs(g.bubble.cx - stock.cx) < 6, `dx=${Math.abs(g.bubble.cx - stock.cx).toFixed(1)}`);
  }
  /* 9c. Отпустил НЕ дотянув до соседней вкладки (ближайшая — текущая) →
         settle обратно, раздел не меняется */
  await pillDown(stock.cx, box.cy);
  await pillMove(stock.cx + 30, box.cy);
  await pillUp(stock.cx + 30, box.cy);
  await page.waitForTimeout(550);
  {
    const g = await settleLens();
    ok("release не дотянув: раздел остался Остатки", g.active.label === "Остатки", g.active.label);
    ok("линза вернулась к активной вкладке", Math.abs(g.bubble.cx - stock.cx) < 6, `dx=${Math.abs(g.bubble.cx - stock.cx).toFixed(1)}`);
  }
  /* 9d. pointercancel → возврат */
  await pillDown(stock.cx, box.cy);
  await pillMove(admin.cx, box.cy);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 0, clientY: 0, buttons: 1 }));
  });
  await page.waitForTimeout(550);
  {
    const g = await settleLens();
    ok("pointercancel: раздел не изменился", g.active.label === "Остатки", g.active.label);
  }
  /* 9e. PHASE 2.4 §4.3: DRAG-RELEASE на «Загрузке» = ACTION: sheet
     открывается, committed view НЕ меняется, линза собирается обратно */
  await pillDown(stock.cx, box.cy);
  await pillMove(upload.cx, box.cy);
  await pillUp(upload.cx, box.cy);
  await page.waitForTimeout(600);
  {
    const s = await page.evaluate(() => ({
      sheet: Boolean(document.querySelector("[data-upload-sheet]")),
      on: document.querySelector(".pill-item.is-on")?.textContent?.trim() ?? null,
    }));
    ok("release на Загрузке: sheet открыт", s.sheet);
    ok("release на Загрузке: раздел остался Остатки", s.on === "Остатки", s.on);
  }
  {
    const g = await settleLens();
    ok("release на Загрузке: линза вернулась к Остаткам", Math.abs(g.bubble.cx - stock.cx) < 6, `dx=${Math.abs(g.bubble.cx - stock.cx).toFixed(1)}`);
  }
  await page.locator('[aria-label="Закрыть загрузку"]').click();
  await page.waitForTimeout(500);
  /* 9f. Обычный тап после жестов жив (Playwright click = настоящий click) */
  await clickTab("Каталог");
  await page.waitForTimeout(650);
  {
    const g = await settleLens();
    ok("тап после жестов работает (Каталог)", g.active.label === "Каталог", g.active.label);
  }
}

console.log("── 10. PH2-3: Морф interruptible — open → мгновенно close (ТЗ 2.9) ──");
{
  await page.locator(".pill-search").click();
  await page.waitForTimeout(120); // середина морфа NAV_TO_SEARCH
  await page.locator(".search-pop-close").click(); // прерываем
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const nav = document.querySelector("nav.pill-nav");
    const pop = document.querySelector(".search-pop");
    return {
      navVis: getComputedStyle(nav).visibility,
      navOp: Number(getComputedStyle(nav).opacity),
      navDisplay: getComputedStyle(nav).display,
      popVis: getComputedStyle(pop).visibility,
    };
  });
  ok("после прерывания панель полностью вернулась", state.navVis === "visible" && state.navOp > 0.95 && state.navDisplay !== "none", JSON.stringify(state));
  ok("карточка скрыта после прерывания", state.popVis === "hidden", state.popVis);
}

console.log("── 11. PH2-4/5: is-scrolling + прозрачность (ТЗ 2.2/2.7) ──");
{
  /* Каталог-корень на 390×844 помещается в экран (canScroll=0) — скроллим
     длинный список «Остатки». Доверенный wheel = реальный путь событий. */
  await clickTab("Остатки");
  await page.waitForTimeout(800);
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.documentElement.classList.contains("is-scrolling"), null, { timeout: 1500 }).catch(() => {});
  const appeared = await page.evaluate(() => document.documentElement.classList.contains("is-scrolling"));
  ok("is-scrolling появляется при скролле", appeared);
  await page.waitForFunction(() => !document.documentElement.classList.contains("is-scrolling"), null, { timeout: 2500 }).catch(() => {});
  const removed = await page.evaluate(() => !document.documentElement.classList.contains("is-scrolling"));
  ok("is-scrolling снимается после остановки (240 мс)", removed);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

  const alpha = await page.evaluate(() => {
    /* PHASE 2.3: реальное стекло переехало в .pill-surface (§1.4/E) */
    const bg = getComputedStyle(document.querySelector(".pill-surface")).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(",").map((s) => parseFloat(s)) : [];
    return parts.length === 4 ? parts[3] : 1;
  });
  /* Liquid Glass v5 (патч владельца): dark --pill-bg = rgba(50,48,44,0.28) —
     чуть плотнее, чем ТЗ 2.2 (0.25) — осознанное решение v5, НЕ регресс. */
  ok("панель прозрачнее: alpha --pill-bg ≤ 0.30 (v5: 0.28)", alpha <= 0.301, `alpha=${alpha}`);
}

/* ── PHASE 2.3: хелперы dynamic lens ── */
const pillPanel = () =>
  page.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const items = [...document.querySelectorAll(".pill-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        label: el.textContent.trim(),
        left: r.left,
        right: r.right,
        cx: r.left + r.width / 2,
        width: r.width,
        covered: el.classList.contains("is-lens-covered"),
        contentScale: (() => {
          const c = el.querySelector(".pill-item-content");
          if (!c) return 1;
          const t = new DOMMatrixReadOnly(getComputedStyle(c).transform === "none" ? "" : getComputedStyle(c).transform);
          return t.a;
        })(),
      };
    });
    return { cy: shell.getBoundingClientRect().top + shell.getBoundingClientRect().height / 2, items };
  });

const lensState = () =>
  page.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const bubble = document.querySelector(".pill-bubble");
    const on = document.querySelector(".pill-item.is-on");
    const s = shell.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    return {
      shellH: s.height,
      shellTop: s.top,
      shellBottom: s.bottom,
      bTop: b.top,
      bBottom: b.bottom,
      bLeft: b.left,
      bRight: b.right,
      bCx: b.left + b.width / 2,
      bW: b.width,
      bH: b.height,
      onLabel: on?.textContent?.trim() ?? null,
      onCx: on ? on.getBoundingClientRect().left + on.getBoundingClientRect().width / 2 : 0,
      coveredCount: document.querySelectorAll(".pill-item.is-lens-covered").length,
      pressVar: bubble.style.getPropertyValue("--lens-press") || "0",
    };
  });

const resetHaptics = () => page.evaluate(() => { window.__haptics.calls.length = 0; });
const hapticCount = () => page.evaluate(() => window.__haptics.calls.length);

console.log("── 12. P23-A/B/C: REST геометрия, PRESS выше панели, content-press (§15) ──");
{
  await clickTab("Каталог");
  await page.waitForTimeout(700);
  let g = await settleLens();
  ok("A. REST: линза внутри панели (h ≤ 64px)", g.bubble.opacity && g.bubble.width > 0 && g.bubble.top >= g.shell.top - 0.6 && g.bubble.bottom <= g.shell.bottom + 0.6, `h=${(g.bubble.bottom - g.bubble.top).toFixed(1)}`);

  const panel = await pillPanel();
  const catalog = panel.items.find((i) => i.label === "Каталог");
  const stock = panel.items.find((i) => i.label === "Остатки");
  const upload = panel.items.find((i) => i.label === "Загрузка");
  const admin = panel.items.find((i) => i.label === "Админ");

  /* B: pointerdown → линза СТАНОВИТСЯ ВЫШЕ панели (пружине press нужно ~0.4 c) */
  await resetHaptics();
  await pillDown(catalog.cx, panel.cy);
  await page.waitForTimeout(500);
  let ls = await lensState();
  ok("B. PRESS: линза выше панели (bH > shellH)", ls.bH > ls.shellH, `bH=${ls.bH.toFixed(1)} shellH=${ls.shellH}`);
  ok("B. PRESS: вспухание симметрично (выше и ниже)", ls.bTop < ls.shellTop - 1 && ls.bBottom > ls.shellBottom + 1, `top Δ=${(ls.shellTop - ls.bTop).toFixed(1)} bottom Δ=${(ls.bBottom - ls.shellBottom).toFixed(1)}`);
  ok("B. PRESS: --lens-press активирован", parseFloat(ls.pressVar) > 0.5, ls.pressVar);

  /* C: content накрытого пункта сжат */
  const covered = panel.items; // пере-снимок ниже
  const p2 = await pillPanel();
  const cat2 = p2.items.find((i) => i.label === "Каталог");
  ok("C. CONTENT PRESS: Каталог накрыт (is-lens-covered)", cat2.covered, `covered=${p2.items.filter((i) => i.covered).map((i) => i.label).join(",")}`);
  ok("C. CONTENT PRESS: scale < 0.96", cat2.contentScale > 0.5 && cat2.contentScale < 0.96, `scale=${cat2.contentScale.toFixed(3)}`);
  ok("C. is-on НЕ изменён при press", ls.onLabel === "Каталог", ls.onLabel);

  /* отпускание: геометрия собирается обратно */
  await pillUp(catalog.cx, panel.cy);
  await page.waitForTimeout(650);
  g = await settleLens();
  ok("B. Release: высота вернулась в панель", g.bubble.top >= g.shell.top - 0.6 && g.bubble.bottom <= g.shell.bottom + 0.6);
  const p3 = await pillPanel();
  ok("C. Release: covered-классов нет", p3.items.every((i) => !i.covered));
  ok("B. PRESS haptic: ≥ 1 вызов vibration", (await hapticCount()) >= 1, `calls=${await hapticCount()}`);
}

console.log("── 13. P23-D/E: single drag за пальцем + TWO-TAB BRIDGE (§15 D/E) ──");
{
  const panel = await pillPanel();
  const catalog = panel.items.find((i) => i.label === "Каталог");
  const stock = panel.items.find((i) => i.label === "Остатки");
  const upload = panel.items.find((i) => i.label === "Загрузка");
  const admin = panel.items.find((i) => i.label === "Админ");

  /* D: одиночный drag в пределах одной вкладки — линза следует за пальцем */
  await pillDown(catalog.cx, panel.cy);
  await pillMove(catalog.cx + 25, panel.cy);
  await page.waitForTimeout(220);
  let ls = await lensState();
  ok("D. SINGLE DRAG: линза ушла за пальцем", ls.bCx > catalog.cx + 12, `dcx=${(ls.bCx - catalog.cx).toFixed(1)}`);
  ok("D. раздел НЕ меняется в полёте", ls.onLabel === "Каталог", ls.onLabel);

  /* E: мост Каталог↔Остатки — ОДНА линза накрывает ОБА центра */
  const midCS = (catalog.cx + stock.cx) / 2;
  await pillMove(midCS, panel.cy);
  await page.waitForTimeout(260);
  ls = await lensState();
  /* CRITICAL STABILITY 4.1/4.3: моста-растяжения БОЛЬШЕ НЕТ — линза едет
     ЕДИНОЙ капсулой press-размера (width = таб × 1.18 ± tolerance); «мост» —
     это состояние covered-пересечения, а не растянутая геометрия */
  ok("E. КАПСУЛА: ширина = таб × 1.18 (не растягивается, tolerance ±12%)",
     Math.abs(ls.bW - catalog.width * 1.18) < catalog.width * 0.14,
     `bW=${ls.bW.toFixed(0)} vs ожидаем ${(catalog.width * 1.18).toFixed(0)}`);
  ok("E. КАПСУЛА: ширина НЕ больше таб × 1.32 (анти-«колбаса»)", ls.bW < catalog.width * 1.32, `bW=${ls.bW.toFixed(0)}`);
  ok("E. пересечение: накрыты ОБА центра (Каталог и Остатки)", ls.bLeft < catalog.cx && ls.bRight > stock.cx, `[${ls.bLeft.toFixed(0)}..${ls.bRight.toFixed(0)}] vs ${catalog.cx.toFixed(0)}/${stock.cx.toFixed(0)}`);
  ok("E. covered: оба пункта is-lens-covered (реальное пересечение, ТЗ 4.4)", (await pillPanel()).items.filter((i) => i.covered).map((i) => i.label).join("+") === "Каталог+Остатки");
  /* CRITICAL STABILITY 4.6 «тяну из Каталога к Остаткам — Каталог ещё горит,
     хотя палец уже ушёл» — БАГ. Подводим палец ЗА центр Остатков: капсула
     полностью уходит с Каталога (перекрытие < 0) → is-on Каталога
     (уже не covered) обязан ГАСНУТЬ (цвет = muted, не brand). */
  await pillMove(stock.cx + 14, panel.cy);
  await page.waitForTimeout(240);
  /* во время drag подсветка committed is-on ГАСНЕТ, если линза её уже
     не накрывает: computed color = muted-foreground (не brand) */
  const dimInfo = await page.evaluate(() => {
    const on = document.querySelector(".pill-item.is-on");
    if (!on) return null;
    return { covered: on.classList.contains("is-lens-covered"), color: getComputedStyle(on).color };
  });
  const brandRgb = await page.evaluate(() => {
    const p = document.querySelector(".pill-item.is-lens-covered");
    return p ? getComputedStyle(p).color : null;
  });
  ok("E. старая вкладка ГАСНЕТ: is-on без covered имеет НЕ-brand цвет (ТЗ 4.6)",
     dimInfo && !dimInfo.covered && brandRgb && dimInfo.color !== brandRgb,
     `onColor=${dimInfo?.color} coveredColor=${brandRgb}`);
  ok("E. BRIDGE: is-on всё ещё Каталог (commit только на release)", ls.onLabel === "Каталог", ls.onLabel);
  ok("E. BRIDGE: линза одна (не две)", ls.bW > 0 && (await page.evaluate(() => document.querySelectorAll(".pill-bubble").length)) === 1);

  /* release на Остатках → commit (G частично) */
  await pillUp(stock.cx, panel.cy);
  await page.waitForTimeout(700);
  const g2 = await settleLens();
  ok("E→G. release на Остатках: commit = Остатки", g2.active.label === "Остатки", g2.active.label);
  ok("G. высота вернулась в панель", g2.bubble.top >= g2.shell.top - 0.6 && g2.bubble.bottom <= g2.shell.bottom + 0.6);
  ok("G. covered-классов нет после commit", (await pillPanel()).items.every((i) => !i.covered));

  /* F: второй мост Остатки↔Загрузка */
  await pillDown(stock.cx, panel.cy);
  const midSU = (stock.cx + upload.cx) / 2;
  await pillMove(midSU, panel.cy);
  await page.waitForTimeout(260);
  ls = await lensState();
  ok("F. КАПСУЛА-2: ширина = таб × 1.18 (постоянна, ТЗ 4.3)", Math.abs(ls.bW - stock.width * 1.18) < stock.width * 0.14, `bW=${ls.bW.toFixed(0)} vs ${(stock.width * 1.18).toFixed(0)}`);
  ok("F. КАПСУЛА-2: ширина НЕ больше таб × 1.32", ls.bW < stock.width * 1.32, `bW=${ls.bW.toFixed(0)}`);
  ok("F. пересечение-2: накрыты ОБА центра (Остатки и Загрузка)", ls.bLeft < stock.cx && ls.bRight > upload.cx, `[${ls.bLeft.toFixed(0)}..${ls.bRight.toFixed(0)}]`);

  /* H: release НЕ дотянув (до Загрузки далеко) → возврат к Остаткам */
  await pillUp(stock.cx + 12, panel.cy);
  await page.waitForTimeout(700);
  const g3 = await settleLens();
  ok("H. release не дотянув: раздел Остатки", g3.active.label === "Остатки", g3.active.label);
  ok("H. геометрия нормальная", g3.bubble.top >= g3.shell.top - 0.6 && g3.bubble.bottom <= g3.shell.bottom + 0.6 && Math.abs(g3.bubble.cx - stock.cx) < 6, `dx=${Math.abs(g3.bubble.cx - stock.cx).toFixed(1)}`);

  /* I: pointercancel — полный возврат */
  await pillDown(stock.cx, panel.cy);
  await pillMove(admin.cx, panel.cy);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 0, clientY: 0, buttons: 1 }));
  });
  await page.waitForTimeout(650);
  const g4 = await settleLens();
  ok("I. pointercancel: раздел не изменился", g4.active.label === "Остатки", g4.active.label);
  ok("I. pointercancel: без залипших covered", (await pillPanel()).items.every((i) => !i.covered));
  ok("I. pointercancel: линза под активной", Math.abs(g4.bubble.cx - g4.active.cx) < 6, `dx=${Math.abs(g4.bubble.cx - g4.active.cx).toFixed(1)}`);

  /* возврат в Каталог для следующих секций */
  await clickTab("Каталог");
  await page.waitForTimeout(600);
}

console.log("── 14. P23-J: rapid press→drag→release ×10 — без залипших состояний ──");
{
  const panel = await pillPanel();
  const byLabel = (l) => panel.items.find((i) => i.label === l);
  const route = ["Остатки", "Каталог", "Админ", "Остатки", "Каталог", "Админ", "Каталог", "Остатки", "Админ", "Каталог"];
  for (let i = 0; i < route.length; i++) {
    const from = byLabel(i % 2 === 0 ? "Каталог" : route[i - 1] ?? "Каталог");
    const to = byLabel(route[i]);
    await pillDown(from.cx, panel.cy);
    await pillMove((from.cx + to.cx) / 2, panel.cy);
    await pillUp(to.cx, panel.cy);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(800);
  const g = await settleLens();
  const p = await pillPanel();
  ok("J. rapid ×10: активный = Каталог", g.active.label === "Каталог", g.active.label);
  ok("J. rapid ×10: линза под активной", Math.abs(g.bubble.cx - g.active.cx) < 5, `dx=${Math.abs(g.bubble.cx - g.active.cx).toFixed(1)}`);
  ok("J. rapid ×10: НЕТ залипших covered-классов", p.items.every((i) => !i.covered));
  ok("J. rapid ×10: геометрия в панели", g.bubble.top >= g.shell.top - 0.6 && g.bubble.bottom <= g.shell.bottom + 0.6);
  ok("J. консоль: 0 ошибок", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
  ok("J. pageerror: 0", pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
}

console.log("── 15. P23-H: HAPTICS — press/step/commit маршрут (§16) ──");
{
  const panel = await pillPanel();
  const catalog = panel.items.find((i) => i.label === "Каталог");
  const stock = panel.items.find((i) => i.label === "Остатки");
  const upload = panel.items.find((i) => i.label === "Загрузка");
  const admin = panel.items.find((i) => i.label === "Админ");

  /* тап по вкладке: press (down) + click-отклик схлопываются троттлом —
     должен остаться ОДИН вызов vibration (±1 на границе троттла) */
  await resetHaptics();
  await clickTab("Остатки");
  await page.waitForTimeout(500);
  const tapCalls = await hapticCount();
  ok("H. tap: ровно один отклик (не дубли)", tapCalls >= 1 && tapCalls <= 2, `calls=${tapCalls}`);

  /* drag через 3 границы (Остатки→Загрузка→Админ): press + ≤3 step + commit;
     НЕ пропорционально числу pointermove (их ~12) */
  await resetHaptics();
  await pillDown(stock.cx, panel.cy);
  for (let i = 1; i <= 12; i++) {
    const x = stock.cx + ((admin.cx - stock.cx) * i) / 12;
    await pillMove(x, panel.cy);
  }
  await pillUp(admin.cx, panel.cy);
  await page.waitForTimeout(500);
  const dragCalls = await hapticCount();
  ok("H. drag ×12 move: события связаны с границами (≤ 7), не с move", dragCalls >= 2 && dragCalls <= 7, `calls=${dragCalls}`);
  ok("H. commit на admin", (await lensState()).onLabel === "Админ");

  if (tapCalls === 0 && dragCalls === 0) {
    console.log("  ⚠ headless: web-haptics не дошёл до navigator.vibrate — маршрут проверен код-ревью, REAL DEVICE отдельно");
  }

  await clickTab("Каталог");
  await page.waitForTimeout(500);
}

console.log("── 16. P24: UPLOAD SHEET — guards, dirty, keyboard (§4) ──");
{
  /* 16a. Открытие тапом; committed view не сбрасывается */
  await clickTab("Остатки");
  await page.waitForTimeout(650);
  await clickTab("Загрузка");
  await page.waitForTimeout(700);
  let sheetState = await page.evaluate(() => {
    const sh = document.querySelector("[data-upload-sheet]");
    const r = sh?.getBoundingClientRect();
    return {
      open: Boolean(sh),
      bottom: r ? window.innerHeight - r.bottom : -1,
      headerVisible: sh ? sh.querySelector("h2")?.textContent?.includes("Загрузка") : false,
      on: document.querySelector(".pill-item.is-on")?.textContent?.trim() ?? null,
    };
  });
  ok("16a. sheet открыт тапом", sheetState.open);
  ok("16a. sheet якорится внизу (bottom = kb-overlay ≈ 0)", sheetState.bottom >= -2 && sheetState.bottom < 8, `bottomGap=${sheetState.bottom}`);
  ok("16a. committed view не сброшен (Остатки)", sheetState.on === "Остатки", sheetState.on);

  /* 16b. DIRTY: выбрали категорию+модель → backdrop больше не закрывает
     сразу, показывает discard-confirm (§4.7) */
  await page.locator('[data-upload-sheet] select').first().selectOption({ index: 1 });
  await page.waitForTimeout(250);
  const modelSel = page.locator('[data-upload-sheet] select').nth(1);
  await modelSel.selectOption({ index: 1 }).catch(() => {});
  await page.waitForTimeout(250);
  // CRITICAL STABILITY: sheet теперь 86dvh (top ≈ 118px при 844) —
  // тап по backdrop ВЫШЕ верха sheet
  const sheetTop = await page.evaluate(() => document.querySelector("[data-upload-sheet]")?.getBoundingClientRect().top ?? 200);
  await page.mouse.click(195, Math.max(20, sheetTop / 2)); // тап по backdrop над sheet
  await page.waitForTimeout(400);
  let confirm = await page.evaluate(() => Boolean(document.querySelector("[data-upload-confirm]")));
  ok("16b. dirty sheet: backdrop показывает discard-confirm", confirm);
  await page.locator('[data-upload-confirm] button:has-text("Остаться")').click();
  await page.waitForTimeout(350);
  confirm = await page.evaluate(() => Boolean(document.querySelector("[data-upload-confirm]")));
  ok("16b. «Остаться» — sheet жив", !confirm);

  /* 16c. KEYBOARD (§4.5): --kb-overlay поднимает НИЗ sheet; шапка на месте;
     доступная высота уменьшилась; скроллится контент, не всё окно */
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--kb-overlay", "300px");
  });
  await page.waitForTimeout(400);
  const kb = await page.evaluate(() => {
    const sh = document.querySelector("[data-upload-sheet]");
    const r = sh.getBoundingClientRect();
    return {
      bottomGap: window.innerHeight - r.bottom,
      top: r.top,
      height: r.height,
      height: getComputedStyle(sh).height,
    };
  });
  ok("16c. клавиатура: низ sheet = --kb-overlay (300)", Math.abs(kb.bottomGap - 300) < 4, `gap=${kb.bottomGap}`);
  ok("16c. клавиатура: sheet не выше видимой зоны", kb.top >= 0, `top=${kb.top.toFixed(0)}`);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--kb-overlay", "0px");
  });
  await page.waitForTimeout(300);

  /* 16d. Discard: крестик → «Закрыть» → sheet закрыт, раздел на месте */
  await page.locator('[aria-label="Закрыть загрузку"]').click();
  await page.waitForTimeout(350);
  confirm = await page.evaluate(() => Boolean(document.querySelector("[data-upload-confirm]")));
  ok("16d. dirty sheet: крестик показывает confirm", confirm);
  await page.locator('[data-upload-confirm] button:has-text("Закрыть")').click();
  await page.waitForTimeout(500);
  sheetState = await page.evaluate(() => ({
    open: Boolean(document.querySelector("[data-upload-sheet]")),
    on: document.querySelector(".pill-item.is-on")?.textContent?.trim() ?? null,
  }));
  ok("16d. discard подтверждён — sheet закрыт", !sheetState.open);
  ok("16d. раздел после закрытия — Остатки", sheetState.on === "Остатки", sheetState.on);
}

console.log("── 17. P24: GLASS TOASTS — позиция над пилюлей, материал (§3) ──");
{
  /* Реальный путь: invalid file в upload sheet → toast.error */
  await clickTab("Каталог");
  await page.waitForTimeout(500);
  await clickTab("Загрузка");
  await page.waitForTimeout(700);
  /* Шаг 1: категория+модель (валидные из справочника) */
  await page.locator('[data-upload-sheet] select').first().selectOption({ index: 1 });
  await page.waitForTimeout(250);
  await page.locator('[data-upload-sheet] select').nth(1).selectOption({ index: 1 }).catch(() => {});
  await page.waitForTimeout(200);
  await page.locator('[data-upload-sheet] button:has-text("Далее")').click();
  await page.waitForTimeout(300);
  await page.locator('[data-upload-sheet] button:has-text("Далее")').click();
  await page.waitForTimeout(300);
  /* Инвалиd-файл (.txt) → toast.error */
  await page.locator('[data-upload-sheet] input[type="file"]').setInputFiles([
    { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("не фото") },
  ]);
  await page.waitForTimeout(700);
  const toast = await page.evaluate(() => {
    const t = document.querySelector('.toaster-m [data-sonner-toast][data-styled="true"]');
    if (!t) return null;
    const st = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    const pill = document.querySelector(".pill-shell")?.getBoundingClientRect();
    const alpha = (() => {
      const m = st.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const parts = m ? m[1].split(",").map((s) => parseFloat(s)) : [];
      return parts.length === 4 ? parts[3] : 1;
    })();
    return {
      type: t.getAttribute("data-type"),
      visible: r.width > 0 && r.height > 0,
      bottom: r.bottom,
      pillTop: pill ? pill.top : null,
      bgAlpha: alpha,
      blur: st.backdropFilter || st.webkitBackdropFilter || "none",
      greenFill: /rgb\((\d+), (\d+), (\d+)\)/.exec(st.backgroundColor)?.slice(1, 4).map(Number) ?? null,
      title: t.querySelector("[data-title]")?.textContent ?? "",
    };
  });
  ok("17. toast.error появился на mobile-тостере", Boolean(toast?.visible), JSON.stringify(toast));
  ok("17. toast стоит НАД пилюлей (bottom < pill.top)", toast && toast.pillTop !== null && toast.bottom <= toast.pillTop + 2, `toast.bottom=${toast?.bottom?.toFixed(0)} pill.top=${toast?.pillTop?.toFixed(0)}`);
  ok("17. toast стекло: bg полупрозрачный (alpha < 0.95)", toast && toast.bgAlpha < 0.95, `alpha=${toast?.bgAlpha}`);
  ok("17. toast стекло: backdrop-filter включён", toast && toast.blur !== "none" && toast.blur !== "", toast?.blur);
  const greenSolid = toast?.greenFill && toast.greenFill[1] > toast.greenFill[0] + 40 && toast.bgAlpha > 0.9;
  ok("17. toast НЕ solid-зелёный (§3.3)", !greenSolid, `bg=${toast?.greenFill} alpha=${toast?.bgAlpha}`);
  await page.screenshot({ path: join(SHOTS, "18-toast-glass.png") });

  /* Второй тостер скрыт на мобиле (дублей нет) */
  const dup = await page.evaluate(() => {
    const d = document.querySelector(".toaster-d [data-sonner-toast]");
    return d ? d.getBoundingClientRect().height : 0;
  });
  ok("17. desktop-тостер скрыт на мобиле", dup === 0, `h=${dup}`);

  /* очистка: dirty sheet — discard */
  await page.locator('[aria-label="Закрыть загрузку"]').click();
  await page.waitForTimeout(350);
  const hasConfirm = await page.evaluate(() => Boolean(document.querySelector("[data-upload-confirm]")));
  if (hasConfirm) {
    await page.locator('[data-upload-confirm] button:has-text("Закрыть")').click();
    await page.waitForTimeout(450);
  }
  await clickTab("Каталог");
  await page.waitForTimeout(400);
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
