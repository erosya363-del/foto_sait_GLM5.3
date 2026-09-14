// ─── Общие типы Skovo Portal ────────────────────────────────────────────────

export type PhotoMatch = {
  variantId: string;
  coverUrl: string;
  photoCount: number;
  confidence: "high" | "medium";
  variantName: string;
};

export type StockItemDto = {
  id: string;
  name: string;
  qty: number;
  category: string;
  size: string | null;
  feature: string | null;
  series: string | null;
  modifiedDate: string | null;
  stale: boolean;
  staleDays: number | null;
  sale: {
    oldPrice: number;
    finalPrice: number;
    discountPercent: number;
  } | null;
  photoMatch: PhotoMatch | null;
  photoMatches: PhotoMatch[];
};

export type StockResponse = {
  items: StockItemDto[];
  categories: string[];
  sizes: string[];
  meta: {
    generatedAt: string;
    total: number;
    units: number;
    saleCount: number;
    staleCount: number;
    version: string;
  };
};

export type PhotoDto = {
  id: string;
  url: string;
  thumbUrl: string;
  comment: string | null;
};

export type CatalogItemDto = {
  id: string;
  categoryId: string;
  categoryName: string;
  modelId: string;
  modelName: string;
  variantName?: string | null;
  materialId: string | null;
  materialName: string | null;
  /** Цветовая гамма ткани (Material.colorGroup) — показывается на карточках */
  materialGroup?: string | null;
  sizeId: string | null;
  sizeName: string | null;
  description: string | null;
  tags: string[];
  /** Шаг 4: вариант/фото добавлены за последние 7 дней */
  isNew?: boolean;
  photos: PhotoDto[];
};

export type Dictionaries = {
  categories: Array<{ id: string; name: string; active: boolean }>;
  models: Array<{ id: string; name: string; categoryId: string; categoryName: string; active: boolean }>;
  materials: Array<{ id: string; name: string; type: string; active: boolean; swatchUrl?: string | null; colorGroup?: string | null }>;
  sizes: Array<{ id: string; name: string; active: boolean }>;
  tags: Array<{ id: string; name: string; active: boolean }>;
};

// ─── Нормализация и парсинг (по мотивам исходного app.js) ──────────────────

export function normalizeName(s: string): string {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/ё/g, "е");
}

/** 160*200, 160х200, 160x200 → «160×200» */
export function normalizeSize(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).match(/(\d{2,3})\s*[×xх\-*]\s*(\d{2,3})/i);
  if (m) return `${m[1]}×${m[2]}`;
  const range = String(s).match(/(до 2|2[–-]2\.5|2\.5[–-]3\.5|4)\s*м/i);
  if (range) return range[0].toLowerCase();
  return null;
}

export function bedPm(name: string): string | null {
  const n = normalizeName(name);
  if (/(с\s*пм|с подъём|с подъем)/.test(n)) return "С ПМ";
  if (/без\s*пм/.test(n)) return "Без ПМ";
  return null;
}

export function sofaKind(name: string): string | null {
  const n = normalizeName(name);
  if (/угл/.test(n)) return "Угловой";
  if (/прям/.test(n)) return "Прямой";
  return null;
}

export function kpbKind(name: string): string | null {
  const n = normalizeName(name);
  if (/евро/.test(n)) return "Евро";
  if (/семей/.test(n)) return "Семейный";
  if (/двусп|дусп/.test(n)) return "Двуспальный";
  if (/полутор/.test(n)) return "Полуторный";
  return null;
}

export function seriesOf(name: string): string | null {
  return null;
}

export const STOCK_STALE_DAYS = 14;

export function staleDays(modifiedDate: string | null, generatedAt: string): number | null {
  if (!modifiedDate) return null;
  const a = new Date(`${modifiedDate}T00:00:00`);
  const g = new Date(generatedAt);
  if (Number.isNaN(a.getTime()) || Number.isNaN(g.getTime())) return null;
  const gDay = new Date(g.getFullYear(), g.getMonth(), g.getDate());
  return Math.floor((gDay.getTime() - a.getTime()) / 86400000);
}

export function formatPrice(v: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(v)) + " ₽";
}
