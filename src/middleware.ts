import { NextResponse, type NextRequest } from "next/server";

/**
 * СТАБИЛИЗАЦИЯ (этап 18 ТЗ): динамические API никогда не кэшируются.
 *
 * Явный `Cache-Control: no-store` на ВСЕ ответы /api/*:
 *  — edge-шлюз платформы Previously кэшировал ответы (внешний /api/catalog
 *    отдавал устаревшие данные с URL /uploads/* после миграции на /api/media/*);
 *  — браузер/CDN не должны кэшировать админ-данные и каталог;
 *  — /api/media/* тоже no-store на уровне HTTP-заголовка: сами ФАЙЛЫ
 *    неизменяемы (уникальные имена), но список/наличие — живая логика.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
