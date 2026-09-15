/* ── Liquid Glass — настоящее оптическое преломление для веба ───────────────
   Порт техники «Liquid Glass» (карта смещений Canvas 2D + SVG feDisplacementMap
   + хроматическая аберрация по RGB-каналам, 0 зависимостей) — по документации,
   предоставленной владельцем. Ноль зависимостей, один файл.

   Как работает:
    1. Canvas 2D рисует КАРТУ СМЕЩЕНИЙ: нейтральный серый (128,128,128) = ноль
       смещения; красный градиент слева-направо = смещение по X; зелёный
       градиент сверху-вниз = смещение по Y; размытая серая зона в центре
       линзы — плавный спад от «неподвижного центра» к «преломляющим граням».
    2. Карта подаётся в SVG-фильтр через feImage (data-URL). ЛОВУШКА ВЫРАВНИВАНИЯ
       решена: canvas заранее размером С ФИЛЬТР-РЕГИОН (элемент + запас под
       максимальное смещение), серый паддинг гарантирует ноль смещения вне
       линзы — feImage заполняет регион ровно, линза совпадает с элементом.
    3. ТРИ прохода feDisplacementMap с чуть разными scale (R/G/B) — каждая
       цветовая составляющая преломляется под своим углом → радужная кайма
       (хроматическая аберрация) на гранях. Проходы изолируются feColorMatrix
       и складываются обратно feBlend mode="screen".
    4. ЛОВУШКА РЕГИОНА решена: filter-region расширяется на полный диапазон
       смещения (scale/2 + запас) — feDisplacementMap не сэмплирует прозрачность.
    5. После преломления в цепочку добавляются feGaussianBlur (иней центра) и
       feColorMatrix saturate — стекло «подстраивается под задний фон».
    6. Всё навешивается одним backdrop-filter: url(#id) — ЧУМ-ONLY. В Safari/
       Firefox эффект недоступен (backdrop-filter: url() не поддерживается) —
       они получают чистый CSS-fallback (blur/saturate), детект автоматический.

   Reference: техника карты смещений — Jhey Tompkins (MIT). */

export type LiquidGlassOptions = {
  /** Радиус скругления линзы (px). 999 = пилюля. */
  borderRadius?: number;
  /** Сила смещения. Более отрицательное = сильнее преломление на гранях. */
  scale?: number;
  /** Аберрация по каналам [R, G, B] — дельты к scale. */
  aberration?: [number, number, number];
  /** Иней (feGaussianBlur stdDeviation) поверх преломлённого фона. */
  blur?: number;
  /** Насыщенность фона (стекло подстраивается под фон). */
  saturation?: number;
  /** Ширина переходной зоны «центр → грань», px. */
  band?: number;
  filterId?: string;
};

export type LiquidGlassInstance = {
  update: (opts?: LiquidGlassOptions) => void;
  destroy: () => void;
  isActive: boolean;
  filterId: string;
};

/** Полный эффект требует backdrop-filter: url() — это только Chromium.
    Safari/Firefox получают CSS-fallback (см. globals.css), без ошибок. */
