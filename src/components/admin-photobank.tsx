"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Images, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
 * Шаг 5: Фотобанк с корзиной.
 * «Активные» — выбор галками, удаление = мягкое (в корзину, можно вернуть).
 * «Корзина»  — вернуть / удалить навсегда (файлы + строка) / очистить целиком.
 * Автоочистка: сервер физически удаляет фото, лежащие в корзине 30 дней.
 */

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

export function PhotoBank() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"active" | "trash">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | "delete" | "purgeSel" | "purgeAll">(null);

  const { data: d } = useQuery<{ models: Array<{ id: string }> }>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      if (!r.ok) throw new Error("Ошибка загрузки справочников");
      return r.json();
    },
  });

  const { data: photos } = useQuery({
    queryKey: ["photobank"],
    enabled: mode === "active",
    queryFn: async () => {
      const r = await fetch("/api/catalog");
      const j = await r.json();
      const out: Array<{ id: string; url: string; variant: string }> = [];
      for (const it of j.items as Array<{ id: string; modelName: string; photos: Array<{ id: string; url: string }> }>) {
        for (const p of it.photos) out.push({ id: p.id, url: p.url, variant: it.modelName });
      }
      return out;
    },
  });

  const { data: trash, refetch: refetchTrash } = useQuery<{ items: TrashItem[]; trashDays: number }>({
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

  return (
    <div>
      {/* Переключатель Активные / Корзина */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-border bg-secondary p-1">
          <button
            type="button"
            onClick={() => { setMode("active"); setSelected(new Set()); }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
              mode === "active" ? "bg-[rgba(var(--brand-rgb),0.18)] text-[color:var(--brand)]" : "text-muted-foreground"
            )}
          >
            Активные
          </button>
          <button
            type="button"
            onClick={() => { setMode("trash"); setSelected(new Set()); }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
              mode === "trash" ? "bg-[rgba(var(--brand-rgb),0.18)] text-[color:var(--brand)]" : "text-muted-foreground"
            )}
          >
            Корзина{trash && trashItems.length > 0 ? ` (${trashItems.length})` : ""}
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Images size={13} />
          {mode === "active" ? (
            <>Всего фото: {photos?.length ?? 0} · нажмите на фото, чтобы выбрать</>
          ) : (
            <>Хранятся {trash?.trashDays ?? 30} дней, затем удаляются автоматически</>
          )}
        </p>
      </div>

      {/* ── Активные ── */}
      {mode === "active" && (
        <div className="grid max-h-[54dvh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-5">
          {(photos ?? []).map((p) => {
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
                <img src={p.url} alt={p.variant} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                <span
                  className={cn(
                    "absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border-2 transition-all",
                    on ? "border-transparent bg-[color:var(--brand)] text-white" : "border-white/70 bg-black/30 text-transparent backdrop-blur-sm"
                  )}
                >
                  <Check size={13} strokeWidth={3} />
                </span>
                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left text-[10.5px] font-bold text-white">
                  {p.variant}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Корзина ── */}
      {mode === "trash" && (
        <>
          <div className="grid max-h-[54dvh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-5">
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
            {trash && trashItems.length === 0 && (
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

      {/* Панель действий над выбранным */}
      {selCount > 0 && (
        <div className="sticky bottom-2 mt-3 flex items-center gap-2 rounded-2xl border border-border bg-background/95 px-3 py-2.5 shadow-xl backdrop-blur">
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
        <AlertDialogContent className="rounded-2xl border-border">
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
    </div>
  );
}
