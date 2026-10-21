"""Financial Report Analyst - Streamlit UI over reports.py."""
import io

import streamlit as st

from reports import build_report, load_csv, load_pdf, sample_csv

st.set_page_config(page_title="Financial Report Analyst", page_icon=":bank:", layout="wide")

st.title("Financial Report Analyst")
st.caption("Parse a bank statement (CSV or PDF), see cash flow, categories and recurring subscriptions. Nothing leaves this app.")

with st.sidebar:
    st.header("Data")
    source = st.radio("Source", ["Sample statement", "Upload CSV/PDF"], index=0)
    st.markdown("**CSV:** `date, description, amount` (signed; debit/credit columns also work). **PDF:** statement tables.")

if source == "Upload CSV/PDF":
    upload = st.file_uploader("Statement file", type=["csv", "pdf"])
    if upload is None:
        st.info("Upload a statement to begin, or switch to the sample in the sidebar.")
        st.stop()
    try:
        raw = io.BytesIO(upload.read())
        txns = load_pdf(raw) if upload.name.lower().endswith(".pdf") else load_csv(raw)
    except ValueError as exc:
        st.error(str(exc))
        st.stop()
else:
    txns = load_csv(io.StringIO(sample_csv()))

rep = build_report(txns)
k = rep.kpis

c1, c2, c3, c4 = st.columns(4)
c1.metric("Income", f'{k["income"]:,.0f}')
c2.metric("Spend", f'{k["spend"]:,.0f}')
c3.metric("Net", f'{k["net"]:,.0f}')
c4.metric("Savings rate", f'{k["savings_rate"]:.0%}')

left, right = st.columns(2)
with left:
    st.subheader("Monthly cash flow")
    st.bar_chart(rep.monthly.set_index("month")[["income", "spend"]])
with right:
    st.subheader("Spend by category")
    st.bar_chart(rep.by_category.set_index("category")[["spend"]])

st.subheader(f"Recurring subscriptions ({k['subscriptions']}) - about {k['subscription_monthly']:,.0f}/month")
if rep.recurring.empty:
    st.info("No recurring monthly charges detected.")
else:
    st.dataframe(rep.recurring.format({"amount": "{:,.2f}", "monthly_cost": "{:,.2f}"}),
                 use_container_width=True, hide_index=True)

st.subheader("Largest transactions")
st.dataframe(
    rep.largest[["date", "description", "category", "amount"]].format(
        {"amount": "{:,.2f}", "date": lambda d: d.strftime("%Y-%m-%d")}),
    use_container_width=True, hide_index=True,
)

with st.expander("All transactions"):
    st.dataframe(rep.txns[["date", "description", "category", "amount"]].sort_values("date", ascending=False),
                 use_container_width=True, height=320)

st.caption(
    "Honest limits: categories come from keyword rules - review 'other' rows. "
    "PDF extraction needs table-formatted statements; scanned image PDFs are not supported."
)