export function isGlassChromium(): boolean {
  if (typeof window === "undefined" || typeof CSS === "undefined") return false;
  try {
    return CSS.supports?.("backdrop-filter", "url(#lg-probe)") === true;
  } catch {
    return false;
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** SDF скруглённого прямоугольника: <0 внутри, 0 на границе, >0 снаружи. */
function sdRoundRect(px: number, py: number, w: number, h: number, r: number): number {
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const qx = Math.abs(px - w / 2) - hx;
  const qy = Math.abs(py - h / 2) - hy;
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

let seq = 0;

export function createLiquidGlass(
  el: HTMLElement,
  opts: LiquidGlassOptions = {}
): LiquidGlassInstance {
  const active = isGlassChromium() && typeof document !== "undefined";
  let o: Required<LiquidGlassOptions> = {
    borderRadius: opts.borderRadius ?? 999,
    scale: opts.scale ?? -110,
    aberration: opts.aberration ?? [0, 7, 14],
    blur: opts.blur ?? 9,
    saturation: opts.saturation ?? 1.5,
    band: opts.band ?? 14,
    filterId: opts.filterId ?? `lg-${++seq}-${Math.random().toString(36).slice(2, 8)}`,
  };

  const NS = "http://www.w3.org/2000/svg";
  let svg: SVGSVGElement | null = null;
  let filter: SVGFilterElement | null = null;
  let feImage: SVGFEImageElement | null = null;
  let disp: SVGFEDisplacementMapElement[] = [];
  let feBlur: SVGFEGaussianBlurElement | null = null;
  let feSat: SVGFEColorMatrixElement | null = null;
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let lastW = 0;
  let lastH = 0;

  /* Карта смещений: canvas размером С РЕГИОНОМ фильтра (элемент + паддинг под
     максимальное смещение). Вне линзы — нейтральный серый: ноль смещения. */
  const buildMap = (): { url: string; pad: number; w: number; h: number } | null => {
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 8 || h < 8) return null;
    lastW = w;
    lastH = h;
    const radius = Math.min(o.borderRadius, h / 2, w / 2);
    const maxDisp = Math.abs(o.scale + Math.min(...o.aberration)) / 2;
    const pad = Math.ceil(maxDisp) + 6;
    const cw = w + pad * 2;
    const ch = h + pad * 2;

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(cw, ch);
    const d = img.data;
    const band = o.band;
    for (let y = 0; y < ch; y++) {
      const ey = y - pad;
      for (let x = 0; x < cw; x++) {
        const ex = x - pad;
        const i = (y * cw + x) * 4;
        // внутри элемента?
        if (ex >= 0 && ex < w && ey >= 0 && ey < h) {
          // глубина от границы линзы (px, 0 на самой кромке)
          const depth = -sdRoundRect(ex, ey, w, h, radius);
          // f: 1 на кромке → 0 в центре (плавный спад на ширину band)
          const f = smooth(1 - clamp01(depth / band));
          const rx = ex / (w - 1);
          const ry = ey / (h - 1);
          d[i] = 128 + (rx * 255 - 128) * f; // R → смещение X
          d[i + 1] = 128 + (ry * 255 - 128) * f; // G → смещение Y
          d[i + 2] = 128;
          d[i + 3] = 255;
        } else {
          d[i] = 128;
          d[i + 1] = 128;
          d[i + 2] = 128;
          d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return { url: canvas.toDataURL(), pad, w, h };
  };

  const mount = () => {
    if (!active || !el.isConnected) return;
    const map = buildMap();
    if (!map) return;
    const { url, pad, w, h } = map;

    if (!svg) {
      svg = document.createElementNS(NS, "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      // ВАЖНО: не display:none (Chrome перестаёт считать фильтр)
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      svg.style.pointerEvents = "none";
      filter = document.createElementNS(NS, "filter");
      filter.setAttribute("id", o.filterId);
      filter.setAttribute("color-interpolation-filters", "sRGB");
      svg.appendChild(filter);
      document.body.appendChild(svg);
    }
    // ЛОВУШКА РЕГИОНА: регион = элемент + весь диапазон смещения
    filter!.setAttribute("filterUnits", "userSpaceOnUse");
    filter!.setAttribute("x", String(-pad));
    filter!.setAttribute("y", String(-pad));
    filter!.setAttribute("width", String(w + pad * 2));
    filter!.setAttribute("height", String(h + pad * 2));

    if (!feImage) {
      feImage = document.createElementNS(NS, "feImage");
      feImage.setAttribute("result", "map");
      feImage.setAttribute("preserveAspectRatio", "none");
      filter!.appendChild(feImage);
      // 3 прохода: смещение → извлечение канала; затем screen-склейка + иней
      const EXTRACT = [
        "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
        "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
        "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
      ];
      let prev = "rg";
      disp = [];
      for (let i = 0; i < 3; i++) {
        const dm = document.createElementNS(NS, "feDisplacementMap");
        dm.setAttribute("in", "SourceGraphic");
        dm.setAttribute("in2", "map");
        dm.setAttribute("xChannelSelector", "R");
        dm.setAttribute("yChannelSelector", "G");
        dm.setAttribute("result", `d${i}`);
        filter!.appendChild(dm);
        disp.push(dm);
        const cm = document.createElementNS(NS, "feColorMatrix");
        cm.setAttribute("in", `d${i}`);
        cm.setAttribute("type", "matrix");
        cm.setAttribute("values", EXTRACT[i]);
        cm.setAttribute("result", `c${i}`);
        filter!.appendChild(cm);
        if (i === 1) {
          const b1 = document.createElementNS(NS, "feBlend");
          b1.setAttribute("in", "c0");
          b1.setAttribute("in2", "c1");
          b1.setAttribute("mode", "screen");
          b1.setAttribute("result", "rg");
          filter!.appendChild(b1);
        }
        if (i === 2) {
          const b2 = document.createElementNS(NS, "feBlend");
          b2.setAttribute("in", "rg");
          b2.setAttribute("in2", "c2");
          b2.setAttribute("mode", "screen");
          b2.setAttribute("result", "warped");
          filter!.appendChild(b2);
          feBlur = document.createElementNS(NS, "feGaussianBlur");
          feBlur.setAttribute("in", "warped");
          feBlur.setAttribute("stdDeviation", String(o.blur));
          feBlur.setAttribute("result", "frosted");
          filter!.appendChild(feBlur);
          feSat = document.createElementNS(NS, "feColorMatrix");
          feSat.setAttribute("in", "frosted");
          feSat.setAttribute("type", "saturate");
          feSat.setAttribute("values", String(o.saturation));
          filter!.appendChild(feSat);
        }
        void prev;
      }
    }
    feImage.setAttribute("href", url);
    feImage.setAttribute("x", String(-pad));
    feImage.setAttribute("y", String(-pad));
    feImage.setAttribute("width", String(w + pad * 2));
    feImage.setAttribute("height", String(h + pad * 2));
    for (let i = 0; i < 3; i++) {
      disp[i]?.setAttribute("scale", String(o.scale + o.aberration[i]));
    }
    feBlur?.setAttribute("stdDeviation", String(o.blur));
    feSat?.setAttribute("values", String(o.saturation));

    // Сам эффект — один backdrop-filter (CSS-фолбэк остаётся для Safari)
    el.style.backdropFilter = `url(#${o.filterId})`;
  };

  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(mount);
  };

  if (active) {
    mount();
    ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (Math.abs(Math.round(rect.width) - lastW) > 1 || Math.abs(Math.round(rect.height) - lastH) > 1) {
        schedule();
      }
    });
    ro.observe(el);
  }

  return {
    update(next: LiquidGlassOptions = {}) {
      o = { ...o, ...next } as Required<LiquidGlassOptions>;
      if (active) schedule();
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      ro = null;
      svg?.remove();
      svg = null;
      filter = null;
      feImage = null;
      disp = [];
      feBlur = null;
      feSat = null;
      el.style.backdropFilter = "";
    },
    isActive: active,
    filterId: o.filterId,
  };
}
