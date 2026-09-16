/**
 * E2E: плавающая «пилюля» v2.8 — СТАБИЛЬНАЯ (п.5 ТЗ: линза/драг/liquid удалены)
 * + умная шапка (п.6-8: один лого, без склада, title = вкладка) + поиск без
 * autofocus (п.9) и без кольца (п.10) + подвесной поиск, pill-dim/active,
 * темы, регресс юбки v3, консоль чистая.
 * Запуск: node scripts/test-pill.mjs (сервер на :3000)
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

/** Дождаться завершения CSS-перехода (флаки под нагрузкой, как в test-s6):
    опрашиваем значение до 2.5с, пока не выполнится предикат. */
async function settle(poll, pred, timeout = 2500) {
  const t0 = Date.now();
  let v = await poll();
  while (!pred(v) && Date.now() - t0 < timeout) {
    await page.waitForTimeout(120);
    v = await poll();
  }
  return v;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log("── 1. Пилюля: наличие, форма, позиция ──");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const nav = page.locator("nav.pill-nav");
ok("nav.pill-nav видна", await nav.isVisible());
const shell = page.locator(".pill-shell");
ok(".pill-shell видна", await shell.isVisible());

const shellBox = await shell.boundingBox();
ok("пилюля не на всю ширину (max-width 500 + поля)", shellBox.width <= 500 + 1, `w=${shellBox.width}`);
ok("пилюля по центру", Math.abs(shellBox.x + shellBox.width / 2 - 195) < 3, `x=${shellBox.x}`);
ok("высота капсулы 64px (v5 — ниже, iOS-компакт)", Math.abs(shellBox.height - 64) < 2, `h=${shellBox.height}`);

const shellStyle = await shell.evaluate((el) => {
  const cs = getComputedStyle(el);
  const after = getComputedStyle(el, "::after");
  return {
    radius: cs.borderRadius,
    pos: cs.position,
    blur: cs.backdropFilter || cs.webkitBackdropFilter,
    bg: cs.backgroundColor,
    sheenAnim: after.animationName,
  };
});
ok("капсула fully-rounded (999px)", shellStyle.radius === "999px", shellStyle.radius);
ok("стекло v6.1: ЕДИНЫЙ CSS blur 18px+saturation (P0.2: SVG-фильтр удалён — на Android рвал слой)", /18px/.test(shellStyle.blur) && /saturate/.test(shellStyle.blur), shellStyle.blur);
ok("P0.2: SVG-фильтра в backdrop-filter НЕТ (url(#lg…) запрещён)", !/url\(/.test(shellStyle.blur), shellStyle.blur);
ok("P0.2: sheen-анимация УДАЛЕНА (background-position поверх стекла пересобирало слой)", shellStyle.sheenAnim === "none", shellStyle.sheenAnim);
ok("ЛИНЗА УДАЛЕНА (п.5 ТЗ: ни одного движущегося элемента на панели)", (await page.locator(".pill-shell > .nav-lens").count()) === 0);

const navStyle = await nav.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bottom: cs.bottom, pos: cs.position, pe: cs.pointerEvents };
});
ok("позиция fixed", navStyle.pos === "fixed");
ok("плавает над низом (bottom 10px)", Math.abs(parseFloat(navStyle.bottom) - 10) < 1.5, navStyle.bottom);
ok("обёртка не ловит клики мимо", navStyle.pe === "none");

console.log("── 2. Пункты (4, без «Поиск») и линза ──");
const items = page.locator(".pill-item");
ok("4 пункта (пятый «Поиск» убран по просьбе)", (await items.count()) === 4);
const labels = await items.allTextContents();
ok("подписи на месте, без «Поиск»", /Каталог/.test(labels[0]) && /Остатки/.test(labels[1]) && /Загрузка/.test(labels[2]) && /Админ/.test(labels[3]) && labels.every((l) => !/Поиск/.test(l)), labels.join("|"));

