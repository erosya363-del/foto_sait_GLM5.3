/**
 * ═══════════════════════════════════════════════════════════════════════════
 * seed-reference-data.ts — ИДЕНПОТЕНТНЫЙ ИМПОРТ СПРАВОЧНЫХ ДАННЫХ ASKONA
 * (ТЗ NEXT_AGENT_TASKS_REFERENCE_DATA_AND_PHOTO_PERSISTENCE.md, BLOCK D)
 *
 * Единственный источник — data/reference/catalog-master-data.json (в Git):
 *   • категории «Кровати», «Диваны»;
 *   • 39 канонических моделей диванов + 102 кровати;
 *   • 190 точных названий тканей/материалов.
 *
 * ЖЁСТКИЕ ГАРАНТИИ (по ТЗ):
 *   • вставляются ТОЛЬКО отсутствующие строки; ничего не удаляется и
 *     не переименовывается;
 *   • ProductVariant, Photo и файлы загрузок НЕ изменяются вообще
 *     (код не содержит ни одного обращения к этим таблицам/путям);
 *   • кресла НЕ импортируются (chairs workbook excluded — в JSON их нет,
 *     наличие проверяется структурно и приводит к отказу);
 *   • перед вставкой ищутся конфликты «отличается только регистром/пробелами»:
 *     конфликт → строка ПРОПУСКАЕТСЯ и попадает в отчёт (никаких молчаливых
 *     слияний и никаких вторых строк с другим регистром);
 *   • --apply выполняет вставки в транзакции БД.
 *
 * РЕЖИМЫ:
 *   bun scripts/seed-reference-data.ts --dry-run            (по умолчанию)
 *       — прямой доступ к БД runtime (как у приложения, src/lib/runtime.ts).
 *   bun scripts/seed-reference-data.ts --apply
 *       — то же, с вставками (в транзакции).
 *   bun scripts/seed-reference-data.ts --live-url https://<site> [--apply]
 *       — HTTP-режим против живого сайта: existing читается из
 *         GET /api/dictionaries, вставки идут через СУЩЕСТВУЮЩИЙ
 *         POST /api/admin {entity, action:"create"} (никакого нового API).
 *         dry-run = только GET. Это «explicit maintenance action» из BLOCK E:
 *         сидирование live ДО получения deploy-lock — следующий
 *         LOCK→DRAIN→FINAL SYNC→BUILD забирает строки в артефакт.
 *
 * Окружение (как в src/lib/runtime.ts):
 *   RUNTIME_ROOT  — корень runtime-зоны (высший приоритет; изолированные
 *                   среды тестов); БД = <RUNTIME_ROOT>/database/custom.db
 *   DATABASE_URL  — file:<абсолютный путь> (кроме легаси <проект>/db/custom.db)
 *   по умолчанию  — download/runtime/database/custom.db
 *
 * Выход (ТЗ BLOCK D, текст + JSON):
 *   Category/Model/Material: existing= inserted= conflicts=
 *   CHAIRS_IMPORTED=0  PRODUCT_VARIANTS_MODIFIED=0  PHOTOS_MODIFIED=0
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

/* ─────────────────────────── аргументы CLI ─────────────────────────── */

const args = process.argv.slice(2);
let APPLY = false;
let LIVE_URL = "";
let JSON_OUT = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--apply") APPLY = true;
  else if (args[i] === "--dry-run") APPLY = false;
  else if (args[i] === "--live-url") LIVE_URL = (args[++i] ?? "").replace(/\/+$/, "");
  else if (args[i] === "--json-out") JSON_OUT = args[++i] ?? "";
  else if (args[i] === "--help" || args[i] === "-h") {
    console.log(
      "Использование:\n" +
        "  bun scripts/seed-reference-data.ts --dry-run\n" +
        "  bun scripts/seed-reference-data.ts --apply\n" +
        "  bun scripts/seed-reference-data.ts --live-url https://<site> [--apply] [--json-out <path>]\n"
    );
    process.exit(0);
  } else {
    console.error(`✗ Неизвестный аргумент: ${args[i]}`);
    process.exit(2);
  }
}

const PROJECT_ROOT = process.cwd();
const MASTER_DATA_PATH = path.join(PROJECT_ROOT, "data", "reference", "catalog-master-data.json");
const LEGACY_DB = path.join(PROJECT_ROOT, "db", "custom.db");

