#!/usr/bin/env python3
"""导出家庭库存快照，供「个人健康饮食」每日餐单读取。

用法：
    python3 发布/导出库存.py                # 从云端拉最新
    python3 发布/导出库存.py --local 路径    # 从本地 JSON 兜底

输出（路径固定，不要改）：
    ~/Life-with-AI/Shared/food-data/01-事实/库存快照.csv
"""
import argparse
import csv
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, "scripts"))

OUT = os.path.expanduser(
    "~/Life-with-AI/Shared/food-data/01-事实/库存快照.csv")

API = "https://brxlbwgyxcrilaxlbvt.supabase.co/rest/v1/rpc"
KEY = "sb_publishable_n4_Ik7gMKPEpZgpGX_s2_Q_kS9jp3hH"
FAMILY = "142ae6144dbb013b5e51146d29ec67ef"
SUFFIX = "_stock"
TOKEN = "809"

COLS = ["名称", "存放方式", "是否开封", "入库日期", "剩余天数", "是否过期"]


def fetch_cloud(token=TOKEN, timeout=20):
    body = json.dumps({"p_family": FAMILY + SUFFIX, "p_token": token}).encode()
    req = urllib.request.Request(
        API + "/get_stock", data=body,
        headers={"apikey": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


def unwrap(payload):
    if not payload:
        return None
    if isinstance(payload, dict) and "items" in payload:
        return payload
    for key in ("body", "data", "doc"):
        v = payload.get(key)
        if isinstance(v, dict) and "items" in v:
            return v
        if isinstance(v, str):
            try:
                p = json.loads(v)
                if isinstance(p, dict) and "items" in p:
                    return p
            except ValueError:
                pass
    return None


def load_local(path):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    return doc if isinstance(doc, dict) and "items" in doc else None


def days_between(since, today):
    try:
        d = datetime.date.fromisoformat(str(since)[:10])
    except ValueError:
        return None
    return (today - d).days


def rows_of(doc, today):
    import ing_pool
    import storage_days
    pool = ing_pool.load_pool()
    storage_days.mount(pool)
    table = storage_days.shelf_table()

    out = []
    for name, it in sorted((doc.get("items") or {}).items()):
        it = it or {}
        spec = table.get(name) or {}
        mode = it.get("mode")
        if mode not in spec:
            mode = "室温" if "室温" in spec else ("冷藏" if "冷藏" in spec else None)
        if not mode:
            continue
        opened = bool(it.get("opened"))
        shelf = (spec.get(mode) or {})
        days = shelf.get("开" if opened else "闭")
        if not days:
            continue
        used = days_between(it.get("since"), today)
        if used is None:
            continue
        left = days - used
        out.append({
            "名称": name,
            "存放方式": mode,
            "是否开封": "是" if opened else "否",
            "入库日期": str(it.get("since"))[:10],
            "剩余天数": left,
            "是否过期": "是" if left <= 0 else "否",
        })
    return out


def write_csv(rows, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", help="本地 rb_stock JSON 文件（云端拉不到时用）")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--token", default=TOKEN)
    args = ap.parse_args()

    doc, src = None, ""
    try:
        doc = unwrap(fetch_cloud(args.token))
        src = "云端"
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"云端不可用：{e}")

    if doc is None and args.local:
        try:
            doc = load_local(args.local)
            src = "本地"
        except (OSError, ValueError) as e:
            print(f"本地文件也读不了：{e}")

    if doc is None:
        print("拿不到库存数据，未写文件。")
        return 1

    rows = rows_of(doc, datetime.date.today())
    if not rows:
        print("库存为空或全部无法判定存放方式，未写文件。")
        return 1

    write_csv(rows, args.out)
    expired = sum(1 for r in rows if r["是否过期"] == "是")
    print(f"已写入 {len(rows)} 项（过期 {expired}）· 来源：{src}")
    print(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
