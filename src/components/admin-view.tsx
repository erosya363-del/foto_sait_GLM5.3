"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Dictionaries } from "@/lib/portal";
import { ProductManager } from "@/components/admin-product-manager";
import { FabricManager } from "@/components/admin-fabric-manager";
import { PhotoBank } from "@/components/admin-photobank";
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

/* П.3 ТЗ: в Справочниках — ТОЛЬКО системные параметры (используются в
   нескольких местах). «Модели» и «Материалы» УДАЛЕНЫ из списка: это дубли
   разделов «Товары» и «Ткани» (модели создаются в мастере товара, ткани —
   в разделе «Ткани»; один источник данных на каждую сущность) */
const TABS: Array<{ key: Entity; label: string }> = [
  { key: "category", label: "Категории" },
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


/**
 * Строка справочника: переименование (карандаш/тап по названию) +
 * УДАЛЕНИЕ с подтверждением (вместо прежнего «отключения»).
 * Занято в товарах — сервер откажет и покажет, сколько товаров мешают.
 */
function Row({
  id,
  name,
  sub,
  entity,
  onRename,
  onDelete,
}: {
  id: string;
  name: string;
  sub?: string;
  entity: Entity;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  return (
    <div className="lg-row group">
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
            className="lg-iconbtn is-ok"
          >
            <Check size={14} strokeWidth={2.6} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            aria-label="Отмена"
            className="lg-iconbtn"
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            className="min-w-0 flex-1 text-left"
            title="Нажмите, чтобы переименовать"
          >
            <p className="truncate text-[13.5px] font-semibold">{name}</p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            aria-label="Переименовать"
            title="Переименовать"
            className="lg-iconbtn is-brand"
          >
            <Pencil size={13} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(id, name)}
            aria-label="Удалить"
            title="Удалить"
            className="lg-iconbtn is-danger"
          >
            <Trash2 size={13} strokeWidth={2.4} />
          </button>
        </>
      )}
    </div>
  );
}

function DictManager({
  entity,
}: {
  entity: Entity;
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
  const [pending, setPending] = useState<string | null>(null); // подтверждение создания
  const [deleting, setDeleting] = useState<null | { id: string; name: string }>(null);

  const rows =
    entity === "category"
      ? (d?.categories ?? []).map((c) => ({ id: c.id, name: c.name, sub: undefined as string | undefined }))
      : entity === "size"
        ? (d?.sizes ?? []).map((s) => ({ id: s.id, name: s.name, sub: undefined }))
        : (d?.tags ?? []).map((t) => ({ id: t.id, name: t.name, sub: "общий" }));

  async function create() {
    if (!name.trim()) return toast.error("Введите название");
    // Сначала подтверждение — защита от опечаток и случайных дублей
    setPending(name.trim());
  }

  async function confirmCreate() {
    const n = pending;
    if (!n) return;
    try {
      await api({ entity, action: "create", name: n });
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

  async function remove(id: string, delName: string) {
    try {
      await api({ entity, action: "delete", id });
      toast.success(`«${delName}» удалено`);
      qc.invalidateQueries({ queryKey: ["dictionaries"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const entityLabel = TABS.find((t) => t.key === entity)?.label.toLowerCase() ?? "";

  return (
    <div className="flex flex-col gap-3" data-no-tab-swipe="">
      <div className="glass flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-end">
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
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Добавить «{pending}»?
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

      {/* Подтверждение удаления справочника */}
      <AlertDialog open={deleting != null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Удалить «{deleting?.name}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {entityLabel.slice(0, -1) === "категори"
                ? "Категория удалится навсегда. Если она используется в товарах — сервер откажет и подскажет, сколько товаров мешают."
                : "Запись удалится навсегда. Если используется в товарах — сервер откажет и подскажет, сколько товаров мешают."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                if (target) remove(target.id, target.name);
              }}
              className="rounded-xl bg-[#fb7185] text-white hover:bg-[#f43f5e]"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid max-h-[52dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <Row
            key={r.id}
            id={r.id}
            name={r.name}
            sub={r.sub}
            entity={entity}
            onRename={rename}
            onDelete={(id, delName) => setDeleting({ id, name: delName })}
          />
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-6 text-center text-[12.5px] text-muted-foreground">
            Пока пусто — создайте первую запись выше
          </p>
        )}
      </div>
    </div>
  );
}

/** Справочники: сегмент-переключатель типа + менеджер выбранного типа */
function DictionariesSection() {
  const [entity, setEntity] = useState<Entity>("category");
  return (
    <div className="flex flex-col gap-3">
      <div
        className="lg-seg w-full overflow-x-auto"
        role="tablist"
        aria-label="Тип справочника"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={entity === t.key}
            onClick={() => setEntity(t.key)}
            className={cn(entity === t.key && "is-on")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <DictManager key={entity} entity={entity} />
    </div>
  );
}

export function AdminView() {
  return (
    <div className="flex flex-col gap-4" data-no-tab-swipe="">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold sm:text-2xl">
            Админ<span className="gradient-text">-панель</span>
          </h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Товары · Ткани · Системные справочники · Фото — по одной точке управления на каждую сущность
          </p>
        </div>
      </div>

      {/* Четыре крупных раздела: ткани заводятся отдельно от товара */}
      <Tabs defaultValue="products" className="rise rise-1">
        <TabsList className="lg-seg h-auto w-full max-w-full sm:w-auto">
          <TabsTrigger
            value="products"
            className="rounded-full data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] data-[state=active]:text-[color:var(--accent-foreground)] data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_14px_-6px_rgba(var(--brand-rgb),0.55)] dark:data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] dark:data-[state=active]:text-[color:var(--accent-foreground)] dark:data-[state=active]:border-transparent"
          >
            Товары
          </TabsTrigger>
          <TabsTrigger
            value="fabrics"
            className="rounded-full data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] data-[state=active]:text-[color:var(--accent-foreground)] data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_14px_-6px_rgba(var(--brand-rgb),0.55)] dark:data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] dark:data-[state=active]:text-[color:var(--accent-foreground)] dark:data-[state=active]:border-transparent"
          >
            Ткани
          </TabsTrigger>
          <TabsTrigger
            value="dicts"
            className="rounded-full data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] data-[state=active]:text-[color:var(--accent-foreground)] data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_14px_-6px_rgba(var(--brand-rgb),0.55)] dark:data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] dark:data-[state=active]:text-[color:var(--accent-foreground)] dark:data-[state=active]:border-transparent"
          >
            Справочники
          </TabsTrigger>
          <TabsTrigger
            value="photos"
            className="rounded-full data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] data-[state=active]:text-[color:var(--accent-foreground)] data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_4px_14px_-6px_rgba(var(--brand-rgb),0.55)] dark:data-[state=active]:bg-[linear-gradient(135deg,rgba(var(--brand-rgb),0.22),rgba(var(--brand-rgb),0.1))] dark:data-[state=active]:text-[color:var(--accent-foreground)] dark:data-[state=active]:border-transparent"
          >
            Фото
          </TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4">
          <ProductManager />
        </TabsContent>
        <TabsContent value="fabrics" className="mt-4">
          <FabricManager />
        </TabsContent>
        <TabsContent value="dicts" className="mt-4">
          <DictionariesSection />
        </TabsContent>
        <TabsContent value="photos" className="mt-4">
          <PhotoBank />
        </TabsContent>
      </Tabs>
    </div>
  );
}
