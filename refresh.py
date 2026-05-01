"""Скачивает свежий CSV из Google Sheets и пересобирает dashboard/data.json.
Запуск:  python3 refresh.py
"""
import subprocess, pandas as pd, re, json, sys
import numpy as np
from pathlib import Path

ROOT = Path(__file__).parent
CSV_PATH = ROOT / "data" / "sheet.csv"
OUT_PATH = ROOT / "dashboard" / "data.json"

# ============================================================
# НАСТРОЙКИ — меняй только этот блок для нового клиента
# ============================================================

# 1. ID таблицы Google Sheets (из URL: .../spreadsheets/d/ВОТ_ЭТО/edit)
SHEET_ID = "1nlz9_J_AF-9I4i9GA0y1UQWwud_uEfnpHDyThiHLR-0"
SHEET_GID = "903839238"

# 2. Рекламные расходы по месяцам (None = данных нет, не считать ДРР)
AD_SPEND = {
    "2026-04": 214800,
    "2026-05": None,
}

# 3. Названия месяцев для отображения в дашборде
MONTH_NAMES = {"2026-04": "Апрель 2026", "2026-05": "Май 2026"}

# ============================================================

SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"
ROOTS = {
    "Имплантация": r"имплант\w*", "Ортопедия": r"ортопед\w*",
    "Терапия": r"тера(?:п|пи)\w*", "Хирургия": r"хирург\w*",
    "Протезы": r"(?:вак\s+)?протез\w*",
}
CATEGORIES = [
    ("Технические/мусор",       r"\bтест\b|номер стоматологии|вычет заявки|проверка кк|марушенков"),
    ("Не оставлял заявку",      r"не оставлял заявку|откуда.*(?:наш|у нас).*номер|не понимает.*откуда"),
    ("Уже лечится",             r"уже.*(?:наш|являются) пациент|лечит(?:ся|ься) (?:в|на|у)|"
                                r"другой (?:клиник|врач)|ушёл к другому|другую клинику|племянница работает"),
    ("Цена / финансы",          r"дорог|нет.*возможност.*финанс|нет денег|кредит.*не хочет|слишком больш|"
                                r"цена.*больш|про вд даже слушать не стал|тратьте время"),
    ("Медицинские причины",     r"не годен.*мед|противопоказ|в силу возраст|не приживаются|пожилая|пенсионер"),
    ("Не актуально / не нужно", r"не актуальн|не интересн|ничего не нужно|не нужны услуг|ничего не надо|"
                                r"больше не беспокои|ничвего не беспокои|все не надо|сказал.*все.*не надо"),
]
OTVAL_YAVKA = {"Не пришел", "Отмена записи"}

def parse_payment(s):
    if pd.isna(s): return 0
    m = re.search(r"оплат[аы]?[^\d]{0,5}(\d[\d\s]*)", s.lower())
    if not m: return 0
    n = re.sub(r"\s", "", m.group(1))
    return int(n) if n.isdigit() else 0

def parse_plan(s, root_pat):
    if pd.isna(s): return 0
    total = 0
    pat = rf"{root_pat}[\s\-—:,\.]{{0,6}}(\d[\d\s]{{1,12}})\s*(т\b|тыс|т\.)?"
    for m in re.finditer(pat, s.lower()):
        n = re.sub(r"\s", "", m.group(1))
        if not n.isdigit(): continue
        v = int(n)
        if m.group(2): v *= 1000
        if v < 1000: continue
        total += v
    return total

def categorize(comment):
    if not isinstance(comment, str): return "Другое"
    c = comment.lower()
    for name, pat in CATEGORIES:
        if re.search(pat, c): return name
    return "Другое"

def normalize_status(s):
    if pd.isna(s): return "—"
    if s.startswith("недозвон"): return "недозвон"
    return s

