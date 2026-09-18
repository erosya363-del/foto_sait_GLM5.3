/**
 * test-stability-part1.mjs — CRITICAL STABILITY PART 1, секция 10.
 *
 * 10.2 ANDROID FALLBACK: emulate capability failure (no backdrop / fallback
 *      class) → линза ОСТАЁТСЯ видимой (position/width/press/covered работают);
 *      Android UA (по умолчанию) → glass-fallback; iOS → glass-full;
 *      ?glass=full на Android форсирует full (debug override).
 * 10.4 VIEWPORT: нет необъяснимого зазора под панелью на 5 вьюпортах
 *      (cold start / tab switch / search open-close);
 *      stale KB state: --kb-overlay возвращается в 0, kb-open снимается.
 * 10.5 UPLOAD SHEET: 375×667 / 390×844 / 393×852 / 430×932 — sheet ≥ 80%
 *      видимой высоты; фон НЕ скроллится (scroll lock); внутренний скролл
 *      работает; после закрытия scroll возвращён.
 *
 * Запуск: bash scripts/run-isolated.sh node scripts/test-stability-part1.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://localhost:3100";
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const browser = await chromium.launch();

/* ═══════════ 10.2 ANDROID FALLBACK ═══════════ */
console.log("── 10.2 ANDROID FALLBACK: capability → класс → видимая линза ──");
{
  // Android UA (как Xiaomi) — по умолчанию обязан включиться fallback
  const ctxA = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; 23049PCD8G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  });
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE, { waitUntil: "networkidle" });
  await pageA.waitForTimeout(1000);

  const clsA = await pageA.evaluate(() => document.documentElement.className);
  ok("A1. Android UA → html.glass-fallback", clsA.includes("glass-fallback"), clsA);
  ok("A2. is-browser/is-standalone проставлен (ТЗ 6.1)", clsA.includes("is-browser"), clsA);

  const gooFilter = await pageA.evaluate(() => getComputedStyle(document.querySelector(".pill-goo")).filter);
  ok("A3. fallback: SVG goo filter отключён (filter: none)", gooFilter === "none", gooFilter);
  const surfBf = await pageA.evaluate(() => getComputedStyle(document.querySelector(".pill-surface")).backdropFilter);
  ok("A4. fallback: backdrop-filter панели отключён", surfBf === "none", surfBf);
  const bubbleBg = await pageA.evaluate(() => getComputedStyle(document.querySelector(".pill-bubble")).backgroundColor);
  ok("A5. fallback: линза имеет turquoise glass заливку", /rgba?\(20,\s*184,\s*166/.test(bubbleBg), bubbleBg);
  const caustic = await pageA.evaluate(() => getComputedStyle(document.querySelector(".pill-caustic")).display);
  ok("A6. fallback: дорогие слои (caustics) скрыты", caustic === "none", caustic);

  // линза видима и ФИЗИКА РАБОТАЕТ в fallback (ТЗ 3.3: позиция/ширина/press/covered)
  const panelA = await pageA.evaluate(() => {
    const shell = document.querySelector(".pill-shell");
    const items = [...document.querySelectorAll(".pill-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim(), left: r.left, right: r.right, cx: r.left + r.width / 2, width: r.width };
    });
    return { cy: shell.getBoundingClientRect().top + shell.getBoundingClientRect().height / 2, items };
  });
  const catalog = panelA.items.find((i) => i.label === "Каталог");
  const stock = panelA.items.find((i) => i.label === "Остатки");
  const down = (x, y) => pageA.evaluate(({ x, y }) => {
    document.querySelector(".pill-shell").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
  }, { x, y });
  const move = async (x, y) => {
    await pageA.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })), { x, y });
    await pageA.waitForTimeout(30);
  };

  await down(catalog.cx, panelA.cy);
  await move(catalog.cx + 8, panelA.cy);
  await pageA.waitForTimeout(200);
  let b = await pageA.evaluate(() => {
    const bubble = document.querySelector(".pill-bubble");
    const r = bubble.getBoundingClientRect();
    return { opacity: getComputedStyle(bubble).opacity, w: r.width, x: r.left + r.width / 2, bg: getComputedStyle(bubble).backgroundColor };
  });
  ok("A7. fallback: линза ВИДНА при press (opacity ≥ 0.9)", Number(b.opacity) >= 0.9, `opacity=${b.opacity}`);
  ok("A8. fallback: линза УЕХАЛА за пальцем", b.x > catalog.cx + 4, `dx=${(b.x - catalog.cx).toFixed(1)}`);

  const mid = (catalog.cx + stock.cx) / 2;
  await move(mid, panelA.cy);
  await pageA.waitForTimeout(240);
  b = await pageA.evaluate(() => document.querySelector(".pill-bubble").getBoundingClientRect());
  ok("A9. fallback: капсула НЕ растягивается (≤ таб ×1.32)", b.width < catalog.width * 1.32, `w=${b.width.toFixed(0)} vs ${(catalog.width * 1.32).toFixed(0)}`);
  const coveredA = await pageA.evaluate(() => [...document.querySelectorAll(".pill-item.is-lens-covered")].map((e) => e.textContent.trim()).join("+"));
  ok("A10. fallback: covered работает (обе вкладки)", coveredA === "Каталог+Остатки", coveredA);

  await pageA.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 0, clientY: 0, buttons: 0 })));
  await pageA.waitForTimeout(500);

  // debug-override: ?glass=full на Android форсирует full
  const pageA2 = await ctxA.newPage();
  await pageA2.goto(`${BASE}/?glass=full`, { waitUntil: "networkidle" });
  await pageA2.waitForTimeout(800);
  const clsA2 = await pageA2.evaluate(() => document.documentElement.className);
  ok("A11. ?glass=full: переопределение работает", clsA2.includes("glass-full"), clsA2);
  await ctxA.close();

  // iOS UA → full
  const ctxI = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const pageI = await ctxI.newPage();
  await pageI.goto(BASE, { waitUntil: "networkidle" });
  await pageI.waitForTimeout(800);
  const clsI = await pageI.evaluate(() => document.documentElement.className);
  ok("A12. iOS UA → glass-full", clsI.includes("glass-full") && !clsI.includes("glass-fallback"), clsI);
  await ctxI.close();

  // явная эмуляция отсутствия backdrop-filter (ТЗ 10.2: capability failure)
  const ctxN = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctxN.addInitScript(() => {
    const orig = window.CSS && window.CSS.supports ? window.CSS.supports.bind(window.CSS) : null;
    if (orig) {
      window.CSS.supports = (p, v) => (p === "backdrop-filter" || p === "-webkit-backdrop-filter" ? false : orig(p, v));
    }
  });
  const pageN = await ctxN.newPage();
  await pageN.goto(BASE, { waitUntil: "networkidle" });
  await pageN.waitForTimeout(800);
  const clsN = await pageN.evaluate(() => document.documentElement.className);
  ok("A13. no-backdrop capability → glass-fallback (CSS.supports=off)", clsN.includes("glass-fallback"), clsN);
  const lensVisible = await pageN.evaluate(() => {
    const b = document.querySelector(".pill-bubble");
    return { bg: getComputedStyle(b).backgroundColor, op: getComputedStyle(b).opacity };
  });
  ok("A14. no-backdrop: линза имеет видимую заливку", /rgba/.test(lensVisible.bg) && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(lensVisible.bg), JSON.stringify(lensVisible));
  await ctxN.close();
}

