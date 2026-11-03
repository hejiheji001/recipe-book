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
# 采购清单页（含本周调料，按本机库存现场计算）
WY="$ROOT/recipes/W$(echo $CODE | sed -E 's/^W([0-9]+)-.*/\1/').yaml"
[ -n "$SHOP" ] && python3 "$ROOT/scripts/build_shopping_html.py" \
    "$SHOP" "$HERE/week/shopping.html" "$CODE" "$WY"

# 备菜时间表（放 week/ 下，稍后一起拷）
PT="$LATEST/备菜时间表.html"
[ -f "$PT" ] && cp "$PT" "$HERE/week/prep.html"

cat > "$HERE/week/meta.json" <<JSON
{"code":"$CODE","updated":"$(date '+%Y-%m-%d %H:%M')"}
JSON

# 版本号：每次发布把 sw.js 的 VER 换成时间戳，触发新 SW 安装
V=$(date '+%Y%m%d%H%M')
sed -i.bak "s/^const VER = .*/const VER = '$V';/" "$HERE/sw.js" && rm -f "$HERE/sw.js.bak"

cd "$HERE"
git add -A
git -c user.email="hejiheji001@users.noreply.github.com" \
    -c user.name="hejiheji001" \
    commit -m "更新 $CODE $(date '+%Y-%m-%d %H:%M')" || echo "（无变化）"
git push -q origin main
echo "✅ 已发布"
echo "   https://hejiheji001.github.io/recipe-book/"
echo "     ├ 本周菜单   /week/"
echo "     ├ 本周采购   /week/shopping.html"
echo "     ├ 总菜谱     /"
echo "     └ 本周打印   /week/print.html"
