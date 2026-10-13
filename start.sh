#!/usr/bin/env bash
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '请先安装 Node.js 22 或更新版本。\n'
  read -r -p '按回车关闭…' _answer
  exit 1
fi
node scripts/launch.mjs
if [ $? -ne 0 ]; then read -r -p '启动失败，请查看上方提示。按回车关闭…' _answer; fi
