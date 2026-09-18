"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { UploadCloud, X, ImagePlus, CheckCircle2, Loader2, Images, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePortal } from "@/lib/store";
import type { Dictionaries } from "@/lib/portal";

/**
 * PHASE 2.4 §4: UPLOAD — GLASS SHEET/DIALOG вместо отдельного раздела.
 *
 * Что изменилось (§4.1–4.8): ТОЛЬКО контейнер UX. Весь движок загрузки
 * перенесён из upload-view.tsx БЕЗ ИЗМЕНЕНИЙ логики:
 *   — file validation (тип/размер), лимит 10×25 МБ;
 *   — превью с кэшем object URL (F-004);
 *   — последовательная загрузка с честным счётчиком N/M и фазами
 *     send/proc, XHR-прогресс, /api/upload integration;
 *   — partial success: успешные убираются, НЕудачные ОСТАЮТСЯ (F-005);
 *   — beforeunload guard на время отправки;
 *   — тосты sonner как дополнительный feedback.
 *
 * Поведение окна (§4.4/4.5):
 *   mobile  — bottom sheet: spring снизу, dimmed backdrop, handle,
 *             glass-материал v5, внутренний скролл ТОЛЬКО контента;
 *   desktop — центрированная glass-карточка (fade+scale).
 * Клавиатура (§4.5 — урок search-pop БЕЗ двойного учёта):
 *   sheet стоит на bottom: var(--kb-overlay) — ФАКТИЧЕСКОЕ overlay-перекрытие
 *   (iOS>0, Android resizes-content≈0 — см. use-visual-viewport), плавный
 *   подъём 220 мс; доступная высота = 100dvh − sat − overlay; скроллится
 *   только внутренний контент; фокус-скролл подводит поле, CTA в sticky
 *   footer остаётся доступным. Весь sheet целиком НЕ транслируется
 *   transform'ом на высоту клавиатуры.
 *
 * Dirty/close guard (§4.7): чистое состояние закрывается сразу; есть
 * введённое/файлы — inline confirm discard; во время отправки закрытие
 * backdrop'ом/handle запрещено — только осознанный cancel flow
 * («Прервать загрузку?» → abort текущего XHR → остановка очереди).
 *
 * Success flow (§4.8): success-экран внутри sheet + CTA «Загрузить ещё» /
 * «Закрыть» / «Показать в каталоге»; glass toast — дополнительный отклик.
 */

const MAX_FILES = 10;
const MAX_SIZE = 25 * 1024 * 1024;

const STEPS = ["Категория", "Параметры", "Файлы"] as const;

const sheetSpring = { type: "spring" as const, stiffness: 380, damping: 40 };

