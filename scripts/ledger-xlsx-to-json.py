#!/usr/bin/env python3
"""一次性把历史「每日算力日报」xlsx 转成算力账本导入 payload（§12.2）。

用法：
    python3 scripts/ledger-xlsx-to-json.py <input.xlsx> <output.json>

依赖：Python 3 + openpyxl（用户机器上已有；不往 Node 项目加任何依赖）。
口径：按表头名找列（飞书导出列序会变）；日期统一 YYYY-MM-DD；文本只 strip，
归一化留给服务端 calc.ts 做一次；忽略所有周/三日/完成比汇总列（R4）。
真实数据的 commit 必须等用户选 A/B/C（§16 Q1）；本脚本只产出 JSON，不连数据库。
"""
import argparse
import hashlib
import json
import sys
from datetime import date, datetime

try:
    import openpyxl
except ImportError:
    sys.exit("需要 openpyxl：pip3 install openpyxl（仅本机一次性使用，不进项目依赖）")

REQUIRED = ["日报提交日期", "项目名称", "提交人", "当天API消耗（token）", "当天即梦消耗（积分）"]
OPTIONAL = [
    "项目类型", "备注", "项目开始日期", "目标算力成本（元）", "目标交付日期",
    "总集数", "已完成集数", "当天算力总消耗（元）", "项目算力总消耗（元）",
]


def norm_header(value):
    return str(value).strip() if value is not None else ""


def build_column_map(header_row):
    headers = {}
    for idx, cell in enumerate(header_row):
        name = norm_header(cell)
        if name and name not in headers:
            headers[name] = idx
    missing = [name for name in REQUIRED if name not in headers]
    if missing:
        sys.exit(f"缺少必需列：{missing}；实际表头：{list(headers)}")
    return headers


def parse_date(value):
    if value is None or norm_header(value) == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = norm_header(value).replace("/", "-").replace(".", "-")
    parts = text.split("-")
    if len(parts) != 3:
        raise ValueError(f"无法解析日期：{value!r}")
    y, m, d = (int(p) for p in parts)
    return date(y, m, d).isoformat()


def parse_number(value):
    if value is None or norm_header(value) == "":
        return 0
    if isinstance(value, (int, float)):
        return value
    text = norm_header(value).replace(",", "")
    try:
        num = float(text)
    except ValueError:
        raise ValueError(f"非数字：{value!r}")
    return int(num) if num.is_integer() else num


def parse_int(value):
    if value is None or norm_header(value) == "":
        return None
    num = parse_number(value)
    return int(num)


def cell(row, cmap, name):
    idx = cmap.get(name)
    return row[idx] if idx is not None and idx < len(row) else None


def text(value):
    return norm_header(value) or None


def main():
    parser = argparse.ArgumentParser(description="历史算力日报 xlsx → 导入 JSON")
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()

    with open(args.input, "rb") as fh:
        sha256 = hashlib.sha256(fh.read()).hexdigest()

    wb = openpyxl.load_workbook(args.input, data_only=True)
    ws = wb.worksheets[0]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        sys.exit("空表：没有表头行")
    cmap = build_column_map(header_row)

    rows = []
    errors = []
    notes = []
    stated_totals = {}
    stated_seen = {}
    row_no = 1  # 表头是第 1 行

    for raw in rows_iter:
        row_no += 1
        date_raw = cell(raw, cmap, "日报提交日期")
        if date_raw is None or norm_header(date_raw) == "":
            continue  # 表尾空行
        try:
            date_key = parse_date(date_raw)
            if date_key is None:
                continue
            project_name = text(cell(raw, cmap, "项目名称"))
            actor_name = text(cell(raw, cmap, "提交人"))
            api_tokens = parse_number(cell(raw, cmap, "当天API消耗（token）"))
            jimeng_points = parse_number(cell(raw, cmap, "当天即梦消耗（积分）"))
        except ValueError as exc:
            errors.append({"rowNo": row_no, "reason": str(exc)})
            continue

        meta = {
            "startDate": None,
            "budgetCny": None,
            "targetDeliveryDate": None,
            "totalEpisodes": parse_int(cell(raw, cmap, "总集数")),
            "doneEpisodes": parse_int(cell(raw, cmap, "已完成集数")),
        }
        try:
            meta["startDate"] = parse_date(cell(raw, cmap, "项目开始日期"))
            meta["targetDeliveryDate"] = parse_date(cell(raw, cmap, "目标交付日期"))
        except ValueError:
            pass
        budget_raw = cell(raw, cmap, "目标算力成本（元）")
        if budget_raw is not None and norm_header(budget_raw) != "":
            try:
                meta["budgetCny"] = parse_number(budget_raw)
            except ValueError:
                pass

        stated_day = cell(raw, cmap, "当天算力总消耗（元）")
        stated_day_cny = None
        if stated_day is not None and norm_header(stated_day) != "":
            try:
                stated_day_cny = parse_number(stated_day)
            except ValueError:
                stated_day_cny = None

        rows.append({
            "rowNo": row_no,
            "dateKey": date_key,
            "projectName": project_name or "",
            "categoryRaw": text(cell(raw, cmap, "项目类型")),
            "actorName": actor_name or "",
            "apiTokens": api_tokens,
            "jimengPoints": jimeng_points,
            "remark": text(cell(raw, cmap, "备注")),
            "statedDayCny": stated_day_cny,
            "projectMeta": meta,
        })

        if project_name:
            total_raw = cell(raw, cmap, "项目算力总消耗（元）")
            if total_raw is not None and norm_header(total_raw) != "":
                try:
                    total = parse_number(total_raw)
                except ValueError:
                    total = None
                if total is not None:
                    prev = stated_seen.get(project_name)
                    if prev is not None and abs(prev - total) > 0.011 and project_name not in notes:
                        notes.append(f"项目「{project_name}」的「项目算力总消耗」各行不一致（{prev} vs {total}），取最大值。")
                    stated_seen[project_name] = total
                    stated_totals[project_name] = max(stated_totals.get(project_name, total), total)

    payload = {
        "source": {"file": args.input, "sheet": ws.title, "sha256": sha256, "rowCount": len(rows)},
        "rows": rows,
        "statedProjectTotals": stated_totals,
        "errors": errors,
        "notes": notes,
    }
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"写出 {len(rows)} 行 → {args.output}（errors={len(errors)}，notes={len(notes)}，项目累计 {len(stated_totals)} 个）")


if __name__ == "__main__":
    main()
