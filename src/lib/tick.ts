"use client";

/**
 * Звуковой «tick» (Web Audio) + вибрация на всех телефонах, где ОНА ВОЗМОЖНА.
 *
 * Правда про iPhone: Apple НЕ даёт веб-страницам и PWA доступ к вибромотору —
 * navigator.vibrate в Safari/Home-Screen-PWA просто отсутствует, и никакой код
 * физически не может заставить iPhone вибрировать. Поэтому универсальный отклик:
 *  — Android/Chrome: navigator.vibrate (настоящая вибрация) + tick;
 *  — iPhone: короткий «tick» (щелчок, как у системных клавиш) + визуальный пульс —
 *    это максимум, который iOS технически позволяет.
 * AudioContext ленивый, создаётся в жесте тапа.
 *
 * Троттл 60 мс: глобальный click-делегат (portal.tsx) и явные вызовы компонентов
 * схлопываются в ОДИН звук/вибро на физический тап, а рябь «step» при быстром
 * drag по пилюле почти не режется.
 */
let ctx: AudioContext | null = null;
let lastTickAt = 0;
let lastHapticAt = 0;

type TickKind = "tap" | "step";

export function playTick(kind: TickKind = "tap") {
  const now = Date.now();
  if (now - lastTickAt < 60) return;
  lastTickAt = now;
  haptic(kind === "step" ? 4 : 12);
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

    // «step» — тише и короче (бег линзы за пальцем), «tap» — обычный отклик
    const peak = kind === "step" ? 0.05 : 0.11;
    const dur = kind === "step" ? 0.045 : 0.07;

    osc.type = "triangle";
    osc.frequency.setValueAtTime(kind === "step" ? 1500 : 1750, t);
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

/** Короткий тихий tick при «пробегании» линзы по пунктам во время drag. */
export function playStep() {
  playTick("step");
}

/** Вибрация на всех телефонах, где есть navigator.vibrate (iOS игнорирует молча). */
export function haptic(ms = 12) {
  if (typeof navigator === "undefined") return;
  const now = Date.now();
  if (now - lastHapticAt < 60) return;
  lastHapticAt = now;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* нет vibrate — ок */
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
 * Шлёт паттерн [14, 60, 24] — два заметных толчка. Возвращает, была ли
 * команда вообще возможна: на iOS вернёт false — это НЕ баг сайта.
 */
export function vibrateTest(): boolean {
  if (!vibrateSupported()) return false;
  try {
    navigator.vibrate?.([14, 60, 24]);
    return true;
  } catch {
    return false;
  }
}
