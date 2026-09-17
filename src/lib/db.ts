import path from 'path'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    /* 'query' убран: каждый SELECT лил в server.log сотни строк (564КБ за день) —
       лишний IO в горячем пути запросов. Ошибки и предупреждения остаются. */
    log: ['error', 'warn'],
    /* FIX deploy: на платформе нет .env -> DATABASE_URL отсутствует ->
       каждый запрос к БД падал. Фолбэк: db/custom.db от корня проекта
       (cwd). При заданном DATABASE_URL поведение не меняется. */
    datasourceUrl:
      process.env.DATABASE_URL ||
      'file:' + path.join(process.cwd(), 'db', 'custom.db'),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db