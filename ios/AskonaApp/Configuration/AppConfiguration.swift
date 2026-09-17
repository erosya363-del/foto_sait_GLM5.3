import Foundation

/// Конфигурация нативной оболочки Askona.
///
/// Единственная точка настройки: URL сайта, доверенные хосты, состав вкладок.
/// Ничего приватного и захардкоженного по геометрии — safe areas считает iOS.
enum AppConfiguration {

    /// Публичный URL сайта (деплой-снимок последнего коммита).
    /// Для локальной разработки замените на http://localhost:3000 —
    /// NSAllowsLocalNetworking в Info.plist уже разрешён.
    static let baseURL = URL(string: "https://j1jr777qg2d0-d.space-z.ai")!

    /// Хосты, которым разрешён JS-мост и навигация внутри WKWebView.
    /// Всё остальное уходит в системный Safari (п.25 ТЗ).
    static let allowedHosts: Set<String> = [
        "j1jr777qg2d0-d.space-z.ai",
        "localhost",
        "127.0.0.1",
    ]

    /// Вкладки нативного таб-бара. Порядок = порядок на панели.
    /// symbol — проверенные SF Symbols (есть в iOS 26 SDK):
    ///   square.grid.2x2     — iOS 14+
    ///   square.and.arrow.up — iOS 7+
    ///   gearshape           — iOS 14+
    ///   shippingbox         — iOS 14+
    static let tabs: [Tab] = [
        Tab(id: "catalog", title: "Каталог", symbolName: "square.grid.2x2"),
        Tab(id: "upload",  title: "Загрузка", symbolName: "square.and.arrow.up"),
        Tab(id: "admin",   title: "Админ", symbolName: "gearshape"),
        Tab(id: "stock",   title: "Остатки", symbolName: "shippingbox"),
    ]

    struct Tab {
        /// Идентификатор раздела на стороне сайта (Web = "catalog" | "upload" | "admin" | "stock")
        let id: String
        let title: String
        let symbolName: String
    }

    /// Имя JS-моста (window.webkit.messageHandlers.<name>)
    static let bridgeName = "nativeApp"

    /// Имя DOM-события, которым нативная сторона переключает разделы сайта
    static let tabChangeEventName = "native-tab-change"
}
