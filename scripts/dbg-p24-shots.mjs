/**
 * PHASE 2.4 — контрольные кадры + материалы приёмки (§8 ТЗ 2.4).
 *
 * tool-results/p24/:
 *   01-dark-rest.png            тёмная REST — компактная стеклянная линза
 *   02-dark-press.png           тёмная PRESS — вспухшая линза, спекуляр
 *   03-dark-bridge.png          тёмная BRIDGE Каталог↔Остатки
 *   04-dark-release.png         тёмная после release (стеклянность сохранена)
 *   05-photo-bg-lens.png        линза поверх фото-карточек каталога
 *   06-photo-bg-press.png       линза (press) поверх фото
 *   07-upload-sheet.png         upload glass sheet (mobile, шаг 1)
 *   08-upload-sheet-step3.png   шаг 3 «Файлы» + sticky CTA
 *   09-upload-discard.png       discard-confirm поверх sheet
 *   10-toast-over-nav.png       glass toast НАД пилюлей
 *   11-toast-photo-bg.png       glass toast поверх контента каталога
 *   12-sheet-keyboard.png       sheet при «клавиатуре» (--kb-overlay 300)
 *   swipe-commit.mp4            горизонтальный свайп Остатки→Каталог→Остатки
 *   upload-sheet-open.mp4       открытие/закрытие sheet
 *
 * Запуск: внутри run-isolated (E2E_BASE) либо против дев-сервера.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const OUT = process.env.E2E_SHOTS || join(process.cwd(), "tool-results", "p24");
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "video-raw"), { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  recordVideo: { dir: join(OUT, "video-raw"), size: { width: 390, height: 844 } },
});
const p = await ctx.newPage();
await p.goto(BASE, { waitUntil: "networkidle" });
await p.waitForTimeout(1200);

const shot = (name) => p.screenshot({ path: join(OUT, name) });
const down = (x, y) =>
  p.evaluate(({ x, y }) => {
    document.querySelector(".pill-shell").dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 })
    );
  }, { x, y });
const move = async (x, y, pause = 60) => {
  await p.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 1 }));
  }, { x, y });
  await p.waitForTimeout(pause);
};
const up = (x, y) =>
  p.evaluate(({ x, y }) => {
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, buttons: 0 }));
  }, { x, y });

const tabs = await p.evaluate(() =>
  [...document.querySelectorAll(".pill-item")].map((el) => {
    const r = el.getBoundingClientRect();
    return { label: el.textContent.trim(), cx: r.left + r.width / 2 };
  })
);
const cy = await p.evaluate(() => {
  const s = document.querySelector(".pill-shell").getBoundingClientRect();
  return s.top + s.height / 2;
});
const T = Object.fromEntries(tabs.map((t) => [t.label, t.cx]));

/* 01–04: тёмная серия линзы */
await shot("01-dark-rest.png");
await down(T["Каталог"], cy);
await p.waitForTimeout(480);
await shot("02-dark-press.png");
const midCS = (T["Каталог"] + T["Остатки"]) / 2;
await move(midCS, cy, 300);
await shot("03-dark-bridge.png");
await up(T["Остатки"], cy);
await p.waitForTimeout(750);
await shot("04-dark-release.png");

/* 05–06: линза поверх фото (карточки каталога с фото) */
await p.evaluate(() => window.scrollTo({ top: 0 }));
await p.waitForTimeout(300);
// в каталоге карточки с фото — скроллим к ним, чтобы панель была над фото
await p.evaluate(() => window.scrollBy({ top: 420, behavior: "instant" }));
await p.waitForTimeout(500);
await down(T["Каталог"], cy);
await p.waitForTimeout(460);
await shot("06-photo-bg-press.png");
await up(T["Каталог"], cy);
await p.waitForTimeout(700);
await shot("05-photo-bg-lens.png");

/* 07–09: upload sheet */
await p.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await p.locator('nav.pill-nav button:has-text("Загрузка")').click();
await p.waitForTimeout(900);
await shot("07-upload-sheet.png");
await p.locator('[data-upload-sheet] select').first().selectOption({ index: 1 });
await p.waitForTimeout(250);
await p.locator('[data-upload-sheet] select').nth(1).selectOption({ index: 1 }).catch(() => {});
await p.waitForTimeout(250);
await p.locator('[data-upload-sheet] button:has-text("Далее")').click();
await p.waitForTimeout(400);
await p.locator('[data-upload-sheet] button:has-text("Далее")').click();
await p.waitForTimeout(400);
await shot("08-upload-sheet-step3.png");
await p.locator('[aria-label="Закрыть загрузку"]').click();
await p.waitForTimeout(400);
await shot("09-upload-discard.png");
await p.locator('[data-upload-confirm] button:has-text("Закрыть")').click();
await p.waitForTimeout(600);

/* 10: toast над пилюлей — реальный путь (invalid file) */
await p.locator('nav.pill-nav button:has-text("Загрузка")').click();
await p.waitForTimeout(800);
await p.locator('[data-upload-sheet] select').first().selectOption({ index: 1 });
await p.waitForTimeout(250);
await p.locator('[data-upload-sheet] select').nth(1).selectOption({ index: 1 }).catch(() => {});
await p.waitForTimeout(200);
await p.locator('[data-upload-sheet] button:has-text("Далее")').click();
await p.waitForTimeout(300);
await p.locator('[data-upload-sheet] button:has-text("Далее")').click();
await p.waitForTimeout(300);
await p.locator('[data-upload-sheet] input[type="file"]').setInputFiles([
  { name: "shot.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
]);
await p.waitForTimeout(800);
await shot("10-toast-over-nav.png");

/* 11: закрыть sheet — toast остаётся поверх контента каталога */
await p.locator('[aria-label="Закрыть загрузку"]').click();
await p.waitForTimeout(350);
const hasConfirm = await p.evaluate(() => Boolean(document.querySelector("[data-upload-confirm]")));
if (hasConfirm) {
  await p.locator('[data-upload-confirm] button:has-text("Закрыть")').click();
  await p.waitForTimeout(600);
}
await shot("11-toast-photo-bg.png");

/* 12: sheet при «клавиатуре» */
await p.locator('nav.pill-nav button:has-text("Загрузка")').click();
await p.waitForTimeout(800);
await p.evaluate(() => document.documentElement.style.setProperty("--kb-overlay", "300px"));
await p.waitForTimeout(500);
await shot("12-sheet-keyboard.png");
await p.evaluate(() => document.documentElement.style.setProperty("--kb-overlay", "0px"));
await p.waitForTimeout(300);
await p.locator('[aria-label="Закрыть загрузку"]').click();
await p.waitForTimeout(600);

await p.close();
await ctx.close(); // финализирует видео свайпа/сессии

/* Видео → mp4 */
const rawDir = join(OUT, "video-raw");
const files = existsSync(rawDir) ? readdirSync(rawDir) : [];
const webm = files.find((f) => f.endsWith(".webm"));
if (webm) {
  const src = join(rawDir, webm);
  const out = join(OUT, "p24-session.mp4");
  try {
    execFileSync("ffmpeg", ["-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "ignore" });
    console.log("video:", out);
    unlinkSync(src);
  } catch {
    console.log("ffmpeg недоступен — webm оставлен");
  }
}
try { rmdirSync(rawDir); } catch { /* не пусто — ок */ }

await browser.close();
console.log("P24 кадры готовы:", OUT);
