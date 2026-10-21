"""Unit tests for reports.py - run: python3 tests/test_reports.py (or pytest)."""
import io
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from reports import build_report, categorize, load_csv, load_pdf, sample_csv  # noqa: E402


def make_pdf(path):
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle
    doc = SimpleDocTemplate(str(path), pagesize=A4)
    data = [["Date", "Description", "Debit", "Credit"],
            ["2026-05-01", "Salary ACME Corp", "", "185000"],
            ["2026-05-03", "Netflix subscription", "649", ""],
            ["2026-05-05", "FreshMart grocery", "1200.50", ""]]
    style = TableStyle([("GRID", (0, 0), (-1, -1), 0.5, (0, 0, 0))])
    doc.build([Table(data, style=style)])


def test_sample_kpis():
    rep = build_report(load_csv(io.StringIO(sample_csv())))
    assert rep.kpis["income"] == 185000 * 6 + 1200
    assert rep.kpis["transactions"] > 150
    assert rep.kpis["savings_rate"] > 0.5
    assert rep.monthly["income"].iloc[0] == 185000


def test_subscriptions_detected():
    rep = build_report(load_csv(io.StringIO(sample_csv())))
    names = set(rep.recurring["description"])
    assert "Netflix subscription" in names and "Spotify premium" in names
    nf = rep.recurring[rep.recurring["description"] == "Netflix subscription"].iloc[0]
    assert nf["hits"] == 6 and 25 <= nf["cadence_days"] <= 33
    # groceries vary in amount and must NOT be flagged as subscriptions
    assert not any("FreshMart" in n for n in names)


def test_iso_dates_not_scrambled():
    df = load_csv(io.StringIO("date,description,amount\n2026-04-01,Salary,1000\n2026-04-02,Rent,-500\n"))
    assert df["date"].iloc[0] == pd.Timestamp("2026-04-01")


def test_debit_credit_columns():
    csv = "date,description,debit,credit\n2026-05-01,Salary,,185000\n2026-05-02,Netflix,649,\n"
    df = load_csv(io.StringIO(csv))
    assert df["amount"].iloc[0] == 185000 and df["amount"].iloc[1] == -649


def test_categorize():
    assert categorize("UPI transfer to Rahul") == "transfer"
    assert categorize("Cafe Aroma dinner") == "dining"
    assert categorize("Random thing") == "other"


def test_pdf_parsing(tmp_path=None):
    import tempfile, os
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "statement.pdf")
        make_pdf(p)
        df = load_pdf(p)
        assert len(df) == 3
        assert df["amount"].iloc[0] == 185000
        assert df["amount"].iloc[1] == -649


def test_missing_column_error():
    try:
        load_csv(io.StringIO("a,b\n1,2\n"))
        assert False, "should raise"
    except ValueError as exc:
        assert "Missing required column" in str(exc)


if __name__ == "__main__":
    for name, fn in sorted({k: v for k, v in globals().items() if k.startswith("test_")}.items()):
        fn()
        print(f"PASS {name}")
    print("ALL PASS")
