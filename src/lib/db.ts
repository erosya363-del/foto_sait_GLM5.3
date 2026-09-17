import { PrismaClient } from "@prisma/client";
import { DATABASE_URL, ensureRuntime } from "@/lib/runtime";

/* СТАБИЛИЗАЦИЯ: до создания клиента гарантируем наличие runtime-зоны и БД
   (bootstrap-копирование легаси/шаблона, только если файла НЕТ — никаких
   reset/seed/перезаписей, см. src/lib/runtime.ts). Раньше фолбэк был
   file:<cwd>/db/custom.db — в standalone это БД ВНУТРИ .next/standalone,
   которую стирал каждый rebuild (первопричина потери фото №2). */
ensureRuntime();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    /* 'query' убран: каждый SELECT лил в server.log сотни строк (564КБ за день) —
       лишний IO в горячем пути запросов. Ошибки и предупреждения остаются. */
    log: ['error', 'warn'],
    /* Единая точка разрешения пути БД — src/lib/runtime.ts:
       env DATABASE_URL (file:…) > download/runtime/database/custom.db.
       Явный datasourceUrl работает одинаково в dev и standalone (без .env). */
    datasourceUrl: DATABASE_URL,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
