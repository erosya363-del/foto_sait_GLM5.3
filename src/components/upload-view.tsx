"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UploadCloud, X, ImagePlus, CheckCircle2, Loader2, Images } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePortal } from "@/lib/store";
import type { Dictionaries } from "@/lib/portal";

const MAX_FILES = 10;
const MAX_SIZE = 25 * 1024 * 1024;

export function UploadView() {
  const inputRef = useRef<HTMLInputElement>(null);
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
  const openProduct = usePortal((s) => s.openProduct);

  /* ФИКС F-004: кэш object URL на файл — URL создаётся один раз на файл,
     переиспользуется при удалении соседей и отзывается при очистке.
     Раньше каждый removeAt/createObjectURL терял старые URL — утечка памяти. */
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
  // отзываем все URL при уходе со страницы загрузки
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

  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      return r.json();
    },
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
   *  Успешные файлы убираются из очереди, неудачные ОСТАЮТСЯ для повтора. */
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

    type Res = { file: File; ok: boolean; reason?: string; variantId?: string };
    const results: Res[] = [];

    for (let i = 0; i < total; i++) {
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

  if (done) {
    return (
      <div className="glass mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl px-6 py-14 text-center rise">
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
        <div className="flex flex-wrap justify-center gap-2">
          {done.variantId && (
            <button
              type="button"
              onClick={() => {
                const id = done.variantId;
                setDone(null);
                openProduct(id, "catalog");
              }}
              className="btn-brand flex items-center gap-2 px-5 py-2.5 text-[13px]"
            >
              <Images size={15} strokeWidth={2.3} />
              Показать в каталоге
            </button>
          )}
          <button type="button" onClick={() => setDone(null)} className="btn-ghost px-5 py-2.5 text-[13px]">
            {done.rejected.length > 0 ? "Повторить не принятые" : "Загрузить ещё"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="rise">
        <h1 className="font-display text-xl font-bold sm:text-2xl">
          Загрузка <span className="gradient-text">фото</span>
        </h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Выбирайте только из готовых справочников — пункты создаёт администратор
        </p>
      </div>

      <div className="glass rise rise-1 flex flex-col gap-4 rounded-3xl p-5">
        {/* Справочники */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              className="field cursor-pointer disabled:opacity-45"
            >
              <option value="">Выберите…</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
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
        </div>

        {/* Признаки */}
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

        {/* Комментарий */}
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
            "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-all duration-300",
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
                  { }
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
                    className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-all hover:bg-black/80 group-hover:opacity-100"
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

        <button
          type="button"
          onClick={submit}
          disabled={busy || !files.length || !categoryId || !modelId}
          className="btn-brand shine flex items-center justify-center gap-2 py-3 text-[14px] disabled:opacity-50"
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
  );
}
