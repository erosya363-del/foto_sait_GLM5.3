/**
 * test-part11-front.mjs — CRITICAL STABILITY PART 1.1, ФРОНТ-КОНТРАКТЫ.
 *
 * §12 LENS: почти прозрачная линза БЕЗ белого прожектора
 *      (brand-тинт + 1px граница; ::after отключён; БЕЗ внешних теней/гало);
 *      sheen ≤ .12 на мобильном, каустики ≤ .2;
 * §13 BROWSER PANEL: CSS-правило компенсации тулбара существует и работает
 *      (--browser-bottom-inset сдвигает .pill-nav на ровно заданный офсет);
 * §14 UPLOAD SHEET KEYBOARD: sheet стоит на bottom:0 (не двигается целиком),
 *      body получает padding-bottom 16+sab+overlay, sticky CTA — над
 *      клавиатурой, header не прыгает.
 *
 * Запуск: bash scripts/run-isolated.sh node scripts/test-part11-front.mjs
 * (headless-контракты; реальное устройство — REAL DEVICE REQUIRED, см. отчёт).
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

/* ═══════════ §12: МАТЕРИАЛ ЛИНЗЫ ═══════════ */
console.log("── §12. Линза: почти прозрачная, БЕЗ белого прожектора ──");
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const dark = await page.evaluate(() => {
    const b = document.querySelector(".pill-bubble");
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, after: getComputedStyle(b, "::after").display };
  });
  ok("12.1 dark: bubble ::after отключён (белый radial убран)", dark?.after === "none", String(dark?.after));
  ok("12.1 dark: лёгкий brand-тинт (alpha 0.035)", /rgba\(20,\s*184,\s*166,\s*0\.035\)/.test(dark?.bg ?? ""), dark?.bg);
  ok(
    "12.1 dark: только 1px внутренняя граница, БЕЗ внешних теней",
    dark?.shadow === "rgba(20, 184, 166, 0.16) 0px 0px 0px 1px inset",
    dark?.shadow
  );

  const light = await page.evaluate(() => {
    document.documentElement.classList.add("light");
    const b = document.querySelector(".pill-bubble");
    const cs = getComputedStyle(b);
    const r = { bg: cs.backgroundColor, shadow: cs.boxShadow, after: getComputedStyle(b, "::after").display };
    document.documentElement.classList.remove("light");
    return r;
  });
  ok("12.1 light: ::after отключён", light.after === "none", light.after);
  ok("12.1 light: лёгкий brand-тинт (alpha ≈ 0.025)", /rgba\(15,\s*118,\s*110,\s*0\.02[0-9]?\)/.test(light.bg), light.bg);
  ok(
    "12.1 light: НЕТ наружной тени 0 4px 14px и белого гало 2.5px (ТЗ «НЕ делать»)",
    !/4px 14px|2\.5px|255,\s*255,\s*255/.test(light.shadow) && /0px 0px 0px 1px inset/.test(light.shadow),
    light.shadow
  );

  /* sheen/каустики панели (§12.2) — мобильный вьюпорт */
  const sheenM = await page.evaluate(() => ({
    sheen: Number(getComputedStyle(document.querySelector(".pill-surface"), "::before").opacity),
    caustic: Number(getComputedStyle(document.querySelector(".pill-caustic")).opacity),
  }));
  ok("12.2 mobile: sheen ≤ .12", sheenM.sheen <= 0.12 + 1e-6, String(sheenM.sheen));
  ok("12.2 mobile: каустики ≤ .2 (максимально сдержанные)", sheenM.caustic <= 0.2 + 1e-6, String(sheenM.caustic));

  /* desktop: sheen чуть заметнее, но сдержан */
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  const sheenD = await page.evaluate(() => Number(getComputedStyle(document.querySelector(".pill-surface"), "::before").opacity));
  ok("12.2 desktop: sheen сдержанный (≤ .45)", sheenD <= 0.45 + 1e-6, String(sheenD));

  await ctx.close();
}

