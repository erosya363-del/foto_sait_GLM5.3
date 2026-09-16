/**
 * E2E v3.1 — P0/P1 ТЗ «стабильная мобильная версия»:
 *  — нижняя панель: одна координата, без transform-скрытия, единое стекло
 *    (без SVG-фильтра и sheen-анимации), bubble = один элемент (P0.1/0.2/1.11/1.12);
 *  — клавиатура: панель скрыта ПОЛНОСТЬЮ (display:none), возврат на ту же
 *    координату, ноль «призрачных» кадров (P0.3/1.14);
 *  — search mode: панель скрыта при открытой карточке (P1.13);
 *  — Photo Viewer на PhotoSwipe 5: без кнопок −/%/+ на таче (P0.8), wheel/zoom
 *    desktop, pan-границы, листание, share-fallback, lifecycle 30× без утечек
 *    (P0.6/0.7/0.9/0.10/0.13/P1.1-1.9).
 * Запуск: node scripts/test-v31.mjs (сервер на :3000)
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
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
/* Тач-контекст (iPhone-класс): pointer:coarse → pswp без zoom-кнопок (P0.8) */
const context = await browser.newContext({
  viewport: { width: 390, height: 780 },
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(() => {
  try {
    if (!localStorage.getItem("test-v31-cleaned")) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("test-v31-cleaned", "1");
    }
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
    }
    if (typeof caches !== "undefined") {
      caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
    }
  } catch {}
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.evaluate(() => {
  document.documentElement.style.scrollBehavior = "auto";
});

console.log("\n— 1. Панель: единое стекло, без расслаивающихся слоёв —");
const shellInfo = await page.evaluate(() => {
  const shell = document.querySelector(".pill-shell");
  const cs = getComputedStyle(shell);
  const after = getComputedStyle(shell, "::after");
  const bubble = document.querySelector(".pill-bubble");
  return {
    bf: cs.backdropFilter || cs.webkitBackdropFilter,
    afterContent: after.content,
    bubbleExists: Boolean(bubble),
    bubbleTransition: bubble ? getComputedStyle(bubble).transitionProperty : null,
    lensLeftovers:
      document.querySelectorAll(".nav-lens, #nav-liquid, .is-liquid").length,
  };
});
ok("backdrop-filter БЕЗ url(#svg) — один CSS-слой (P0.2)", shellInfo.bf.includes("blur(") && !shellInfo.bf.includes("url("), shellInfo.bf);
ok("sheen-анимация ::after удалена (content: none)", shellInfo.afterContent === "none", shellInfo.afterContent);
ok("bubble — один общий элемент", shellInfo.bubbleExists);
ok("старых линз/SVG-слоёв нет", shellInfo.lensLeftovers === 0);
ok("bubble анимирует только transform/width/opacity (P1.12)",
  /^transform|transform/.test(shellInfo.bubbleTransition) && shellInfo.bubbleTransition.split(",").every(
    (p) => /transform|width|opacity/.test(p.trim()) || p.trim() === "all"
  ) && !/left|right|top|margin/.test(shellInfo.bubbleTransition),
  shellInfo.bubbleTransition);

console.log("\n— 2. Панель: одна координата при смене вкладок (P0.1) —");
const pillY = () => page.locator(".pill-shell").evaluate((el) => Math.round(el.getBoundingClientRect().top));
const y1 = await pillY();
await page.locator(".pill-shell .pill-item").nth(1).click();
await page.waitForTimeout(650);
const y2 = await pillY();
await page.locator(".pill-shell .pill-item").nth(2).click();
await page.waitForTimeout(650);
const y3 = await pillY();
ok("Y панели неизменен при Каталог→Остатки→Загрузка", y1 === y2 && y2 === y3, `${y1}/${y2}/${y3}`);
const boxes = await page.evaluate(() =>
  [...document.querySelectorAll(".pill-shell .pill-item")].map((el) => {
    const r = el.getBoundingClientRect();
    return `${Math.round(r.left)}x${Math.round(r.width)}`;
  }).join("|")
);
await page.locator(".pill-shell .pill-item").nth(0).click();
await page.waitForTimeout(650);
const boxes2 = await page.evaluate(() =>
  [...document.querySelectorAll(".pill-shell .pill-item")].map((el) => {
    const r = el.getBoundingClientRect();
    return `${Math.round(r.left)}x${Math.round(r.width)}`;
  }).join("|")
);
ok("иконки стоят на месте — боксы пунктов пиксель-в-пиксель (P1.12)", boxes === boxes2, `${boxes} → ${boxes2}`);
const bubbleMove = await page.evaluate(async () => {
  const bubble = document.querySelector(".pill-bubble");
  const t0 = bubble.style.transform;
  document.querySelectorAll(".pill-shell .pill-item")[1].click();
  await new Promise((r) => setTimeout(r, 650));
  return { t0, t1: bubble.style.transform, w: bubble.style.width };
});
ok("bubble переехал transform'ом", bubbleMove.t0 !== bubbleMove.t1 && /translateX/.test(bubbleMove.t1), `${bubbleMove.t0} → ${bubbleMove.t1}`);
await page.locator(".pill-shell .pill-item").nth(0).click();
await page.waitForTimeout(500);

console.log("\n— 3. Search Mode: панель скрыта ПОЛНОСТЬЮ (P1.13) —");
await page.locator(".pill-search").click();
await page.waitForTimeout(350);
const searchMode = await page.evaluate(() => {
  const nav = document.querySelector(".pill-nav");
  return {
    display: getComputedStyle(nav).display,
    popOpen: document.querySelector(".search-pop")?.classList.contains("is-open"),
  };
});
ok("карточка поиска открыта", searchMode.popOpen);
ok("панель display:none в search mode", searchMode.display === "none", searchMode.display);

console.log("\n— 4. Клавиатура: панель скрыта, возврат на ту же координату (P0.3/1.14) —");
/* Android-эмуляция resizes-content: фокус в поле + сжатие layout-viewport. */
await page.locator('input[data-search-input]').first().focus({ preventScroll: true });
await page.setViewportSize({ width: 390, height: 420 });
await page.waitForTimeout(500);
const kbState = await page.evaluate(() => {
  const nav = document.querySelector(".pill-nav");
  return {
    kbOpen: document.documentElement.classList.contains("kb-open"),
    navDisplay: nav ? getComputedStyle(nav).display : "absent",
    kbH: document.documentElement.style.getPropertyValue("--kb-h"),
  };
});
ok("класс kb-open выставлен (детект клавиатуры)", kbState.kbOpen);
ok("панель скрыта при клавиатуре (display:none)", kbState.navDisplay === "none", kbState.navDisplay);
ok("--kb-h выставлена", /(\d{2,})px/.test(kbState.kbH), kbState.kbH);
/* Возврат: клавиатура закрыта (blur + размер обратно) — панель на прежнем месте */
await page.evaluate(() => document.activeElement?.blur());
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(500);
const kbOff = await page.evaluate(() => ({
  kbOpen: document.documentElement.classList.contains("kb-open"),
}));
ok("kb-open снят после закрытия клавиатуры", !kbOff.kbOpen);
/* Закрываем карточку — search mode выключается, панель возвращается */
await page.locator(".search-pop-close").click();
await page.waitForTimeout(350);
const navBack = await page.evaluate(() => {
  const nav = document.querySelector(".pill-nav");
  return {
    display: getComputedStyle(nav).display,
    top: Math.round(nav.getBoundingClientRect().top),
    transform: getComputedStyle(nav).transform,
  };
});
ok("панель снова видима после выхода из search mode", navBack.display !== "none");
ok("панель вернулась на ТУ ЖЕ координату (Y==Y до клавиатуры)", navBack.top === y1, `${y1} vs ${navBack.top}`);
ok("панель без transform-сдвигов (никогда не двигается)", navBack.transform === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(navBack.transform), navBack.transform);

console.log("\n— 5. Карточка поиска поднята над клавиатурой —");
await page.locator(".pill-search").click();
await page.waitForTimeout(300);
const b0 = await page.locator(".search-pop").evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
await page.locator('input[data-search-input]').first().focus({ preventScroll: true });
await page.setViewportSize({ width: 390, height: 420 });
await page.waitForTimeout(500);
const b1 = await page.locator(".search-pop").evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
ok("карточка над клавиатурой (bottom поднялся)", b1 < b0, `${b0} → ${b1}`);
await page.evaluate(() => document.activeElement?.blur());
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(400);
await page.locator(".search-pop-close").click();
await page.waitForTimeout(300);

console.log("\n— 6. Photo Viewer (PhotoSwipe): мобильный — тач-режим —");
const productId = await page.evaluate(async () => {
  const r = await fetch("/api/catalog");
  const j = await r.json();
  const item = (j.items ?? []).find((p) => p.photos && p.photos.length > 0);
  return item ? item.id : null;
});
ok("найден товар с фото", Boolean(productId));
await page.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await page.waitForTimeout(1100);
const photoFrames = page.locator(".photo-frame");
ok("фотолента товара отрисована", (await photoFrames.count()) > 0);
await page.evaluate(() => window.scrollTo(0, 120));
const scrollBefore = await page.evaluate(() => window.scrollY);
await photoFrames.first().click();
await page.waitForTimeout(800);
ok("pswp открылся", await page.locator(".pswp").isVisible());
const pswpMobile = await page.evaluate(() => {
  const pswp = document.querySelector(".pswp");
  const zoomBtns = document.querySelectorAll(".pswp__button--zoom").length;
  const minusPlus = [...document.querySelectorAll(".pswp__button")].filter((b) =>
    /[−+]/.test(b.getAttribute("aria-label") || "")
  ).length;
  return {
    zoomBtns,
    minusPlus,
    counter: document.querySelector(".pswp__counter")?.textContent?.trim(),
    actionsBtn: Boolean(document.querySelector('button[aria-label="Действия с фотографией"]')),
    pswpZ: getComputedStyle(pswp).zIndex,
    hasMouse: pswp.classList.contains("pswp--has_mouse"),
  };
});
ok("тач-режим (pswp не считает устройство мышью)", !pswpMobile.hasMouse);
ok("счётчик «1 / N»", /^\d+ \/ \d+$/.test(pswpMobile.counter || ""), pswpMobile.counter);
ok("НИ ОДНОЙ кнопки зума на таче (P0.8)", pswpMobile.zoomBtns === 0 && pswpMobile.minusPlus === 0);
ok("кнопка ⋯ (действия) присутствует (P1.5)", pswpMobile.actionsBtn);
ok("pswp выше всей навигации приложения (z-шкала)", Number(pswpMobile.pswpZ) >= 10000, pswpMobile.pswpZ);

console.log("\n— 7. Zoom API + РЕАЛЬНЫЕ жесты: CDP pinch/pan/swipe (P0.9/0.10) —");
const zoomTest = await page.evaluate(async () => {
  const pswp = window.__pswp;
  if (!pswp) return null;
  const slide = pswp.currSlide;
  pswp.zoomTo(3, { x: 195, y: 300 }, 0);
  await new Promise((r) => setTimeout(r, 120));
  const zAfter = slide.currZoomLevel;
  slide.panTo(99999, 99999);
  await new Promise((r) => setTimeout(r, 120));
  const px = slide.pan.x;
  const py = slide.pan.y;
  const bounds = slide.bounds;
  return { zAfter, px, py, maxX: bounds.max.x, maxY: bounds.max.y, minX: bounds.min.x, minY: bounds.min.y };
});
ok("zoomTo(3) применился (слайд зумибелен при известных пропорциях)", zoomTest && Math.abs(zoomTest.zAfter - 3) < 0.01, zoomTest && String(zoomTest?.zAfter));
ok("pan жёстко ограничен границами (не утащить за viewport)",
  zoomTest && zoomTest.px >= Math.min(zoomTest.minX, zoomTest.maxX) - 1 && zoomTest.px <= Math.max(zoomTest.minX, zoomTest.maxX) + 1 &&
  zoomTest.py >= Math.min(zoomTest.minY, zoomTest.maxY) - 1 && zoomTest.py <= Math.max(zoomTest.minY, zoomTest.maxY) + 1,
  zoomTest && JSON.stringify({ px: zoomTest.px, minX: zoomTest.minX, maxX: zoomTest.maxX }));
await page.evaluate(() => window.__pswp.zoomTo(1, null, 0));
await page.waitForTimeout(200);

/* РЕАЛЬНЫЙ PINCH двумя пальцами через CDP (эмуляция iPhone) */
const cdp = await context.newCDPSession(page);
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: 150, y: 380 }, { x: 250, y: 380 }],
});
for (let step = 1; step <= 6; step++) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 150 - step * 18, y: 380 },
      { x: 250 + step * 18, y: 380 },
    ],
  });
  await page.waitForTimeout(40);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(400);
