# Снюс-счётчик

Счётчик снюса, вкинутого сегодня. Две версии:

## 1. Нативное Android-приложение (`app/`)
- Java, Material 3, minSdk 24 (Android 7.0+)
- Экраны: MainActivity (счётчик +1/−1/произвольное число, прогресс к лимиту,
  таймер с последней порции, чистая серия), HistoryActivity, SettingsActivity
- Сборка: `gradle assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`

## 2. Встраиваемая веб-версия (`web/`)
Чистый HTML/CSS/JS без зависимостей, логика 1-в-1 повторяет `SnusStore.java`,
данные — в localStorage. Работает офлайн.

Запуск для разработки:
```bash
cd web && python3 -m http.server 8099   # открыть http://localhost:8099
```

Встроена в APK через WebView:
- файлы продублированы в `app/src/main/assets/web/`
- экран `WebActivity` открывается кнопкой 🌐 в шапке главного экрана
- включены DOM Storage (localStorage) и JavaScript; кнопка «домой» возвращает в нативный UI

⚠️ Никотин вреден. Приложение предназначено для учёта потребления, а не для его поощрения.
