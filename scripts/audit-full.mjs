/**
 * ПОЛНЫЙ АУДИТ ФРОНТЕНДА (ЭТАПЫ 1–6, 14 плана стабилизации).
 * Запуск: node scripts/audit-full.mjs [--quick]
 * Сервер должен отвечать на http://localhost:3000
 *
 * Проверяет:
 *  A. Сплэш: показ при старте, НЕ показ при внутренних переходах, показ при F5
 *  B. Разделы (каталог/остатки/загрузка/админ+табы): console/pageerror/404/битые img/overflow
 *  C. Кнопки: map интерактивных элементов, tap-target, перекрытия (elementFromPoint)
 *  D. Viewports 320→1920 + landscape: горизонтальный overflow, геометрия пилюли
 *  E. Нижняя навигация: единообразие стилей на всех разделах, padding контента
 *  F. Back/history: браузерный Back после дриллдауна/товара
 *  G. Offline: перезагрузка без сети — не белый экран
 *  H. Upload: реальная загрузка 2 фото (прогресс, результат)
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const QUICK = process.argv.includes("--quick");
const out = { startedAt: new Date().toISOString(), findings: [], stats: {} };
let fid = 0;

function add(priority, section, error, cause, effect, solution, risk, evidence = "") {
  out.findings.push({ id: `F-${String(++fid).padStart(3, "0")}`, priority, section, error, cause, effect, solution, risk, evidence });
  console.log(`  [${priority}] ${section}: ${error}${evidence ? " — " + evidence : ""}`);
}

/* ─── Сборщик ошибок страницы ─── */
function wireCollector(page, bucket) {
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") bucket.console.push({ type: t, text: m.text().slice(0, 300) });
  });
  page.on("pageerror", (e) => bucket.pageerrors.push(String(e).slice(0, 300)));
  page.on("requestfailed", (r) => bucket.reqfail.push({ url: r.url().slice(0, 200), err: r.failure()?.errorText?.slice(0, 80) }));
  page.on("response", (r) => { if (r.status() >= 400) bucket.http.push({ url: r.url().slice(0, 200), status: r.status() }); });
}

/* ─── Инспекция DOM: overflow, битые img, кнопки, перекрытия ─── */
const INSPECT = () => {
  const doc = document.documentElement;
  const overflowX = doc.scrollWidth - window.innerWidth;
  const brokenImgs = [...document.querySelectorAll("img")]
    .filter((i) => i.complete && i.naturalWidth === 0 && i.offsetParent !== null)
    .map((i) => i.getAttribute("src")?.slice(0, 120));
  const btns = [...document.querySelectorAll('button, [role="button"], a[href], select, summary, [role="tab"], [role="radio"]')];
  const small = [];
  const overlapped = [];
  const invisible = [];
  for (const el of btns) {
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") continue;
    if (st.pointerEvents === "none") continue; // скрытые по дизайну (fab-top до скролла и т.п.)
    if (parseFloat(st.opacity) < 0.1) continue; // прозрачные (прячутся анимацией)
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40);
    const hasTextOrIcon = (el.textContent?.trim().length ?? 0) > 0 || el.querySelector("svg, img");
    if (!hasTextOrIcon) { invisible.push(label || el.outerHTML.slice(0, 60)); continue; }
    if ((r.width < 40 || r.height < 28) && r.width > 4) small.push(`${label} (${Math.round(r.width)}×${Math.round(r.height)})`);
    // кнопка частично за краем вьюпорта (горизонтальные ленты) — центр может попасть на соседа: скип
    if (r.left < 1 || r.right > window.innerWidth - 1 || r.top < 1 || r.bottom > window.innerHeight - 1) continue;
    // перекрытие: элемент в центре клика не он сам и не потомок/предок
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (top && !el.contains(top) && !top.contains(el) && top !== el) {
      const ts = getComputedStyle(top);
      if (ts.pointerEvents !== "none") {
        // плавающая навигация? проверяем и сам элемент, и предков (лейбл внутри pill-item и т.п.)
        let anc = top, floating = null, depth = 0;
        while (anc && depth < 5) {
          const m = String(anc.className?.baseVal ?? anc.className ?? "").match(/pill-shell|pill-item|pill-nav|nav-lens|search-fab|search-pop|fab-top|header-collapsed/);
          if (m) { floating = m[0]; break; }
          anc = anc.parentElement; depth++;
        }
        overlapped.push({
          btn: label,
          by: `${top.tagName}.${String(top.className?.baseVal ?? top.className).slice(0, 50)}`,
          pos: `${Math.round(cx)},${Math.round(cy)}`,
          floating,
        });
      }
    }
  }
  return { overflowX, brokenImgs, small, overlapped, invisible, btnCount: btns.length };
};