/** Ключ «отличается только регистром/пробелами»: trim → lower → схлопнуть пробелы. */
function ciKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/* ─────────────────────── канонические данные (JSON) ─────────────────────── */

type MasterData = {
  version: number;
  source: Record<string, string>;
  categories: string[];
  models: Record<string, string[]>;
  materials: string[];
  excluded: Record<string, unknown>;
};

function loadMasterData(): MasterData {
  if (!fs.existsSync(MASTER_DATA_PATH)) {
    console.error(`✗ Канонический файл не найден: ${MASTER_DATA_PATH}`);
    process.exit(2);
  }
  const d = JSON.parse(fs.readFileSync(MASTER_DATA_PATH, "utf8")) as MasterData;
  const modelTotal = Object.values(d.models).reduce((n, list) => n + list.length, 0);
  console.log(
    `── канонический источник: ${path.relative(PROJECT_ROOT, MASTER_DATA_PATH)} ` +
      `(категорий ${d.categories.length}, моделей ${modelTotal}, материалов ${d.materials.length})`
  );
  if (d.categories.length === 0 || modelTotal === 0 || d.materials.length === 0) {
    console.error("✗ Канонический файл пуст — импорт отменён");
    process.exit(2);
  }
  // кресла в JSON отсутствуют BY DESIGN (excluded.Кресла) — проверяем структурно
  if (d.models["Кресла"] !== undefined) {
    console.error("✗ Канонический файл содержит кресла — это запрещено ТЗ (chairs excluded)");
    process.exit(2);
  }
  return d;
}

/* ────────────────────────────── структура плана ───────────────────────────── */

type Conflict = { canonical: string; existingRow: string; note?: string };
type Plan = {
  toInsert: string[];
  conflicts: Conflict[];
  existing: string[]; // канонические строки, найденные в БД exact-совпадением
  errors: string[];   // ошибки вставки (apply)
};

function newPlan(): Plan {
  return { toInsert: [], conflicts: [], existing: [], errors: [] };
}

function classify(
  canonicalNames: string[],
  existingRows: string[],
  plan: Plan
): void {
  const byKey = new Map<string, string>();
  for (const row of existingRows) {
    const k = ciKey(row);
    // в БД уже два варианта регистра — фиксируем как конфликт обеих строк
    if (byKey.has(k)) plan.conflicts.push({ canonical: "", existingRow: row, note: "дубль регистра в БД" });
    else byKey.set(k, row);
  }
  for (const name of canonicalNames) {
    const hit = byKey.get(ciKey(name));
    if (!hit) plan.toInsert.push(name);
    else if (hit === name.trim()) plan.existing.push(name);
    else plan.conflicts.push({ canonical: name, existingRow: hit });
  }
}

/* ───────────────────────────── HTTP-режим ───────────────────────────── */

type Dict = {
  categories: { id: string; name: string; active: boolean }[];
  models: { id: string; name: string; categoryId: string; categoryName: string; active: boolean }[];
  materials: { id: string; name: string; type: string; active: boolean }[];
};

async function fetchDict(base: string): Promise<Dict> {
  const res = await fetch(`${base}/api/dictionaries`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${base}/api/dictionaries → HTTP ${res.status}`);
  return (await res.json()) as Dict;
}

async function httpCreate(
  base: string,
  entity: "category" | "model" | "material",
  body: Record<string, string>
): Promise<{ ok: boolean; status: number; id?: string; error?: string }> {
  const res = await fetch(`${base}/api/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity, action: "create", ...body }),
  });
  let payload: { id?: string; error?: string } = {};
  try {
    payload = (await res.json()) as { id?: string; error?: string };
  } catch {
    /* не-JSON ответ — оставим пустым */
  }
  return { ok: res.ok, status: res.status, id: payload.id, error: payload.error };
}

