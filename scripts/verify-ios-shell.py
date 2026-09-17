#!/usr/bin/env python3
"""Статическая верификация iOS-оболочки без Xcode:
1) project.pbxproj — баланс скобок/структура OpenStep-плита;
2) Info.plist + Contents.json — валидный XML/JSON;
3) все ID-ссылки в pbxproj разрешаются;
4) Swift-файлы: баланс скобок, запрет private API (_Class), наличие @main/классов.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project/ios")
errors = []

# ---------- 1. pbxproj: баланс и парсинг ----------
pbx = (ROOT / "AskonaApp.xcodeproj/project.pbxproj").read_text()

# убираем комментарии и строковые литералы для проверки баланса
stripped = re.sub(r"\"(?:[^\"\\]|\\.)*\"", '""', pbx)
stripped = re.sub(r"/\*.*?\*/", "", stripped, flags=re.S)
for ch_open, ch_close, name in [("{", "}", "braces"), ("(", ")", "parens")]:
    if stripped.count(ch_open) != stripped.count(ch_close):
        errors.append(f"pbxproj: дисбаланс {name}: {stripped.count(ch_open)} vs {stripped.count(ch_close)}")

# ссылки: все 24-hex ID, использованные как ссылки, должны быть объявлены
declared = set(re.findall(r"^\t\t([0-9A-F]{24}) ", pbx, flags=re.M))
used = set(re.findall(r"\b([0-9A-F]{24})\b", pbx))
missing = used - declared
if missing:
    errors.append(f"pbxproj: необъявленные ID: {missing}")

# ключевые объекты обязаны присутствовать
for must in ["PBXFileSystemSynchronizedRootGroup", "PBXFileSystemSynchronizedBuildFileExceptionSet",
             "PBXNativeTarget", "PBXProject", "XCBuildConfiguration", "INFOPLIST_FILE",
             "IPHONEOS_DEPLOYMENT_TARGET = 26.0", "fileSystemSynchronizedGroups"]:
    if must not in pbx:
        errors.append(f"pbxproj: отсутствует {must}")

# ---------- 2. Info.plist ----------
plist_text = (ROOT / "AskonaApp/Resources/Info.plist").read_text()
try:
    import plistlib
    data = plistlib.loads(plist_text.encode())
    for key in ["CFBundleDisplayName", "UILaunchScreen", "UIApplicationSceneManifest",
                "NSCameraUsageDescription", "NSPhotoLibraryUsageDescription", "CFBundleExecutable"]:
        if key not in data:
            errors.append(f"Info.plist: отсутствует ключ {key}")
except Exception as exc:  # noqa: BLE001
    errors.append(f"Info.plist: ошибка парсинга: {exc}")

# ---------- 3. Assets ----------
for cj in ROOT.rglob("*.colorset/Contents.json"):
    try:
        json.loads(cj.read_text())
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{cj}: ошибка JSON: {exc}")
icon_json = ROOT / "AskonaApp/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json"
try:
    icon_data = json.loads(icon_json.read_text())
    filename = icon_data["images"][0]["filename"]
    icon_png = icon_json.parent / filename
    if not icon_png.exists():
        errors.append(f"AppIcon: файл {filename} отсутствует")
    else:
        if icon_png.stat().st_size < 10000:
            errors.append("AppIcon: файл подозрительно мал")
        with open(icon_png, "rb") as fh:
            sig = fh.read(8)
            if sig[:4] != b"\x89PNG":
                errors.append("AppIcon: не PNG")
except Exception as exc:  # noqa: BLE001
    errors.append(f"AppIcon Contents.json: {exc}")

# ---------- 4. Swift ----------
swift_files = sorted(ROOT.rglob("*.swift"))
if len(swift_files) != 8:
    errors.append(f"ожидалось 8 swift-файлов, найдено {len(swift_files)}: {[f.name for f in swift_files]}")
for sf in swift_files:
    src = sf.read_text()
    s = re.sub(r"\"(?:[^\"\\]|\\.)*\"", '""', src)
    s = re.sub(r"//[^\n]*", "", s)
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    if s.count("{") != s.count("}"):
        errors.append(f"{sf.name}: дисбаланс скобок {{}}: {s.count('{')} vs {s.count('}')}")
    if s.count("(") != s.count(")"):
        errors.append(f"{sf.name}: дисбаланс скобок (): {s.count('(')} vs {s.count(')')}")
    # запрет приватных API Apple (п.3 ТЗ): _ИмяКласса в коде
    privates = re.findall(r"\b_U[IA-Z]\w+", src)
    privates = [p for p in privates if p not in ("_ASKONA",)]
    if privates:
        errors.append(f"{sf.name}: использованы private API: {set(privates)}")

all_swift = "\n".join(sf.read_text() for sf in swift_files)
for must in ["UITabBarController", "WKWebView", "WKScriptMessageHandler",
             "UISelectionFeedbackGenerator", "setTabBarHidden(", "WKWebsiteDataStore.default()",
             "square.grid.2x2", "square.and.arrow.up", "gearshape", "shippingbox",
             "__ASKONA_NATIVE_IOS__", "native-tab-change", "tabChanged"]:
    if must not in all_swift:
        errors.append(f"Swift: отсутствует обязательный фрагмент: {must}")

# UITabBarControllerDelegate методы
if "func tabBarController(_ tabBarController: UITabBarController," not in all_swift:
    errors.append("Swift: отсутствует UITabBarControllerDelegate")

if errors:
    print("ОШИБКИ:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("OK: pbxproj структура и ссылки — валидны")
print("OK: Info.plist — валидный XML-plist, ключи на месте")
print("OK: Assets — JSON валидны, AppIcon1024.png присутствует (PNG)")
print(f"OK: {len(swift_files)} Swift-файлов — скобки сбалансированы, private API не обнаружены")
print("OK: обязательные фрагменты (системный таб-бар, мост, SF Symbols) — на месте")
