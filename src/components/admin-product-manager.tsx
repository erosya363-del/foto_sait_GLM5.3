"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Package, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Dictionaries } from "@/lib/portal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * «Товары» — лёгкое создание и контроль контента.
 * Верхняя карточка: мастер создания — категория и модель ЗАДАЮТСЯ ОДНИМ ПОЛЕМ:
 * можно выбрать подсказку из существующих, а можно просто вписать новую —
 * переключатели «из списка / + новая» убраны (путали владельца: «зачем выбирать
 * старое?»). Сервер сам создаст новые категорию/модель (quickCreateVariant).
 * Ниже: список всех товаров: переименование подписи + УДАЛЕНИЕ (мягкое:
 * товар исчезает, фото — в корзину; «Вернуть» из корзины оживляет товар).
 */

async function api(body: Record<string, unknown>) {
  const r = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Ошибка");
  return j;
}

type VariantRowData = {
  id: string;
  label: string;
  categoryName: string;
  variantName: string | null;
  active: boolean;
  photoCount: number;
  createdAt: string;
};

/** Строка товара: переименование подписи + удаление (мягкое) с подтверждением */
function VariantItem({ v, onChanged }: { v: VariantRowData; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(v.variantName ?? "");

  async function save() {
    try {
      await api({ action: "renameVariant", id: v.id, variantName: draft });
      toast.success("Подпись обновлена");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function remove() {
    try {
      const r = (await api({ action: "deleteVariant", id: v.id })) as { photosToTrash: number };
      toast.success("Товар удалён", {
        description: r.photosToTrash > 0
          ? `Фото (${r.photosToTrash}) — в корзине, можно вернуть`
          : undefined,
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <>
      <div
        className={cn(
          "lg-row",
          !v.active && "opacity-50"
        )}
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[rgba(var(--brand-rgb),0.12)] text-[color:var(--brand)]">
          <Package size={16} strokeWidth={2.2} />
        </div>
        {editing ? (
          <>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="field flex-1 py-1.5 text-[13px]"
              placeholder="Подпись варианта (напр. «Угловой»)"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <button type="button" onClick={save} aria-label="Сохранить" className="lg-iconbtn is-ok">
              <Check size={14} strokeWidth={2.6} />
            </button>
            <button type="button" onClick={() => setEditing(false)} aria-label="Отмена" className="lg-iconbtn">
              <X size={14} strokeWidth={2.4} />
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { setDraft(v.variantName ?? ""); setEditing(true); }} className="min-w-0 flex-1 text-left" title="Нажмите, чтобы изменить подпись">
              <p className="truncate text-[13.5px] font-semibold">{v.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {v.categoryName} · фото: <span className={cn(v.photoCount === 0 && "font-bold text-[#fb7185]")}>{v.photoCount}</span>
                {v.variantName && <span className="text-border"> · </span>}{v.variantName}
              </p>
            </button>
            <button
              type="button"
              onClick={() => { setDraft(v.variantName ?? ""); setEditing(true); }}
              aria-label="Переименовать"
              title="Переименовать"
              className="lg-iconbtn is-brand"
            >
              <Pencil size={13} strokeWidth={2.4} />
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label="Удалить товар"
              title="Удалить (фото — в корзину)"
              className="lg-iconbtn is-danger"
            >
              <Trash2 size={13} strokeWidth={2.4} />
            </button>
          </>
        )}
      </div>

      {/* Подтверждение удаления: товар исчезнет, фото уйдут в корзину (возврат — из корзины) */}
      <AlertDialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Удалить «{v.label}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Товар исчезнет из каталога и админки. Фото ({v.photoCount}) уйдут в корзину и хранятся 30 дней:
              «Фото» → «Корзина» → «Вернуть» оживит товар целиком.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirming(false); remove(); }}
              className="rounded-xl bg-[#fb7185] text-white hover:bg-[#f43f5e]"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ProductManager() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<null | {
    categoryName: string;
    modelName: string;
    isNewCategory: boolean;
    isNewModel: boolean;
  }>(null);

  // Справочники
  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      if (!r.ok) throw new Error("Ошибка загрузки справочников");
      return r.json();
    },
  });

  // Товары (ТЗ v3.0 п.9: isLoading → skeleton сразу, пустого экрана нет)
  const { data: variants, isLoading } = useQuery<{ items: VariantRowData[] }>({
    queryKey: ["admin-variants"],
    queryFn: async () => {
      const r = await fetch("/api/admin?view=variants");
      if (!r.ok) throw new Error("Ошибка загрузки товаров");
      return r.json();
    },
  });

  /* ── ОДНО поле вместо переключателей «из списка / + новая» ──────────
     Печатаем новое значение или выбираем подсказку — старый список больше
     не заставляет себя листать. Совпадения разрешаются БЕЗ УЧЁТА РЕГИСТРА:
     «кровати» переиспользует «Кровати», дубли не плодятся. */
  const [categoryName, setCategoryName] = useState("");
  const [modelName, setModelName] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [variantName, setVariantName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const activeCategories = useMemo(() => (d?.categories ?? []).filter((c) => c.active), [d]);
  const activeModels = useMemo(() => (d?.models ?? []).filter((m) => m.active), [d]);

  /** Введённая категория совпала с существующей → переиспользуем её, а не создаём дубли */
  const matchedCategory = useMemo(() => {
    const q = categoryName.trim().toLowerCase();
    if (!q) return null;
    return activeCategories.find((c) => c.name.toLowerCase() === q) ?? null;
  }, [activeCategories, categoryName]);

  /** Подсказки моделей: у совпавшей категории — её модели; пока категория не определена — все активные */
  const modelSuggestions = useMemo(
    () => (matchedCategory ? activeModels.filter((m) => m.categoryId === matchedCategory.id) : activeModels),
    [activeModels, matchedCategory]
  );

  /** Введённая модель совпала с существующей в этой категории → переиспользуем */
  const matchedModel = useMemo(() => {
    const q = modelName.trim().toLowerCase();
    if (!q || !matchedCategory) return null;
    return activeModels.find((m) => m.categoryId === matchedCategory.id && m.name.toLowerCase() === q) ?? null;
  }, [activeModels, matchedCategory, modelName]);

  /** Подсказки подписи — из уже заведённых товаров (Угловой, Прямой, С ПМ…) */
  const signatureSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const it of variants?.items ?? []) if (it.variantName) set.add(it.variantName);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [variants]);

  function resetForm() {
    setCategoryName(""); setModelName("");
    setMaterialId(""); setSizeId(""); setVariantName("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function doCreate() {
    setBusy(true);
    try {
      const cat = categoryName.trim();
      const mod = modelName.trim();
      // Совпавшие с существующими (без учёта регистра) уходят id'шниками —
      // переиспользование; новые — именами: сервер сам их создаст
      const created = (await api({
        action: "quickCreateVariant",
        categoryId: matchedCategory?.id ?? "",
        categoryName: matchedCategory ? "" : cat,
        modelId: matchedModel?.id ?? "",
        modelName: matchedModel ? "" : mod,
        materialId,
        sizeId,
        variantName,
      })) as { variantId: string; categoryId: string; modelId: string; createdCategory: boolean; createdModel: boolean };

      // 2) Фото — через штатную загрузку (вариант найдётся по категории+модели)
      let uploaded = 0;
      const rejected: string[] = [];
      if (files.length > 0) {
        const fd = new FormData();
        for (const f of files) fd.append("photos", f);
        fd.append("categoryId", created.categoryId);
        fd.append("modelId", created.modelId);
        if (materialId) fd.append("materialId", materialId);
        if (sizeId) fd.append("sizeId", sizeId);
        const ur = await fetch("/api/upload", { method: "POST", body: fd });
        const uj = await ur.json();
        if (!ur.ok) throw new Error(uj.error || "Не удалось загрузить фото");
        uploaded = uj.uploaded ?? 0;
        for (const rj of uj.rejected ?? []) rejected.push(`${rj.name}: ${rj.reason}`);
      }

      toast.success(
        uploaded > 0
          ? `Товар создан, фото загружено: ${uploaded}`
          : "Товар создан — фото можно загрузить позже в разделе «Загрузка»",
        rejected.length ? { description: `Отклонено: ${rejected.join("; ")}`, duration: 9000 } : undefined
      );
      resetForm();
      qc.invalidateQueries({ queryKey: ["admin-variants"] });
      qc.invalidateQueries({ queryKey: ["dictionaries"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function submit() {
    const cat = categoryName.trim();
    const mod = modelName.trim();
    if (!cat) return toast.error("Укажите категорию — выберите из подсказок или впишите новую");
    if (!mod) return toast.error("Укажите модель — выберите из подсказок или впишите новую");
    if (files.length > 10) return toast.error("Максимум 10 фото за раз");
    setPending({
      categoryName: matchedCategory?.name ?? cat,
      modelName: matchedModel?.name ?? mod,
      isNewCategory: !matchedCategory,
      isNewModel: !matchedModel,
    });
  }

  const whatWillHappen = pending
    ? [
        `категория: ${pending.categoryName}${pending.isNewCategory ? " (создастся)" : ""}`,
        `модель: ${pending.modelName}${pending.isNewModel ? " (создастся)" : ""}`,
        files.length ? `фото: ${files.length} шт.` : "без фото (добавите позже)",
      ].join(", ")
    : "";

  return (
    <div className="flex flex-col gap-3">
      {/* ── Мастер создания ── */}
      <div className="glass flex flex-col gap-3 rounded-2xl p-3 sm:p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Новый товар · категория, модель и фото
        </p>

        {/* Подсказки (нативный datalist): старый список доступен, но НЕ навязан —
            можно просто вписать новое значение */}
        <datalist id="dl-categories">
          {activeCategories.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        <datalist id="dl-models">
          {modelSuggestions.map((m) => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
        <datalist id="dl-signatures">
          {signatureSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>

        {/* Категория — одно поле: выбрать или вписать новую */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Категория — из списка или новая *
          </span>
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            list="dl-categories"
            placeholder="Например: Кровати"
            className="field"
            autoComplete="off"
          />
        </label>

        {/* Модель — одно поле: выбрать или вписать новую */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Модель / серия — из списка или новая *
          </span>
          <input
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            list="dl-models"
            placeholder="Например: Ergomotion X"
            className="field"
            autoComplete="off"
          />
        </label>

        {/* Ткань / размер / подпись — по желанию */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="field cursor-pointer">
            <option value="">Ткань (необязательно)</option>
            {(d?.materials ?? []).filter((m) => m.active).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} className="field cursor-pointer">
            <option value="">Размер (необязательно)</option>
            {(d?.sizes ?? []).filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input value={variantName} onChange={(e) => setVariantName(e.target.value)} list="dl-signatures" placeholder="Подпись: Угловой, Прямой, С ПМ…" className="field" />
        </div>

        {/* Фото */}
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted-foreground transition-colors hover:border-[rgba(var(--brand-rgb),0.5)]">
          <ImagePlus size={16} className="text-[color:var(--brand)]" />
          {files.length ? `Фото выбрано: ${files.length}` : "Фото сразу или позже — до 10 файлов"}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>

        <button type="button" onClick={submit} disabled={busy} className="btn-brand shine flex items-center justify-center gap-1.5 px-4 py-2.5 text-[13px] disabled:opacity-60">
          <Plus size={15} strokeWidth={2.6} />
          Создать товар
        </button>
      </div>

      {/* Подтверждение */}
      <AlertDialog open={pending != null} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Создать товар?</AlertDialogTitle>
            <AlertDialogDescription>
              {whatWillHappen}. Существующие категория/модель переиспользуются, дубликат товара сервер не допустит.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={doCreate} className="rounded-xl">Создать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Список товаров: переход → skeleton → данные (ТЗ v3.0 п.9) ── */}
      <div className="grid max-h-[44dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-2xl" />)
        ) : (
          <>
            {(variants?.items ?? []).map((v) => (
              <VariantItem key={v.id} v={v} onChanged={() => qc.invalidateQueries({ queryKey: ["admin-variants"] })} />
            ))}
            {variants && variants.items.length === 0 && (
              <p className="col-span-full py-6 text-center text-[12.5px] text-muted-foreground">
                Товаров пока нет — создайте первый выше
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
