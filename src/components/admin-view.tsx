"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, Check, X, Images, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Dictionaries } from "@/lib/portal";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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

type Entity = "category" | "model" | "material" | "size" | "tag";

const TABS: Array<{ key: Entity; label: string }> = [
  { key: "category", label: "Категории" },
  { key: "model", label: "Модели" },
  { key: "material", label: "Материалы" },
  { key: "size", label: "Размеры" },
  { key: "tag", label: "Признаки" },
];

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

function Row({
  id,
  name,
  sub,
  active,
  onRename,
  onToggle,
}: {
  id: string;
  name: string;
  sub?: string;
  active: boolean;
  onRename: (id: string, name: string) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 transition-all duration-300 hover:border-[rgba(var(--brand-rgb),0.35)]",
        !active && "opacity-50"
      )}
    >
      {editing ? (
        <>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="field flex-1 py-1.5 text-[13px]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRename(id, draft);
                setEditing(false);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button
            type="button"
            onClick={() => {
              onRename(id, draft);
              setEditing(false);
            }}
            aria-label="Сохранить"
            className="grid h-8 w-8 place-items-center rounded-lg bg-[rgba(var(--brand-rgb),0.15)] text-[color:var(--brand)] transition-transform hover:scale-110"
          >
            <Check size={14} strokeWidth={2.6} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label="Отмена"
            className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-muted-foreground"
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-w-0 flex-1 text-left"
            title="Нажмите, чтобы переименовать"
          >
            <p className="truncate text-[13.5px] font-semibold">{name}</p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </button>
          <button
            type="button"
            onClick={() => onToggle(id, !active)}
            aria-label={active ? "Скрыть" : "Вернуть"}
            title={active ? "Скрыть" : "Вернуть"}
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-all",
              active
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

function DictManager({
  entity,
  withCategory,
}: {
  entity: Entity;
  withCategory?: boolean;
}) {
  const qc = useQueryClient();
  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      if (!r.ok) throw new Error("Ошибка загрузки справочников");
      return r.json();
    },
  });
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [materialType, setMaterialType] = useState("Ткань");
  const [pending, setPending] = useState<string | null>(null); // подтверждение создания

  const rows =
    entity === "category"
      ? (d?.categories ?? []).map((c) => ({ id: c.id, name: c.name, sub: undefined as string | undefined, active: c.active }))
      : entity === "model"
        ? (d?.models ?? []).map((m) => ({ id: m.id, name: m.name, sub: m.categoryName, active: m.active }))
        : entity === "material"
          ? (d?.materials ?? []).map((m) => ({ id: m.id, name: m.name, sub: m.type, active: m.active }))
          : entity === "size"
            ? (d?.sizes ?? []).map((s) => ({ id: s.id, name: s.name, sub: undefined, active: s.active }))
            : (d?.tags ?? []).map((t) => ({ id: t.id, name: t.name, sub: "общий", active: t.active }));

  async function create() {
    if (!name.trim()) return toast.error("Введите название");
    // Сначала подтверждение — защита от опечаток и случайных дублей
    setPending(name.trim());
  }

  async function confirmCreate() {
    const n = pending;
    if (!n) return;
    try {
      await api({ entity, action: "create", name: n, categoryId, type: materialType });
      toast.success(`«${n}» создано`);
      setName("");
      qc.invalidateQueries({ queryKey: ["dictionaries"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(null);
    }
  }

  async function rename(id: string, newName: string) {
    if (!newName.trim()) return;
    try {
      await api({ entity, action: "rename", id, name: newName });
      toast.success("Переименовано");
      qc.invalidateQueries({ queryKey: ["dictionaries"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function toggle(id: string, active: boolean) {
    try {
      await api({ entity, action: "toggle", id, active });
      qc.invalidateQueries({ queryKey: ["dictionaries"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="glass flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-end">
        {withCategory && (
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="field cursor-pointer sm:w-44">
            <option value="">Категория *</option>
            {d?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {entity === "material" && (
          <select value={materialType} onChange={(e) => setMaterialType(e.target.value)} className="field cursor-pointer sm:w-40">
            {["Ткань", "Обивка", "ЛДСП", "Дерево", "Металл", "Другое"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Название…"
          className="field flex-1"
        />
        <button type="button" onClick={create} className="btn-brand shine flex items-center justify-center gap-1.5 px-4 py-2.5 text-[13px]">
          <Plus size={15} strokeWidth={2.6} />
          Создать
        </button>
      </div>

      {/* Подтверждение создания — защита от опечаток и дублей */}
      <AlertDialog open={pending != null} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent className="rounded-2xl border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Добавить {TABS.find((t) => t.key === entity)?.label.toLowerCase().replace(/ы$/, "у")} «{pending}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Проверьте написание. Если такое уже есть — сервер сообщит о дубликате.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCreate} className="rounded-xl">Добавить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid max-h-[52dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <Row key={r.id} id={r.id} name={r.name} sub={r.sub} active={r.active} onRename={rename} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}

function PhotoBank() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      if (!r.ok) throw new Error("Ошибка загрузки справочников");
      return r.json();
    },
  });

  const { data: photos } = useQuery({
    queryKey: ["photobank"],
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

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Возвращает данные удалённых фото — для кнопки «Вернуть» */
  async function removeSelected(): Promise<Array<Record<string, string>>> {
    const removed: Array<Record<string, string>> = [];
    for (const id of selected) {
      try {
        const r = await fetch(`/api/admin?photoId=${id}`, { method: "DELETE" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Не удалось удалить фото");
        removed.push(j.photo);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось удалить фото");
      }
    }
    qc.invalidateQueries({ queryKey: ["photobank"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    return removed;
  }

  async function onConfirmDelete() {
    const ids = [...selected];
    const n = ids.length;
    setSelected(new Set());
    setConfirmOpen(false);
    const removed = await removeSelected();
    if (removed.length === 0) return;
    toast.success(n === 1 ? "Фото удалено" : `Удалено фото: ${removed.length}`, {
      description: "Действие можно отменить",
      duration: 8000,
      action: {
        label: "Вернуть",
        onClick: async () => {
          let back = 0;
          for (const p of removed) {
            try {
              const res = await fetch("/api/admin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ entity: "photo", action: "restorePhoto", ...p }),
              });
              if (!res.ok) throw new Error("Не удалось вернуть фото");
              back++;
            } catch {
              /* пропускаем — частичный откат */
            }
          }
          qc.invalidateQueries({ queryKey: ["photobank"] });
          qc.invalidateQueries({ queryKey: ["catalog"] });
          if (back > 0) toast.success(back === 1 ? "Фото возвращено" : `Возвращено фото: ${back}`);
        },
      },
    });
  }

  const selCount = selected.size;

  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Images size={14} />
        Всего фото: {photos?.length ?? 0} · вариантов каталога: {d?.models.length ?? 0} моделей
        <span className="text-border">·</span>
        Нажмите на фото, чтобы выбрать
      </p>

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
              {/* Галка выбора — единственный способ пометить фото */}
              <span
                className={cn(
                  "absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full border-2 transition-all",
                  on
                    ? "border-transparent bg-[color:var(--brand)] text-white"
                    : "border-white/70 bg-black/30 text-transparent backdrop-blur-sm"
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

      {/* Панель действий над выбранным — удаление только отсюда */}
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
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[rgba(251,113,133,0.92)] px-3.5 py-1.5 text-[12.5px] font-bold text-white transition-transform hover:scale-[1.03]"
          >
            <Trash2 size={13} strokeWidth={2.5} />
            Удалить
          </button>
        </div>
      )}

      {/* Подтверждение удаления */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-2xl border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Удалить фото: {selCount}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Случайно нажатое фото не удалится — сначала нужно его выбрать. После удаления можно вернуть кнопкой «Вернуть» в уведомлении.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDelete}
              className="rounded-xl bg-[rgba(251,113,133,0.92)] text-white hover:bg-[rgba(251,113,133,1)]"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function AdminView() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rise">
        <h1 className="font-display text-xl font-bold sm:text-2xl">
          Админ<span className="gradient-text">-панель</span>
        </h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Всё, что выбирает пользователь, сначала создаёт администратор
        </p>
      </div>

      <Tabs defaultValue="category" className="rise rise-1">
        <TabsList className="flex w-full flex-wrap gap-1 rounded-2xl border border-border bg-secondary p-1 sm:w-auto">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              className="rounded-xl px-3 py-1.5 text-[12.5px] font-semibold data-[state=active]:bg-[rgba(var(--brand-rgb),0.18)] data-[state=active]:text-[color:var(--accent-foreground)]"
            >
              {t.label}
            </TabsTrigger>
          ))}
          <TabsTrigger
            value="photos"
            className="rounded-xl px-3 py-1.5 text-[12.5px] font-semibold data-[state=active]:bg-[rgba(var(--brand-rgb),0.18)] data-[state=active]:text-[color:var(--accent-foreground)]"
          >
            Фото
          </TabsTrigger>
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <DictManager entity={t.key} withCategory={t.key === "model"} />
          </TabsContent>
        ))}
        <TabsContent value="photos" className="mt-4">
          <PhotoBank />
        </TabsContent>
      </Tabs>
    </div>
  );
}
