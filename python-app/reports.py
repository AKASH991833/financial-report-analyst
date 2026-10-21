"""Financial statement analysis: CSV/PDF ingestion, cash flow, recurring charges.

Pure-logic module, no Streamlit imports.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = {"date", "description", "amount"}  # amount: signed (negative = spend)


@dataclass
class Report:
    txns: pd.DataFrame          # normalized transactions
    kpis: dict
    monthly: pd.DataFrame       # month -> income, spend, net
    by_category: pd.DataFrame
    recurring: pd.DataFrame     # detected subscriptions
    largest: pd.DataFrame


CATEGORY_PATTERNS = [
    ("income", r"salary|payroll|interest earned|refund|cashback|deposit"),
    ("groceries", r"grocery|mart|supermarket|kirana|fresh"),
    ("dining", r"cafe|restaurant|pizza|burger|dining|swiggy|zomato"),
    ("transport", r"uber|ola|metro|fuel|petrol|cab|ride"),
    ("utilities", r"electric|power|water|broadband|fiber|mobile recharge|gas bill"),
    ("subscriptions", r"netflix|spotify|prime|subscription|icloud|youtube|hotstar"),
    ("shopping", r"amazon|flipkart|store|shopping|gadget|style"),
    ("health", r"pharmacy|hospital|clinic|medic"),
    ("transfer", r"upi|transfer|neft|imps"),
]


def categorize(description: str) -> str:
    text = description.lower()
    for cat, pattern in CATEGORY_PATTERNS:
        if re.search(pattern, text):
            return cat
    return "other"


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    aliases = {
        "narration": "description", "merchant": "description", "details": "description",
        "particulars": "description", "memo": "description",
        "txn_date": "date", "transaction_date": "date", "value_date": "date", "posted": "date",
    }
    df = df.rename(columns={c: aliases[c] for c in df.columns if c in aliases})
    if "amount" not in df.columns:
        # bank statements often carry separate debit/credit columns
        if "debit" in df.columns or "credit" in df.columns:
            debit = pd.to_numeric(df.get("debit", 0), errors="coerce").fillna(0)
            credit = pd.to_numeric(df.get("credit", 0), errors="coerce").fillna(0)
            df["amount"] = credit - debit
        elif "withdrawal" in df.columns or "deposit" in df.columns:
            wd = pd.to_numeric(df.get("withdrawal", 0), errors="coerce").fillna(0)
            dep = pd.to_numeric(df.get("deposit", 0), errors="coerce").fillna(0)
            df["amount"] = dep - wd
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Missing required column(s): {', '.join(sorted(missing))}")
    d_iso = pd.to_datetime(df["date"], errors="coerce", format="ISO8601")
    miss = d_iso.isna() & df["date"].notna()
    if miss.any():
        d_iso.loc[miss] = pd.to_datetime(df.loc[miss, "date"], errors="coerce", dayfirst=True)
    df["date"] = d_iso
    df["amount"] = pd.to_numeric(
        df["amount"].astype(str).str.replace(r"[^\d.\-]", "", regex=True), errors="coerce"
    )
    df["description"] = df["description"].astype(str).str.strip()
    df = df.dropna(subset=["date", "amount"])
    df = df[df["description"] != ""].reset_index(drop=True)
    if df.empty:
        raise ValueError("No valid transactions after parsing.")
    df["category"] = df.get("category", pd.Series(["auto"] * len(df)))
    df.loc[df["category"].isin(["auto", "", None]), "category"] = df["description"].map(categorize)
    return df


def load_csv(source) -> pd.DataFrame:
    return normalize(pd.read_csv(source))


def load_pdf(source) -> pd.DataFrame:
    """Extract statement tables from a PDF using pdfplumber."""
    import pdfplumber
    rows = []
    settings_list = [{}, {"vertical_strategy": "text", "horizontal_strategy": "text"}]
    with pdfplumber.open(source) as pdf:
        for page in pdf.pages:
            tables = []
            for st in settings_list:
                tables = page.extract_tables(table_settings=st) if st else page.extract_tables()
                if tables:
                    break
            for table in tables:
                if not table:
                    continue
                header = [str(c or "").strip().lower() for c in table[0]]
                if not ({"date"} & set(header) and ({"amount"} & set(header) or {"debit"} & set(header) or {"credit"} & set(header))):
                    continue
                for r in table[1:]:
                    rows.append({header[i]: (c or "") for i, c in enumerate(r) if i < len(header)})
    if not rows:
        raise ValueError("No statement tables found in the PDF.")
    return normalize(pd.DataFrame(rows))


def detect_recurring(txns: pd.DataFrame, min_hits: int = 3) -> pd.DataFrame:
    """Same normalized description + similar amount + ~monthly cadence = subscription."""
    work = txns[txns["amount"] < 0].copy()
    if work.empty:
        return pd.DataFrame(columns=["description", "amount", "hits", "cadence_days", "monthly_cost"])
    work["norm"] = work["description"].str.lower().str.replace(r"[^a-z ]", "", regex=True).str.split().str[:3].str.join(" ")
    out = []
    for norm, grp in work.groupby("norm"):
        if len(grp) < min_hits:
            continue
        amounts = grp["amount"].abs()
        if amounts.std() > amounts.mean() * 0.15:
            continue
        days = grp["date"].sort_values().diff().dt.days.dropna().to_numpy()
        if len(days) == 0:
            continue
        cadence = float(np.median(days))
        if 20 <= cadence <= 40:
            out.append({
                "description": grp["description"].mode().iloc[0],
                "amount": round(float(amounts.mean()), 2),
                "hits": int(len(grp)),
                "cadence_days": round(cadence, 1),
                "monthly_cost": round(float(amounts.mean()) * 30.0 / cadence, 2),
            })
    return pd.DataFrame(out).sort_values("monthly_cost", ascending=False).reset_index(drop=True) if out else pd.DataFrame(
        columns=["description", "amount", "hits", "cadence_days", "monthly_cost"])


def build_report(txns: pd.DataFrame) -> Report:
    work = txns.copy()
    work["month"] = work["date"].dt.to_period("M").astype(str)
    monthly = work.assign(
        income=work["amount"].clip(lower=0), spend=-work["amount"].clip(upper=0)
    ).groupby("month").agg(income=("income", "sum"), spend=("spend", "sum")).reset_index()
    monthly["net"] = monthly["income"] - monthly["spend"]
    spend_only = work[work["amount"] < 0]
    by_cat = (
        spend_only.assign(spend=-spend_only["amount"])
        .groupby("category").agg(spend=("spend", "sum"), txns=("spend", "size"))
        .sort_values("spend", ascending=False).reset_index()
    )
    income = work.loc[work["amount"] > 0, "amount"].sum()
    spend = -work.loc[work["amount"] < 0, "amount"].sum()
    recurring = detect_recurring(work)
    kpis = {
        "transactions": int(len(work)),
        "income": float(income),
        "spend": float(spend),
        "net": float(income - spend),
        "savings_rate": float((income - spend) / income) if income > 0 else 0.0,
        "subscriptions": int(len(recurring)),
        "subscription_monthly": float(recurring["monthly_cost"].sum()) if len(recurring) else 0.0,
        "date_min": str(work["date"].min().date()),
        "date_max": str(work["date"].max().date()),
    }
    largest = work.reindex(work["amount"].abs().sort_values(ascending=False).index).head(10)
    return Report(txns=work, kpis=kpis, monthly=monthly, by_category=by_cat,
                  recurring=recurring, largest=largest)


def sample_csv(seed: int = 9) -> str:
    """Synthetic 6-month bank statement CSV with salary, bills and subscriptions."""
    rng = np.random.default_rng(seed)
    rows = ["date,description,amount"]
    for month in range(4, 10):
        rows.append(f"2026-{month:02d}-01,Salary ACME Corp,185000")
        for day, desc, amt in [
            (3, "Netflix subscription", -649), (3, "Spotify premium", -119),
            (5, "Electric power board", -1850), (7, "FiberNet broadband", -999),
            (10, "iCloud storage", -75),
        ]:
            rows.append(f"2026-{month:02d}-{day:02d},{desc},{amt}")
        for _ in range(28):
            cat = rng.choice(["FreshMart grocery", "Cafe Aroma", "Uber ride", "Amazon shopping", "City pharmacy"])
            amt = -round(float(np.exp(rng.uniform(np.log(120), np.log(3200)))), 2)
            rows.append(f"2026-{month:02d}-{int(rng.integers(1, 28)):02d},{cat},{amt}")
    rows.append("2026-06-15,Flight booking makeTrip,-18450")
    rows.append("2026-08-02,Cashback reward,1200")
    return "\n".join(rows) + "\n"
