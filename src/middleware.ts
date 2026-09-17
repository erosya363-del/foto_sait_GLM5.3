import { NextResponse, type NextRequest } from "next/server";

/**
 * СТАБИЛИЗАЦИЯ (этап 18 ТЗ + правка ревью v2: единая cache-policy).
 *
 * Противоречие ДО правки: /api/media/* отдавал immutable+1 год, а middleware
 * матчил ВСЁ /api/* и перезаписывал no-store — код одновременно говорил
 * «фото кэшировать год» и «весь /api не кэшировать вообще».
 *
 * ЕДИНАЯ ПОЛИТИКА:
 *   /api/media/*  → public, max-age=31536000, immutable
 *     (имена файлов уникальны и содержимое никогда не меняется; без этого
 *      сервер перечитывал одни и те же JPEG с диска на каждый запрос)
 *   остальные /api/* → no-store
 *     (каталог/админ/остатки — живая логика; edge-шлюз платформы Previously
 *      кэшировал ответы и отдавал устаревшие данные с URL /uploads/*)
 *
 * Значение дублируется в самих route-handler'ах (/api/media, /uploads-легаси):
 * middleware гарантирует политику даже там, где ответ идёт мимо handler'а.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/media/")) {
    res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.headers.set("Cache-Control", "no-store");
  }
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