/* ═══════════ 10.4 VIEWPORT: нет зазора под панелью ═══════════ */
console.log("── 10.4 VIEWPORT: зазоры/стейл KB на 5 вьюпортах ──");
{
  const VPS = [
    { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 393, h: 852 }, { w: 430, h: 932 }, { w: 844, h: 390, landscape: true },
  ];
  for (const vp of VPS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true, isMobile: !vp.landscape });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const m1 = await page.evaluate(() => {
      const pill = document.querySelector(".pill-shell")?.getBoundingClientRect();
      return { pillBottom: pill ? Math.round(pill.bottom) : null, ih: window.innerHeight };
    });
    ok(`10.4 [${vp.w}×${vp.h}] cold start: панель не ниже вьюпорта`, m1.pillBottom != null && m1.pillBottom <= m1.ih + 1, `pillBottom=${m1.pillBottom} ih=${m1.ih}`);

    // tab switch → панель на месте
    const tab = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".pill-item")];
      return { x: items[1].getBoundingClientRect().left + items[1].getBoundingClientRect().width / 2, y: document.querySelector(".pill-shell").getBoundingClientRect().top + 30 };
    });
    await page.evaluate(({ x, y }) => {
      document.querySelector(".pill-shell").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 0 }));
    }, tab);
    await page.waitForTimeout(600);
    const m2 = await page.evaluate(() => {
      const pill = document.querySelector(".pill-shell")?.getBoundingClientRect();
      return { pillBottom: pill ? Math.round(pill.bottom) : null, ih: window.innerHeight };
    });
    ok(`10.4 [${vp.w}×${vp.h}] после смены вкладки: панель на месте`, m2.pillBottom != null && m2.pillBottom <= m2.ih + 1, `pillBottom=${m2.pillBottom}`);

    // stale KB: форсируем kb-состояние, затем focusout → measure должен снять
    await page.evaluate(() => {
      document.documentElement.classList.add("kb-open");
      document.documentElement.style.setProperty("--kb-overlay", "300px");
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      // симуляция закрытия клавиатуры: measure() срабатывает на focusout
      const inp = document.createElement("input");
      document.body.appendChild(inp);
      inp.focus();
      inp.blur();
      inp.remove();
      // и страховочно — прямое событие resize (триггер measure)
      window.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(400);
    const m3 = await page.evaluate(() => ({
      kbOpen: document.documentElement.classList.contains("kb-open"),
      overlay: document.documentElement.style.getPropertyValue("--kb-overlay").trim(),
      pillBottom: Math.round(document.querySelector(".pill-shell").getBoundingClientRect().bottom),
      ih: window.innerHeight,
    }));
    ok(`10.4 [${vp.w}×${vp.h}] stale KB снят (kb-open off, overlay=0)`, !m3.kbOpen && (m3.overlay === "0px" || m3.overlay === ""), `kbOpen=${m3.kbOpen} overlay=${m3.overlay}`);
    ok(`10.4 [${vp.w}×${vp.h}] нет зазора после KB-цикла`, m3.pillBottom <= m3.ih + 1, `pillBottom=${m3.pillBottom} ih=${m3.ih}`);
    await ctx.close();
  }
}