def compute(g, ad_spend=None):
    total = len(g)
    pcp   = int((g["КВАЛИФИКАЦИЯ"] == "ПЦП").sum())
    nekv  = int((g["КВАЛИФИКАЦИЯ"] == "НЕКВАЛ").sum())
    zapis = int((g["Статус:"] == "запись в клинику").sum())
    prishel   = int((g["Явка:"] == "Пришел").sum())
    neprishel = int((g["Явка:"] == "Не пришел").sum())
    otmena    = int((g["Явка:"] == "Отмена записи").sum())
    perezap   = int((g["Явка:"] == "Перезапись").sum())
    zap_mask  = g["Статус:"] == "запись в клинику"
    active = int((zap_mask & (g["Явка:"].isna() | (g["Явка:"] == "Перезапись"))).sum())
    otval  = int((zap_mask & g["Явка:"].isin(OTVAL_YAVKA)).sum())

    with_dep = g[(g["plan_total"] > 0) & (g["payment"] > 0)]
    no_dep   = g[(g["plan_total"] > 0) & (g["payment"] == 0)]
    only_pay = g[(g["plan_total"] == 0) & (g["payment"] > 0)]

    plan_dep_sum = int(with_dep["plan_total"].sum())
    drr = round(ad_spend / plan_dep_sum * 100, 1) if (ad_spend and plan_dep_sum) else None

    op_stats = {}
    for op, og in g.groupby("Имя оператора, взявшего в работу", dropna=False):
        op_name = op if pd.notna(op) else "—"
        ozap = og["Статус:"] == "запись в клинику"
        op_stats[op_name] = {
            "total":    int(len(og)),
            "pcp":      int((og["КВАЛИФИКАЦИЯ"] == "ПЦП").sum()),
            "nekv":     int((og["КВАЛИФИКАЦИЯ"] == "НЕКВАЛ").sum()),
            "zapis":    int(ozap.sum()),
            "prishel":  int((og["Явка:"] == "Пришел").sum()),
            "otval":    int((ozap & og["Явка:"].isin(OTVAL_YAVKA)).sum()),
            "active":   int((ozap & (og["Явка:"].isna() | (og["Явка:"] == "Перезапись"))).sum()),
            "payment":  int(og["payment"].sum()),
            "plan_with_dep":     int(og[(og["plan_total"] > 0) & (og["payment"] > 0)]["plan_total"].sum()),
            "plan_no_dep":       int(og[(og["plan_total"] > 0) & (og["payment"] == 0)]["plan_total"].sum()),
            "patients_with_dep": int(((og["plan_total"] > 0) & (og["payment"] > 0)).sum()),
            "patients_no_dep":   int(((og["plan_total"] > 0) & (og["payment"] == 0)).sum()),
        }

    cols = ["Имя:", "Телефон:", "plan_total", "payment",
            "Имя оператора, взявшего в работу", "Статус:", "Явка:",
            "Дата записи", "Комментарии:"]

    rg = g[g["Статус:"].isin(["ОТКАЗ", "неактуал"])]
    rt = int(len(rg))
    refusal_cats = []
    if rt:
        vc = rg["refusal_cat"].value_counts()
        for cat, n in vc.items():
            items = rg[rg["refusal_cat"] == cat][
                ["Имя:", "Статус:", "Имя оператора, взявшего в работу", "Комментарии:"]
            ].to_dict("records")
            refusal_cats.append({
                "cat": cat, "count": int(n),
                "share": round(n / rt * 100, 1),
                "items": items,
            })

    return {
        "kpi": {
            "total": total, "pcp": pcp, "nekv": nekv,
            "zapis": zapis, "prishel": prishel,
            "neprishel": neprishel, "otmena": otmena, "perezap": perezap,
            "active_zapis": active, "otval_zapis": otval,
            "conv_pcp": round(pcp / total * 100, 1) if total else 0,
            "conv_zapis_from_pcp": round(zapis / pcp * 100, 1) if pcp else 0,
            "conv_prishel_from_zapis": round(prishel / zapis * 100, 1) if zapis else 0,
            "sum_payment": int(g["payment"].sum()),
            "sum_plan": int(g["plan_total"].sum()),
            "plan_with_dep_sum": plan_dep_sum,
            "plan_with_dep_count": int(len(with_dep)),
            "plan_with_dep_paid": int(with_dep["payment"].sum()),
            "plan_no_dep_sum": int(no_dep["plan_total"].sum()),
            "plan_no_dep_count": int(len(no_dep)),
            "only_payment_sum": int(only_pay["payment"].sum()),
            "only_payment_count": int(len(only_pay)),
            "refusals_total": int((g["Статус:"] == "ОТКАЗ").sum()),
            "neaktual_total": int((g["Статус:"] == "неактуал").sum()),
            "ad_spend": ad_spend,
            "drr": drr,
        },
        "status_counts": {k: int(v) for k, v in
                          g["Статус:"].fillna("—").apply(normalize_status).value_counts().items()},
        "operator_stats": op_stats,
        "plans_with_deposit":    with_dep[cols].sort_values("plan_total", ascending=False).to_dict("records"),
        "plans_without_deposit": no_dep[cols].sort_values("plan_total", ascending=False).to_dict("records"),
        "appointments": g[g["Статус:"] == "запись в клинику"][
            ["Имя:", "Телефон:", "Дата записи", "Явка:", "Имя оператора, взявшего в работу",
             "payment", "plan_total", "Комментарии:"]].to_dict("records"),
        "refusal_categories": refusal_cats,
    }

