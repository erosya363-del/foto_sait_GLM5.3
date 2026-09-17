/** Отладка находок стабилизации: stock-перекрытия + landscape 852×393. */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const browser = await chromium.launch();

// ── Кейс 1: 390×844, Остатки, кто накрывает «Компактный вид» и «Закрыть поиск» ──
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 120)); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator("nav.pill-nav").getByRole("button", { name: "Остатки", exact: true }).click({ force: true });
  // ждём реальную загрузку данных склада (первый запрос может быть холодным)
  const modeSwitch = page.locator(".mode-switch");
  try {
    await modeSwitch.waitFor({ state: "visible", timeout: 12000 });
  } catch {
    console.log("mode-switch не появился за 12с; HTML страницы:", (await page.content()).length, "байт");
    await page.screenshot({ path: "tool-results/stabilize-shots/dbg-stock-no-modeswitch.png" });
  }

  const probe = await page.evaluate(() => {
    const out = { elements: [] };
    for (const el of Array.from(document.querySelectorAll("button"))) {
      const label = (el.getAttribute("aria-label") || el.title || el.textContent || "").trim();
      if (!/Компактный вид|Закрыть поиск|Карточки/.test(label)) continue;
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      out.elements.push({
        label: label.slice(0, 30),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        topAtCenter: top ? `${top.tagName}.${String(top.className).split(" ").slice(0, 2).join(".")}`.slice(0, 70) : "null",
        topIsSelf: top === el || el.contains(top),
        visible: getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden",
      });
    }
    // поиск открыт?
    out.searchPopOpen = !!document.querySelector(".search-pop.is-open");
    out.searchBarVisible = (() => {
      const el = document.querySelector('[aria-label="Закрыть поиск"]')?.closest(".search-pop, .search-chip, div");
      if (!el) return "нет";
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return `rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} disp=${cs.display} vis=${cs.visibility} op=${cs.opacity}`;
    })();
    return out;
  });
  console.log(JSON.stringify(probe, null, 1));

  // тап по «Компактный вид» через координату центра
  const btn = page.getByRole("button", { name: "Компактный вид" });
  const before = await btn.getAttribute("aria-pressed");
  const bb = await btn.boundingBox();
  console.log("boundingBox:", JSON.stringify(bb));
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(400);
  const after = await btn.getAttribute("aria-pressed");
  console.log("tap center: pressed", before, "→", after);
  await ctx.close();
}

// ── Кейс 2: 852×393 landscape — есть ли пилюля вообще ──
{
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("L-CONSOLE:", m.text().slice(0, 120)); });
  page.on("pageerror", (e) => console.log("L-PAGEERROR:", String(e).slice(0, 160)));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => ({
    pill: !!document.querySelector("nav.pill-nav"),
    pillItems: Array.from(document.querySelectorAll("nav.pill-nav button")).map((b) => b.textContent?.trim()),
    pillDisplay: document.querySelector("nav.pill-nav") ? getComputedStyle(document.querySelector("nav.pill-nav")).display : "нет элемента",
    bodyLen: document.body.innerHTML.length,
    splash: !!document.querySelector(".boot-bg"),
  }));
  console.log("852×393:", JSON.stringify(info, null, 1));
  await page.screenshot({ path: "tool-results/stabilize-shots/dbg-852x393.png" });
  await ctx.close();
}

await browser.close();
