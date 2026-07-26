#!/usr/bin/env sh
set -eu
if ! command -v gradle >/dev/null 2>&1; then
  echo "未找到 Gradle。请使用 Android Studio 打开本项目，或安装 Gradle 8.9。" >&2
  exit 1
fi
gradle :app:assembleDebug
printf '\nAPK: app/build/outputs/apk/debug/app-debug.apk\n'
