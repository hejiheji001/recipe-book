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

# 根地址跳「推荐菜谱」（全设备统一默认页）；总菜谱放 catalog.html
cp "$CAT" "$HERE/catalog.html"
cat > "$HERE/index.html" <<'ENTRY'
<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="菜谱">
<meta name="theme-color" content="#ffffff">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<title>菜谱</title>
<script>
(function(){
  var h = location.hash || "";
  location.replace(h ? "./catalog.html" + h : "./week/");
})();
</script>
</head><body>
<noscript><a href="./week/">进入推荐菜谱</a> · <a href="./catalog.html">总菜谱</a></noscript>
</body></html>
ENTRY

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
# 周代号两种：W1-11-02（手写 W1.yaml） / auto-D1116-11-16（build_all --roll 生成 auto-D1116.yaml）
STEM=$(echo "$CODE" | sed -E 's/-[0-9]{2}-[0-9]{2}$//')
WY="$ROOT/recipes/$STEM.yaml"

[ -n "$SHOP" ] && python3 "$ROOT/scripts/build_shopping_html.py" \
    "$SHOP" "$HERE/week/shopping.html" "$CODE" "$WY"

# 打印清单页（PDF → 逐页 jpg → html）。pg/ 缺失时才转，避免每次发布都跑
if [ ! -d "$HERE/week/pg" ] && [ -f "$HERE/week/print.pdf" ]; then
  python3 "$ROOT/scripts/build_print_pages.py" "$HERE/week" || true
fi
[ -f "$HERE/week/print.pdf" ] && python3 "$ROOT/scripts/build_print_html.py" \
    "$HERE/week/print.html" "$CODE" "$HERE/week"

# 机器可读的菜单（给健康模型用）：week/menu.json + week/meta.json
# week/*.json 已由健康侧接管（code 以 H 开头），不再用家庭 yaml 覆盖
if grep -q '"code": "H' "$ROOT/发布/week/meta.json" 2>/dev/null; then
  echo "week/*.json 由健康侧维护，跳过 build_menu_json"
elif [ -f "$WY" ]; then
  python3 "$ROOT/scripts/build_menu_json.py" "$WY" "$CODE"
fi

# 定制清单（定制/<slug>/ → custom/<slug>/）：只读定制目录，家庭菜单构建不会覆盖它
python3 "$ROOT/scripts/sync_custom.py"

# 版本号：每次发布把 sw.js 的 VER 换成时间戳，触发新 SW 安装
V=$(date '+%Y%m%d%H%M%S')
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
