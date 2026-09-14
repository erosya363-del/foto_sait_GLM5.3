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
  // iOS: страница не зумится при фокусе в поиск (зум только внутри просмотрщика фото)
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0e10" },
    { media: "(prefers-color-scheme: light)", color: "#f4f7f8" },
  ],
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
                } catch (e) {}
              };
              [120, 420, 900, 1500, 2200, 3000].forEach(function (ms) { setTimeout(nudge, ms); });
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