ok("SVG-фильтр #nav-liquid УДАЛЁН (жидкий переезд — тоже линза)", (await page.locator("#nav-liquid").count()) === 0);
const lensCount = await page.locator(".nav-lens").count();
ok("линзы нет нигде в DOM", lensCount === 0, `got ${lensCount}`);
const hapticSwitches = await page.locator(".pill-haptic").count();
ok("нативных switch для хаптики — по одному на пункт + поиск (iOS)", hapticSwitches === 5, `got ${hapticSwitches}`);
const hsStyle = await page.locator(".pill-haptic").first().evaluate((el) => {
  const cs = getComputedStyle(el);
  return { op: cs.opacity, clip: cs.clipPath, app: cs.appearance };
});
ok("switch невидим, но appearance нативный (иначе iOS не сыграет)", Number(hsStyle.op) === 0 && /inset/.test(hsStyle.clip) && !/none/.test(hsStyle.app), JSON.stringify(hsStyle));
const item1 = await items.nth(0).boundingBox();
const onStyle1 = await items.nth(0).evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, shadow: cs.boxShadow };
});
const bubbleState = await page.evaluate(() => {
  const b = document.querySelector(".pill-bubble");
  const cs = b ? getComputedStyle(b) : null;
  return {
    exists: Boolean(b),
    bg: cs ? cs.backgroundColor : null,
    shadow: cs ? cs.boxShadow : null,
    transform: b ? b.style.transform : null,
    bf: cs ? cs.backdropFilter : null,
  };
});
ok("P1.11: активный пункт = ОДИН общий bubble", bubbleState.exists && bubbleState.bg !== "rgba(0, 0, 0, 0)", JSON.stringify(bubbleState.bg));
ok("P1.11: bubble с внутренним бликом, БЕЗ своего backdrop (не второй glass-слой)", /inset/.test(bubbleState.shadow) && (bubbleState.bf === "none" || bubbleState.bf === ""), `${bubbleState.shadow} bf=${bubbleState.bf}`);
ok("P1.11: bubble спозиционирован transform'ом (не left/width-анимация)", /translateX/.test(bubbleState.transform), bubbleState.transform);
ok("активный пункт — только цвет, без личной подложки (bubble даёт фон)", onStyle1.bg === "rgba(0, 0, 0, 0)", JSON.stringify(onStyle1));

const onColor = await items.nth(0).evaluate((el) => getComputedStyle(el).color);
ok(
  "активный пункт чётким цветом текста (iOS-стиль, без бирюзы)",
  onColor === "rgb(246, 244, 240)",
  onColor
);

console.log("── 3. Смена вкладки: геометрия ВСЕХ пунктов НЕИЗМЕННА (п.5 ТЗ) ──");
// Снимаем боксы всех пунктов ДО переключения
const boxesBefore = await page.evaluate(() =>
  [...document.querySelectorAll(".pill-item")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })
);
await items.nth(1).click();
await page.waitForTimeout(700); // было 120мс на линзу — теперь просто ждём переходы цвета
// Никаких «жидких» классов в DOM
const liquidLeft = await page.evaluate(() => ({
  lens: document.querySelectorAll(".nav-lens").length,
  liquid: document.querySelector(".pill-shell")?.classList.contains("is-liquid") ?? false,
  squash: document.querySelectorAll(".is-squash").length,
  drag: document.querySelectorAll(".pill-item.is-drag").length,
}));
ok("нет линзы/is-liquid/is-squash/is-drag после смены вкладки", !liquidLeft.lens && !liquidLeft.liquid && !liquidLeft.squash && !liquidLeft.drag, JSON.stringify(liquidLeft));
ok("активным стал «Остатки» (is-on переехал классом, не анимацией)", await items.nth(1).evaluate((el) => el.classList.contains("is-on")) && !(await items.nth(0).evaluate((el) => el.classList.contains("is-on"))));
// Геометрия КАЖДОГО пункта — идентична до/после (ничего не прыгнуло)
const boxesAfter = await page.evaluate(() =>
  [...document.querySelectorAll(".pill-item")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })
);
const geomStable = boxesBefore.every((b, i) => Math.abs(b.x - boxesAfter[i].x) < 0.5 && Math.abs(b.w - boxesAfter[i].w) < 0.5);
ok("иконки не сдвинулись, ширины не изменились (пиксель-в-пиксель)", geomStable, JSON.stringify({ before: boxesBefore[1], after: boxesAfter[1] }));
ok("заголовок в шапке — только вкладка «Остатки» (п.8 ТЗ)", (await page.locator("header .font-display").textContent())?.trim() === "Остатки");

