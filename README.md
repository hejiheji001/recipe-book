# 发布目录说明

把「菜谱目录」和「最新一周的三件套」同步到 GitHub Pages。

## 网址（永久固定）

| 内容 | 网址 |
|---|---|
| 入口 | https://hejiheji001.github.io/recipe-book/ |
| 菜谱目录（567 道，可筛选/选菜做采购清单） | https://hejiheji001.github.io/recipe-book/catalog.html |
| 本周菜单（HTML） | https://hejiheji001.github.io/recipe-book/week/ |
| 本周打印 PDF | https://hejiheji001.github.io/recipe-book/week/print.pdf |
| 本周总览 PDF | https://hejiheji001.github.io/recipe-book/week/overview.pdf |

`/week/` 每次都被最新一周覆盖，地址永远不变。

## 更新

```bash
cd "/Users/surichen/MCN 大冒险/琪-美食博主号/数据建设"
python3 build_all.py --week W1     # 重出本周产物
./发布/update.sh                    # 推上去
```

`update.sh` 自动找 `输出/` 下日期最新的一周。

## 注意

- 仓库是 public（GitHub Pages 免费版要求）。内容只有菜名/食材/做法。
- 家人打开后建议「添加到主屏幕」，像 App 一样用。
- `week/` 只保留最新一周，旧的仍在本地 `输出/` 里。
