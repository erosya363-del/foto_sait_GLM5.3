"use client";

/**
 * Короткий «tick» через Web Audio — отклик на повторный тап «Каталог».
 * iOS не разрешает navigator.vibrate — звук + визуальный пульс вместо него.
 * AudioContext создаётся лениво и переиспользуется (первое создание — в жесте тапа).
 */
let ctx: AudioContext | null = null;

export function playTick() {
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

    osc.type = "triangle";
    osc.frequency.setValueAtTime(1750, t);
    osc.frequency.exponentialRampToValueAtTime(950, t + 0.055);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.085);
  } catch {
    /* тишина лучше ошибки */
  }
}

/** Вибрация там, где она есть (Android); iOS молча пропустит. */
export function haptic(ms = 12) {
  if (typeof navigator === "undefined") return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* нет vibrate — ок */
  }
}