console.log("── 4. Тап «Загрузка» → заголовок = только вкладка, геометрия стабильна ──");
const boxAdminBefore = await items.nth(3).boundingBox();
const boxFirstBefore = await items.nth(0).boundingBox();
await items.nth(2).click();
await page.waitForTimeout(650);
ok("заголовок «Загрузка» (без приставок — п.8 ТЗ)", (await page.locator("header .font-display").textContent())?.trim() === "Загрузка");
const boxAdminAfter = await items.nth(3).boundingBox();
const boxFirstAfter = await items.nth(0).boundingBox();
/* Смена раздела может появить/убрать скроллбар страницы → капсула честно
   пересчитывается по ширине вьюпорта (на iPhone скроллбары overlay — эффекта
   нет). Стабильность = межиконные шаги неизменны, а изменение ширины (если
   есть) РАВНОМЕРНОЕ по всем пунктам — никакой пункт не «прыгает» отдельно. */
const gapBefore = boxAdminBefore.x - boxFirstBefore.x;
const gapAfter = boxAdminAfter.x - boxFirstAfter.x;
const dAdmin = boxAdminAfter.width - boxAdminBefore.width;
const dFirst = boxFirstAfter.width - boxFirstBefore.width;
ok(
  "пункты не прыгают: шаг неизменен, пересчёт ширины равномерный",
  Math.abs(gapBefore - gapAfter) < 0.5 && Math.abs(dAdmin - dFirst) < 0.5,
  JSON.stringify({ gapBefore, gapAfter, dAdmin, dFirst })
);

console.log("── 5. Пилюля и скролл/касание: pill-dim / pill-active ──");
// скроллим «Остатки» (на L1 каталога места под скролл почти нет)
await page.locator('nav.pill-nav button:has-text("Остатки")').click();
await page.waitForTimeout(600);
ok("наверху: нет pill-dim", !(await shell.evaluate((el) => el.classList.contains("pill-dim"))));
// безопасный «тап мимо» (не по контенту — чтобы не открыть товар): синтетический pointerdown
const tapElsewhere = () => page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
await tapElsewhere();
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(350);
await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
await page.waitForTimeout(400);
ok("после скролла: pill-dim", await shell.evaluate((el) => el.classList.contains("pill-dim")));
const bgDim = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("фон прозрачнее при скролле", bgDim !== shellStyle.bg, `${shellStyle.bg} → ${bgDim}`);
ok("неактивные пункты чёткие при скролле (opacity 1)", Math.abs(Number(await items.nth(0).evaluate((el) => getComputedStyle(el).opacity)) - 1) < 0.03);
ok("активный пункт чёткий (opacity 1)", Math.abs(Number(await items.nth(1).evaluate((el) => getComputedStyle(el).opacity)) - 1) < 0.03);
// касание пилюли → pill-active; касание мимо → снялось (синтетический pointerdown — без активации пункта)
await page.evaluate(() => {
  document.querySelector(".pill-shell")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 99 }));
});
await page.waitForTimeout(250);
ok("тап по пилюле → pill-active", await shell.evaluate((el) => el.classList.contains("pill-active")));
const bgActive = await shell.evaluate((el) => getComputedStyle(el).backgroundColor);
ok("активный фон плотнее", bgActive !== bgDim, `${bgDim} → ${bgActive}`);
await tapElsewhere();
await page.waitForTimeout(250);
ok("тап мимо → pill-active снялся", !(await shell.evaluate((el) => el.classList.contains("pill-active"))));