export function UploadSheet() {
  const open = usePortal((s) => s.uploadOpen);
  const setOpen = usePortal((s) => s.setUploadOpen);
  const openProduct = usePortal((s) => s.openProduct);

  /* Desktop/mobile рендер-ветки (SSR-safe: первый кадр — мобильная ветка) */
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const [categoryId, setCategoryId] = useState("");
  const [modelId, setModelId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  /** Прогресс по файлам: сколько готово, какой отправляется, фаза текущего файла */
  const [doneCount, setDoneCount] = useState(0);
  const [upIdx, setUpIdx] = useState(0);
  const [phase, setPhase] = useState<"send" | "proc">("send");
  const [done, setDone] = useState<{ variantId: string; count: number; rejected: Array<{ name: string; reason: string }> } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  /* §4.7: confirm-состояния закрытия. null = нет вопроса;
     "discard" — есть несохранённое; "abort" — идёт отправка */
  const [confirmMode, setConfirmMode] = useState<null | "discard" | "abort">(null);

  /* §4.7 cancel flow: abort → очередь останавливается → sheet закрывается */
  const abortRef = useRef(false);
  const abortCloseRef = useRef(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /* ФИКС F-004: кэш object URL на файл — URL создаётся один раз на файл,
     переиспользуется при удалении соседей и отзывается при очистке. */
  const urlCache = useRef(new Map<File, string>());
  const urlFor = (f: File) => {
    let u = urlCache.current.get(f);
    if (!u) {
      u = URL.createObjectURL(f);
      urlCache.current.set(f, u);
    }
    return u;
  };
  const revokeAll = () => {
    urlCache.current.forEach((u) => URL.revokeObjectURL(u));
    urlCache.current.clear();
  };
  useEffect(() => () => revokeAll(), []);

  /* ФИКС F-005: страховка от случайного закрытия страницы во время отправки */
  useEffect(() => {
    if (!busy) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);

  /* CRITICAL STABILITY 7.4 — SCROLL LOCK (надёжная modal-стратегия):
     основной фон НЕ скроллится под sheet. Обычного overflow:hidden на body
     в iOS Safari недостаточно (страница скроллится инерцией/резиновым тягой),
     поэтому позиционная фиксация: body фиксируется на -scrollY, после
     закрытия позиция возвращается ТОЧНО. Очистка — при любом снятии open. */
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("sheet-scroll-locked");
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      html.classList.remove("sheet-scroll-locked");
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
    };
  }, [open]);

  /* CRITICAL STABILITY 7.3: фокус в поле → поле подводится scrollIntoView
   ВНУТРИ sheet-body (клавиатура НЕ поднимает весь sheet — она сжимает
   доступную высоту, подъём делает только anchor bottom + height-clamp).
   Задержка 320 мс: iOS сначала поднимает клавиатуру, потом скроллит. */
  const onBodyFocusCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!(t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    const scroller = bodyRef.current;
    if (!scroller) return;
    window.setTimeout(() => {
      try {
        t.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch {
        t.scrollIntoView();
      }
    }, 320);
  }, []);

  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      return r.json();
    },
    enabled: open,
  });

  const models = useMemo(() => d?.models.filter((m) => m.categoryId === categoryId && m.active) ?? [], [d, categoryId]);
  // Признаки: привязка к категории через название + общие
  const catName = d?.categories.find((c) => c.id === categoryId)?.name;
  const catTags = useMemo(() => {
    if (!d) return [];
    const byCat: Record<string, string[]> = {
      Кровати: ["С ПМ", "Без ПМ", "Мягкое изголовье"],
      Диваны: ["Прямой", "Угловой", "Модульный", "Раскладной", "С ящиком"],
      Матрасы: ["Жёсткий", "Средний", "Мягкий", "Пружинный", "Беспружинный"],
    };
    const names = (catName && byCat[catName]) || [];
    return d.tags.filter((t) => t.active && (names.includes(t.name) || ["Новинка", "Экспозиция", "Распродажа"].includes(t.name)));
  }, [d, catName]);

  /* §4.7 dirty: любое введённое/выбранное/прикреплённое состояние */
  const dirty =
    Boolean(categoryId) ||
    Boolean(modelId) ||
    Boolean(materialId) ||
    Boolean(sizeId) ||
    tagIds.size > 0 ||
    comment.trim().length > 0 ||
    files.length > 0;

  /** Полный сброс черновика (PHASE 2.4, урок E2E: состояние sheet живёт в
      всегда смонтированном компоненте — без явного сброса reopen показывал
      прошлый шаг и выбранные поля, а discard-confirm обещал сброс). */
  const resetDraft = useCallback(() => {
    setCategoryId("");
    setModelId("");
    setMaterialId("");
    setSizeId("");
    setTagIds(new Set());
    setComment("");
    revokeAll();
    setFiles([]);
    setPreviews([]);
    setProgress(0);
    setDoneCount(0);
    setUpIdx(0);
    setPhase("send");
    setDone(null);
    setDragOver(false);
    setStep(1);
    setConfirmMode(null);
    abortRef.current = false;
    abortCloseRef.current = false;
  }, []);

  /** Немедленное закрытие (мимо guard'ов) — только для внутренних путей,
      где чистота/намерение уже проверены; черновик сбрасывается */
  const doClose = useCallback(() => {
    resetDraft();
    setOpen(false);
  }, [resetDraft, setOpen]);

  /** Guard-закрытие (§4.7): backdrop/handle/Escape/крестик — все через него */
  const attemptClose = useCallback(() => {
    if (busy) {
      /* Во время отправки обычное закрытие запрещено — осознанный cancel flow */
      setConfirmMode("abort");
      return;
    }
    if (dirty || done) {
      setConfirmMode("discard");
      return;
    }
    doClose();
  }, [busy, dirty, done, doClose]);

  /** Осознанная отмена отправки: abort текущего XHR + остановка очереди */
  const abortUpload = useCallback(() => {
    abortRef.current = true;
    abortCloseRef.current = true;
    try {
      xhrRef.current?.abort();
    } catch {
      /* уже завершён */
    }
  }, []);

  /* §4.7: abort завершён (submit вышел из очереди) → осознанное закрытие */
  useEffect(() => {
    if (!busy && abortCloseRef.current) {
      abortCloseRef.current = false;
      abortRef.current = false;
      doClose();
    }
  }, [busy]);

  /* Escape/внешние запросы закрытия (портал вызывает на Escape) — ТОП-слой
     всегда закрывается через guard (§4.7) */
  useEffect(() => {
    if (!open) return;
    const onRequestClose = () => attemptClose();
    window.addEventListener("portal:upload-close", onRequestClose);
    return () => window.removeEventListener("portal:upload-close", onRequestClose);
  }, [open, busy, categoryId, modelId, materialId, sizeId, comment, tagIds, files]);

  const dragControls = useDragControls();

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const ok: File[] = [];
    for (const f of incoming) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
        toast.error(`Формат не поддерживается: ${f.name}`);
        continue;
      }
      if (f.size > MAX_SIZE) {
        toast.error(`Файл больше 25 МБ: ${f.name}`);
        continue;
      }
      ok.push(f);
    }
    setFiles((prev) => {
      const merged = [...prev, ...ok].slice(0, MAX_FILES);
      if (prev.length + ok.length > MAX_FILES) toast.warning(`Выбрано ${prev.length + ok.length} — взяты первые ${MAX_FILES}`);
      setPreviews(merged.map(urlFor));
      return merged;
    });
  }

  function removeAt(i: number) {
    if (busy) return; // во время отправки список зафиксирован
    setFiles((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      // ФИКС F-004: URL берутся из кэша — новых object URL не создаётся
      setPreviews(next.map(urlFor));
      return next;
    });
  }

  /** Один файл → один запрос /api/upload. Резолвится ВСЕГДА (ok/error) —
   *  чтобы сбой одного файла не ронял остальные. Сетевые ошибки и ошибки
   *  сервера превращаются в { ok:false, reason }, а не в исключение. */
  function uploadOne(
    file: File,
    onFrac: (frac: number) => void
  ): Promise<{ ok: boolean; variantId?: string; error?: string }> {
    return new Promise((resolve) => {
      const fd = new FormData();
      fd.set("categoryId", categoryId);
      fd.set("modelId", modelId);
      if (materialId) fd.set("materialId", materialId);
      if (sizeId) fd.set("sizeId", sizeId);
      if (comment) fd.set("comment", comment);
      if (tagIds.size) fd.set("tagIds", [...tagIds].join(","));
      fd.append("photos", file);

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onFrac(Math.min(0.9, (e.loaded / e.total) * 0.9));
      };
      // отправка завершена — дальше сервер обрабатывает (sharp + миниатюры)
      xhr.upload.onload = () => {
        setPhase("proc");
        onFrac(0.9);
      };
      xhr.onerror = () => resolve({ ok: false, error: "Ошибка сети — файл не отправлен" });
      xhr.onabort = () => resolve({ ok: false, error: "Загрузка отменена" });
      xhr.onload = () => {
        let j: Record<string, unknown> = {};
        try {
          j = JSON.parse(xhr.responseText);
        } catch {
          /* пустой ответ */
        }
        if (xhr.status >= 200 && xhr.status < 300 && j.ok) {
          onFrac(1);
          resolve({ ok: true, variantId: String(j.variantId ?? "") });
        } else {
          onFrac(1);
          resolve({ ok: false, error: String(j.error || `Ошибка сервера (${xhr.status})`) });
        }
      };
      xhr.send(fd);
    });
  }

  /** Последовательная загрузка по одному файлу — честный счётчик «N/M».
   *  Успешные файлы убираются из очереди, неудачные ОСТАЮТСЯ для повтора.
   *  PHASE 2.4 §4.7: abortRef останавливает очередь (cancel flow sheet). */
  async function submit() {
    if (busy) return;
    if (!categoryId || !modelId) return toast.error("Выберите категорию и модель");
    if (!files.length) return toast.error("Добавьте хотя бы одно фото");

    const list = [...files];
    const total = list.length;
    setBusy(true);
    setProgress(0);
    setDoneCount(0);
    setUpIdx(0);
    setPhase("send");
    abortRef.current = false;

    type Res = { file: File; ok: boolean; reason?: string; variantId?: string };
    const results: Res[] = [];
    let aborted = false;

    for (let i = 0; i < total; i++) {
      if (abortRef.current) {
        aborted = true;
        break;
      }
      setUpIdx(i);
      setPhase("send");
      const file = list[i];
      const res = await uploadOne(file, (frac) => {
        setProgress(Math.round(((i + frac) / total) * 100));
      });
      if (res.ok) {
        setDoneCount(i + 1);
        results.push({ file, ok: true, variantId: res.variantId });
      } else {
        results.push({ file, ok: false, reason: res.error });
      }
    }

    setBusy(false);
    xhrRef.current = null;

    if (aborted) {
      /* Cancel flow sheet: очередь не трогаем — закрывает abort-эффект */
      toast.warning("Загрузка прервана");
      setProgress(0);
      return;
    }

    const okFiles = results.filter((r) => r.ok);
    const failFiles = results.filter((r) => !r.ok);

    if (okFiles.length === 0) {
      // ничего не ушло — очередь остаётся на месте, причины на экране
      toast.error("Ни одно фото не загружено", {
        description: "Проверьте соединение и попробуйте ещё раз — список сохранён",
      });
      failFiles.slice(0, 5).forEach((r) => toast.warning(`${r.file.name}: ${r.reason}`, { duration: 9000 }));
      if (failFiles.length > 5) toast.warning(`…и ещё ${failFiles.length - 5} с ошибкой`, { duration: 9000 });
      setProgress(0);
      return;
    }

    // успешные убираем из очереди (и отзываем их object URL), неудачные остаются для повтора
    okFiles.forEach((r) => {
      const u = urlCache.current.get(r.file);
      if (u) {
        URL.revokeObjectURL(u);
        urlCache.current.delete(r.file);
      }
    });
    const remaining = failFiles.map((r) => r.file);
    setFiles(remaining);
    setPreviews(remaining.map(urlFor));

    const lastVariantId = [...okFiles].reverse().find((r) => r.variantId)?.variantId ?? "";
    setDone({
      variantId: lastVariantId,
      count: okFiles.length,
      rejected: failFiles.map((r) => ({ name: r.file.name, reason: r.reason ?? "Не принято" })),
    });
    toast.success(
      failFiles.length ? `${okFiles.length} из ${total} фото загружено` : `${okFiles.length} фото загружено`,
      {
        description: failFiles.length
          ? `${failFiles.length} не принято — остались в списке для повтора`
          : "Фотографии уже видны в каталоге у товара",
      }
    );
    failFiles.forEach((r) => toast.warning(`${r.file.name}: ${r.reason}`, { duration: 9000 }));
  }

  /** «Загрузить ещё»: очередь (не принятые) сохраняется, успех-экран гаснет */
  const uploadMore = () => {
    setDone(null);
    setProgress(0);
    setStep(3);
  };

  /* ── Рендер закрытого состояния (AnimatePresence всё равно пустой) ── */
  if (!open) return null;

  const stepTitle = done ? "Готово" : STEPS[step - 1];

  const form = (
    <>
      {/* ── ШАГ 1: Категория + Модель (§4.6) ── */}
      {step === 1 && !done && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Категория *</span>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setModelId("");
              }}
              className="field cursor-pointer"
            >
              <option value="">Выберите…</option>
              {d?.categories.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Модель / серия *</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={!categoryId}
              className="field cursor-pointer disabled:opacity-60"
            >
              <option value="">{categoryId ? "Выберите…" : "Сначала выберите категорию"}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Доступны значения из справочника. Новые пункты добавляет администратор.
          </p>
          {/* CRITICAL STABILITY 7.3: CTA в sticky footer — доступен при клавиатуре,
              как на шаге 3 (единый паттерн sticky-подвала во всех шагах) */}
          <div className="sticky bottom-0 -mx-5 mt-1 border-t border-border bg-[var(--sheet-footer-bg)] px-5 pb-[max(12px,var(--sab))] pt-3 backdrop-blur-[var(--glass-blur)]">
            <button
              type="button"
              disabled={!categoryId || !modelId}
              onClick={() => setStep(2)}
              className="btn-brand flex w-full items-center justify-center gap-2 py-3 text-[14px] disabled:opacity-50"
            >
              Далее
            </button>
          </div>
        </div>
      )}

      {/* ── ШАГ 2: ДОП. ПАРАМЕТРЫ — условный блок (§4.6): ткань/размер/
          признаки зависят от справочников и категории; у категории без
          признаков блока просто нет — жёстких одинаковых ступеней нет ── */}
      {step === 2 && !done && (
        <div className="flex flex-col gap-3">
          {(d?.materials.filter((m) => m.active).length ?? 0) > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Материал / ткань</span>
              <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="field cursor-pointer">
                <option value="">Не указан</option>
                {d?.materials.filter((m) => m.active).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(d?.sizes.filter((s) => s.active).length ?? 0) > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Размер</span>
              <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} className="field cursor-pointer">
                <option value="">Не указан</option>
                {d?.sizes.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {catTags.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Признаки</p>
              <div className="flex flex-wrap gap-1.5">
                {catTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      const next = new Set(tagIds);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      setTagIds(next);
                    }}
                    className={cn("chip", tagIds.has(t.id) && "is-on")}
                    aria-pressed={tagIds.has(t.id)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Комментарий</span>
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: угол слева, изголовье"
              className="field"
              maxLength={200}
            />
          </label>
        </div>
      )}

      {/* sticky-подвал шага 2 (CRITICAL STABILITY 7.3) */}
      {step === 2 && !done && (
        <div className="sticky bottom-0 -mx-5 border-t border-border bg-[var(--sheet-footer-bg)] px-5 pb-[max(12px,var(--sab))] pt-3 backdrop-blur-[var(--glass-blur)]">
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="btn-ghost px-4 py-3 text-[13px]">
              Назад
            </button>
            <button type="button" onClick={() => setStep(3)} className="btn-brand flex-1 py-3 text-[14px]">
              Далее
            </button>
          </div>
        </div>
      )}

      {/* ── ШАГ 3: ФАЙЛЫ + отправка (§4.6) ── */}
      {step === 3 && !done && (
        <div className="flex flex-col gap-4">
          {/* Дропзона (PHASE2 ТЗ 3.6: зона с собственным drag — без tab-swipe) */}
          <div
            data-no-tab-swipe=""
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (busy) return; // во время отправки очередь зафиксирована
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => {
              if (busy) return;
              inputRef.current?.click();
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-all duration-300",
              dragOver
                ? "border-[color:var(--brand)] bg-[rgba(var(--brand-rgb),0.08)] scale-[1.01]"
                : "border-border hover:border-[rgba(var(--brand-rgb),0.5)] hover:bg-[rgba(var(--brand-rgb),0.04)]"
            )}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[rgba(var(--brand-rgb),0.12)] text-[color:var(--brand)] transition-transform duration-300 hover:scale-110">
              <ImagePlus size={22} strokeWidth={2.1} />
            </span>
            <p className="text-[13.5px] font-semibold">Нажмите или перетащите фото</p>
            <p className="text-[11.5px] text-muted-foreground">
              JPG · PNG · WebP · до 25 МБ · максимум {MAX_FILES} за раз
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {/* Превью — во время загрузки каждая плитка показывает свой статус:
              галочка — файл загружен, спиннер — отправляется/обрабатывается */}
          {previews.length > 0 && (
            <div>
              <p className="mb-2 text-[12px] font-semibold text-muted-foreground">
                Выбрано {previews.length} из {MAX_FILES}
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {previews.map((src, i) => (
                  <div key={`${src}-${i}`} className="group relative aspect-square overflow-hidden rounded-xl border border-border">
                    <img src={src} alt={`Предпросмотр ${i + 1}`} className={cn("h-full w-full object-cover transition-opacity", busy && i < doneCount && "opacity-45")} />
                    {busy && i < doneCount && (
                      <span className="absolute inset-0 grid place-items-center">
                        <CheckCircle2 size={22} className="text-[color:var(--brand)]" strokeWidth={2.4} />
                      </span>
                    )}
                    {busy && i === upIdx && (
                      <span className="absolute inset-0 grid place-items-center bg-black/25 backdrop-blur-[2px]">
                        <Loader2 size={22} className="animate-spin text-white" strokeWidth={2.4} />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAt(i);
                      }}
                      aria-label="Убрать фото"
                      className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-100 backdrop-blur transition-all hover:bg-black/80 sm:opacity-0 group-hover:opacity-100"
                    >
                      <X size={12} strokeWidth={2.6} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {busy && (
            <div>
              <div className="flex items-center justify-between text-[11.5px] font-semibold text-muted-foreground">
                <span>
                  Фото {Math.min(upIdx + 1, files.length)} из {files.length} ·{" "}
                  {phase === "send" ? "отправляем…" : "обрабатываем и создаём миниатюры…"}
                </span>
                <span className="tabular">{progress}%</span>
              </div>
              <div
                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Прогресс загрузки"
              >
                <div
                  className="h-full rounded-full bg-[color:var(--brand)] transition-[width] duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* §4.5: CTA в sticky footer — остаётся доступным при клавиатуре */}
          <div className="sticky bottom-0 z-[1] -mx-5 flex gap-2 border-t border-border bg-[var(--sheet-footer-bg)] px-5 pb-[max(12px,var(--sab))] pt-3 backdrop-blur-[var(--glass-blur)]">
            <button type="button" onClick={() => setStep(2)} disabled={busy} className="btn-ghost px-4 py-3 text-[13px] disabled:opacity-45">
              Назад
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !files.length || !categoryId || !modelId}
              className="btn-brand shine flex flex-1 items-center justify-center gap-2 py-3 text-[14px] disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  Загружаем… {Math.min(upIdx + 1, Math.max(files.length, 1))}/{Math.max(files.length, 1)}
                </>
              ) : (
                <>
                  <UploadCloud size={17} strokeWidth={2.3} />
                  Загрузить {files.length > 0 ? `${files.length} фото` : ""}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── SUCCESS STATE (§4.8): внутри sheet + CTA; toast — доп. feedback ── */}
      {done && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[rgba(var(--brand-rgb),0.15)]">
            <CheckCircle2 size={32} className="text-[color:var(--brand)]" />
          </span>
          <h2 className="font-display text-lg font-bold">{done.count} фото загружено</h2>
          <p className="text-[13px] text-muted-foreground">
            Фотографии обработаны и добавлены в каталог. Они уже видны у товара.
          </p>
          {done.rejected.length > 0 && (
            <div className="w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-left">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Не принято ({done.rejected.length})
              </p>
              <ul className="mt-1.5 space-y-1">
                {done.rejected.map((r) => (
                  <li key={r.name} className="truncate text-[12px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{r.name}</span> — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex w-full flex-wrap justify-center gap-2">
            {done.variantId && (
              <button
                type="button"
                onClick={() => {
                  const id = done.variantId;
                  doClose();
                  openProduct(id, "catalog");
                }}
                className="btn-brand flex items-center gap-2 px-5 py-2.5 text-[13px]"
              >
                <Images size={15} strokeWidth={2.3} />
                Показать в каталоге
              </button>
            )}
            <button
              type="button"
              onClick={uploadMore}
              className="btn-ghost px-5 py-2.5 text-[13px]"
            >
              {done.rejected.length > 0 ? "Повторить не принятые" : "Загрузить ещё"}
            </button>
            <button
              type="button"
              onClick={attemptClose}
              className="btn-ghost px-5 py-2.5 text-[13px]"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {/* ── §4.7 CONFIRM: discard / abort — inline, без window.confirm ── */}
      <AnimatePresence>
        {confirmMode && (
          <motion.div
            key="confirm"
            data-upload-confirm=""
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute inset-x-3 bottom-3 z-[2] rounded-2xl border border-border bg-[var(--glass-strong)] p-4 shadow-[var(--shadow-pop)] backdrop-blur-[var(--glass-blur)]"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[#fbbf24]" strokeWidth={2.2} />
              <div className="min-w-0">
                <p className="text-[13px] font-bold">
                  {confirmMode === "abort" ? "Прервать загрузку?" : "Закрыть без сохранения?"}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  {confirmMode === "abort"
                    ? "Очередь остановится на текущем файле; уже загруженные фото сохранятся в каталоге."
                    : "Выбранная категория, параметры и файлы будут сброшены."}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmMode(null)}
                className="btn-ghost flex-1 px-3 py-2.5 text-[12.5px]"
              >
                {confirmMode === "abort" ? "Продолжить загрузку" : "Остаться"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmMode === "abort") {
                    setConfirmMode(null);
                    abortUpload();
                  } else {
                    doClose();
                  }
                }}
                className="flex-1 rounded-xl border border-[rgba(251,113,133,.35)] bg-[rgba(251,113,133,.12)] px-3 py-2.5 text-[12.5px] font-bold text-[#fb7185] transition-all active:scale-[0.98]"
              >
                {confirmMode === "abort" ? "Прервать" : "Закрыть"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop: гасит контент; тап — guard-закрытие (§4.7). З-слой
              выше панели навигации — page swipe/panel drag под sheet
              не работают (§5) */}
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[var(--z-sheet)] bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={attemptClose}
            aria-hidden="true"
          />

          {isDesktop ? (
            /* ── DESKTOP: центрированная glass-карточка (§4.4) ── */
            <motion.div
              key="dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Загрузка фото"
              data-no-tab-swipe=""
              data-upload-sheet=""
              className="fixed inset-0 z-[var(--z-sheet)] grid place-items-center p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-[var(--sheet-bg)] shadow-[var(--shadow-pop)] backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturation)]"
                initial={{ opacity: 0, scale: 0.94, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <SheetHeader step={step} title={stepTitle} isDone={Boolean(done)} onClose={attemptClose} busy={busy} />
                <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-5" data-upload-sheet-body="">
                  {form}
                </div>
              </motion.div>
            </motion.div>
          ) : (
            /* ── MOBILE: bottom sheet, spring снизу —
               Якорь низа = var(--kb-overlay) — фактическое перекрытие
               клавиатурой (iOS>0, Android≈0): подъём плавный (220 мс).
               CRITICAL STABILITY 7.1/7.2: ЯВНАЯ высота 86dvh (не только
               maxHeight!): sheet больше НЕ сжимается по контенту до ~40%
               экрана; при клавиатуре height-clamp ограничивает доступной
               областью (sheet НЕ превращается в маленькую карточку:
               при kb 40% это ~55dvh, скроллится только внутренний контент). */
            <motion.div
              key="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Загрузка фото"
              data-no-tab-swipe=""
              data-upload-sheet=""
              className="fixed inset-x-0 z-[var(--z-sheet)] flex flex-col rounded-t-[28px] border-t border-x border-border bg-[var(--sheet-bg)] shadow-[0_-18px_50px_-18px_rgba(0,0,0,0.55)] backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturation)]"
              style={{
                bottom: "var(--kb-overlay, 0px)",
                height: "min(86dvh, calc(100dvh - max(18px, var(--sat)) - var(--kb-overlay, 0px) - 10px))",
                transition: "bottom 220ms cubic-bezier(0.22, 0.61, 0.36, 1)",
              }}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={sheetSpring}
              drag={busy ? false : "y"}
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.55 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 110 || info.velocity.y > 500) attemptClose();
              }}
            >
              {/* Handle: свайп вниз — guard-закрытие (§4.7); drag стартует
                  ТОЛЬКО с handle — вертикальный скролл контента не конфликтует */}
              <div
                className="flex shrink-0 cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing"
                aria-hidden="true"
                onPointerDown={(e) => {
                  if (!busy) dragControls.start(e);
                }}
              >
                <span className="h-1 w-10 rounded-full bg-[var(--border-strong)]" />
              </div>
              <SheetHeader step={step} title={stepTitle} isDone={Boolean(done)} onClose={attemptClose} busy={busy} />
              <div
                ref={bodyRef}
                data-upload-sheet-body=""
                onFocusCapture={onBodyFocusCapture}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3 pt-3"
              >
                {form}
              </div>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

/** Шапка sheet: заголовок шага + точки прогресса + крестик (§4.7 guard).
 *  CRITICAL STABILITY 7.5: читаемость степпера — active чёткий (широкая
 *  капсула + яркий текст), completed мягкий, future вторичный. */
function SheetHeader({
  step,
  title,
  isDone,
  onClose,
  busy,
}: {
  step: number;
  title: string;
  isDone: boolean;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-2">
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-display text-[15px] font-bold leading-tight">Загрузка фото</h2>
        <div className="mt-1 flex items-center gap-2">
          {!isDone &&
            STEPS.map((label, i) => {
              const isActive = i + 1 === step;
              const isDone2 = i + 1 < step;
              return (
                <span key={label} className="flex items-center gap-1" aria-current={isActive ? "step" : undefined}>
                  <span
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-200",
                      isActive ? "w-5 bg-[var(--brand)]" : isDone2 ? "w-1.5 bg-[var(--brand)]/45" : "w-1.5 bg-[var(--border-strong)]"
                    )}
                  />
                  <span
                    className={cn(
                      "text-[11px] font-bold uppercase tracking-wide transition-colors",
                      isActive ? "text-foreground" : isDone2 ? "text-muted-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {label}
                  </span>
                </span>
              );
            })}
          {isDone && (
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--brand)]">
              <CheckCircle2 size={12} strokeWidth={2.4} />
              {title}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        aria-label="Закрыть загрузку"
        onClick={onClose}
        disabled={busy}
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground transition-all",
          busy ? "opacity-45" : "hover:text-foreground active:scale-90"
        )}
      >
        <X size={16} strokeWidth={2.4} />
      </button>
    </div>
  );
}