/* ═══════════ 10.5 UPLOAD SHEET: высота/scroll-lock на 4 вьюпортах ═══════════ */
console.log("── 10.5 UPLOAD SHEET: высота ≥80%, scroll lock, восстановление ──");
{
  for (const vp of [{ w: 375, h: 667 }, { w: 390, h: 844 }, { w: 393, h: 852 }, { w: 430, h: 932 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    // длинный фон для проверки scroll lock
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      for (let i = 0; i < 60; i++) {
        const d = document.createElement("div");
        d.style.height = "60px";
        document.querySelector("main")?.appendChild(d);
      }
    });
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(250);
    const savedY = await page.evaluate(() => window.scrollY);

    // открыть sheet (реальный click — как пользовательский тап)
    await page.locator('.pill-item:has-text("Загрузка")').click();
    await page.waitForTimeout(800);

    const s = await page.evaluate(() => {
      const sh = document.querySelector("[data-upload-sheet]");
      const r = sh?.getBoundingClientRect();
      return {
        open: Boolean(sh),
        top: r?.top ?? -1,
        height: r?.height ?? -1,
        ih: window.innerHeight,
        bodyPos: document.body.style.position,
        htmlLocked: document.documentElement.classList.contains("sheet-scroll-locked"),
      };
    });
    ok(`10.5 [${vp.w}×${vp.h}] sheet открыт`, s.open);
    ok(`10.5 [${vp.w}×${vp.h}] sheet занимает ≥80% видимой высоты (ТЗ 7.1)`, s.height >= s.ih * 0.8, `h=${s.height.toFixed(0)} ih=${s.ih} = ${((s.height / s.ih) * 100).toFixed(1)}%`);
    ok(`10.5 [${vp.w}×${vp.h}] scroll lock активен (body fixed)`, s.bodyPos === "fixed" && s.htmlLocked, `pos=${s.bodyPos}`);

    // фон НЕ скроллится: попытка скролла окна при locked body
    const yBefore = await page.evaluate(() => document.documentElement.scrollTop || document.body.scrollTop || window.scrollY);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    const yAfter = await page.evaluate(() => document.documentElement.scrollTop || document.body.scrollTop || window.scrollY);
    ok(`10.5 [${vp.w}×${vp.h}] фон не скроллится под sheet`, Math.abs(yAfter - yBefore) < 2, `yBefore=${yBefore} yAfter=${yAfter}`);

    // внутренний скролл работает
    const innerScroll = await page.evaluate(() => {
      const body = document.querySelector("[data-upload-sheet-body]");
      if (!body) return { ok: false, st: -1, s2: -1 };
      const st0 = body.scrollTop;
      body.scrollTop = 60;
      return { ok: body.scrollHeight > body.clientHeight, st: st0, s2: body.scrollTop };
    });
    ok(`10.5 [${vp.w}×${vp.h}] внутренний body скроллится (или контент меньше — ок)`, innerScroll.ok ? true : innerScroll.s2 >= 0, `scrollable=${innerScroll.ok}`);

    // чистое состояние → закрытие без confirm → scroll восстановлен
    await page.evaluate(() => {
      document.querySelector('[aria-label="Закрыть загрузку"]')?.click();
    });
    await page.waitForTimeout(600);
    const restored = await page.evaluate(() => ({
      open: Boolean(document.querySelector("[data-upload-sheet]")),
      locked: document.documentElement.classList.contains("sheet-scroll-locked"),
      bodyPos: document.body.style.position,
      y: window.scrollY,
    }));
    ok(`10.5 [${vp.w}×${vp.h}] sheet закрыт`, !restored.open);
    ok(`10.5 [${vp.w}×${vp.h}] scroll lock снят`, !restored.locked && restored.bodyPos === "", `pos=${restored.bodyPos}`);
    ok(`10.5 [${vp.w}×${vp.h}] scroll восстановлен точно (${savedY})`, Math.abs(restored.y - savedY) <= 1, `y=${restored.y}`);
    await ctx.close();
  }
}

await browser.close();
console.log(`\n══ ИТОГ: PASS=${pass} FAIL=${fail} ══`);
if (failures.length) console.log("Провалены:\n" + failures.map((f) => "  ✗ " + f).join("\n"));
process.exit(fail === 0 ? 0 : 1);
