"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Pencil, Plus, SwatchBook, Trash2, X } from "lucide-react";
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
 * «Ткани» — отдельный раздел админки: ткань заводится САМА по себе,
 * без товара: название + цветовая гамма + фото каталога ткани.
 * Здесь же — замена фото, переименование, гамма и удаление существующих тканей.
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

async function uploadSwatch(materialId: string, file: File) {
  const fd = new FormData();
  fd.append("materialId", materialId);
  fd.append("photo", file);
  const r = await fetch("/api/fabric-photo", { method: "POST", body: fd });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Не удалось загрузить фото");
  return j as { swatchUrl: string };
}

/** Строка ткани: превью, название, гамма, замена фото, переименование, удаление */
function FabricRow({
  f,
  groups,
  onChanged,
  onDelete,
}: {
  f: { id: string; name: string; colorGroup: string | null; swatchUrl: string | null };
  groups: string[];
  onChanged: () => void;
  onDelete: (id: string, name: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(f.name);
  const [groupDraft, setGroupDraft] = useState(f.colorGroup ?? "");
  const [busy, setBusy] = useState(false);

  async function saveEdits() {
    setBusy(true);
    try {
      if (nameDraft.trim() && nameDraft.trim() !== f.name) {
        await api({ entity: "material", action: "rename", id: f.id, name: nameDraft.trim() });
      }
      if ((groupDraft.trim() || null) !== (f.colorGroup ?? null)) {
        await api({ action: "setFabricGroup", id: f.id, colorGroup: groupDraft.trim() });
      }
      toast.success("Сохранено");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function onPickPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await uploadSwatch(f.id, file);
      toast.success("Фото каталога ткани обновлено");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="lg-row gap-3">
      {/* Превью / замена фото каталога ткани */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        title="Загрузить/заменить фото каталога ткани"
        className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary"
      >
        {f.swatchUrl ? (
          <img src={f.swatchUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <SwatchBook size={18} className="text-muted-foreground" />
        )}
        <span className="absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity hover:opacity-100">
          <ImagePlus size={16} strokeWidth={2.2} />
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => onPickPhoto(e.target.files?.[0])}
      />

      {editing ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="field py-1.5 text-[13px]"
              placeholder="Название ткани"
              autoFocus
            />
            <input
              value={groupDraft}
              onChange={(e) => setGroupDraft(e.target.value)}
              className="field py-1.5 text-[12px]"
              placeholder="Цветовая гамма (напр. «Серая»)"
              list="fabric-groups"
            />
          </div>
          <datalist id="fabric-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={saveEdits}
            disabled={busy}
            aria-label="Сохранить"
            className="lg-iconbtn is-ok"
          >
            <Check size={14} strokeWidth={2.6} />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setNameDraft(f.name);
              setGroupDraft(f.colorGroup ?? "");
            }}
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
              setNameDraft(f.name);
              setGroupDraft(f.colorGroup ?? "");
              setEditing(true);
            }}
            className="min-w-0 flex-1 text-left"
            title="Нажмите, чтобы изменить название и гамму"
          >
            <p className="truncate text-[13.5px] font-semibold">{f.name}</p>
            <p className={cn("truncate text-[11.5px]", f.colorGroup ? "text-[color:var(--brand)]" : "text-muted-foreground")}>
              {f.colorGroup ?? "Гамма не задана"}
            </p>
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Изменить"
            title="Название / гамма"
            className="lg-iconbtn is-brand"
          >
            <Pencil size={13} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(f.id, f.name)}
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

export function FabricManager() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: d } = useQuery<Dictionaries>({
    queryKey: ["dictionaries"],
    queryFn: async () => {
      const r = await fetch("/api/dictionaries");
      if (!r.ok) throw new Error("Ошибка загрузки справочников");
      return r.json();
    },
  });

  const fabrics = (d?.materials ?? []).filter((m) => m.type === "Ткань");
  const groups = [...new Set(fabrics.map((f) => f.colorGroup).filter(Boolean) as string[])];

  // Новая ткань: название + гамма + фото каталога (по желанию)
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState<null | { id: string; name: string }>(null);

  async function confirmCreate() {
    setBusy(true);
    try {
      const created = (await api({
        entity: "material",
        action: "create",
        name: name.trim(),
        type: "Ткань",
        colorGroup: group.trim(),
      })) as { id: string };
      if (photo) await uploadSwatch(created.id, photo);
      toast.success(`Ткань «${name.trim()}» создана`, {
        description: photo ? "Фото каталога загружено" : "Фото каталога можно добавить в списке ниже",
      });
      setName("");
      setGroup("");
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["dictionaries"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      setPending(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const { id, name: n } = deleting;
    setDeleting(null);
    try {
      await api({ entity: "material", action: "delete", id });
      toast.success(`Ткань «${n}» удалена`);
      qc.invalidateQueries({ queryKey: ["dictionaries"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Новая ткань: отдельно от товара ── */}
      <div className="glass flex flex-col gap-2.5 rounded-2xl p-3 sm:p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Новая ткань · отдельно от товара
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название ткани (напр. «Sky Velvet 07») *"
            className="field"
          />
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Цветовая гамма (напр. «Серая»)"
            className="field"
            list="fabric-groups-new"
          />
          <datalist id="fabric-groups-new">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-[12.5px] text-muted-foreground transition-colors hover:border-[rgba(var(--brand-rgb),0.5)]">
          <ImagePlus size={16} className="text-[color:var(--brand)]" />
          {photo ? `Фото каталога: ${photo.name}` : "Фото каталога ткани — карточка в каталоге (по желанию)"}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (!name.trim()) return toast.error("Введите название ткани");
            setPending(true);
          }}
          disabled={busy}
          className="btn-brand shine flex items-center justify-center gap-1.5 px-4 py-2.5 text-[13px] disabled:opacity-60"
        >
          <Plus size={15} strokeWidth={2.6} />
          Создать ткань
        </button>
      </div>

      {/* Подтверждение создания */}
      <AlertDialog open={pending} onOpenChange={(v) => !v && setPending(false)}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Добавить ткань «{name.trim()}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {group.trim() ? `Гамма: «${group.trim()}». ` : "Гамму можно задать позже. "}
              {photo ? "Фото каталога загрузится сразу." : "Фото каталога можно добавить позже — тапом по превью."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCreate} className="rounded-xl">
              Добавить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Подтверждение удаления */}
      <AlertDialog open={deleting != null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Удалить ткань «{deleting?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Если ткань используется в товарах — сервер откажет и подскажет, сколько товаров мешают.
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

      {/* ── Список тканей ── */}
      <div className="grid max-h-[48dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {fabrics.map((f) => (
          <FabricRow
            key={f.id}
            f={{ id: f.id, name: f.name, colorGroup: f.colorGroup ?? null, swatchUrl: f.swatchUrl ?? null }}
            groups={groups}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["dictionaries"] });
              qc.invalidateQueries({ queryKey: ["catalog"] });
            }}
            onDelete={(id, n) => setDeleting({ id, name: n })}
          />
        ))}
        {fabrics.length === 0 && (
          <p className="col-span-full py-6 text-center text-[12.5px] text-muted-foreground">
            Пока пусто — создайте первую ткань выше
          </p>
        )}
      </div>
    </div>
  );
}
