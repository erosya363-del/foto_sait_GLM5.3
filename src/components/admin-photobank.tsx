"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Images, Pencil, Trash2, Undo2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Шаг 5: Фотобанк с корзиной. П.4 ТЗ:
 *  — просмотр всех фото с привязкой;
 *  — РЕДАКТИРОВАНИЕ ПРИВЯЗКИ (карандаш на фото): категория/модель/ткань/размер/
 *    подпись — файл НЕ перезаливается, переезжает только строка в БД;
 *  — отдельная кнопка «Удалить фотографию» с подтверждением (→ корзина);
 *  «Активные» — выбор галками, удаление = мягкое (в корзину, можно вернуть);
 *  «Корзина»  — вернуть / удалить навсегда / очистить целиком (30 дней).
 */

type PhotoRow = {
  id: string;
  url: string;
  thumbUrl: string;
  comment: string | null;
  variantId: string;
  categoryId: string;
  categoryName: string;
  modelId: string;
  modelName: string;
  materialId: string | null;
  materialName: string | null;
  sizeId: string | null;
  sizeName: string | null;
  variantName: string | null;
  variantPhotoCount: number;
};

type TrashItem = {
  id: string;
  url: string;
  thumbUrl: string;
  daysLeft: number;
  variantLabel: string;
  categoryName: string;
};

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

/* ── Редактирование привязки фото (п.4 ТЗ) ────────────────────────────────
   Пример из ТЗ: фото кровати случайно привязали к дивану → открыть фото →
   «Редактировать» → Диван → Кровать + правильные модель/ткань/размер →
   «Сохранить». Файл фото остаётся тем же. */
