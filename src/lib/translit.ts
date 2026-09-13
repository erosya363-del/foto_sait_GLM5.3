/**
 * Умный поиск с фонетическим транслитом: «ральф»↔ralf, «скай»↔sky, «казанова»↔casanova.
 * Ключ гасит гласные и шумные согласные; короткие ключи сравниваются
 * со словом целиком, чтобы «sky» не ловил Casanova.
 */

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "q", ч: "ch", ш: "sh",
  щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Фонетический ключ строки */
export function soundKey(input: string): string {
  let s = input.toLowerCase().replace(/×/g, "x");
  let out = "";
  for (const ch of s) out += CYR[ch] ?? ch;
  // латинская x звучит как «кс»
  out = out.replace(/x/g, "ks");
  // шумные согласные в один класс; «ц» (q) — отдельный класс, чтобы «акция» ≠ «sky»
  out = out
    .replace(/sh|ch|sch/g, "c")
    .replace(/[szc]/g, "k")
    .replace(/[aeiouyj]/g, "");
  return out;
}

/** Каждый токен запроса должен совпасть: короткие — со словом целиком, длинные — по префиксу */
export function matchesQuery(haystack: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const wordKeys = haystack
    .split(/[^0-9a-zа-яё]+/i)
    .filter(Boolean)
    .map(soundKey)
    .filter(Boolean);
  const hay = soundKey(haystack);
  return tokens.every((t) => {
    const tk = soundKey(t);
    if (!tk) return true;
    // короткие ключи: слово целиком, либо начало слова + максимум 1 согласная
    // («угл» → «угловой» ✓, но «sky» не ловит «casanova»)
    if (tk.length <= 2) return wordKeys.some((w) => w === tk || (w.startsWith(tk) && w.length <= 3));
    return hay.includes(tk) || wordKeys.some((w) => w.startsWith(tk));
  });
}
