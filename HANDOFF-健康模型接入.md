# 接入契约：健康模型 ← 菜谱站（伯明翰 809）

**给健康饮食/健康模型那边的技术说明。** 一句话：别抓 HTML，读三个 JSON。

站点只负责「内容」（这周吃哪 35 道菜、买什么）。排版随时会变，**我们不保证 HTML 结构**；
程序要的全部数据在这几个文件里，字段只增不改。

---

## 1. 拿什么（三个地址）

| 用途 | 线上地址 |
|---|---|
| 本周推荐菜谱（含营养） | `https://hejiheji001.github.io/recipe-book/week/menu.json` |
| 本周推荐采购 | `https://hejiheji001.github.io/recipe-book/week/shopping.json` |
| 元信息（版本/更新时间） | `https://hejiheji001.github.io/recipe-book/week/meta.json` |

CDN 有缓存（几分钟）。要最新或怀疑旧，改用 GitHub raw（无缓存）：

```
https://raw.githubusercontent.com/hejiheji001/recipe-book/main/week/menu.json
https://raw.githubusercontent.com/hejiheji001/recipe-book/main/week/shopping.json
https://raw.githubusercontent.com/hejiheji001/recipe-book/main/week/meta.json
```

不要读的：`week/index.html`、`week/shopping.html`、`week/print.*`、根目录 `index.html` —— 都是给人看的。

本地调试用的等价文件（同一份内容，不用联网）：
```
~/职业/MCN 大冒险/琪-美食博主号/数据建设/发布/week/menu.json
~/职业/MCN 大冒险/琪-美食博主号/数据建设/发布/week/shopping.json
```

---

## 2. menu.json（schema 1）

```json
{
  "schema": 1,
  "code": "W1-11-02",
  "week": "2026/11/2 – 11/8",
  "family": "伯明翰809",
  "generated": "2026-11-05T12:53:11",
  "source": "recipes/W1.yaml",
  "nutrition_basis": "整锅（全锅总量，不是每人每份）",
  "servings_hint": 3.35,
  "days": [
    { "day": 1, "date": "11/2", "weekday": "周一", "theme": "潮汕家常 · 快手开局",
      "active_min": 17, "total_min": 30,
      "dishes": [
        { "role": "主菜①", "name": "白灼虾", "cook_min": 12,
          "camera": true, "kid_ok": false,
          "ing": [{"name":"沙虾","qty":500,"unit":"g","buy":500}],
          "pantry": ["姜","葱","料酒","盐","生抽","蒜","小米辣","糖","香油"],
          "nutrition": {"kcal_total":586.0,"protein_total":93.2,"fat_total":10.2,
                        "carb_total":30.1,"fiber_total":0.8,"sodium_total":2757.0,
                        "sat_fat_total":null},
          "edible_grams": 300.0,
          "per100g": {"kcal_total":195.3,"protein_total":31.1,"fat_total":3.4,
                      "carb_total":10.0,"fiber_total":0.3,"sodium_total":919.0,
                      "sat_fat_total":null},
          "nutrition_known": true }
      ]}
  ]
}
```

字段规则：

- `days` 一般 7 天，每天 5 道（`role` = 主菜①/主菜②/主菜③/汤/青菜）。**别写死 7×5**，按数组长度遍历。
- `nutrition.*` 是**整锅**口径：`kcal_total` 是这一整锅的总热量。要算每人每份，**你自己除**（除以吃的人数 ÷ 本餐菜数），我们不除。
- 数值字段可能是 `null`——**表示「没算出来」，不是 0**。`nutrition_known=false` 时整组营养别用。
- `sat_fat_total` 目前经常是 `null`（部分菜缺饱和脂肪推算），属正常。
- `ing[].qty` 是菜谱需要的克数/个数，`ing[].unit` 是单位（g/ml/个/根…）；`buy` 是按包装取整后的采购量。
- `pantry` 是调料清单，只有名字，没有量。
- `servings_hint` 只是「这周菜单按几个人排的」参考值（3.35 是某家庭的数），不是硬约束。
- `edible_grams` = 这一整锅的可食重量（克）；`per100g` = 由它除出来的每 100g 营养。缺则双双为 `null`。

### 我们的分量 ≠ 你的分量（必读）

这份菜单是**按家庭整锅**排的：一条 586 kcal 的蒸水蛋是「一整锅」，不是「一份」。
所以**不要**把 `nutrition` 直接当自己那一餐的量，也**不要**拿 `servings_hint` 去硬除。

三种换算，按精度从高到低：

| 做法 | 公式 | 什么时候用 |
|---|---|---|
| **按自己吃的克数（推荐）** | `我的 kcal = per100g.kcal_total × 我吃的克数 / 100` | 你有称、或者按份量记录 |
| 按整锅比例分摊 | `我的 kcal = nutrition.kcal_total × 我吃的克数 / edible_grams` | 同上，等价；没有 per100g 时用这个 |
| 按人数比（最粗） | `我的 kcal = nutrition.kcal_total ÷ servings_hint × 我的份数比例` | 只有一个「我吃 1.2 人份」这种估计时，误差最大 |

