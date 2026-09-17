import UIKit
import WebKit

/// Навигационная политика WKWebView (п.25 ТЗ).
///
/// - Собственные страницы (AppConfiguration.allowedHosts) — остаются в WebView.
///   target="_blank" того же хоста тоже открывается здесь же (не уводим контент).
/// - Любой другой http(s)-хост — системный Safari. Неизвестный сайт никогда
///   не получает доступ к JS-мосту (мост зарегистрирован только в этой
///   конфигурации WebView, а посторонние страницы мы в неё не грузим).
/// - Прочие схемы (javascript: и всё неизвестное) — явно cancel:
///   веб-контент не может заставить WebView исполнить или открыть произвольную схему.
final class WebNavigationDelegate: NSObject, WKNavigationDelegate {

    /// Служебные схемы WebKit, безопасные для загрузки (подресурсы, blob-превью).
    private static let safeSchemes: Set<String> = ["about", "blob", "data"]

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {

        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        let scheme = url.scheme?.lowercased() ?? ""

        if scheme == "https" || scheme == "http" {
            if AppConfiguration.allowedHosts.contains(url.host ?? "") {
                decisionHandler(.allow)
            } else {
                // Внешний домен: навигацию отменяем, открываем системный Safari
                decisionHandler(.cancel)
                openExternally(url)
            }
            return
        }

        if Self.safeSchemes.contains(scheme) {
            decisionHandler(.allow)
            return
        }

        // javascript:, file:, произвольные схемы — запрещены
        decisionHandler(.cancel)
    }

    private func openExternally(_ url: URL) {
        Task { @MainActor in
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
    }

    // MARK: - Восстановление после смерти WebContent-процесса (п.14 ТЗ:
    // повторная загрузка допустима только при реальном уничтожении процесса)

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation?,
                 withError error: Error) {
        // Нет сети / сервер недоступен: сайт сам не отрисуется; лог для отладки.
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        NSLog("[AskonaApp] загрузка не удалась: \(nsError.localizedDescription)")
    }
}