const pinchZoom = await page.evaluate(() => window.__pswp?.currSlide?.currZoomLevel ?? 0);
ok("pinch двумя пальцами зумит (следует за пальцами)", pinchZoom > 1.3, String(pinchZoom));

/* РЕАЛЬНЫЙ PAN одним пальцем в зуме: фото двигается, но в границах */
const panBefore = await page.evaluate(() => window.__pswp.currSlide.pan.x);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
for (let step = 1; step <= 8; step++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195 + step * 30, y: 380 }] });
  await page.waitForTimeout(30);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(400);
const panState = await page.evaluate(() => {
  const s = window.__pswp.currSlide;
  return { panX: s.pan.x, maxX: s.bounds.max.x, minX: s.bounds.min.x, zoom: s.currZoomLevel };
});
ok("pan одним пальцем в зуме: фото двигается за пальцем", panState.panX !== panBefore || Math.abs(panState.maxX) < 1, `${panBefore} → ${panState.panX}`);
ok("pan в границах после жеста (P0.9)", panState.panX >= Math.min(panState.minX, panState.maxX) - 1 && panState.panX <= Math.max(panState.minX, panState.maxX) + 1, JSON.stringify(panState));

/* Смена фото во время pinch ЗАПРЕЩЕНА (P0.10): pinch не листает */
const cntPinch = await page.locator(".pswp__counter").innerText();
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: 120, y: 380 }, { x: 260, y: 380 }],
});
for (let step = 1; step <= 5; step++) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 120 - step * 25, y: 380 },
      { x: 260 + step * 25, y: 380 },
    ],
  });
  await page.waitForTimeout(35);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(400);