console.log("── 6. Шапка: сворачивание при скролле, поиска сверху НЕТ (шаги 1/3) ──");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(400);
const logo = page.locator("header img[alt='Askona']");
ok("на мобиле: лого скрыт (заголовок «Askona …» вместо него)", !(await logo.isVisible()));
ok("поисковой строки сверху НЕТ (панель .search-collapse удалена)", (await page.locator(".search-collapse").count()) === 0);
ok("кружка-лупы .search-fab больше нет (поиск в пилюле)", (await page.locator(".search-fab").count()) === 0);
ok("наверху: заголовок раздела виден", await page.locator("header .font-display").isVisible());
await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
await page.waitForTimeout(500);
const titleOpacity = await settle(
  () => page.locator("header .font-display").evaluate((el) => Number(getComputedStyle(el.closest(".header-fade") ?? el).opacity)),
  (v) => v < 0.05
);
ok("при скролле: заголовок скрыт (opacity 0)", titleOpacity < 0.05, `opacity=${titleOpacity}`);
const hdrBg = await settle(
  () => page.locator("header.glass").evaluate((el) => getComputedStyle(el).backgroundColor),
  (v) => v === "rgba(0, 0, 0, 0)"
);
ok("при скролле: шапка полностью прозрачна", hdrBg === "rgba(0, 0, 0, 0)", hdrBg);
ok("при скролле: «Назад» осталась (шапка жива)", await page.locator("header").isVisible());

console.log("── 7. Круглый поиск на пилюле → карточка НАД панелью (шаг 3) ──");
const searchBtn = page.locator(".pill-search");
ok("круглый элемент поиска есть на панели", await searchBtn.isVisible());
const sBtnBox = await searchBtn.boundingBox();
const lastItemBox = await items.nth(3).boundingBox();
ok("поиск СПРАВА от «Админ» (ряд пилюли, без разделителя)", sBtnBox.x > lastItemBox.x + lastItemBox.width - 2, JSON.stringify({ sBtnBox, lastItemBox }));
ok("разделитель .pill-sep удалён (поиск — часть пилюли)", (await page.locator(".pill-sep").count()) === 0);
ok("размер поиска 54px (весь ряд, как табы)", Math.abs(sBtnBox.width - 54) < 2 && Math.abs(sBtnBox.height - 54) < 2, `w=${sBtnBox.width} h=${sBtnBox.height}`);
/* ВАЖНО: НЕ locator.click() — fixed-элемент; жмём из JS, как настоящий тап */
await page.evaluate(() => document.querySelector(".pill-search")?.click());
await page.waitForTimeout(450);
const pop = page.locator(".search-pop");
ok("подвесной поиск открылся", await pop.isVisible());
const popBox = await pop.boundingBox();
/* v3.1: в search mode панель display:none — меряем от ВИРТУАЛЬНОЙ позиции
   панели (низ вьюпорта − 10px отступа − 64px высоты пилюли). */
