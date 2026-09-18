import type { Metadata, Viewport } from "next";
import { Inter, Unbounded } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Склад мебели · Askona",
  description:
    "Единый товарный портал Askona: фотокаталог продукции + складские остатки (Обухово и Владимир). Поиск, фильтры, связка «Смотреть фото».",
  applicationName: "Склад мебели",
  appleWebApp: {
    capable: true,
    title: "Склад мебели",
    statusBarStyle: "black-translucent",
  },
  authors: [{ name: "Ярослав Федоренко" }],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: "/logo-askona.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // СТАБИЛИЗАЦИЯ (этап 15 ТЗ): maximumScale:1 / userScalable:false УДАЛЕНЫ —
  // браузерный zoom разрешён (доступность). iOS Safari всё равно игнорирует
  // user-scalable=no; авто-зум при фокусе в поля предотвращается font-size ≥16px
  // в инпутах (globals.css). Zoom просмотрщика фото (PhotoSwipe) не заменяет
  // zoom страницы. viewportFit/interactiveWidget — без изменений (safe-area,
  // поведение клавиатуры).
  viewportFit: "cover",
  // П.11 ТЗ (клавиатура): Android/Chrome сжимает layout-viewport на высоту
  // клавиатуры → 100dvh/модалки/нижняя панель считаются от ВИДИМОЙ области
  // синхронно с visualViewport-логикой portal.tsx (--kb-h)
  interactiveWidget: "resizes-content",
  /* ЧЁЛКА iPhone (аудит v2.6): ОДИН meta без media — цвет зоны статуса
     синхронизируется с ТЕМОЙ ПРИЛОЖЕНИЯ (не системной) скриптом ниже и
     MutationObserver'ом в portal.tsx. Раньше стояли media-пары со старыми
     цветами (#0d0e10/#f4f7f8) — при светлой теме приложения и тёмной системе
     Safari рисовал серую полосу под чёлкой (скрин владельца) */
  themeColor: "#1d1b18",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* ФИКС ПОЛОСЫ v3: серия пересчётов вьюпорта ЕЩЁ ДО гидратации —
            первый запуск iOS standalone-PWA раскладывает страницу во вьюпорт
            без нижнего safe-area; лечим под сплэшем, чтобы полоса не успела
            появиться */}
        <Script id="ios-viewport-nudge" strategy="beforeInteractive">
          {`(function () {
            try {
              /* ТЗ v3.0 п.41: сплэш только при ПЕРВОМ запуске сессии. Флаг ставим
                 до гидратации; на повторных загрузках (F5/возврат на вкладку)
                 класс boot-skip прячет .boot-bg с первого кадра (CSS). */
              try {
                if (sessionStorage.getItem("skovo-booted") === "1") {
                  document.documentElement.classList.add("boot-skip");
                } else {
                  sessionStorage.setItem("skovo-booted", "1");
                }
              } catch (e) {}
              /* ЧЁЛКА (аудит v2.6): цвет статуса = тема приложения ДО первой
                 отрисовки (next-themes хранит ключ "theme": light/dark/system) */
              var syncMeta = function () {
                try {
                  var t = null;
                  try { t = localStorage.getItem("theme"); } catch (e) {}
                  var eff = t === "light" || t === "dark"
                    ? t
                    : (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
                  var m = document.querySelector('meta[name="theme-color"]');
                  if (m) m.setAttribute("content", eff === "light" ? "#f8f5ef" : "#1d1b18");
                } catch (e) {}
              };
              syncMeta();
              var ua = navigator.userAgent || "";
              var iOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
              if (!iOS) return;
              var nudge = function () {
                try {
                  var html = document.documentElement;
                  var prev = html.style.minHeight;
                  html.style.minHeight = "calc(100dvh + 1px)";
                  void html.offsetHeight;
                  html.style.minHeight = prev;
                  window.dispatchEvent(new Event("resize"));
                  /* ФИКС ПОЛОСЫ, повторно + PHASE 2.2 (регресс на iOS 26 с тяжёлым
                     стеклом v5 blur 40/sat 2): слой backdrop-filter при холодном
                     старте живёт с неверной геометрией ДО ПЕРВОГО КАСАНИЯ —
                     пользователь видит «пустую полосу под панелью», первое
                     взаимодействие перестраивает композитор и панель «опускается
                     на место». (а) Хинт стал сильнее: scale-пульс а не только
                     translateZ; (б) серия продлена до 7.6 с — прежние 3 с
                     кончались раньше, чем пользователь успевал коснуться экрана. */
                  var pill = document.querySelector(".pill-shell");
                  if (pill) {
                    pill.style.transform = "translateZ(0) scale(1.002)";
                    setTimeout(function () { pill.style.transform = ""; }, 90);
                  }
                  syncMeta();
                } catch (e) {}
              };
              [120, 420, 900, 1500, 2200, 3000, 4200, 5600, 7600].forEach(function (ms) { setTimeout(nudge, ms); });
              window.addEventListener("pageshow", function (e) { if (e.persisted) nudge(); });
            } catch (e) {}
          })();`}
        </Script>
        {/* F-002 offline: регистрация минимального SW (network-first, fallback
            только для навигаций). readyState-гейт: window "load" мог уже пройти
            к моменту инъекции afterInteractive-скрипта. Ошибки — молча. */}
        <Script id="sw-register" strategy="afterInteractive">
          {`if ("serviceWorker" in navigator) { var __swReg = function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); }; if (document.readyState === "complete") __swReg(); else window.addEventListener("load", __swReg); }`}
        </Script>
      </head>
      <body className={`${inter.variable} ${unbounded.variable} antialiased`}>
        <Providers>{children}</Providers>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}