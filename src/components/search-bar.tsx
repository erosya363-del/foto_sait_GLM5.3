"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePortal } from "@/lib/store";

type SearchResp = {
  popular: string[];
  fabrics: Array<{ id: string; name: string; swatchUrl: string | null; count: number }>;
  variants: Array<{
    id: string;
    categoryName: string;
    modelName: string;
    variantName: string | null;
    materialName: string | null;
    materialGroup?: string | null;
    sizeName: string | null;
    tags: string[];
    photo: { url: string; thumbUrl: string } | null;
    photoCount: number;
  }>;
};

/* ── Личные популярные запросы: частые вводы за последние 7 дней (localStorage) ── */
const LOG_KEY = "skovo-search-log";
type SearchLog = Record<string, number[]>;
const WEEK = 7 * 24 * 3600 * 1000;

function loadLog(): SearchLog {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "{}") as SearchLog;
  } catch {
    return {};
  }
}

/** Записать применённый запрос (Enter/чип/ткань) — помним 7 дней, всегда */
function recordQuery(q: string) {
  try {
    const now = Date.now();
    const fresh = loadLog();
    const pruned: SearchLog = {};
    for (const [k, v] of Object.entries(fresh)) {
      const vv = v.filter((t) => t >= now - WEEK);
      if (vv.length) pruned[k] = vv.slice(-30);
    }
    pruned[q] = [...(pruned[q] ?? []), now].slice(-30);
    localStorage.setItem(LOG_KEY, JSON.stringify(pruned));
  } catch {
    /* приватный режим — не страшно */
  }
}