```python
# 推荐：知道自己吃多少克
d = menu["days"][0]["dishes"][0]           # 白灼虾
my_grams = 150
if d["per100g"] and d["per100g"]["kcal_total"] is not None:
    kcal = d["per100g"]["kcal_total"] * my_grams / 100   # ≈ 293
```

采购同理：`need_*` / `buy_*` 是**这份家庭菜单的总量**，不是你自己一周要买的。
按你自己的系数缩放（例如你只吃家里的 40%，就 ×0.4），或者干脆只用它做「这周吃什么」的候选，量自己重算。

---

## 3. shopping.json（schema 1）

```json
{ "schema": 1, "code": "W1-11-02", "generated": "2026-11-05T12:53:11",
  "items": [
    { "category": "肉禽", "name": "三黄鸡",
      "need_qty": 900.0, "need_unit": "g",  "need_text": "900g",
      "buy_qty": 900.0,  "buy_unit": "g",   "buy_text": "900g",
      "used_on": ["周五"],
      "link": "https://www.aldi.co.uk/product/...",     // 可能为 null
      "product": {"name":"鸡蛋","store":"ALDI","size":"6 pack",
                  "price_gbp":1.29,"link":"https://..."} // 可能为 null
    }
  ]}
```

- `need_*` = 菜谱实需；`buy_*` = 按包装取整后的建议购买量（**下单用这个**）。
- 数量已拆成 `数值 + 单位`。解析不了时 `*_qty` 为 `null`、单位字段退回原文 —— 用 `*_text` 兜底显示，别崩。
- `category` 取值：`肉禽 / 水产 / 蛋豆 / 乳品主食 / 蔬菜 / 干货`（可能新增）。
- `used_on` 是「哪几天用」，值为「周一…周日」，可能空数组。
- 同一食材只会出现一次（已按食材合并过）。
- `link` / `product`：**可能为 `null`**。只有「买得到对应包装商品」的项才有链接；
  生鲜（三黄鸡、沙虾、排骨）通常没有 —— 不要因为缺链接就当数据错误。当前覆盖率约 1/42，
  补法是在 `01-事实/商品链接映射.csv` 里加一行「食材 → 商品名」，不用改代码。
- 链接指向 ALDI 官网商品页，价格是抓取时的目录价，**会过期**，下单前别当实时价。

---

## 4. 消费端要守的 5 条

1. **只读 JSON**，永远不解析 HTML 取数。HTML 变了不算我们的 bug。
2. **忽略不认识的字段**：我们只做加法（新增字段/新增 category），不改名不删字段。真要破坏性改，`schema` 会变 2。
3. **`null` ≠ 0**，缺数据就跳过该项，不要拿 0 参与营养汇总。
4. **先读 `meta.json` 的 `updated`** 判断要不要重新拉；同一 `code` + 同一 `generated` 就是同一份，可长期缓存。
5. 网络失败重试 2 次、超时 10s；仍然失败就用上一次的缓存，并在结果里标注「数据可能过期」。

---

## 5. 抄了就能跑（Python，无第三方依赖）

```python
import json, urllib.request

BASE = "https://raw.githubusercontent.com/hejiheji001/recipe-book/main/week/"

def fetch(name):
    with urllib.request.urlopen(BASE + name, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))

meta   = fetch("meta.json")      # {"code","updated","schema","menu","shopping"}
menu   = fetch("menu.json")      # 推荐菜谱
shop   = fetch("shopping.json")  # 推荐采购
assert menu["schema"] == 1 and shop["schema"] == 1

# 每道菜的整锅营养（缺就算了，别当 0）
for day in menu["days"]:
    for d in day["dishes"]:
        n = d["nutrition"]
        if not d["nutrition_known"] or n["kcal_total"] is None:
            continue
        print(day["weekday"], d["role"], d["name"], n["kcal_total"], "kcal（整锅）")

# 采购清单：按购买量下单
for it in shop["items"]:
    qty = it["buy_qty"] if it["buy_qty"] is not None else it["buy_text"]
    print(f'{it["category"]:4s} {it["name"]} 买 {qty}{it["buy_unit"] or ""}')
```

---

## 6. 这些文件怎么来的（改内容的人看）

```
recipes/W*.yaml  ──build_all.py──▶  输出/<周代号>/shopping.csv
                                        │
食材 yaml + 食谱库.csv 营养 ──scripts/build_menu_json.py──▶ 发布/week/menu.json
                                        └────────────────▶ 发布/week/shopping.json
                                        └────────────────▶ 发布/week/meta.json
```

- `发布/update.sh` 每次发布都会重跑 `build_menu_json.py`，所以只要你发了新一周，健康模型下次拉就是新的。
- 手动重生成：`python3 scripts/build_menu_json.py recipes/W1.yaml W1-11-02`
- 新增字段时：只往 `menu.json`/`shopping.json` 里加，同步在本文件补一行说明。

---

## 7. 库存方向（可选，另一个通道）

库存不是网页文件，是每家一份的云端文档 `rb_stock`（Supabase，家庭 token 见站点）。要读库存：
跑 `发布/导出库存.py` 生成 `库存快照.csv`（列含 `食材/数量/单位/估算克数/克数口径/剩余天数/存放方式`），
健康模型读这个 CSV —— 同样按列名读，不按列位置。
