"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Package, Power, Plus, X } from "lucide-react";
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
 * Шаг 5: «Товар» — лёгкое создание и контроль контента.
 * Верхняя карточка: мастер создания (категория → модель → ткань/размер → фото).
 * Ниже: список всех товаров с счётчиком фото, скрытием и переименованием.
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

/** Строка товара: переименование подписи + скрытие/возврат */
function VariantItem({ v, onChanged }: { v: VariantRowData; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
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

  async function toggle() {
    try {
      await api({ action: "toggleVariant", id: v.id, active: !v.active });
      toast.success(v.active ? "Товар скрыт из каталога" : "Товар возвращён в каталог");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 transition-all duration-300 hover:border-[rgba(var(--brand-rgb),0.35)]",
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
          <button type="button" onClick={save} aria-label="Сохранить" className="grid h-8 w-8 place-items-center rounded-lg bg-[rgba(var(--brand-rgb),0.15)] text-[color:var(--brand)] transition-transform hover:scale-110">
            <Check size={14} strokeWidth={2.6} />
          </button>
          <button type="button" onClick={() => setEditing(false)} aria-label="Отмена" className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-muted-foreground">
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
            onClick={toggle}
            aria-label={v.active ? "Скрыть" : "Вернуть"}
            title={v.active ? "Скрыть из каталога" : "Вернуть в каталог"}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-all",
              v.active
                ? "border-transparent bg-secondary text-muted-foreground hover:text-[#fb7185]"
                : "border-[rgba(var(--brand-rgb),0.4)] text-[color:var(--brand)]"
            )}
          >
            <Power size={13} strokeWidth={2.4} />
          </button>
        </>
      )}
    </div>
  );
}

export function ProductManager() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<null | { categoryName: string; modelName: string }>(null);

  // Справочники
  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      if (!r.ok) throw new Error("Ошибка загрузки справочников");
      return r.json();
    },
  });

  // Товары
  const { data: variants } = useQuery<{ items: VariantRowData[] }>({
    queryKey: ["admin-variants"],
    queryFn: async () => {
      const r = await fetch("/api/admin?view=variants");
      if (!r.ok) throw new Error("Ошибка загрузки товаров");
      return r.json();
    },
  });

  const [categoryMode, setCategoryMode] = useState<"existing" | "new">("existing");
  const [modelMode, setModelMode] = useState<"existing" | "new">("existing");
  const [categoryId, setCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [variantName, setVariantName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const modelsOfCategory = useMemo(
    () => (d?.models ?? []).filter((m) => m.categoryId === categoryId && m.active),
    [d, categoryId]
  );

  function resetForm() {
    setCategoryMode("existing"); setCategoryId(""); setCategoryName("");
    setModelMode("existing"); setModelId(""); setModelName("");
    setMaterialId(""); setSizeId(""); setVariantName("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function doCreate() {
    setBusy(true);
    try {
      // 1) Создаём товар (категория/модель — готовые или на лету)
      const created = (await api({
        action: "quickCreateVariant",
        categoryId: categoryMode === "existing" ? categoryId : "",
        categoryName: categoryMode === "new" ? categoryName : "",
        modelId: modelMode === "existing" ? modelId : "",
        modelName: modelMode === "new" ? modelName : "",
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
    const cat = categoryMode === "new" ? categoryName.trim() : categoryId;
    const mod = modelMode === "new" ? modelName.trim() : modelId;
    if (!cat) return toast.error("Выберите или введите категорию");
    if (!mod) return toast.error("Выберите или введите модель");
    if (files.length > 10) return toast.error("Максимум 10 фото за раз");
    setPending({
      categoryName: categoryMode === "new" ? categoryName.trim() : (d?.categories.find((c) => c.id === categoryId)?.name ?? ""),
      modelName: modelMode === "new" ? modelName.trim() : (d?.models.find((m) => m.id === modelId)?.name ?? ""),
    });
  }

  const whatWillHappen = pending
    ? [
        `категория${categoryName === pending.categoryName && categoryMode === "new" ? " (создастся)" : ""}: ${pending.categoryName}`,
        `модель: ${pending.modelName}`,
        files.length ? `фото: ${files.length} шт.` : "без фото (добавите позже)",
      ].join(", ")
    : "";

  return (
    <div className="flex flex-col gap-3">
      {/* ── Мастер создания ── */}
      <div className="glass flex flex-col gap-3 rounded-2xl p-3 sm:p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Новый товар · три поля и фото
        </p>

        {/* Категория */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            {(["existing", "new"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCategoryMode(m)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                  categoryMode === m
                    ? "bg-[rgba(var(--brand-rgb),0.18)] text-[color:var(--brand)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "existing" ? "Категория из списка" : "+ Новая категория"}
              </button>
            ))}
          </div>
          {categoryMode === "existing" ? (
            <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setModelId(""); }} className="field cursor-pointer">
              <option value="">Категория *</option>
              {(d?.categories ?? []).filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Например: Кресла" className="field" />
          )}
        </div>

        {/* Модель */}
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            {(["existing", "new"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModelMode(m)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                  modelMode === m
                    ? "bg-[rgba(var(--brand-rgb),0.18)] text-[color:var(--brand)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "existing" ? "Модель из списка" : "+ Новая модель"}
              </button>
            ))}
          </div>
          {modelMode === "existing" ? (
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="field cursor-pointer" disabled={!categoryId}>
              <option value="">{categoryId ? "Модель *" : "Сначала выберите категорию"}</option>
              {modelsOfCategory.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : (
            <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Например: Ричмонд" className="field" />
          )}
        </div>

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
          <input value={variantName} onChange={(e) => setVariantName(e.target.value)} placeholder="Подпись (напр. «Угловой»)" className="field" />
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
        <AlertDialogContent className="rounded-2xl border-border">
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

      {/* ── Список товаров ── */}
      <div className="grid max-h-[44dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {(variants?.items ?? []).map((v) => (
          <VariantItem key={v.id} v={v} onChanged={() => qc.invalidateQueries({ queryKey: ["admin-variants"] })} />
        ))}
        {variants && variants.items.length === 0 && (
          <p className="col-span-full py-6 text-center text-[12.5px] text-muted-foreground">
            Товаров пока нет — создайте первый выше
          </p>
        )}
      </div>
    </div>
  );
}