const cntPinchAfter = await page.locator(".pswp__counter").innerText();
ok("pinch НЕ листает фотографии (P0.10)", cntPinch === cntPinchAfter, `${cntPinch} vs ${cntPinchAfter}`);

/* Сброс зума двойным тапом: два быстрых касания одной точкой.
   «1x» в pswp = zoomLevels.initial (fit относительно натурального размера). */
await page.evaluate(() => window.__pswp.zoomTo(window.__pswp.currSlide.zoomLevels.initial, null, 0));
await page.waitForTimeout(600);
await page.waitForFunction(() => Math.abs((window.__pswp?.currSlide?.currZoomLevel ?? 1) - (window.__pswp?.currSlide?.zoomLevels?.initial ?? 1)) < 0.02);
const doubleTap = async () => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(70);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 380 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(650);
};
await doubleTap();
const dblTapZoom = await page.evaluate(() => window.__pswp?.currSlide?.currZoomLevel ?? 0);
ok("double tap зумит к ~2.5x (P0.9)", dblTapZoom > 1.8 && dblTapZoom < 4, String(dblTapZoom));
await page.waitForFunction(() => Math.abs((window.__pswp?.currSlide?.currZoomLevel ?? 0) - 2.5) < 0.1, null, { timeout: 3000 }).catch(() => {});
await doubleTap();
const dblTapBack = await page.evaluate(() => window.__pswp?.currSlide?.currZoomLevel ?? 0);
const fitLevel = await page.evaluate(() => window.__pswp?.currSlide?.zoomLevels?.initial ?? 1);
ok("повторный double tap вернул к fit (1x)", Math.abs(dblTapBack - fitLevel) < 0.05, `${dblTapBack} vs fit=${fitLevel}`);
await page.waitForFunction(
  (fit) => Math.abs((window.__pswp?.currSlide?.currZoomLevel ?? 1) - fit) < 0.05,
  fitLevel,
  { timeout: 3000 }
).catch(() => {});