/* ═══════════ §13: БРАУЗЕРНАЯ КОМПЕНСАЦИЯ ПАНЕЛИ ═══════════ */
console.log("── §13. Browser panel: правило + механика --browser-bottom-inset ──");
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const rule = await page.evaluate(() => {
    let found = null;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.selectorText && r.selectorText.includes("is-browser:not(.kb-open)") && r.selectorText.includes(".pill-nav")) {
          found = { sel: r.selectorText, css: r.style.bottom ?? "" };
        }
      }
    }
    return found;
  });
  ok("13.4 правило html.is-browser:not(.kb-open) .pill-nav существует", Boolean(rule), rule?.sel ?? "not found");
  ok("13.4 правило использует var(--browser-bottom-inset)", rule?.css?.includes("--browser-bottom-inset"), rule?.css ?? "");

  const mech = await page.evaluate(() => {
    const docEl = document.documentElement;
    docEl.classList.add("is-browser");
    const nav = document.querySelector(".pill-nav");
    const base = getComputedStyle(nav).bottom;
    docEl.style.setProperty("--browser-bottom-inset", "40px");
    const shifted = getComputedStyle(nav).bottom;
    docEl.style.setProperty("--browser-bottom-inset", "0px");
    const back = getComputedStyle(nav).bottom;
    docEl.style.removeProperty("--browser-bottom-inset");
    docEl.classList.remove("is-browser");
    return { base, shifted, back };
  });
  ok("13.4 inset=0 → bottom = max(10px,sab) = 10px", mech.base === "10px", mech.base);
  ok("13.4 inset=40px → bottom = 50px (компенсация ровно офсетом)", mech.shifted === "50px", mech.shifted);
  ok("13.4 inset=0 → возврат к 10px", mech.back === "10px", mech.back);

  await ctx.close();
}

/* ═══════════ §14: UPLOAD SHEET — КЛАВИАТУРНЫЙ КОНТРАКТ ═══════════ */
console.log("── §14. Upload sheet: якорь bottom:0, клавиатура не двигает sheet ──");
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  // открыть sheet как пользователь: тап по табу «Загрузка»
  const clicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".pill-item")];
    const up = items.find((el) => el.textContent?.trim() === "Загрузка");
    if (!up) return false;
    up.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 800, buttons: 1 }));
    up.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 800, buttons: 0 }));
    up.click();
    return true;
  });
  await page.waitForTimeout(800);
  const open = await page.evaluate(() => Boolean(document.querySelector("[data-upload-sheet]")));
  ok("14 sheet открыт (тап «Загрузка»)", clicked && open);

  const geo = await page.evaluate(() => {
    const sh = document.querySelector("[data-upload-sheet]");
    const r = sh.getBoundingClientRect();
    return {
      inlineBottom: sh.style.bottom,
      gap: window.innerHeight - r.bottom,
      top: r.top,
      heightPct: (r.height / window.innerHeight) * 100,
    };
  });
  ok("14.1 sheet якорь bottom: 0 (inline)", geo.inlineBottom === "0px" || geo.inlineBottom === "0", geo.inlineBottom);
  ok("14.1 низ sheet прижат к вьюпорту (gap ≈ 0)", Math.abs(geo.gap) < 2, `gap=${geo.gap}`);
  ok("14.1 высота ≈ 86dvh (closed keyboard)", geo.heightPct > 80 && geo.heightPct < 92, `${geo.heightPct.toFixed(1)}%`);
  const topBefore = geo.top;

  // клавиатура: контракт — sheet НЕ двигается, body паддинг, CTA над клавиатурой
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--kb-overlay", "300px");
  });
  await page.waitForTimeout(450);
  const kb = await page.evaluate(() => {
    const sh = document.querySelector("[data-upload-sheet]");
    const r = sh.getBoundingClientRect();
    const body = document.querySelector("[data-upload-sheet-body]");
    const footer = body?.querySelector(".sticky") ?? null;
    return {
      gap: window.innerHeight - r.bottom,
      top: r.top,
      bodyPad: body ? parseFloat(getComputedStyle(body).paddingBottom) : -1,
      footerBottom: footer ? getComputedStyle(footer).bottom : null,
    };
  });
  ok("14.2 клавиатура: sheet НЕ поднялся (gap ≈ 0)", Math.abs(kb.gap) < 2, `gap=${kb.gap}`);
  ok("14.2 header НЕ прыгает (top не изменился)", Math.abs(kb.top - topBefore) < 2, `dTop=${Math.abs(kb.top - topBefore).toFixed(1)}`);
  ok("14.2 body padding-bottom = 16+sab+300 ≈ 316px", Math.abs(kb.bodyPad - 316) < 3, `pad=${kb.bodyPad}`);
  ok("14.2 sticky CTA над клавиатурой (bottom=300px)", kb.footerBottom === "300px", String(kb.footerBottom));

  await page.evaluate(() => {
    document.documentElement.style.setProperty("--kb-overlay", "0px");
  });
  await page.waitForTimeout(350);
  await ctx.close();
}

await browser.close();
console.log(`\n═══ part11-front: PASS ${pass} / FAIL ${fail} ═══`);
if (failures.length) console.log("Провалены: " + failures.join(" | "));
process.exit(fail === 0 ? 0 : 1);