async function runLive(): Promise<void> {
  console.log(`── HTTP-режим: live = ${LIVE_URL} (${APPLY ? "APPLY" : "DRY-RUN"})`);
  const d = loadMasterData();
  const dict = await fetchDict(LIVE_URL);

  const catPlan = newPlan(), modelPlan = newPlan(), matPlan = newPlan();
  classify(d.categories, dict.categories.map((c) => c.name), catPlan);

  const catIds = new Map(dict.categories.map((c) => [c.name, c.id]));
  const catOf = new Map(dict.models.map((m) => [m.id, m.categoryName]));
  for (const [catName, modelNames] of Object.entries(d.models)) {
    const rows = dict.models.filter((m) => m.categoryName === catName).map((m) => m.name);
    const before = modelPlan.conflicts.length;
    classify(modelNames, rows, modelPlan);
    for (let i = before; i < modelPlan.conflicts.length; i++)
      if (modelPlan.conflicts[i].canonical) modelPlan.conflicts[i].note = catName;
    if (!catIds.has(catName)) {
      // категория отсутствует: все её «отсутствующие» модели ждут её создания
      modelPlan.toInsert = modelPlan.toInsert; // порядок не меняется; catId решим при вставке
    }
  }
  classify(d.materials, dict.materials.map((m) => m.name), matPlan);

  /* вставки (apply): категории → модели → материалы */
  const catIdsCreated = new Map<string, string>();
  if (APPLY) {
    for (const name of catPlan.toInsert) {
      const r = await httpCreate(LIVE_URL, "category", { name });
      if (r.ok && r.id) catIdsCreated.set(name, r.id);
      else catPlan.errors.push(`category «${name}»: HTTP ${r.status} ${r.error ?? ""}`);
    }
    for (const name of modelPlan.toInsert) {
      // ищем категорию канонической модели в исходном JSON
      let catName = "";
      for (const [cn, names] of Object.entries(d.models)) if (names.includes(name)) { catName = cn; break; }
      const catId = catIds.get(catName) ?? catIdsCreated.get(catName) ?? "";
      if (!catId) { modelPlan.errors.push(`model «${name}»: нет id категории «${catName}»`); continue; }
      const r = await httpCreate(LIVE_URL, "model", { name, categoryId: catId });
      if (!r.ok) modelPlan.errors.push(`model «${name}»: HTTP ${r.status} ${r.error ?? ""}`);
    }
    for (const name of matPlan.toInsert) {
      const r = await httpCreate(LIVE_URL, "material", { name, type: "Ткань" });
      if (!r.ok) matPlan.errors.push(`material «${name}»: HTTP ${r.status} ${r.error ?? ""}`);
    }
  }

  printReport({ Category: catPlan, Model: modelPlan, Material: matPlan });

  /* верификация после apply: повторный GET словаря */
  if (APPLY) {
    const after = await fetchDict(LIVE_URL);
    const missing: string[] = [];
    const afterCats = new Set(after.categories.map((c) => c.name));
    const afterModels = new Set(after.models.map((m) => `${m.categoryName}::${ciKey(m.name)}`));
    const afterMats = new Set(after.materials.map((m) => ciKey(m.name)));
    for (const c of d.categories) if (!afterCats.has(c) && !catPlan.conflicts.some((k) => k.canonical === c)) missing.push(`category:${c}`);
    for (const [catName, names] of Object.entries(d.models))
      for (const n of names)
        if (!afterModels.has(`${catName}::${ciKey(n)}`) && !modelPlan.conflicts.some((k) => k.canonical === n)) missing.push(`model:${n}`);
    for (const m of d.materials)
      if (!afterMats.has(ciKey(m)) && !matPlan.conflicts.some((k) => k.canonical === m)) missing.push(`material:${m}`);
    console.log(
      missing.length
        ? `── ⚠ после apply в словаре live отсутствуют (${missing.length}): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`
        : "── верификация после apply: все канонические строки присутствуют в словаре live (или в конфликтах)"
    );
  }

  writeJsonOut({ Category: catPlan, Model: modelPlan, Material: matPlan }, null, null);
}

/* ─────────────────────────── прямой режим (Prisma) ─────────────────────────── */

function databaseFile(): string {
  const runtimeRoot = process.env.RUNTIME_ROOT;
  if (runtimeRoot) return path.join(runtimeRoot, "database", "custom.db");
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("file:")) {
    const p = url.slice("file:".length);
    if (path.isAbsolute(p) && p !== LEGACY_DB) return p;
  }
  return path.join(PROJECT_ROOT, "download", "runtime", "database", "custom.db");
}