/** Топ частых запросов за 7 дней (по числу, затем по свежести) */
function popularFromLog(max = 6): string[] {
  try {
    const week = Date.now() - WEEK;
    return Object.entries(loadLog())
      .map(([q, ts]) => ({ q, n: ts.filter((t) => t >= week).length, last: Math.max(...ts) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n || b.last - a.last)
      .slice(0, max)
      .map((r) => r.q);
  } catch {
    return [];
  }
}

/* Плейсхолдер — СТАТИЧНЫЙ и честный.
   Раньше здесь был «печатающийся» плейсхолдер, который в записи владельца
   выглядел как самопечатающий сломанный поиск («Поиск: тк…») — убран:
   поле должно молчать, пока пользователь сам не начал печатать. */
const PLACEHOLDER = "Ткань, модель, размер…";

/**
 * Фиксированный единый поиск. Анти-джиттер:
 *  — дропдаун всегда один DOM-узел, секции внутри не анимируются по отдельности;
 *  — фон дропдауна полностью непрозрачный (никаких «призраков»);
 *  — результат печати применяется только по Enter/выбору (ввод не трогает страницу).
 */
export function SearchBar() {
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /* ФИКС «ПОИСК НЕ РАБОТАЕТ»: раньше у ОБОИХ экземпляров SearchBar (свёрнутая
     панель шапки + подвесная карточка) поле было с одним и тем же id
     "global-search" — getElementById возвращал НЕВИДИМОЕ поле, фокус уходил
     туда, клавиатура iOS не открывалась. Теперь id уникален (useId), а портал
     фокусирует поле по data-search-input внутри ВИДИМОГО контейнера. */
  const inputId = useId();

  const searchOpen = usePortal((s) => s.searchOpen);
  const setSearchOpen = usePortal((s) => s.setSearchOpen);
  const searchQuery = usePortal((s) => s.searchQuery);
  const applySearch = usePortal((s) => s.applySearch);

  // Debounce печати → запрос
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 220);
    return () => clearTimeout(t);
  }, [value]);

  const { data, isFetching } = useQuery<SearchResp>({
    queryKey: ["search", debounced],
    queryFn: async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(debounced)}`);
      if (!r.ok) throw new Error("search failed");
      return r.json();
    },
    enabled: searchOpen,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  // Клик мимо — закрыть дропдаун. ВАЖНО: тапы внутри подвесной карточки
  // (.search-pop) и по кружку-лупе (.search-fab) НЕ считаются «мимо» — когда
  // открыта карточка, именно она активная поверхность; иначе экземпляр панели
  // шапки гасил бы дропдаун карточки каждым её тапом (два экземпляра живут
  // одновременно — панель НЕ размонтируется, чтобы не прыгала высота шапки).
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".search-pop") || t?.closest?.(".search-fab")) return;
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [searchOpen, setSearchOpen]);

  const commit = (q: string | null) => {
    if (q) recordQuery(q);
    applySearch(q);
    setSearchOpen(false);
    setValue(q ?? "");
    inputRef.current?.blur();
  };

  const hasDropdown = searchOpen;

  // Личные популярные — пересчитывать при каждом открытии дропдауна
  const personal = useMemo(
    () => (searchOpen && !debounced ? popularFromLog(6) : []),
    [searchOpen, debounced]
  );

  return (
    <div ref={wrapRef} className="relative">
      {/* Поле: серое, полупрозрачное (80%), тонкая чёткая рамка — никаких
          анимированных/мигающих рамок (просьба пользователя) */}
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 z-[1] -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          id={inputId}
          data-search-input=""
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (!searchOpen) setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(value.trim() || null);
            } else if (e.key === "Escape" && searchOpen) {
              e.stopPropagation();
              setSearchOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={PLACEHOLDER}
          aria-label="Единый поиск: ткань, модель, размер"
          enterKeyHint="search"
          autoComplete="off"
          // 16px на мобильных — iOS не зумит поле; капсула Liquid Glass: блюр 80px,
          // синеватое стекло вместо серого, кобальтовый focus-ring.
          // ВАЖНО: transition-all ЗАПРЕЩЁН — он транзионил унаследованный
          // visibility (карточка открывается в кадре тапа): в первый кадр
          // computed visibility оставался «hidden» и focus() молча отказывал.
          className="h-11 w-full rounded-full border border-border bg-field pl-10 pr-10 text-[16px] font-medium text-foreground shadow-[inset_0_1px_0_var(--glass-spec)] outline-none backdrop-blur-[80px] transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground focus:border-[var(--border-strong)] focus:bg-field-strong focus:shadow-[inset_0_1px_0_var(--glass-spec),0_0_0_4px_var(--focus-ring)] sm:text-[14px]"
        />
        {/* Подсказка «/» — только десктоп, пока поле пустое и не открыто */}
        {!(value || searchQuery) && !searchOpen && (
          <kbd className="pointer-events-none absolute right-3 top-1/2 z-[1] hidden -translate-y-1/2 items-center rounded-md border border-border bg-secondary px-1.5 py-0.5 font-sans text-[11px] font-bold text-muted-foreground sm:block" aria-hidden>
            /
          </kbd>
        )}
        {(value || searchQuery) && (
          <button
            type="button"
            aria-label="Очистить поиск"
            onClick={() => {
              setValue("");
              if (searchQuery) commit(null);
              inputRef.current?.focus();
            }}
            className="absolute right-2.5 top-1/2 z-[1] grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-muted/70 text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-90"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Дропдаун: полупрозрачный стеклянный (~80%) с размытым фоном,
          без внутренней анимации секций */}
      {hasDropdown && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-50 max-h-[min(62dvh,480px)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-[var(--glass-strong)] p-2.5 shadow-2xl shadow-black/25 backdrop-blur-[80px]">
          {!debounced && (
            <>
              <p className="px-1.5 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {personal.length > 0 ? "Популярные за 7 дней" : "Популярные запросы"}
              </p>
              <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
                {(personal.length > 0
                  ? [...personal, ...(data?.popular ?? []).filter((p) => !personal.includes(p))].slice(0, 8)
                  : (data?.popular ?? ["Локо", "Карина", "Ника", "sky", "угловой", "акция", "160×200"])
                ).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => commit(p)}
                    className="rounded-full border border-border bg-secondary/70 px-3 py-1.5 text-[12.5px] font-semibold text-foreground/90 backdrop-blur-md transition-all hover:border-[var(--border-strong)] hover:text-foreground active:scale-95"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </>
          )}

          {debounced && (data?.fabrics?.length ?? 0) > 0 && (
            <>
              <p className="px-1.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Ткани
              </p>
              <div className="mb-1.5 flex flex-col">
                {data!.fabrics.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => commit(f.name)}
                    className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-all hover:bg-secondary active:scale-[0.98]"
                  >
                    {f.swatchUrl ? (
                      <img src={f.swatchUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="h-8 w-8 shrink-0 rounded-lg bg-muted" />
                    )}
                    <span className="flex-1 truncate text-[13.5px] font-semibold">{f.name}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">
                      {f.count} вар.
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {debounced && (data?.variants?.length ?? 0) > 0 && (
            <>
              <p className="px-1.5 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Каталог фото
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {data!.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      applySearch(null);
                      setSearchOpen(false);
                      usePortal.getState().openProduct(v.id, "catalog");
                      setValue("");
                      inputRef.current?.blur();
                    }}
                    className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:border-[color:var(--brand)] active:scale-[0.97]"
                  >
                    {/* Фиксированная пропорция — фото не налезает на текст */}
                    <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
                      {v.photo && (
                        <img
                          src={v.photo.thumbUrl}
                          alt={v.modelName}
                          loading="lazy"
                          onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
                          className="img-fade h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-[12.5px] font-bold leading-tight">{v.modelName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[v.materialName, v.materialGroup, v.sizeName].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {debounced && !isFetching && (data?.variants?.length ?? 0) === 0 && (data?.fabrics?.length ?? 0) === 0 && (
            /* Единственный пустой стейт на весь дропдаун — дубля не бывает */
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <Search size={22} className="text-muted-foreground/60" />
              <p className="text-[14px] font-bold">Ничего не найдено</p>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Работает транслит: «ральф», «скай», «казанова». Попробуйте другой запрос.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Применённый поиск — обычный блок в потоке (без наложения на контент) */}
      {searchQuery && !searchOpen && (
        <div className="flex items-center gap-2 px-0.5 pt-2">
          <span className="truncate text-[12.5px] text-muted-foreground">
            Поиск: <span className="font-bold text-foreground">«{searchQuery}»</span>
          </span>
          <button
            type="button"
            onClick={() => commit(null)}
            className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-all hover:text-foreground active:scale-95"
          >
            сбросить
          </button>
        </div>
      )}
    </div>
  );
}
