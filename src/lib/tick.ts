"use client";

/**
 * Звуковой «tick» (Web Audio) + хаптика на ВСЕХ платформах, где она возможна.
 *
 * ДВА УРОВНЯ отклика (решение «вибрация критична», 2026; обновлено ТЗ v4):
 *  1. Android/Chromium: navigator.vibrate — настоящая вибрация, любые паттерны.
 *     Длительности ≥16 мс: короткие 4–10 мс на многих телефонах НЕ ОЩУЩАЮТСЯ.
 *  2. iPhone (iOS 17.4+, включая 26.5+/27+): паттерны эмулируются движком
 *     web-haptics через СОБСТВЕННЫЕ скрытые switch-элементы, которые пакет
 *     создаёт и держит сам (см. ниже) — программные тики работают.
 *
 * ⚠ НЕ СОЗДАВАТЬ `.pill-haptic` и ЛЮБЫЕ скрытые form-controls
 * (`<input type="checkbox" switch>` и т.п.) внутри кнопок нижней панели!
 * Это было вычищено ТЗ v4 п.3/25: интерактивный <input> внутри <button> —
 * баг-машина (двойные фокусы, зум, чужие click-цепочки). Хаптика панели —
 * ТОЛЬКО playTick("tap") отсюда. Если появится настоящий native iOS shell —
 * системную хаптику делать через native bridge, НЕ через скрытый DOM-input.
 * Аудиоти́к остаётся универсальным откликом везде (щелчок, как у системных клавиш).
 *
 * Движок: npm-пакет web-haptics (MIT) — navigator.vibrate там, где он есть,
 * и switch-эмуляция паттернов на остальных. DOM-элементы создаёт сам (скрыты,
 * ВНЕ навигации — в отличие от запрещённых .pill-haptic).
 *
 * Троттл 60 мс: глобальный click-делегат (portal.tsx) и явные вызовы компонентов
 * схлопываются в ОДИН отклик на физический тап.
 */
import { WebHaptics } from "web-haptics";

let ctx: AudioContext | null = null;
let lastTickAt = 0;
let lastHapticAt = 0;

/** Ленивый синглтон движка (DOM-switch создаётся при первом trigger) */
let engine: WebHaptics | null = null;
function hapticsEngine(): WebHaptics | null {
  if (typeof window === "undefined") return null;
  if (!engine) {
    try {
      engine = new WebHaptics();
    } catch {
      engine = null;
    }
  }
  return engine;
}

type TickKind = "tap" | "step" | "press";

/**
 * playTick — звук + хаптика одним вызовом.
 * opts.hapticOn === false — пропустить хаптический движок (оставить только
 * звук). Использовалось точками, где отклик даёт другой механизм; обычным
 * кнопкам панели передавать не нужно — просто playTick("tap").
 *
 * PHASE 2.3 (§5.2 A/I): у панели появился ОТДЕЛЬНЫЙ мягкий «press»-отклик
 * на pointerdown — лёгкий и короткий (16 мс — нижняя граница осязаемости),
 * играющий ОДНОВРЕМЕННО с визуальным вспуханием линзы. Полная схема
 * панели: press (down) → step (пересечение границы вкладки в drag) →
 * tap (commit на release). Троттл 60 мс схлопывает press + click обычного
 * тапа в один отклик.
 */
export function playTick(kind: TickKind = "tap", opts?: { hapticOn?: boolean }) {
  const now = Date.now();
  if (now - lastTickAt < 60) return;
  lastTickAt = now;
  if (opts?.hapticOn !== false)
    haptic(kind === "step" ? 10 : kind === "press" ? 16 : 22);
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // «step» — тише и короче (бег линзы за пальцем), «press» — мягкий down,
    // «tap» — обычный отклик
    const peak = kind === "step" ? 0.05 : kind === "press" ? 0.07 : 0.11;
    const dur = kind === "step" ? 0.045 : kind === "press" ? 0.055 : 0.07;

    osc.type = "triangle";
    osc.frequency.setValueAtTime(kind === "step" ? 1500 : kind === "press" ? 1650 : 1750, t);
    osc.frequency.exponentialRampToValueAtTime(950, t + dur);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  } catch {
    /* тишина лучше ошибки */
  }
}

/** Короткий тихий tick (резерв для бегущих по списку откликов). */
export function playStep() {
  playTick("step");
}

/**
 * Хаптика: Android — navigator.vibrate (движок); iOS — switch-эмуляция паттернов
 * движком web-haptics (работает на 17.4+, включая 26.5+/27+).
 * Скрытые switch'ы в САМОЙ панели (.pill-haptic) ЗАПРЕЩЕНЫ — см. шапку файла.
 * Минимум 16 мс: всё, что короче, часть телефонов просто не отыгрывает.
 */
export function haptic(ms = 22) {
  if (typeof navigator === "undefined") return;
  const now = Date.now();
  if (now - lastHapticAt < 60) return;
  lastHapticAt = now;
  try {
    const e = hapticsEngine();
    e?.trigger(Math.max(16, Math.round(ms)));
  } catch {
    /* нет ни vibrate, ни switch — ок */
  }
}

/**
 * АУДИО-«ТОЛЧОК» — резервный физический отклик: низкочастотный импульс ~78→48 Гц
 * заставляет динамик «бубнить» корпус, ладонь ощущает короткий тычок.
 * Используется кнопкой «Тест вибрации» в админке как гарантированно слышимый
 * отклик на устройствах, где вибрация недоступна.
 */
export function hapticThump() {
  audioThump();
}

function audioThump() {
  if (typeof window === "undefined") return;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume();

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(78, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.09);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  } catch {
    /* тишина лучше ошибки */
  }
}

/** Есть ли у устройства Vibration API (на iPhone всегда false — ограничение Apple). */
export function vibrateSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    return typeof navigator.vibrate === "function";
  } catch {
    return false;
  }
}

/**
 * Самопроверка вибрации (кнопка «Тест вибрации» в админке).
 *  — Android: усиленный паттерн [45,60,45,60,150] — три явных толчка → true.
 *  — iOS: движок играет паттерн через switch-эмуляцию (см. шапку файла),
 *    плюс аудио-«толчок» как слышимое подтверждение → false
 *    (это НЕ баг сайта: navigator.vibrate на iOS Apple не даёт в принципе).
 */
export function vibrateTest(): boolean {
  try {
    hapticsEngine()?.trigger([45, 60, 45, 60, 150]);
  } catch {
    /* пусто */
  }
  if (vibrateSupported()) return true;
  audioThump();
  return false;
}