def clean(o):
    if isinstance(o, dict): return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, list): return [clean(v) for v in o]
    if isinstance(o, np.integer): return int(o)
    if isinstance(o, np.floating): return None if np.isnan(o) else float(o)
    if isinstance(o, float) and pd.isna(o): return None
    return o

def main():
    print(f"⤓ Скачиваю CSV из Google Sheets…")
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["curl", "-sSL", "-o", str(CSV_PATH), SHEET_URL],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"curl failed: {r.stderr}")

    df = pd.read_csv(CSV_PATH)
    print(f"  Колонки CSV: {df.columns.tolist()}")
    # Маппинг колонок Золотого Яблока → внутренние имена
    df = df.rename(columns={
        "Заявка":      "Время:",
        "Статус":      "Статус:",
        "Явка":        "Явка:",
        "Имя":         "Имя:",
        "Телефон":     "Телефон:",
        "Комментарии": "Комментарии:",
        "Имя оператора": "Имя оператора, взявшего в работу",
        "продажа":     "Чек",
    })
    df["payment"] = df["Чек"].apply(parse_payment)
    for label, pat in ROOTS.items():
        df[label] = df["Чек"].apply(lambda s, p=pat: parse_plan(s, p))
    df["plan_total"] = sum(df[k] for k in ROOTS)
    df["dt"]    = pd.to_datetime(df["Время:"], dayfirst=True, errors="coerce")
    df["month"] = df["dt"].dt.strftime("%Y-%m")
    df["refusal_cat"] = df["Комментарии:"].apply(categorize)
    df.loc[~df["Статус:"].isin(["ОТКАЗ", "неактуал"]), "refusal_cat"] = None

    months = sorted(df["month"].dropna().unique())
    total_ad = sum(v for v in AD_SPEND.values() if v)
    data = {
        "period": {"date_min": str(df["dt"].min().date()), "date_max": str(df["dt"].max().date())},
        "generated_at": pd.Timestamp.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "months": [{"key": m, "label": MONTH_NAMES.get(m, m), "count": int((df["month"] == m).sum())}
                   for m in months],
        "all": compute(df, ad_spend=total_ad),
        "by_month": {m: compute(df[df["month"] == m], ad_spend=AD_SPEND.get(m)) for m in months},
    }
    data = clean(data)
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    k = data["all"]["kpi"]
    print(f"✓ Готово: {k['total']} заявок · {k['zapis']} записей · {k['prishel']} пришли")
    print(f"  По месяцам: " + ", ".join(f"{m['label']} {m['count']}" for m in data["months"]))
    print(f"  Файл: {OUT_PATH}")

if __name__ == "__main__":
    main()
