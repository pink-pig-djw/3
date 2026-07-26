@echo off
where gradle >nul 2>nul
if errorlevel 1 (
  echo 未找到 Gradle。请使用 Android Studio 打开本项目，或安装 Gradle 8.9。
  exit /b 1
)
gradle :app:assembleDebug
if errorlevel 1 exit /b 1
echo.
echo APK: app\build\outputs\apk\debug\app-debug.apk