/* СВАЙП при 1x листает (P0.10) */
const cntSwipe = await page.locator(".pswp__counter").innerText();
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y: 380 }] });
for (let step = 1; step <= 6; step++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 300 - step * 45, y: 380 }] });
  await page.waitForTimeout(25);
}
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(500);
const cntSwipeAfter = await page.locator(".pswp__counter").innerText();
ok("горизонтальный свайп при 1x листает", cntSwipe !== cntSwipeAfter, `${cntSwipe} → ${cntSwipeAfter}`);

console.log("\n— 8. Листание: клавиши ←/→, счётчик меняется (P0.10) —");
const cnt1 = await page.locator(".pswp__counter").innerText();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
const cnt2 = await page.locator(".pswp__counter").innerText();
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(400);
const cnt3 = await page.locator(".pswp__counter").innerText();
ok("→ перелистнула, ← вернула", cnt1 === cnt3 && cnt1 !== cnt2, `${cnt1} → ${cnt2} → ${cnt3}`);

console.log("\n— 9. Preload: только current ± 1 (P0.13) —");
const optLoaded = await page.evaluate(
  () => performance.getEntriesByType("resource").filter((r) => r.name.includes("/uploads/optimized/")).length
);
ok("optimized-версий загружено ≤ 3 (не 30–100)", optLoaded <= 3, String(optLoaded));
const thumbsLoaded = await page.evaluate(
  () => performance.getEntriesByType("resource").filter((r) => r.name.includes("/uploads/thumbs/")).length
);
ok("thumb отдаётся мгновенно (загружены)", thumbsLoaded >= 1, String(thumbsLoaded));

