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
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db