/* ─── Геометрия пилюли ─── */
const PILL = () => {
  const nav = document.querySelector("nav.pill-nav");
  const shell = document.querySelector(".pill-shell");
  const main = document.querySelector("main");
  if (!nav || !shell) return null;
  const ns = getComputedStyle(nav), ss = getComputedStyle(shell);
  const r = shell.getBoundingClientRect();
  return {
    navZ: ns.zIndex, navPos: ns.position, navDisplay: ns.display,
    shellH: Math.round(r.height), shellW: Math.round(r.width), radius: ss.borderRadius,
    bg: ss.backgroundColor, blur: ss.backdropFilter, border: ss.borderColor, shadow: ss.boxShadow.slice(0, 60),
    cls: shell.className,
    bottomInset: ns.bottom,
    mainPadB: main ? getComputedStyle(main).paddingBottom : null,
    winH: window.innerHeight,
  };
};

const browser = await chromium.launch();
const results = { sections: {}, viewports: {}, back: {}, offline: null, upload: null, pillStyles: {} };

/* ═══ PASS A+G+H: мобильный 390×760 — разделы, сплэш, пилюля, upload ═══ */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const bucket = { console: [], pageerrors: [], reqfail: [], http: [] };
  wireCollector(page, bucket);

  console.log("\n══ PASS A: сплэш ══");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const splashAtStart = await page.evaluate(() => !!document.querySelector(".boot-bg"));
  if (!splashAtStart) add("P1", "Сплэш", "стартовая заставка не показана при первом запуске", "BootSplash скрылся раньше замера", "нет индикации загрузки", "проверить тайминги BootSplash", "низкий");
  await page.waitForTimeout(2200);
  const splashGone = await page.evaluate(() => !document.querySelector(".boot-bg"));
  if (!splashGone) add("P1", "Сплэш", "сплэш не исчез за 2.2 c", "зависли таймеры", "блокирует контент", "проверить setDone", "средний");

  // переходы между разделами — сплэш не должен появляться
  const sections = [
    ["catalog", 'nav.pill-nav button:has-text("Каталог")'],
    ["stock", 'nav.pill-nav button:has-text("Остатки")'],
    ["upload", 'nav.pill-nav button:has-text("Загрузка")'],
    ["admin", 'nav.pill-nav button:has-text("Админ")'],
  ];
  let splashReappear = false;
  for (const [name, sel] of sections) {
    await page.click(sel);
    await page.waitForTimeout(650);
    const s = await page.evaluate(() => !!document.querySelector(".boot-bg"));
    if (s) splashReappear = true;
  }
  if (splashReappear) add("P0", "Сплэш", "сплэш появляется при внутренних переходах", "BootSplash ремоунтится при смене view", "заставка мешает навигации", "вынести выше / гейт по restored", "средний");
  else console.log("  ✓ сплэш не появляется при внутренних переходах");

  // F5 → сплэш снова (это норма — настоящий старт)
  await page.reload({ waitUntil: "domcontentloaded" });
  const splashOnReload = await page.evaluate(() => !!document.querySelector(".boot-bg"));
  console.log(`  ${splashOnReload ? "✓" : "(i)"} сплэш на F5: ${splashOnReload}`);
  await page.waitForTimeout(2200);

  console.log("\n══ PASS B: разделы (390 mobile) ══");
  for (const [name, sel] of sections) {
    await page.click(sel);
    await page.waitForTimeout(900);
    // админ: открыть все табы
    const tabs = ["products", "fabrics", "dicts", "photos"];
    for (const t of (name === "admin" ? tabs : [])) {
      await page.click(`[role="tab"]:has-text(${JSON.stringify(t === "dicts" ? "Справочники" : t === "photos" ? "Фото" : t === "fabrics" ? "Ткани" : "Товары")})`);
      await page.waitForTimeout(500);
    }
    const ins = await page.evaluate(INSPECT);
    results.sections[name] = ins;
    if (ins.overflowX > 1) add("P0", `Раздел ${name}`, `горизонтальный overflow ${ins.overflowX}px`, "широкий элемент без min-w-0/overflow", "сдвиг вёрстки, горизонтальный скролл", "найти виновника (listing ниже)", "средний");
    if (ins.brokenImgs.length) add("P0", `Раздел ${name}`, `битые изображения: ${ins.brokenImgs.join(", ")}`, "404/файл отсутствует", "пустые квадраты вместо фото", "починить источник/путь", "низкий");
    ins.overlapped.filter((o) => !o.floating).slice(0, 6).forEach((o) =>
      add("P0", `Раздел ${name}`, `кнопка «${o.btn}» перекрыта → ${o.by} @${o.pos}`, "absolute/fixed слой поверх", "тап не доходит", "снять z/pointer-events виновника", "средний"));
    const floatN = ins.overlapped.filter((o) => o.floating).length;
    if (floatN) console.log(`  (i) ${name}: контент под плавающей навигацией (норма): ${floatN}`);
    if (ins.small.length) console.log(`  (i) ${name}: малые tap-target: ${ins.small.slice(0, 5).join("; ")}`);
  }

  console.log("\n══ PASS E: пилюля на всех разделах ══");
  const pillBySection = {};
  for (const [name, sel] of sections) {
    await page.click(sel);
    await page.waitForTimeout(600);
    pillBySection[name] = await page.evaluate(PILL);
  }
  results.pillStyles.mobile = pillBySection;
  const base = pillBySection.catalog;
  for (const [name, p] of Object.entries(pillBySection)) {
    if (!p) { add("P0", "Нижняя навигация", `пилюля отсутствует на ${name}`, "-", "нет навигации", "-", "-"); continue; }
    if (p.shellH !== base.shellH) add("P1", "Нижняя навигация", `высота пилюли на ${name} = ${p.shellH} ≠ ${base.shellH} на каталоге`, "разные стили на разделах", "панель прыгает", "единый компонент/токены", "низкий");
    // bg сравниваем только при одинаковом состоянии (pill-active/dim меняют прозрачность по дизайну)
    if (p.bg !== base.bg && p.cls === base.cls) add("P1", "Нижняя навигация", `фон пилюли на ${name} отличается при том же состоянии (${p.bg} vs ${base.bg})`, "разные glass-токены", "разная прозрачность на страницах", "единый токен", "низкий");
    if (p.blur !== base.blur) add("P1", "Нижняя навигация", `blur на ${name}: ${p.blur} ≠ ${base.blur}`, "разный backdrop", "разная мутность", "единый токен", "низкий");
  }
  // нижний padding контента
  const needPad = base ? base.shellH + 24 : 88;
  if (base?.mainPadB) {
    const px = parseFloat(base.mainPadB);
    if (px < needPad) add("P1", "Нижняя навигация", `main pb=${base.mainPadB} < пилюля+отступ (${needPad}px)`, "мало нижнего паддинга", "последний элемент под панелью", "увеличить pb", "низкий");
    else console.log(`  ✓ main pb=${base.mainPadB} (≥ ${needPad})`);
  }

  console.log("\n══ PASS F: Back/history — каноничный прогон в отдельном скрипте: node scripts/audit-back.mjs (чистые сессии, 4 сценария) ══");
  // В длинной сессии этого аудита накоплено много записей истории — goBack-трассировка
  // Playwright в таких сессиях ненадёжна, поэтому послойный Back проверяем audit-back.mjs.

  console.log("\n══ PASS G: offline ══");
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1500);
  const off = await page.evaluate(() => ({
    bodyLen: document.body?.innerText?.length ?? 0,
    hasSplash: !!document.querySelector(".boot-bg"),
    title: document.title,
  }));
  results.offline = off;
  if (off.bodyLen < 20 && !off.hasSplash) add("P1", "Offline", "без сети — практически белый экран (и без сплэша)", "статика не кэшируется, SPA падает", "пустой экран при обрыве сети", "offline fallback/минимальный кэш app shell", "средний");
  else console.log(`  (i) offline: bodyLen=${off.bodyLen}, splash=${off.hasSplash}`);
  await ctx.setOffline(false);

  console.log("\n══ PASS H: upload 2 фото ══");
  try {
    await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1400);
    await page.click('nav.pill-nav button:has-text("Загрузка")');
    await page.waitForTimeout(800);
    // реальный JPEG с диска — sharp его примет
    const realImg = "public/catalog/cover-1.jpg";
    await page.setInputFiles('input[type="file"]', [
      { name: "audit-a.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(realImg) },
      { name: "audit-b.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(realImg) },
    ]);
    await page.waitForTimeout(400);
    const previews = await page.locator("text=Выбрано 2 из 10").count();
    // выбрать категорию/модель
    const cats = page.locator("select.field").first();
    const catOptions = await cats.locator("option").allTextContents();
    if (catOptions.length > 1) {
      await cats.selectOption({ index: 1 });
      await page.waitForTimeout(300);
      const modelSel = page.locator("select.field").nth(1);
      const modelOptions = await modelSel.locator("option").count();
      if (modelOptions > 1) {
        await modelSel.selectOption({ index: 1 });
        await page.waitForTimeout(200);
        const submitBtn = page.locator('button:has-text("Загрузить 2 фото")');
        if (await submitBtn.count()) {
          const [resp] = await Promise.all([
            page.waitForResponse((r) => r.url().includes("/api/upload"), { timeout: 20000 }).catch(() => null),
            submitBtn.click(),
          ]);
          await page.waitForTimeout(2500);
          const okScreen = await page.locator('h2:has-text("фото загружено")').count();
          results.upload = { previews: previews > 0, status: resp?.status() ?? null, okScreen: okScreen > 0, body: resp ? await resp.text().catch(() => "") : "" };
          if (resp && resp.status() >= 400) add("P0", "Upload", `POST /api/upload → ${resp.status()}`, "серверная ошибка", "фото не загружаются", "смотреть ответ/логи", "средний");
          else if (okScreen > 0) console.log("  ✓ upload: превью 2/10, ответ 2xx, экран успеха");
          else add("P1", "Upload", "после успешного POST нет экрана результата", "ответ не распознан", "пользователь не видит результат", "проверить обработку ответа", "низкий");
          // двойной тап по submit (кнопка задизейблена?)
          const submitDisabled = await page.locator('button:has-text("Загружаем")').count();
          console.log(`  (i) состояние после: busyBtn=${submitDisabled}`);
        } else add("P1", "Upload", "кнопка «Загрузить 2 фото» не найдена/задизейблена", "валидация не прошла", "нельзя загрузить", "проверить select-ы", "низкий");
      } else add("P1", "Upload", "у выбранной категории нет моделей", "справочники пусты", "загрузка невозможна", "сид справочников", "низкий");
    } else add("P1", "Upload", "справочник категорий пуст", "API /api/dictionaries", "загрузка невозможна", "проверить API", "низкий");
  } catch (e) {
    add("P1", "Upload", `сценарий упал: ${String(e).slice(0, 140)}`, "-", "-", "-", "-");
  }

  bucket.console.filter((c) => c.type === "error").filter((c) => !c.text.includes("ERR_INTERNET_DISCONNECTED")).slice(0, 10).forEach((c) =>
    add("P1", "Консоль (mobile-сессия)", `console.error: ${c.text.slice(0, 160)}`, "-", "-", "-", "-"));
  bucket.pageerrors.slice(0, 8).forEach((e) =>
    add("P0", "Консоль (mobile-сессия)", `необработанная ошибка JS: ${e.slice(0, 160)}`, "-", "-", "-", "-"));
  bucket.http.filter((h) => !h.url.includes("gstatic")).slice(0, 10).forEach((h) =>
    add("P0", "Сеть", `HTTP ${h.status}: ${h.url}`, "-", "-", "-", "-"));
  await ctx.close();
}