async function runDirect(): Promise<void> {
  const dbFile = databaseFile();
  if (!fs.existsSync(dbFile)) {
    console.error(
      `✗ БД не найдена: ${dbFile}\n` +
        "  Сидер НЕ создаёт БД в production. Для изолированной тестовой среды\n" +
        "  задайте RUNTIME_ROOT=<dir> (тогда пустая схема создаётся как в runtime.ts)\n" +
        "  или восстановите runtime: bash scripts/restore-runtime.sh <архив>"
    );
    process.exit(1);
  }
  console.log(`── БД: ${dbFile} (${APPLY ? "APPLY" : "DRY-RUN"})`);

  const prisma = new PrismaClient({ datasourceUrl: `file:${dbFile}` });

  /* счётчики ДО — в отчёт (доказательство «Photo/ProductVariant не тронуты») */
  const countsBefore = {
    categories: await prisma.category.count(),
    models: await prisma.model.count(),
    materials: await prisma.material.count(),
    productVariants: await prisma.productVariant.count(),
    photos: await prisma.photo.count(),
  };

  const [dbCategories, dbModels, dbMaterials] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.model.findMany({ select: { id: true, name: true, categoryId: true } }),
    prisma.material.findMany({ select: { id: true, name: true } }),
  ]);

  const d = loadMasterData();

  const catPlan = newPlan(), modelPlan = newPlan(), matPlan = newPlan();
  classify(d.categories, dbCategories.map((c) => c.name), catPlan);

  const catIds = new Map(dbCategories.map((c) => [c.name, c.id]));
  const catIdByName = new Map(dbCategories.map((c) => [c.id, c.name]));
  const modelsByCatName = new Map<string, string[]>();
  for (const m of dbModels) {
    const cname = catIdByName.get(m.categoryId) ?? "";
    const list = modelsByCatName.get(cname) ?? [];
    list.push(m.name);
    modelsByCatName.set(cname, list);
  }
  for (const [catName, modelNames] of Object.entries(d.models)) {
    const before = modelPlan.conflicts.length;
    classify(modelNames, modelsByCatName.get(catName) ?? [], modelPlan);
    for (let i = before; i < modelPlan.conflicts.length; i++)
      if (modelPlan.conflicts[i].canonical) modelPlan.conflicts[i].note = catName;
  }
  classify(d.materials, dbMaterials.map((m) => m.name), matPlan);

  if (APPLY) {
    /* ТЗ BLOCK D: apply — в транзакции БД. Вставляем ТОЛЬКО отсутствующие
       справочные строки; других таблиц касания нет — structurally. */
    await prisma.$transaction(async (tx) => {
      for (const name of catPlan.toInsert) {
        const row = await tx.category.create({ data: { name }, select: { id: true } });
        catIds.set(name, row.id);
      }
      for (const name of modelPlan.toInsert) {
        let catName = "";
        for (const [cn, names] of Object.entries(d.models)) if (names.includes(name)) { catName = cn; break; }
        const catId = catIds.get(catName) ?? "";
        if (!catId) throw new Error(`model «${name}»: нет категории «${catName}»`);
        await tx.model.create({ data: { name, categoryId: catId } });
      }
      for (const name of matPlan.toInsert) {
        await tx.material.create({ data: { name, type: "Ткань" } });
      }
    });
  }

  const countsAfter = {
    categories: await prisma.category.count(),
    models: await prisma.model.count(),
    materials: await prisma.material.count(),
    productVariants: await prisma.productVariant.count(),
    photos: await prisma.photo.count(),
  };

  printReport({ Category: catPlan, Model: modelPlan, Material: matPlan });

  /* гарантии ТЗ: Photo/ProductVariant не изменились */
  if (countsBefore.productVariants !== countsAfter.productVariants || countsBefore.photos !== countsAfter.photos) {
    console.error("✗ НАРУШЕНИЕ: изменились счётчики ProductVariant/Photo — стоп");
    process.exit(1);
  }

  if (APPLY) {
    const expect = {
      categories: countsBefore.categories + catPlan.toInsert.length,
      models: countsBefore.models + modelPlan.toInsert.length,
      materials: countsBefore.materials + matPlan.toInsert.length,
    };
    if (
      countsAfter.categories !== expect.categories ||
      countsAfter.models !== expect.models ||
      countsAfter.materials !== expect.materials
    ) {
      console.error("✗ Верификация после apply не сошлась:", { expect, after: countsAfter });
      process.exit(1);
    }
    console.log("── верификация после apply: счётчики сходятся (before+inserted)");
  }

  writeJsonOut({ Category: catPlan, Model: modelPlan, Material: matPlan }, countsBefore, countsAfter);
  await prisma.$disconnect();
}