const virtualNavTop = await page.evaluate(() => window.innerHeight - 10 - 64);
const gapPx = virtualNavTop - (popBox.y + popBox.height);
ok("карточка НАД панелью (не перекрывает)", popBox.y + popBox.height <= virtualNavTop + 1, `popBottom=${(popBox.y + popBox.height).toFixed(1)} virtualNavTop=${virtualNavTop}`);
ok("зазор 10–15мм (38–57px)", gapPx >= 36 && gapPx <= 60, `gap=${gapPx.toFixed(1)}`);
const focused1 = await page.evaluate(() => {
  const ae = document.activeElement;
  return Boolean(ae && ae.matches("input[data-search-input]") && ae.closest(".search-pop"));
});
/* П.9 ТЗ: при ОТКРЫТИИ поле НЕ в фокусе — клавиатура не вскакивает, экран не прыгает */
ok("при открытии поле БЕЗ фокуса (п.9: клавиатуру вызывает сам пользователь)", !focused1);
/* П.10 ТЗ: геометрия поля при focus НЕ меняется, никакого кольца */
const inpBefore = await page.locator("input[data-search-input]").boundingBox();
await page.locator("input[data-search-input]").click();
await page.waitForTimeout(300);
const focused2 = await page.evaluate(() => Boolean(document.activeElement?.matches("input[data-search-input]")));
ok("тап по полю → фокус (клавиатура)", focused2);
const inpAfter = await page.locator("input[data-search-input]").boundingBox();
ok("геометрия поля при focus идентична (п.10)", Math.abs(inpBefore.width - inpAfter.width) < 0.5 && Math.abs(inpBefore.height - inpAfter.height) < 0.5, JSON.stringify({ before: inpBefore, after: inpAfter }));
const focusShadow = await page.locator("input[data-search-input]").evaluate((el) => getComputedStyle(el).boxShadow);
ok("при focus НЕТ 4px-кольца (только inset-спекуляр)", !/0px 0px 0px 4px/.test(focusShadow), focusShadow);
// печатаем — дропдаун открывается ВВЕРХ от поля (карточка у низа экрана)
await page.keyboard.type("диван");
await page.waitForTimeout(600);
ok("дропдаун подсказок открыт", await page.locator(".search-pop .search-dd").isVisible());
const ddGeom = await page.locator(".search-pop .search-dd").evaluate((el) => {
  const d = el.getBoundingClientRect();
  const p = el.closest(".search-pop").getBoundingClientRect();
  return { ddBottom: d.bottom, popTop: p.top };
});
ok("дропдаун ВЫШЕ поля (у низа экрана)", ddGeom.ddBottom <= ddGeom.popTop + 2, JSON.stringify(ddGeom));
// крестик закрытия карточки
ok("крестик закрытия есть", await page.locator(".search-pop-close").isVisible());
/* v3.0 ТЗ п.1/2/5: скролл БОЛЬШЕ НЕ закрывает поиск — search mode самостоятелен.
   Раньше листание >30px закрывало карточку — именно это давало состояние
   «клавиатура открыта, а поиск исчез» (iOS подкручивает документ при фокусе,
   Android клэмпит scrollY при сжатии viewport). Теперь закрытие только явное. */
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(500);
ok("листание НЕ закрывает поиск (v3.0: состояние самостоятельное)",
  (await page.locator(".search-pop.is-open").count()) === 1);
// явное закрытие крестиком по-прежнему работает
await page.locator(".search-pop-close").click();
await page.waitForTimeout(400);
ok("крестик закрыл подвесной поиск", (await page.locator(".search-pop.is-open").count()) === 0);

console.log("── 8. Повторный тап «Каталог»: пульс + мгновенный верх (Шаг 2) ──");
await items.nth(0).click(); // из остатков → в каталог (обычный переход, без пульса)
await page.waitForTimeout(600);
// запас скролла: открываем «Все ткани» (длинная сетка)
await page.evaluate(() => window.__portal.setState({ catFabrics: true }));
await page.waitForTimeout(900);
await page.evaluate(() => window.scrollTo({ top: 999999, behavior: "instant" }));
await page.waitForTimeout(250);
const beforePulse = await page.evaluate(() => window.scrollY);
ok("страница проскроллена", beforePulse > 50, `got ${beforePulse}`);
await items.nth(0).click();
await page.waitForTimeout(120);
const pulsing = await page.evaluate(() => document.querySelectorAll(".pill-item")[0].classList.contains("nav-pulse"));
ok("пульс-класс nav-pulse активирован", pulsing);
await page.waitForTimeout(600);
const scrollY2 = await page.evaluate(() => window.scrollY);
ok("scrollY = 0 после повторного тапа", scrollY2 === 0, `got ${scrollY2}`);
ok("активным снова стал «Каталог» (is-on)", await items.nth(0).evaluate((el) => el.classList.contains("is-on")));

