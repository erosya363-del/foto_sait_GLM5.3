"use client";

import { useMemo, useRef, useState } from "react";
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
  const [done, setDone] = useState<{ variantId: string; count: number; rejected: Array<{ name: string; reason: string }> } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const openProduct = usePortal((s) => s.openProduct);

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
      setPreviews(merged.map((f) => URL.createObjectURL(f)));
      return merged;
    });
  }

  function removeAt(i: number) {
    setFiles((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      setPreviews(next.map((f) => URL.createObjectURL(f)));
      return next;
    });
  }

  /** Загрузка через XHR — только он даёт реальный прогресс отправки */
  function submit() {
    if (!categoryId || !modelId) return toast.error("Выберите категорию и модель");
    if (!files.length) return toast.error("Добавьте хотя бы одно фото");

    const fd = new FormData();
    fd.set("categoryId", categoryId);
    fd.set("modelId", modelId);
    if (materialId) fd.set("materialId", materialId);
    if (sizeId) fd.set("sizeId", sizeId);
    if (comment) fd.set("comment", comment);
    if (tagIds.size) fd.set("tagIds", [...tagIds].join(","));
    files.forEach((f) => fd.append("photos", f));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    setBusy(true);
    setProgress(0);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        // Отправка — до 70% общего прогресса, остальное — обработка на сервере
        const pct = Math.round((e.loaded / e.total) * 70);
        setProgress(pct);
      }
    };

    xhr.onerror = () => {
      setBusy(false);
      toast.error("Проблема с сетью — проверьте соединение и попробуйте ещё раз");
    };

    xhr.onabort = () => {
      setBusy(false);
      toast.info("Загрузка отменена");
    };

    xhr.onload = () => {
      setBusy(false);
      setProgress(100);
      let j: Record<string, unknown> = {};
      try {
        j = JSON.parse(xhr.responseText);
      } catch {
        /* пустой ответ */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const rej = (j.rejected as Array<{ name: string; reason: string }>) ?? [];
        setDone({ variantId: String(j.variantId), count: Number(j.uploaded), rejected: rej });
        toast.success(`${j.uploaded} фото загружено`, {
          description: "Фотографии уже видны в каталоге у товара",
        });
        rej.forEach((r) => toast.warning(`${r.name}: ${r.reason}`, { duration: 9000 }));
        setFiles([]);
        setPreviews([]);
      } else {
        const msg = String(j.error || `Ошибка сервера (${xhr.status})`);
        toast.error(msg, { duration: 8000 });
        const rej = (j.rejected as Array<{ name: string; reason: string }>) ?? [];
        rej.forEach((r) => toast.warning(`${r.name}: ${r.reason}`, { duration: 9000 }));
      }
    };

    xhr.send(fd);
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
          <button type="button" onClick={() => setDone(null)} className="btn-ghost px-5 py-2.5 text-[13px]">
            Загрузить ещё
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

        {/* Дропзона */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
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

        {/* Превью */}
        {previews.length > 0 && (
          <div>
            <p className="mb-2 text-[12px] font-semibold text-muted-foreground">
              Выбрано {previews.length} из {MAX_FILES}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {previews.map((src, i) => (
                <div key={`${src}-${i}`} className="group relative aspect-square overflow-hidden rounded-xl border border-border">
                  { }
                  <img src={src} alt={`Предпросмотр ${i + 1}`} className="h-full w-full object-cover" />
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
              <span>{progress < 70 ? "Отправляем фото…" : "Обрабатываем и создаём миниатюры…"}</span>
              <span className="tabular">{progress}%</span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
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
              Загружаем… {progress}%
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