/* ───────────────────────────── общий отчёт ───────────────────────────── */

type PlanSet = Record<"Category" | "Model" | "Material", Plan>;

function insertedCount(p: Plan): number {
  return p.toInsert.length - p.errors.length;
}

function printReport(sets: PlanSet): void {
  console.log("\n──────────── ОТЧЁТ ИМПОРТА ────────────");
  for (const label of ["Category", "Model", "Material"] as const) {
    const p = sets[label];
    console.log(
      `${label}:\nexisting=${p.existing.length}\ninserted=${APPLY ? insertedCount(p) : 0}${APPLY ? "" : ` (план: ${p.toInsert.length})`}\nconflicts=${p.conflicts.length}\n`
    );
  }
  const allConflicts = [
    ...sets.Category.conflicts.map((c) => ({ ...c, entity: "category" })),
    ...sets.Model.conflicts.map((c) => ({ ...c, entity: "model" })),
    ...sets.Material.conflicts.map((c) => ({ ...c, entity: "material" })),
  ];
  if (allConflicts.length) {
    console.log("── КОНФЛИКТЫ (отличаются регистром/пробелами; НЕ вставлены, НЕ слиты):");
    for (const c of allConflicts) {
      const canon = c.canonical ? `канон: «${c.canonical}»  ↔  в БД: «${c.existingRow}»` : `дубль регистра в БД: «${c.existingRow}»`;
      // NB: не печатать «[m…]» — bun console.log глотает «[m» (ANSI-артефакт)
      console.log(`   ${c.entity}: ${canon}${c.note ? `  [${c.note}]` : ""}`);
    }
  }
  const allErrors = [...sets.Category.errors, ...sets.Model.errors, ...sets.Material.errors];
  if (allErrors.length) {
    console.log("── ОШИБКИ ВСТАВКИ:");
    for (const e of allErrors) console.log(`   ${e}`);
  }
  console.log("\nCHAIRS_IMPORTED=0");
  console.log("PRODUCT_VARIANTS_MODIFIED=0");
  console.log("PHOTOS_MODIFIED=0");
  console.log(`MODE=${APPLY ? "apply" : "dry-run"}`);
  console.log("────────────────────────────────────────\n");
}

function writeJsonOut(
  sets: PlanSet,
  countsBefore: unknown,
  countsAfter: unknown
): void {
  const outPath = JSON_OUT || path.join(PROJECT_ROOT, "tool-results", `seed-reference-data-${APPLY ? "apply" : "dry-run"}.json`);
  const payload = {
    mode: APPLY ? "apply" : "dry-run",
    liveUrl: LIVE_URL || null,
    database: LIVE_URL ? null : databaseFile(),
    masterData: "data/reference/catalog-master-data.json",
    Category: { existing: sets.Category.existing.length, planInsert: sets.Category.toInsert.length, inserted: APPLY ? insertedCount(sets.Category) : 0, conflicts: sets.Category.conflicts, errors: sets.Category.errors },
    Model: { existing: sets.Model.existing.length, planInsert: sets.Model.toInsert.length, inserted: APPLY ? insertedCount(sets.Model) : 0, conflicts: sets.Model.conflicts, errors: sets.Model.errors },
    Material: { existing: sets.Material.existing.length, planInsert: sets.Material.toInsert.length, inserted: APPLY ? insertedCount(sets.Material) : 0, conflicts: sets.Material.conflicts, errors: sets.Material.errors },
    countsBefore,
    countsAfter,
    chairsImported: 0,
    productVariantsModified: 0,
    photosModified: 0,
    at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
    console.log(`── JSON-отчёт: ${outPath}`);
  } catch (e) {
    console.warn(`⚠ JSON-отчёт не записан (${String(e)})`);
  }
}

/* ──────────────────────────────── main ──────────────────────────────── */

const runner = LIVE_URL ? runLive() : runDirect();
runner.catch((e) => {
  console.error("✗ Импорт упал:", e);
  process.exit(1);
});