console.log("── 10. Светлая тема ──");
await page.evaluate(() => {
  document.documentElement.classList.add("light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(600); // 280мс переход фона темы должен завершиться
// снять pill-active/касание — читаем БАЗОВОЕ стекло светлой темы
await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown")));
await page.waitForTimeout(350);
const lightBg = await settle(
  () => shell.evaluate((el) => getComputedStyle(el).backgroundColor),
  (v) => /^rgba\(255,\s*255,\s*255/.test(v)
);
ok(
  "светлая тема: белое translucent стекло v4 (фон просвечивает; палитра «Изумруд»)",
  /^rgba\(255,\s*255,\s*255/.test(lightBg),
  lightBg
);
const lightBubble = await page.locator(".pill-bubble").evaluate((el) => {
  const cs = getComputedStyle(el);
  return cs.backgroundColor + " | " + cs.boxShadow + " | transform=" + el.style.transform;
});
ok(
  "светлая тема: ОДИН общий bubble со стеклом и бликом, позиция transform'ом (P1.11)",
  /inset/.test(lightBubble) && /translateX/.test(lightBubble),
  lightBubble
);
await page.screenshot({ path: "tool-results/pill-light.png" });
await page.evaluate(() => {
  document.documentElement.classList.add("dark");
  document.documentElement.classList.remove("light");
});
await page.waitForTimeout(250);

console.log("── 11. Скриншоты + регресс юбки v3 ──");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(400);
await page.screenshot({ path: "tool-results/pill-dark-catalog.png" });
await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
await page.waitForTimeout(500);
await page.screenshot({ path: "tool-results/pill-dark-scrolled.png" });
const skirt = await page.locator(".fx-skirt").count();
ok("фикс v3: юбка на месте", skirt === 1);
const htmlBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
ok("фикс v3: html фон --edge (тёплый графит #1d1b18)", htmlBg === "rgb(29, 27, 24)", htmlBg);

console.log("── 12. Десктоп: пилюля скрыта, поиск в сайдбаре ──");
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(400);
ok("пилюля скрыта на lg", !(await nav.isVisible()));
ok("сайдбар виден", await page.locator("aside").isVisible());
ok("в сайдбаре есть кнопка «Поиск» (шаг 3)", await page.locator("aside .side-link", { hasText: "Поиск" }).isVisible());
ok("карточка поиска в DOM (одна, скрыта до вызова)", (await page.locator(".search-pop").count()) === 1);
await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
await page.waitForTimeout(400);
ok("десктоп: лого в шапке УДАЛЁН (п.6: один логотип — в сайдбаре)", !(await logo.isVisible().catch(() => false)));
ok("десктоп: основной лого в сайдбаре на месте", await page.locator("aside img[alt='Askona']").isVisible());
ok("десктоп: селектора склада «Обухово» в шапке НЕТ (п.7)", (await page.locator("header select").count()) === 0);
ok("десктоп: «склад онлайн» удалён из сайдбара (п.7)", !/склад онлайн/.test(await page.locator("aside").innerText()));
ok("десктоп: заголовок = только вкладка (п.8)", ["Каталог", "Остатки", "Загрузка", "Админ"].includes((await page.locator("header .font-display").textContent())?.trim() ?? ""));

console.log("── 13. Консоль ──");
const realErrors = consoleErrors.filter((e) => !/Download the React DevTools/i.test(e));
ok("консоль чистая", realErrors.length === 0, JSON.stringify(realErrors).slice(0, 300));

console.log(`\n═══ ИТОГ: ${passed} ✓ / ${failed} ✗ ═══`);
if (failed) {
  console.log("Провалены:", errors.join(" | "));
  process.exit(1);
}
await browser.close();
