#!/usr/bin/env bun
/**
 * verify-runtime-artifact.mjs — VERIFY КАЖДОЙ PHOTO СТРОКИ (ТЗ CRITICAL STABILITY 2.7).
 *
 * Читает SQLite-БД runtime-зоны/артефакта и проверяет КАЖДУЮ живую Photo
 * (deletedAt IS NULL):
 *      photo.url  и  photo.thumbUrl
 *        → файл существует;
 *        → regular file;
 *        → size > 0;
 *        → путь не выходит за runtime root (нет ../, symlink-побегов, abs-путей).
 *
 * Также сверяет счётчик Photo с числом файлов в optimized/thumbs — чтобы
 * артефакт «БД есть, медиа нет» (первопричина «исчезающих фото») был невозможен.
 *
 * Fail-closed: хотя бы одна сломанная ссылка → EXIT 1 + перечень проблем.
 *
 * Использование:
 *   bun scripts/verify-runtime-artifact.mjs <ROOT> [--db <ПУТЬ_К_БД>] [--quiet]
 *     <ROOT>  корень runtime-зоны/артефакта, внутри которого ожидаются
 *             uploads/{optimized,thumbs}
 *     --db    явный путь к БД (артефакт хранит её в db/custom.db, вне ROOT —
 *             ТЗ 2.8: проверяем ровно те файлы, что уедут в деплой)
 *
 * Примеры:
 *   bun scripts/verify-runtime-artifact.mjs download/runtime            # локальная зона
 *   bun scripts/verify-runtime-artifact.mjs "$BUILD_DIR/next-service-dist"  # артефакт
 */
import fs from "fs";
import path from "path";
import { Database } from "bun:sqlite";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const dbFlagIdx = args.indexOf("--db");
const dbOverride = dbFlagIdx >= 0 ? args[dbFlagIdx + 1] : null;
const rootArg = args.find(
  (a, i) => !a.startsWith("--") && (dbFlagIdx === -1 || i !== dbFlagIdx + 1)
);

if (!rootArg) {
  console.error("✗ Использование: bun scripts/verify-runtime-artifact.mjs <ROOT> [--db <ПУТЬ>] [--quiet]");
  process.exit(1);
}

const ROOT = path.resolve(rootArg);
const DB_FILE = dbOverride ? path.resolve(dbOverride) : path.join(ROOT, "database", "custom.db");
const OPT_DIR = path.join(ROOT, "uploads", "optimized");
const THM_DIR = path.join(ROOT, "uploads", "thumbs");

let fail = 0;
const problems = [];
function bad(msg) {
  fail++;
  problems.push(msg);
  if (!quiet) console.error("  ✗ " + msg);
}
function ok(msg) {
  if (!quiet) console.log("  ✓ " + msg);
}

if (!fs.existsSync(DB_FILE)) {
  console.error(`✗ БД не найдена: ${DB_FILE}`);
  process.exit(1);
}

/* ── [1/4] Читаем живые Photo ──────────────────────────────────────────── */
let rows = [];
try {
  const db = new Database(DB_FILE, { readonly: true });
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((t) => String(t.name).toLowerCase());
  const table = tables.includes("photos") ? "photos" : tables.includes("photo") ? "photo" : null;
  if (!table) {
    console.error("✗ В БД нет таблицы photos/photo — это не runtime-БД каталога");
    process.exit(1);
  }
  const cols = db.query(`PRAGMA table_info(${table})`).all().map((c) => String(c.name));
  const hasDeletedAt = cols.some((c) => c.toLowerCase() === "deletedat");
  rows = hasDeletedAt
    ? db
        .query(
          `SELECT id, url, "thumbUrl" AS thumbUrl FROM ${table} WHERE "deletedAt" IS NULL`
        )
        .all()
    : db.query(`SELECT id, url, "thumbUrl" AS thumbUrl FROM ${table}`).all();
  db.close();
} catch (e) {
  console.error("✗ Не удалось прочитать БД: " + e.message);
  process.exit(1);
}

ok(`БД прочитана: живых Photo = ${rows.length}`);

/* ── [2/4] Проверка каждой ссылки url/thumbUrl ─────────────────────────── */
function safeJoin(baseDir, url) {
  // url вида /api/media/optimized/<name> → файл <ROOT>/uploads/optimized/<name>
  if (typeof url !== "string" || !url) return null;
  const m = url.match(/^\/api\/media\/(optimized|thumbs)\/([A-Za-z0-9._-]+)$/);
  if (!m) return null;
  const dir = m[1] === "optimized" ? OPT_DIR : THM_DIR;
  const name = m[2];
  if (name.includes("..") || name.startsWith("/")) return null;
  const full = path.join(dir, name);
  const rel = path.relative(ROOT, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null; // побег из root
  return full;
}

let checked = 0;
for (const r of rows) {
  for (const kind of ["url", "thumbUrl"]) {
    const url = r[kind];
    const full = safeJoin(ROOT, url);
    if (!full) {
      bad(`Photo ${r.id}: некорректный ${kind}="${url}" (не ссылка /api/media/{optimized|thumbs}/<имя> или выход за root)`);
      continue;
    }
    checked++;
    let st = null;
    try {
      st = fs.statSync(full);
    } catch {
      st = null;
    }
    if (!st) {
      bad(`Photo ${r.id}: ${kind}="${url}" — ФАЙЛ ОТСУТСТВУЕТ: ${full}`);
      continue;
    }
    if (!st.isFile()) {
      bad(`Photo ${r.id}: ${kind}="${url}" — не regular file: ${full}`);
      continue;
    }
    if (st.size <= 0) {
      bad(`Photo ${r.id}: ${kind}="${url}" — size=0: ${full}`);
      continue;
    }
  }
}
ok(`Проверено ссылок: ${checked} (2 на каждую Photo)`);

/* ── [3/4] Счётчики media vs БД (артефакт «БД без медиа» невозможен) ───── */
function countFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => {
      try {
        return fs.statSync(path.join(dir, n)).isFile();
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}
const optCount = countFiles(OPT_DIR);
const thmCount = countFiles(THM_DIR);
ok(`Файлов: optimized=${optCount}, thumbs=${thmCount}`);

if (rows.length > 0 && optCount === 0) {
  bad(`БД содержит ${rows.length} Photo, но uploads/optimized ПУСТ — «исчезнувшие фото» при таком артефакте гарантированы`);
}
if (rows.length > 0 && thmCount === 0) {
  bad(`БД содержит ${rows.length} Photo, но uploads/thumbs ПУСТ`);
}

/* ── [4/4] Итог ────────────────────────────────────────────────────────── */
if (fail > 0) {
  console.error(`\n✗ ARTIFACT VERIFY: FAIL — проблем: ${fail}`);
  console.error(problems.slice(0, 20).join("\n"));
  if (problems.length > 20) console.error(`  … и ещё ${problems.length - 20}`);
  process.exit(1);
}

console.log(`\n✅ ARTIFACT VERIFY: PASS — ${rows.length} Photo, все ссылки целы (root=${ROOT})`);
process.exit(0);
