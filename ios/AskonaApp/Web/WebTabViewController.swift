import UIKit

/// Контент-контроллер одной вкладки RootTabBarController.
///
/// АРХИТЕКТУРА (п.13 ТЗ — минимум перезагрузок):
/// сайт — одностраничное приложение (SPA на zustand-состояниях, URL-роутов
/// разделов нет), поэтому существует РОВНО ОДИН общий WKWebView на все
/// четыре вкладки. Он принадлежит RootTabBarController и лежит в нём
/// ПОД стеком дочерних view (но НАД фоном и ПОД tab bar'ом — контент
/// продолжается под системным Liquid Glass, п.19 ТЗ).
///
/// Каждый WebTabViewController — прозрачный «носитель» пункта таб-бара.
/// Переключение вкладки НЕ трогает WebView: ни reload(), ни load(),
/// ни повторного splash — состояние разделов сайта живёт между вкладками.
final class WebTabViewController: UIViewController {

    /// Идентификатор раздела на стороне сайта ("catalog" | "upload" | "admin" | "stock")
    let webTabID: String

    init(webTabID: String, title: String, symbolName: String) {
        self.webTabID = webTabID
        super.init(nibName: nil, bundle: nil)
        // Пункт таб-бара: системный SF Symbol, никакого кастомного фона/изображений
        tabBarItem = UITabBarItem(title: title,
                                  image: UIImage(systemName: symbolName),
                                  selectedImage: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("WebTabViewController не поддерживает storyboard-инициализацию")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // Прозрачный: WebView виден сквозь него, системный tab bar — над всем
        view.backgroundColor = .clear
    }
}
