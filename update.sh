#!/bin/bash
# 把最新菜谱目录 + 最新一周的三件套推到 GitHub Pages
#   /                   入口
#   /catalog.html       菜谱目录（全库 567 道）
#   /week/              最新一周（每次覆盖，只保留最新）
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
CAT="$ROOT/食谱库/catalog.html"

[ -f "$CAT" ] || { echo "找不到 $CAT"; exit 1; }

# 找最新一周（按导出目录名里的日期排序）
LATEST=$(ls -d "$ROOT"/输出/W*-*-*/ 2>/dev/null | sort -t- -k2,3 | tail -1)
[ -n "$LATEST" ] || { echo "输出/ 下没有周目录"; exit 1; }
LATEST="${LATEST%/}"
CODE=$(basename "$LATEST")
echo "最新一周：$CODE"

# 根地址就是菜谱目录（不再单独做入口页），catalog.html 保留给旧链接
cp "$CAT" "$HERE/index.html"
cp "$CAT" "$HERE/catalog.html"

# 一周三件套
HTML=$(ls "$LATEST"/*-一周晚餐菜谱.html 2>/dev/null | head -1)
PRINT=$(ls "$LATEST"/*-七天打印.pdf 2>/dev/null | head -1)
OVER=$(ls "$LATEST"/*-一周总览.pdf 2>/dev/null | head -1)
SHOP=$(ls "$LATEST"/shopping.csv 2>/dev/null | head -1)

rm -rf "$HERE/week"
mkdir -p "$HERE/week"
[ -n "$HTML" ]  && cp "$HTML"  "$HERE/week/index.html"
[ -n "$PRINT" ] && cp "$PRINT" "$HERE/week/print.pdf"
[ -n "$OVER" ]  && cp "$OVER"  "$HERE/week/overview.pdf"
[ -n "$SHOP" ]  && cp "$SHOP"  "$HERE/week/shopping.csv"

cat > "$HERE/week/meta.json" <<JSON
{"code":"$CODE","updated":"$(date '+%Y-%m-%d %H:%M')"}
JSON

cd "$HERE"
git add -A
git -c user.email="hejiheji001@users.noreply.github.com" \
    -c user.name="hejiheji001" \
    commit -m "更新 $CODE $(date '+%Y-%m-%d %H:%M')" || echo "（无变化）"
git push -q origin main
echo "✅ 已发布"
echo "   菜谱目录  https://hejiheji001.github.io/recipe-book/catalog.html"
echo "   本周菜单  https://hejiheji001.github.io/recipe-book/week/"
echo "   打印 PDF  https://hejiheji001.github.io/recipe-book/week/print.pdf"