/* ═══ PASS D: вьюпорты ═══ */
{
  console.log("\n══ PASS D: вьюпорты ══");
  const vpList = QUICK
    ? [[320, 568], [390, 760], [768, 1024], [1280, 800], [1920, 1080]]
    : [[320, 568], [360, 640], [375, 667], [390, 760], [393, 852], [412, 915], [430, 932], [768, 1024], [820, 1180], [1024, 1366], [1280, 800], [1366, 768], [1440, 900], [1920, 1080], [852, 393], [932, 430]];
  for (const [w, h] of vpList) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
    // новый контекст = холодная загрузка → BootSplash показывается по дизайну.
    // Ждём его исчезновения (до 5с), иначе детектор перекрытий ловит сплэш как P0.
    await page
      .waitForSelector(".boot-bg", { state: "detached", timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    const r = {};
    for (const view of ["catalog", "stock"]) {
      if (view === "stock") {
        const nav = page.locator(w >= 1024 ? 'aside button:has-text("Остатки")' : 'nav.pill-nav button:has-text("Остатки")');
        await nav.click().catch(() => {});
        await page.waitForTimeout(700);
      }
      const ins = await page.evaluate(INSPECT);
      r[view] = { overflowX: ins.overflowX, overlapped: ins.overlapped.length, broken: ins.brokenImgs.length, btns: ins.btnCount };
      if (ins.overflowX > 1) add("P0", `Viewport ${w}×${h} (${view})`, `горизонтальный overflow ${ins.overflowX}px`, "элемент шире вьюпорта", "горизонтальный скролл на устройстве", "найти и починить", "средний");
      ins.overlapped.filter((o) => !o.floating).slice(0, 3).forEach((o) =>
        add("P0", `Viewport ${w}×${h} (${view})`, `«${o.btn}» перекрыта → ${o.by}`, "слой поверх кнопки", "тап не доходит", "починить слои", "средний"));
      if (ins.brokenImgs.length) add("P1", `Viewport ${w}×${h} (${view})`, `битые img: ${ins.brokenImgs.join(", ").slice(0, 120)}`, "404", "пустые места", "починить путь", "низкий");
    }
    results.viewports[`${w}x${h}`] = r;
    await ctx.close();
  }
}

/* ═══ PASS A2: сплэш-стек — глубокая проверка «не ремоунтится» ═══ */
{
  // (сплэш уже проверен в mobile-сессии)
}

await browser.close();
// Автоочистка тестового мусора (фото/варианты, созданные аудитом)
import { spawnSync } from "node:child_process";
spawnSync("bun", ["scripts/cleanup-audit-junk.mjs"], { cwd: "/home/z/my-project", stdio: "inherit", timeout: 120000 });
out.stats = {
  sections: results.sections,
  viewports: results.viewports,
  back: results.back,
  offline: results.offline,
  upload: results.upload,
  pillStyles: results.pillStyles,
};
fs.writeFileSync("/home/z/my-project/scripts/audit-results.json", JSON.stringify(out, null, 2));
console.log(`\n════ ИТОГ: ${out.findings.length} находок. JSON: scripts/audit-results.json`);
const byP = {};
for (const f of out.findings) byP[f.priority] = (byP[f.priority] ?? 0) + 1;
console.log("По приоритетам:", JSON.stringify(byP));