console.log("\n— 10. Action sheet ⋯: пункты, Esc-приоритет (P1.2/1.5) —");
await page.locator('button[aria-label="Действия с фотографией"]').click();
await page.waitForTimeout(450);
ok("sheet открылся", await page.locator(".viewer-sheet").isVisible());
ok("«Скачать фото» есть (P1.4: Save отдельно от Share)", await page.locator(".viewer-sheet-row", { hasText: "Скачать фото" }).count() > 0);
ok("«Скопировать ссылку» есть", await page.locator(".viewer-sheet-row", { hasText: "Скопировать ссылку" }).count() > 0);
ok("«Открыть оригинал» есть", await page.locator(".viewer-sheet-row", { hasText: "Открыть оригинал" }).count() > 0);
const sheetZ = await page.locator(".viewer-sheet-backdrop").evaluate((el) => Number(getComputedStyle(el).zIndex));
ok("sheet выше корня pswp", sheetZ >= Number(pswpMobile.pswpZ), String(sheetZ));
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelectorAll(".viewer-sheet").length === 0, null, { timeout: 4000 });
ok("Esc закрыл только sheet, viewer жив", (await page.locator(".viewer-sheet").count()) === 0 && (await page.locator(".pswp").count()) === 1);
/* Закрытие тапом по фону (вне sheet): сначала открываем sheet снова */
await page.locator('button[aria-label="Действия с фотографией"]').click();
await page.waitForFunction(() => document.querySelectorAll(".viewer-sheet").length === 1, null, { timeout: 4000 });
await page.locator(".viewer-sheet-backdrop").click({ position: { x: 12, y: 12 } });
await page.waitForFunction(() => document.querySelectorAll(".viewer-sheet").length === 0, null, { timeout: 4000 });
ok("тап по фону закрыл sheet", (await page.locator(".viewer-sheet").count()) === 0);
/* Повторное открытие ⋯ + «Отмена» (проверка стабильности повторного открытия) */
await page.locator('button[aria-label="Действия с фотографией"]').click();
await page.waitForFunction(() => document.querySelectorAll(".viewer-sheet").length === 1, null, { timeout: 4000 });
await page.locator(".viewer-sheet-cancel").click();
await page.waitForFunction(() => document.querySelectorAll(".viewer-sheet").length === 0, null, { timeout: 4000 });
ok("«Отмена» закрыла sheet", (await page.locator(".viewer-sheet").count()) === 0);

console.log("\n— 11. Lifecycle: 30 циклов open/close без деградации (P0.6) —");
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".pswp"), null, { timeout: 4000 });
let cycleFails = 0;
for (let i = 0; i < 30; i++) {
  try {
    await photoFrames.first().click({ timeout: 4000 });
    await page.waitForSelector(".pswp", { timeout: 4000 });
    // Esc во время fade-in может игнорироваться pswp — ретраим до фактического закрытия
    let closed = false;
    for (let t = 0; t < 3 && !closed; t++) {
      await page.keyboard.press("Escape");
      try {
        await page.waitForFunction(() => !document.querySelector(".pswp"), null, { timeout: 1500 });
        closed = true;
      } catch {}
    }
    if (!closed) cycleFails++;
  } catch {
    cycleFails++;
  }
}
ok("30× open/close — viewer каждый раз открывался и закрывался", cycleFails === 0, `${cycleFails} сбоев`);
const afterCycles = await page.evaluate(() => ({
  pswpNodes: document.querySelectorAll(".pswp").length,
  bodyOverflow: document.body.style.overflow,
  scrollY: Math.round(window.scrollY),
}));
ok("нет зависших .pswp-нод в DOM", afterCycles.pswpNodes === 0);
ok("body scroll восстановлен (не остался overflow:hidden)", afterCycles.bodyOverflow === "", afterCycles.bodyOverflow);
ok("скролл каталога на месте (P1.9)", Math.abs(afterCycles.scrollY - scrollBefore) < 8, `${scrollBefore} → ${afterCycles.scrollY}`);