function EditPhotoDialog({ photo, onClose }: { photo: PhotoRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      if (!r.ok) throw new Error("Ошибка загрузки справочников");
      return r.json();
    },
  });

  const [categoryId, setCategoryId] = useState(photo.categoryId);
  const [modelId, setModelId] = useState(photo.modelId);
  const [materialId, setMaterialId] = useState(photo.materialId ?? "");
  const [sizeId, setSizeId] = useState(photo.sizeId ?? "");
  const [variantName, setVariantName] = useState(photo.variantName ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const modelsOfCategory = (d?.models ?? []).filter((m) => m.categoryId === categoryId && m.active);

  async function save() {
    if (!categoryId) return toast.error("Выберите категорию");
    if (!modelId) return toast.error("Выберите модель");
    setBusy(true);
    try {
      await api({
        action: "movePhoto",
        id: photo.id,
        categoryId,
        modelId,
        materialId,
        sizeId,
        variantName,
      });
      toast.success("Привязка фото обновлена");
      qc.invalidateQueries({ queryKey: ["photobank"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["admin-variants"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin?photoId=${photo.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Не удалось удалить фото");
      toast.success("Фотография удалена", {
        description: "Оказалась в корзине — можно вернуть в течение 30 дней",
        duration: 7000,
      });
      qc.invalidateQueries({ queryKey: ["photobank"] });
      qc.invalidateQueries({ queryKey: ["admin-trash"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["admin-variants"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      setConfirmDel(false);
    }
  }

  const bindingNow = [photo.categoryName, photo.modelName, photo.materialName, photo.sizeName, photo.variantName]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
        <DialogContent className="glass-panel sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Редактировать фото</DialogTitle>
            <DialogDescription className="pr-6">
              Сейчас: <span className="font-semibold text-foreground">{bindingNow || "без привязки"}</span>.{" "}
              Измените привязку — сам файл не перезаливается.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2.5">
            {/* Категория */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Категория *</span>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setModelId("");
                }}
                className="field cursor-pointer"
              >
                {(d?.categories ?? []).filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Модель */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Модель *</span>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="field cursor-pointer"
                disabled={!categoryId}
              >
                <option value="">{categoryId ? "Выберите модель" : "Сначала выберите категорию"}</option>
                {modelsOfCategory.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
                {/* Текущая модель всегда в списке, даже если категория/модель отключены */}
                {categoryId === photo.categoryId && !modelsOfCategory.some((m) => m.id === photo.modelId) && (
                  <option value={photo.modelId}>{photo.modelName}</option>
                )}
              </select>
            </div>

            {/* Ткань / размер / подпись */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="field cursor-pointer">
                <option value="">Ткань — не указана</option>
                {(d?.materials ?? []).filter((m) => m.active || m.id === photo.materialId).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} className="field cursor-pointer">
                <option value="">Размер — не указан</option>
                {(d?.sizes ?? []).filter((s) => s.active || s.id === photo.sizeId).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <input
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              placeholder="Подпись варианта (напр. «Угловой»)"
              className="field"
            />

            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary/60 p-2">
              <img src={photo.thumbUrl || photo.url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              <p className="text-[11.5px] leading-snug text-muted-foreground">
                Фото привязано к товару, где уже {photo.variantPhotoCount} фото. При смене привязки оно переедет
                к выбранной связке — дубликат товара не создаётся.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            {/* Отдельная кнопка удаления (п.4 ТЗ) — с подтверждением ниже */}
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-[rgba(251,113,133,0.45)] px-3 py-2.5 text-[13px] font-semibold text-[#fb7185] transition-colors hover:bg-[rgba(251,113,133,0.1)] disabled:opacity-60 sm:mr-auto"
            >
              <Trash2 size={14} strokeWidth={2.4} />
              Удалить фото
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-border px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !modelId}
              className="btn-brand shine flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-bold disabled:opacity-60"
            >
              <Check size={15} strokeWidth={2.6} />
              Сохранить
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления фотографии */}
      <AlertDialog open={confirmDel} onOpenChange={(v) => !v && setConfirmDel(false)}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Удалить фотографию?</AlertDialogTitle>
            <AlertDialogDescription>
              Фото уйдёт в корзину (хранение 30 дней, затем сотрётся). Товар останется — исчезнет только это
              изображение.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
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

export function PhotoBank() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"active" | "trash">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "delete" | "purgeSel" | "purgeAll">(null);
  const [editing, setEditing] = useState<string | null>(null); // id фото в редакторе привязки

  const { data: photos, isLoading: photosLoading } = useQuery<{ items: PhotoRow[] }>({
    queryKey: ["photobank"],
    enabled: mode === "active",
    queryFn: async () => {
      const r = await fetch("/api/admin?view=photos");
      if (!r.ok) throw new Error("Ошибка загрузки фото");
      return r.json();
    },
  });

  const { data: trash, isLoading: trashLoading, refetch: refetchTrash } = useQuery<{ items: TrashItem[]; trashDays: number }>({
    queryKey: ["admin-trash"],
    enabled: mode === "trash",
    queryFn: async () => {
      const r = await fetch("/api/admin?view=trash");
      if (!r.ok) throw new Error("Ошибка загрузки корзины");
      return r.json();
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetSel() {
    setSelected(new Set());
    setConfirm(null);
  }

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ["photobank"] });
    qc.invalidateQueries({ queryKey: ["admin-trash"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["admin-variants"] });
  }

  /** Активные → в корзину (мягкое удаление) */
  async function softDeleteSelected() {
    const ids = [...selected];
    resetSel();
    let done = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`/api/admin?photoId=${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error("Не удалось удалить фото");
        done++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось удалить фото");
      }
    }
    refreshAll();
    if (done === 0) return;
    toast.success(done === 1 ? "Фото → в корзину" : `В корзину: ${done}`, {
      description: "Фото можно вернуть в разделе «Корзина»",
      duration: 7000,
    });
  }

  /** Корзина → вернуть */
  async function restoreSelected() {
    const ids = [...selected];
    resetSel();
    let done = 0;
    for (const id of ids) {
      try {
        await api({ action: "restoreFromTrash", id });
        done++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось вернуть фото");
      }
    }
    refreshAll();
    if (done) toast.success(done === 1 ? "Фото возвращено" : `Возвращено фото: ${done}`);
  }

  /** Корзина → удалить выбранные/все НАВСЕГДА (файлы + строки) */
  async function purge(scope: "sel" | "all") {
    const ids = [...selected];
    resetSel();
    try {
      if (scope === "sel") {
        let done = 0;
        for (const id of ids) {
          await api({ action: "purgePhoto", id });
          done++;
        }
        toast.success(done === 1 ? "Фото удалено навсегда" : `Удалено навсегда: ${done}`);
      } else {
        const res = (await api({ action: "purgeTrash" })) as { purged: number };
        toast.success(res.purged ? `Корзина очищена (${res.purged})` : "Корзина пуста");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
    refreshAll();
  }

  const selCount = selected.size;
  const trashItems = trash?.items ?? [];
  const photoRows = photos?.items ?? [];
  const editingPhoto = photoRows.find((p) => p.id === editing) ?? null;

  return (
    <div>
      {/* Переключатель Активные / Корзина */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="lg-seg">
          <button
            type="button"
            onClick={() => { setMode("active"); setSelected(new Set()); }}
            className={cn(mode === "active" && "is-on")}
          >
            Активные
          </button>
          <button
            type="button"
            onClick={() => { setMode("trash"); setSelected(new Set()); }}
            className={cn(mode === "trash" && "is-on")}
          >
            Корзина{trash && trashItems.length > 0 ? ` (${trashItems.length})` : ""}
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Images size={13} />
          {mode === "active" ? (
            <>Всего фото: {photoRows.length} · тап — выбрать, карандаш — привязка</>
          ) : (
            <>Хранятся {trash?.trashDays ?? 30} дней, затем удаляются автоматически</>
          )}
        </p>
      </div>

      {/* ── Активные ── */}
      {mode === "active" && (
        <div className="grid max-h-[54dvh] grid-cols-2 gap-3 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-4 lg:grid-cols-5">
          {photosLoading &&
            /* ТЗ v3.0 п.9: skeleton вместо пустого экрана при первом входе */
            Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-xl" />)}
          {photoRows.map((p) => {
            const on = selected.has(p.id);
            return (
              <div key={p.id} className="relative">
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  className={cn(
                    "group relative block w-full overflow-hidden rounded-xl border-2 transition-all",
                    on ? "border-[color:var(--brand)] shadow-lg shadow-[rgba(var(--brand-rgb),0.25)]" : "border-transparent hover:border-border"
                  )}
                >
                  <img src={p.thumbUrl || p.url} alt={p.modelName} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  <span
                    className={cn(
                      "absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border-2 transition-all",
                      on ? "border-transparent bg-[color:var(--brand)] text-white" : "border-white/70 bg-black/30 text-transparent backdrop-blur-sm"
                    )}
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left text-[10.5px] font-bold text-white">
                    {[p.categoryName, p.modelName, p.materialName].filter(Boolean).join(" · ")}
                  </span>
                </button>
                {/* Редактирование привязки (п.4 ТЗ) — не мешает выбору галкой */}
                <button
                  type="button"
                  aria-label="Редактировать привязку фото"
                  title="Редактировать привязку"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(p.id);
                  }}
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full border border-white/40 bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 active:scale-90 after:absolute after:-inset-2 after:rounded-full after:content-['']"
                >
                  <Pencil size={12} strokeWidth={2.6} />
                </button>
              </div>
            );
          })}
          {photos && !photosLoading && photoRows.length === 0 && (
            <p className="col-span-full py-8 text-center text-[12.5px] text-muted-foreground">
              Активных фото пока нет
            </p>
          )}
        </div>
      )}

      {/* ── Корзина ── */}
      {mode === "trash" && (
        <>
          <div className="grid max-h-[54dvh] grid-cols-2 gap-3 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-4 lg:grid-cols-5">
            {trashLoading &&
              /* ТЗ v3.0 п.9: skeleton вместо пустого экрана */
              Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-xl" />)}
            {trashItems.map((p) => {
              const on = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-pressed={on}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border-2 transition-all",
                    on ? "border-[color:var(--brand)] shadow-lg shadow-[rgba(var(--brand-rgb),0.25)]" : "border-transparent hover:border-border"
                  )}
                >
                  <img src={p.thumbUrl} alt={p.variantLabel} loading="lazy" className="aspect-[4/3] w-full object-cover opacity-80" />
                  <span
                    className={cn(
                      "absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border-2 transition-all",
                      on ? "border-transparent bg-[color:var(--brand)] text-white" : "border-white/70 bg-black/30 text-transparent backdrop-blur-sm"
                    )}
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                    <Clock3 size={10} />
                    {p.daysLeft} дн.
                  </span>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left text-[10.5px] font-bold text-white">
                    {p.variantLabel}
                  </span>
                </button>
              );
            })}
            {trash && !trashLoading && trashItems.length === 0 && (
              <p className="col-span-full py-8 text-center text-[12.5px] text-muted-foreground">
                Корзина пуста — удалённые фото будут появляться здесь
              </p>
            )}
          </div>
          {trashItems.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirm("purgeAll")}
                className="flex items-center gap-1.5 rounded-lg border border-[rgba(251,113,133,0.4)] px-3 py-1.5 text-[12.5px] font-semibold text-[#fb7185] transition-colors hover:bg-[rgba(251,113,133,0.1)]"
              >
                <Trash2 size={13} strokeWidth={2.5} />
                Очистить корзину
              </button>
            </div>
          )}
        </>
      )}

      {/* Панель действий над выбранным — ВЫШЕ нижней пилюли навигации
          (иначе «Снять»/«В корзину» прячутся под ней, просьба пользователя) */}
      {selCount > 0 && (
        <div className="sticky bottom-[calc(98px+env(safe-area-inset-bottom))] z-30 mt-3 flex items-center gap-2 glass rounded-2xl px-3 py-2.5 lg:bottom-2">
          <span className="flex-1 text-[12.5px] font-semibold">
            Выбрано: <span className="text-[color:var(--brand)]">{selCount}</span>
          </span>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Снять
          </button>
          {mode === "active" ? (
            <button
              type="button"
              onClick={() => setConfirm("delete")}
              className="flex items-center gap-1.5 rounded-lg bg-[rgba(251,113,133,0.92)] px-3.5 py-1.5 text-[12.5px] font-bold text-white transition-transform hover:scale-[1.03]"
            >
              <Trash2 size={13} strokeWidth={2.5} />
              В корзину
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => restoreSelected()}
                className="flex items-center gap-1.5 rounded-lg bg-[rgba(var(--brand-rgb),0.92)] px-3.5 py-1.5 text-[12.5px] font-bold text-white transition-transform hover:scale-[1.03]"
              >
                <Undo2 size={13} strokeWidth={2.5} />
                Вернуть
              </button>
              <button
                type="button"
                onClick={() => setConfirm("purgeSel")}
                className="flex items-center gap-1.5 rounded-lg bg-[rgba(251,113,133,0.92)] px-3.5 py-1.5 text-[12.5px] font-bold text-white transition-transform hover:scale-[1.03]"
              >
                <Trash2 size={13} strokeWidth={2.5} />
                Удалить навсегда
              </button>
            </>
          )}
        </div>
      )}

      {/* Диалоги подтверждения */}
      <AlertDialog open={confirm != null} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="glass-panel">
          {confirm === "delete" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display">Убрать фото в корзину: {selCount}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Фото скроется из каталога, но останется в корзине — его можно вернуть. Навсегда удаляется только из корзины или через 30 дней.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={softDeleteSelected}
                  className="rounded-xl bg-[rgba(251,113,133,0.92)] text-white hover:bg-[rgba(251,113,133,1)]"
                >
                  В корзину
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirm === "purgeSel" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display">Удалить навсегда: {selCount}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Файлы будут стёрты с диска, восстановить будет НЕЛЬЗЯ. Если фото нужно — сначала «Вернуть».
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => purge("sel")}
                  className="rounded-xl bg-[rgba(251,113,133,0.92)] text-white hover:bg-[rgba(251,113,133,1)]"
                >
                  Удалить навсегда
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {confirm === "purgeAll" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display">Очистить корзину?</AlertDialogTitle>
                <AlertDialogDescription>
                  Все фото в корзине ({trashItems.length}) будут стёрты с диска навсегда. Вернуть их будет нельзя.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => purge("all")}
                  className="rounded-xl bg-[rgba(251,113,133,0.92)] text-white hover:bg-[rgba(251,113,133,1)]"
                >
                  Очистить
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Редактор привязки фото (п.4 ТЗ) */}
      {editingPhoto && (
        <EditPhotoDialog photo={editingPhoto} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
