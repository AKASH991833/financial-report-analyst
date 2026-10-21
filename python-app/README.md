# Financial Report Analyst - Python (pandas + pdfplumber + Streamlit)

> **Live browser demo:** https://akash991833.github.io/financial-report-analyst/ - zero-install version. The app in this folder is the pro-grade rebuild; run steps below.
> **Repo:** https://github.com/AKASH991833/financial-report-analyst

![financial-report-analyst in action](../screenshots/dash-insights-desktop-dark.png)

The pro-grade version of the browser demo: real bank statement parsing (CSV and PDF), cash-flow analytics and subscription detection.

## Stack

- **pandas / numpy** - statement normalization (flexible column names, debit/credit columns, ISO and day-first dates), monthly cash flow, category rules
- **pdfplumber** - statement table extraction from PDFs (line-ruled and text-layout tables)
- **Recurring detection** - same merchant + stable amount + roughly monthly cadence, with true monthly cost
- **Streamlit** - KPIs, cash-flow and category charts, subscription table, largest transactions

## Run locally

```
pip install -r requirements.txt
streamlit run app.py
```

## Tests

```
python3 tests/test_reports.py     # or: python3 -m pytest tests/ -q
```

Covers sample KPIs, subscription recall (5 detected, groceries correctly ignored), ISO date parsing, debit/credit column handling, category rules, real PDF table extraction (reportlab-generated statement), and error paths.

## Honest limits

- Categories come from keyword rules; review "other" rows.
- PDF extraction needs table-formatted statements; scanned image PDFs are not supported.

## Layout

- `reports.py` - pure logic (no Streamlit imports), fully unit tested
- `app.py` - Streamlit UI
- `tests/test_reports.py` - unit tests