console.log("\n— 12. Android Back: viewer закрывается, товар остаётся (P1.8/история) —");
await photoFrames.first().click();
await page.waitForTimeout(600);
await page.goBack();
await page.waitForTimeout(700);
const backState = await page.evaluate(() => ({
  pswp: document.querySelectorAll(".pswp").length,
  productOpen: Boolean(window.__portal.getState().productId),
}));
ok("Back закрыл viewer", backState.pswp === 0);
ok("товар остался открытым (Back вышел из viewer, не из товара)", backState.productOpen);
await page.evaluate(() => window.__portal.getState().closeProduct());
await page.waitForTimeout(400);

console.log("\n— 13. Desktop viewer: zoom-кнопка, wheel, double-click —");
/* ОТДЕЛЬНЫЙ десктоп-контекст (pointer:fine — не тач) */
const dctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const dpage = await dctx.newPage();
dpage.on("pageerror", (e) => consoleErrors.push(String(e)));
await dpage.goto(BASE, { waitUntil: "networkidle" });
await dpage.waitForTimeout(1200);
await dpage.evaluate((id) => window.__portal.getState().openProduct(id, "catalog"), productId);
await dpage.waitForTimeout(1000);
await dpage.locator(".photo-frame").first().click();
await dpage.waitForTimeout(900);
const desktopZoomBtn = await dpage.locator(".pswp__button--zoom").count();
ok("на десктопе zoom-кнопка ЕСТЬ (desktop-паттерн разрешён)", desktopZoomBtn === 1);
await dpage.locator(".pswp__img").first().hover();
await dpage.mouse.wheel(0, -500);
await dpage.waitForTimeout(350);
const wheelZoom = await dpage.evaluate(() => window.__pswp?.currSlide?.currZoomLevel ?? 0);
ok("wheel зумит (страница под ним не скроллится)", wheelZoom > 1.2, String(wheelZoom));
await dpage.evaluate(() => window.__pswp.zoomTo(1, null, 0));
await dpage.waitForTimeout(200);
await dpage.locator(".pswp__img").first().dblclick();
await dpage.waitForTimeout(500);
const dblZoom = await dpage.evaluate(() => window.__pswp?.currSlide?.currZoomLevel ?? 0);
ok("double click зумит к ~2.5x", dblZoom > 1.8 && dblZoom < 4, String(dblZoom));
await dpage.keyboard.press("Escape");
await dpage.waitForTimeout(500);
ok("Esc закрыл desktop viewer", (await dpage.locator(".pswp").count()) === 0);
await dctx.close();

console.log("\n— 14. Токены P0.5/P1.10/P2.3/P2.4 —");
const tokens = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    sat: cs.getPropertyValue("--sat").trim(),
    sab: cs.getPropertyValue("--sab").trim(),
    glassBlur: cs.getPropertyValue("--glass-blur").trim(),
    glassSat: cs.getPropertyValue("--glass-saturation").trim(),
    glassShadow: cs.getPropertyValue("--glass-shadow").trim(),
    zNav: cs.getPropertyValue("--z-nav").trim(),
    zViewer: cs.getPropertyValue("--z-photo-viewer").trim(),
    envCount: document.body.style.padding.includes("env(") ? "body-raw" : "clean",
  };
});
ok("safe-area токены заданы и резолвятся (--sat/--sab; env() → 0px вне выемки)",
  tokens.sat.length > 0 && tokens.sab.length > 0, `${tokens.sat} / ${tokens.sab}`);
ok("glass-токены заданы (blur/saturation/shadow)", tokens.glassBlur !== "" && tokens.glassSat !== "" && tokens.glassShadow !== "");
ok("z-шкала задана (--z-nav/--z-photo-viewer)", tokens.zNav !== "" && tokens.zViewer !== "");

console.log("\n— 15. Консоль —");
const realErrors = consoleErrors.filter(
  (e) => !/favicon|Download the React DevTools|Autofocus processing/i.test(e)
);
ok("консоль без ошибок за весь прогон", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(400);
await page.screenshot({ path: "tool-results/v31-final-mobile.png" });

await browser.close();
console.log(`\n══════ ИТОГ v3.1: ${passed} ok, ${failed} fail ══════`);
if (failed > 0) {
  console.log("Провалены:", errors.join(" | "));
  process.exit(1);
}
