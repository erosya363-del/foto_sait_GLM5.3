/**
 * АУДИТ СТАБИЛИЗАЦИИ — этапы 12/13 ТЗ:
 *  — все вьюпорты владельца (мобилка/планшет/десктоп/landscape);
 *  — разделы: Каталог, Остатки, Загрузка, Админ (+ карточка товара, поиск);
 *  — горизонтальный overflow, перекрытия fixed-элементов, консоль/сеть;
 *  — «Остатки»: elementFromPoint-проверка интерактивных элементов (этап 13) +
 *    реальные тапы по переключателям;
 *  — скриншоты мобильных размеров в tool-results/stabilize-shots/.
 *
 * READ-ONLY: данных не меняет, работает на живом сервере (:3000) или E2E_BASE.
 * Запуск: node scripts/stabilize-viewport-audit.mjs [--shots]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = "tool-results/stabilize-shots";

const VIEWPORTS = [
  [320, 568], [360, 640], [375, 667], [390, 844], [393, 852], [412, 915], [430, 932],
  [768, 1024], [820, 1180],
  [1280, 800], [1366, 768], [1440, 900], [1920, 1080],
  [852, 393], [932, 430], // landscape
];
const MOBILE = new Set(["320x568", "360x640", "375x667", "390x844", "393x852", "412x915", "430x932", "852x393", "932x430"]);

const SECTIONS = ["Каталог", "Остатки", "Загрузка", "Админ"];

const browser = await chromium.launch();
const problems = [];
let checked = 0;

function add(vp, section, msg) {
  problems.push({ vp: `${vp[0]}×${vp[1]}`, section, msg });
  console.log(`  ✗ [${vp[0]}×${vp[1]}] ${section}: ${msg}`);
}

async function gotoSection(page, name, vp, hasTouch) {
  // Пилюля (мобилка) активирует пункт на pointerup; линза накрывает активный
  // пункт — тапаем ПО КООРДИНАТАМ. Десктоп (lg≥1024): пилюля скрыта (lg:hidden),
  // навигация через сайдбар.
  for (let attempt = 0; attempt < 3; attempt++) {
    const pillVisible = await page.evaluate(() => {
      const p = document.querySelector("nav.pill-nav");
      return p && getComputedStyle(p).display !== "none";
    });
    if (pillVisible) {
      const btn = page.locator("nav.pill-nav button", { hasText: name }).first();
      const bb = await btn.boundingBox();
      if (!bb) {
        await page.waitForTimeout(500);
        continue;
      }
      const cx = bb.x + bb.width / 2;
      const cy = bb.y + bb.height / 2;
      if (hasTouch) await page.touchscreen.tap(cx, cy);
      else await page.mouse.click(cx, cy);
    } else {
      const side = page.locator("aside button", { hasText: name }).first();
      if (await side.count()) await side.click();
      else {
        await page.waitForTimeout(500);
        continue;
      }
    }
    await page.waitForTimeout(700);
    /* PHASE 2.4: «Загрузка» — glass sheet, а не раздел: шапка не меняется,
       sheet закрываем сразу (чистое состояние), чтобы не блокировать
       следующие секции. */
    const sheetOpen = await page.evaluate(() => Boolean(document.querySelector("[data-upload-sheet]")));
    if (sheetOpen) {
      const title2 = await page.evaluate(() => (document.querySelector("header")?.textContent || "").trim().slice(0, 30));
      await page.click('[aria-label="Закрыть загрузку"]').catch(() => {});
      await page.waitForTimeout(500);
      return Boolean(title2);
    }
    const title = await page.evaluate(() => (document.querySelector("header")?.textContent || "").trim().slice(0, 30));
    if (title.includes(name)) return true;
  }
  if (vp) add(vp, "навигация", `не удалось попасть в «${name}» за 3 попытки`);
  return false;
}

  for (const [w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const failed = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  page.on("requestfailed", (r) => failed.push(`REQFAIL ${r.url().slice(0, 100)}`));

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  for (const section of SECTIONS) {
    if (!(await gotoSection(page, section, [w, h], w < 800))) continue;
    checked++;

    // 1. Горизонтальный overflow документа
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { sw: de.scrollWidth, iw: window.innerWidth, bh: document.body.scrollHeight };
    });
    if (overflow.sw > overflow.iw + 1) {
      add([w, h], section, `horizontal overflow: scrollWidth=${overflow.sw} > viewport=${overflow.iw}`);
    }

    // 2. Скриншоты мобильных
    if (SHOTS && MOBILE.has(`${w}x${h}`)) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, `${w}x${h}-${section}.png`) });
    }

    // 3. «Остатки»: перекрытия интерактивных элементов (этап 13) — только тут тапы
    if (section === "Остатки") {
      // ждём реальные данные склада (первый запрос холодный)
      try {
        await page.locator(".mode-switch").waitFor({ state: "visible", timeout: 12000 });
      } catch {
        add([w, h], section, "переключатель вида не появился за 12с (данные склада не загрузились?)");
      }
      const overlaps = await page.evaluate(() => {
        const out = [];
        const pill = document.querySelector("nav.pill-nav");
        const hidden = (el) => {
          for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0" || cs.pointerEvents === "none") return true;
          }
          return false;
        };
        const els = Array.from(document.querySelectorAll("button, [role=button], a, select, input"));
        for (const el of els) {
          if (hidden(el)) continue; // скрытые элементы не перехватывают тапы — не overlap
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.bottom < 0 || r.top > innerHeight) continue;
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          const top = document.elementFromPoint(cx, cy);
          if (!top) continue;
          const inPill = pill && (pill.contains(el) || pill.contains(top));
          if (inPill) continue;
          if (!el.contains(top) && !top.contains(el)) {
            const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
            const overlay = (top.tagName + "." + String(top.className).split(" ")[0]).slice(0, 40);
            const blocker = top.closest("button, [role=button], a, select, input, label");
            if (blocker && blocker !== el && !el.contains(blocker)) {
              out.push({ label, overlay });
            }
          }
        }
        return out.slice(0, 5);
      });
      for (const o of overlaps) add([w, h], section, `перекрытие: «${o.label}» накрыт «${o.overlay}»`);

      // реальные тапы по переключателю вида (этап 13).
      // «Компактный вид» — режим ПО УМОЛЧАНИЮ: тап по нему не меняет aria-pressed.
      // Проверяем переключение в «Карточки» и обратно.
      const cardsBtn = page.getByRole("button", { name: "Карточки" });
      const compactBtn = page.getByRole("button", { name: "Компактный вид" });
      if ((await cardsBtn.count()) && (await compactBtn.count())) {
        const before = await cardsBtn.getAttribute("aria-pressed");
        await cardsBtn.click();
        await page.waitForTimeout(300);
        const mid = await cardsBtn.getAttribute("aria-pressed");
        if (before === mid) add([w, h], section, "тап «Карточки» не переключил режим (перекрытие?)");
        await compactBtn.click();
        await page.waitForTimeout(300);
        const back = await compactBtn.getAttribute("aria-pressed");
        if (back !== "true") add([w, h], section, "возврат на «Компактный вид» не сработал");
      }
    }

    // 4. Пилюля: видима и в пределах экрана (на десктопе lg≥1024 пилюля скрыта — норма)
    if (w < 1024) {
    const pillBox = await page.evaluate(() => {
      const p = document.querySelector("nav.pill-nav");
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.x, right: r.right, bottom: r.bottom, w: r.width, display: getComputedStyle(p).display };
    });
    if (pillBox) {
      if (pillBox.display === "none") add([w, h], section, "пилюля display:none без клавиатуры");
      else if (pillBox.x < -2 || pillBox.right > w + 2) add([w, h], section, `пилюля за краем: x=${pillBox.x}, right=${pillBox.right}`);
    }
  }
  }

  // 5. Поиск: открыть/ввести/закрыть (на мобильных)
  if (MOBILE.has(`${w}x${h}`)) {
    await gotoSection(page, "Каталог", [w, h], w < 800);
    const searchBtn = page.locator("nav.pill-nav [aria-label*=оиск], nav.pill-nav [title*=оиск]").first();
    if (await searchBtn.count()) {
      await searchBtn.click({ force: true });
      await page.waitForTimeout(500);
      const pop = await page.$(".search-pop.is-open");
      if (!pop) add([w, h], "Поиск", "дропдаун поиска не открылся");
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (sw > w + 1) add([w, h], "Поиск", `overflow при открытом поиске: ${sw}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }

  // 6. Консоль/сеть
  const realErrors = consoleErrors.filter((e) => !/Download the React DevTools/i.test(e));
  if (realErrors.length) add([w, h], "console", `console.error: ${realErrors[0]}${realErrors.length > 1 ? ` (+${realErrors.length - 1})` : ""}`);
  // 404/500 — только неожиданные (нет картинок каталога и пр.)
  const bad = failed.filter((f) => !f.includes("/api/") && !f.includes("favicon"));
  if (bad.length) add([w, h], "network", `сбои: ${bad[0]}${bad.length > 1 ? ` (+${bad.length - 1})` : ""}`);

  await ctx.close();
}

await browser.close();

console.log(`\n═══ Проверено комбинаций: ${checked} (плюс поиск на мобильных) ═══`);
console.log(`Проблем: ${problems.length}`);
if (problems.length) {
  fs.writeFileSync("tool-results/stabilize-audit-problems.json", JSON.stringify(problems, null, 2));
  console.log("Подробности: tool-results/stabilize-audit-problems.json");
  process.exit(1);
}
console.log("✅ Аудит вьюпортов/перекрытий/консоли — без проблем");
