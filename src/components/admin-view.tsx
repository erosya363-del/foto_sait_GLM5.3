"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Dictionaries } from "@/lib/portal";
import { ProductManager } from "@/components/admin-product-manager";
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

export function AdminView() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rise">
        <h1 className="font-display text-xl font-bold sm:text-2xl">
          Админ<span className="gradient-text">-панель</span>
        </h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Товар за минуту: создать, загрузить фото, при ошибке — вернуть из корзины
        </p>
      </div>

      <Tabs defaultValue="product" className="rise rise-1">
        <TabsList className="flex w-full flex-wrap gap-1 rounded-2xl border border-border bg-secondary p-1 sm:w-auto">
          <TabsTrigger
            value="product"
            className="rounded-xl px-3 py-1.5 text-[12.5px] font-semibold data-[state=active]:bg-[rgba(var(--brand-rgb),0.18)] data-[state=active]:text-[color:var(--accent-foreground)]"
          >
            Товар
          </TabsTrigger>
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
        <TabsContent value="product" className="mt-4">
          <ProductManager />
        </TabsContent>
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
