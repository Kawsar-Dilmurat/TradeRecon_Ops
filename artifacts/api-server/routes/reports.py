import uuid
from decimal import Decimal
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_conn
from ai_service import get_provider
from reconciliation_engine import RISK_SCORE_FORMULA
from routes.dashboard import get_direction, DEFAULT_OPENING_BALANCE

router = APIRouter()


class ReportRequest(BaseModel):
    batchId: str


def _build_report_markdown(batch_id: str, stats: dict, ai_summary: str, actions: list[dict]) -> str:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM upload_batches WHERE id = %s", (batch_id,))
    batch = cur.fetchone()
    cur.execute(
        "SELECT status, risk_level, bank_reference, ledger_invoice_id, "
        "difference_amount, difference_pct, converted_amount, ledger_amount "
        "FROM reconciliation_results WHERE batch_id = %s",
        (batch_id,)
    )
    results = cur.fetchall()
    cur.close()
    conn.close()

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    bank_file = batch["bank_file_name"] if batch else "N/A"
    ledger_file = batch["ledger_file_name"] if batch else "N/A"
    risk_score = batch["risk_score"] if batch else 0
    bank_total = stats.get("bankTotal", 0)
    ledger_total = stats.get("ledgerTotal", 0)

    matched = [r for r in results if r["status"] == "MATCHED"]
    fx_var = [r for r in results if r["status"] == "FX_VARIANCE"]
    mismatch = [r for r in results if r["status"] == "AMOUNT_MISMATCH"]
    unmatched_bank = [r for r in results if r["status"] == "UNMATCHED_BANK"]
    unmatched_ledger = [r for r in results if r["status"] == "UNMATCHED_LEDGER"]
    duplicates = [r for r in results if r["status"] == "POSSIBLE_DUPLICATE"]
    manual = [r for r in results if r["status"] == "MANUAL_REVIEW"]

    if risk_score <= 30:
        review_status = "Reconciled"
    elif risk_score <= 60:
        review_status = "Review Recommended"
    elif risk_score <= 80:
        review_status = "Needs Analyst Review"
    else:
        review_status = "Critical Review Required"

    # Cash flow from stats
    total_inflow = stats.get("totalInflowConverted", "0.00")
    total_outflow = stats.get("totalOutflowConverted", "0.00")
    net_flow = stats.get("netFlow", "0.00")
    opening_balance = stats.get("openingBalance", str(DEFAULT_OPENING_BALANCE.quantize(Decimal("0.01"))))
    expected_ending = stats.get("expectedEndingBalance", "0.00")

    def fmt(s: str) -> str:
        try:
            n = float(s)
            sign = "-" if n < 0 else ""
            return f"{sign}¥{abs(n):,.2f}"
        except Exception:
            return f"¥{s}"

    lines = [
        f"# TradeReconOps Audit Report",
        f"",
        f"**Generated:** {now}  ",
        f"**Batch ID:** `{batch_id}`  ",
        f"**Bank Statement:** {bank_file}  ",
        f"**Internal Ledger:** {ledger_file}  ",
        f"**Batch Review Status:** {review_status}  ",
        f"",
        f"---",
        f"",
        f"## 1. Batch Summary",
        f"",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Bank Transactions | {bank_total} |",
        f"| Internal Ledger Records | {ledger_total} |",
        f"| Reconciliation Result Rows | {len(results)} |",
        f"| Exactly Matched | {len(matched)} |",
        f"| FX Variance (within tolerance) | {len(fx_var)} |",
        f"| Amount Mismatch | {len(mismatch)} |",
        f"| Possible Duplicate | {len(duplicates)} |",
        f"| Unmatched Bank | {len(unmatched_bank)} |",
        f"| Unmatched Ledger | {len(unmatched_ledger)} |",
        f"| Manual Review | {len(manual)} |",
        f"| **Risk Score** | **{risk_score}/100** |",
        f"| **Batch Status** | **{review_status}** |",
        f"",
        f"### Financial Exposure Breakdown",
        f"",
        f"| Exposure Category | Amount (CNY) |",
        f"|-------------------|-------------|",
        f"| Amount mismatch differences | {fmt(stats.get('mismatchExposure', '0.00'))} |",
        f"| Unmatched bank transactions (converted) | {fmt(stats.get('unmatchedBankExposure', '0.00'))} |",
        f"| Unmatched ledger records | {fmt(stats.get('unmatchedLedgerExposure', '0.00'))} |",
        f"| Potential duplicate exposure | {fmt(stats.get('potentialDuplicateExposure', '0.00'))} |",
        f"| **Total Review Exposure** | **{fmt(stats.get('totalReviewExposure', '0.00'))}** |",
        f"",
        f"> **How Total Review Exposure is calculated:** Amount mismatch differences + unmatched bank converted amounts + unmatched ledger amounts + potential duplicate exposure. FX variance within tolerance is tracked separately and **not** included.",
        f"",
        f"> **FX Note:** Bank amounts are in USD. All reconciliation comparisons are made in CNY using the "
        f"prevailing USD/CNY spot rate at each transaction date. Converted amounts and differences are expressed in CNY.",
        f"",
        f"### Cash Flow & Balance Summary",
        f"",
        f"| | Amount (CNY) |",
        f"|---|---|",
        f"| Opening Balance | {fmt(opening_balance)} |",
        f"| Total Inflow (bank credits, converted to CNY) | {fmt(total_inflow)} |",
        f"| Total Outflow (bank debits, converted to CNY) | {fmt(total_outflow)} |",
        f"| Net Flow | {fmt(net_flow)} |",
        f"| **Expected Ending Balance** | **{fmt(expected_ending)}** |",
        f"",
        f"> **Cash Flow & Balance reflects money movement. Review Exposure reflects reconciliation risk.** They are related but not the same.",
        f"> Net Flow = Total Inflow − Total Outflow. Expected Ending Balance = Opening Balance + Net Flow.",
        f"> Direction is determined by the bank transaction `type` field (credit = INFLOW, debit = OUTFLOW).",
        f"",
        f"---",
        f"",
        f"## 2. Matching Summary",
        f"",
        f"- **{len(matched)}** bank transaction(s) matched exactly to internal ledger records after USD→CNY FX conversion.",
        f"- **{len(fx_var)}** transaction(s) matched within FX variance tolerance (≤0.5% or ≤50 CNY) — no action required.",
        f"",
        f"---",
        f"",
        f"## 3. FX Variance Summary",
        f"",
    ]

    def _fmt_amt(v) -> str:
        try:
            return f"¥{float(v):,.2f}"
        except Exception:
            return str(v)

    def _fmt_pct(v) -> str:
        try:
            return f"{float(v):.4f}"
        except Exception:
            return str(v)

    if fx_var:
        lines += [f"The following transactions were classified as FX_VARIANCE (within tolerance):", f""]
        for r in fx_var[:10]:
            lines.append(
                f"- Reference `{r.get('bank_reference', 'N/A')}`: "
                f"difference {_fmt_amt(r.get('difference_amount', 0))} ({_fmt_pct(r.get('difference_pct', 0))}%) — within tolerance, no adjustment needed"
            )
    else:
        lines.append("No FX variance items in this batch.")

    lines += [
        f"",
        f"---",
        f"",
        f"## 4. Real Discrepancy Summary",
        f"",
    ]

    if mismatch:
        lines += [f"### Amount Mismatches ({len(mismatch)})", f""]
        for r in mismatch[:10]:
            lines.append(
                f"- Reference `{r.get('bank_reference', 'N/A')}`: "
                f"{_fmt_amt(r.get('difference_amount', 0))} ({_fmt_pct(r.get('difference_pct', 0))}%) difference — **{r.get('risk_level', 'N/A')} risk**"
            )
        lines.append("")

    if unmatched_bank or unmatched_ledger:
        lines += [f"### Unmatched Transactions ({len(unmatched_bank) + len(unmatched_ledger)})", f""]
        for r in unmatched_bank[:10]:
            lines.append(f"- [Bank] Reference `{r.get('bank_reference', 'N/A')}` — no ledger match found")
        for r in unmatched_ledger[:10]:
            lines.append(f"- [Ledger] Invoice `{r.get('ledger_invoice_id', 'N/A')}` — no bank transaction found")
        lines.append("")

    if not mismatch and not unmatched_bank and not unmatched_ledger:
        lines.append("No real discrepancies in this batch.")
        lines.append("")

    lines += [
        f"---",
        f"",
        f"## 5. Duplicate Detection Summary",
        f"",
    ]

    if duplicates:
        lines += [f"The following bank transactions were flagged as possible duplicates:", f""]
        for r in duplicates[:10]:
            lines.append(f"- Reference `{r.get('bank_reference', 'N/A')}` — **HIGH risk** — verify with treasury before posting")
    else:
        lines.append("No possible duplicate transactions detected.")

    lines += [
        f"",
        f"---",
        f"",
        f"## 6. Risk Score Formula",
        f"",
        f"```",
        f"risk_score = {RISK_SCORE_FORMULA}",
        f"```",
        f"",
        f"| Component | Count | Weight | Points |",
        f"|-----------|-------|--------|--------|",
        f"| Unmatched (bank + ledger) | {len(unmatched_bank) + len(unmatched_ledger)} | ×8 | {(len(unmatched_bank) + len(unmatched_ledger)) * 8} |",
        f"| Amount Mismatch | {len(mismatch)} | ×10 | {len(mismatch) * 10} |",
        f"| Possible Duplicate | {len(duplicates)} | ×12 | {len(duplicates) * 12} |",
        f"| Critical Items | {stats.get('criticalCount', 0)} | ×15 | {stats.get('criticalCount', 0) * 15} |",
        f"| FX Variance | {len(fx_var)} | ×2 | {len(fx_var) * 2} |",
        f"| **Total (capped at 100)** | | | **{risk_score}** |",
        f"",
        f"---",
        f"",
        f"## 7. AI Audit Summary",
        f"",
        f"> *All statuses and risk classifications are determined by the deterministic rule engine. AI provides narrative summary only.*",
        f"",
        ai_summary,
        f"",
        f"---",
        f"",
        f"## 8. Recommended Actions",
        f"",
    ]

    for action in actions:
        priority = action.get("priority", "LOW")
        category = action.get("category", "")
        text = action.get("action", "")
        lines.append(f"**[{priority}] {category}:** {text}")
        lines.append("")

    lines += [
        f"---",
        f"",
        f"*This report was generated by TradeReconOps. All financial determinations are made by the deterministic "
        f"reconciliation rule engine. Bank amounts are in USD; all comparisons and differences are expressed in CNY.*",
    ]

    return "\n".join(lines)


@router.post("/generate")
def generate_report(body: ReportRequest):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT status, risk_level, difference_amount, converted_amount, ledger_amount, "
        "bank_reference, ledger_invoice_id, bank_type, bank_description "
        "FROM reconciliation_results WHERE batch_id = %s",
        (body.batchId,)
    )
    results = cur.fetchall()
    cur.execute("SELECT risk_score, bank_row_count, ledger_row_count FROM upload_batches WHERE id = %s", (body.batchId,))
    batch = cur.fetchone()
    cur.close()
    conn.close()

    if not results:
        raise HTTPException(status_code=400, detail={"error": "No results for this batch", "details": None})

    matched = sum(1 for r in results if r["status"] == "MATCHED")
    fx_var = sum(1 for r in results if r["status"] == "FX_VARIANCE")
    mismatch = sum(1 for r in results if r["status"] == "AMOUNT_MISMATCH")
    unmatched_bank_cnt = sum(1 for r in results if r["status"] == "UNMATCHED_BANK")
    unmatched_ledger_cnt = sum(1 for r in results if r["status"] == "UNMATCHED_LEDGER")
    unmatched = unmatched_bank_cnt + unmatched_ledger_cnt
    duplicate = sum(1 for r in results if r["status"] == "POSSIBLE_DUPLICATE")
    critical = sum(1 for r in results if r["risk_level"] == "CRITICAL")

    risk_score = batch["risk_score"] if batch else 0
    bank_total = batch["bank_row_count"] if batch else 0
    ledger_total = batch["ledger_row_count"] if batch else 0

    confirmed_unresolved = Decimal("0")
    potential_duplicate_exp = Decimal("0")
    mismatch_exp = Decimal("0")
    unmatched_bank_exp = Decimal("0")
    unmatched_ledger_exp = Decimal("0")
    total_inflow = Decimal("0")
    total_outflow = Decimal("0")

    for r in results:
        status = r["status"]
        if status == "AMOUNT_MISMATCH":
            diff = r.get("difference_amount")
            if diff:
                try:
                    v = abs(Decimal(str(diff)))
                    confirmed_unresolved += v
                    mismatch_exp += v
                except Exception:
                    pass
        elif status == "UNMATCHED_BANK":
            amt = r.get("converted_amount")
            if amt:
                try:
                    v = Decimal(str(amt))
                    confirmed_unresolved += v
                    unmatched_bank_exp += v
                except Exception:
                    pass
        elif status == "UNMATCHED_LEDGER":
            amt = r.get("ledger_amount")
            if amt:
                try:
                    v = Decimal(str(amt))
                    confirmed_unresolved += v
                    unmatched_ledger_exp += v
                except Exception:
                    pass
        elif status == "POSSIBLE_DUPLICATE":
            amt = r.get("converted_amount")
            if amt:
                try:
                    potential_duplicate_exp += Decimal(str(amt))
                except Exception:
                    pass

        # Cash flow
        if status != "UNMATCHED_LEDGER":
            converted = r.get("converted_amount")
            if converted:
                try:
                    amt_dec = Decimal(str(converted))
                    direction = get_direction(r.get("bank_type"), r.get("bank_description"))
                    if direction == "INFLOW":
                        total_inflow += amt_dec
                    elif direction == "OUTFLOW":
                        total_outflow += amt_dec
                except Exception:
                    pass

    q = Decimal("0.01")
    confirmed_str = str(confirmed_unresolved.quantize(q))
    potential_str = str(potential_duplicate_exp.quantize(q))
    total_review_str = str((confirmed_unresolved + potential_duplicate_exp).quantize(q))
    net_flow = total_inflow - total_outflow
    opening_balance = DEFAULT_OPENING_BALANCE
    expected_ending = opening_balance + net_flow

    stats = {
        "bankTotal": bank_total,
        "ledgerTotal": ledger_total,
        "total": len(results),
        "matched": matched,
        "fxVarianceCount": fx_var,
        "amountMismatchCount": mismatch,
        "unmatchedCount": unmatched,
        "unmatchedBankCount": unmatched_bank_cnt,
        "unmatchedLedgerCount": unmatched_ledger_cnt,
        "duplicateCount": duplicate,
        "criticalCount": critical,
        "riskScore": risk_score,
        "confirmedUnresolvedAmount": confirmed_str,
        "potentialDuplicateExposure": potential_str,
        "totalReviewExposure": total_review_str,
        "totalUnresolvedAmount": total_review_str,
        "mismatchExposure": str(mismatch_exp.quantize(q)),
        "unmatchedBankExposure": str(unmatched_bank_exp.quantize(q)),
        "unmatchedLedgerExposure": str(unmatched_ledger_exp.quantize(q)),
        "totalInflowConverted": str(total_inflow.quantize(q)),
        "totalOutflowConverted": str(total_outflow.quantize(q)),
        "netFlow": str(net_flow.quantize(q)),
        "openingBalance": str(opening_balance.quantize(q)),
        "expectedEndingBalance": str(expected_ending.quantize(q)),
    }

    provider = get_provider()
    ai_summary = provider.generate_audit_summary(stats)
    actions = provider.generate_recommended_actions(stats, [])

    markdown = _build_report_markdown(body.batchId, stats, ai_summary, actions)

    report_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    provider_name = "openai" if "OpenAI" in type(provider).__name__ else "mock"

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO audit_reports (id, batch_id, markdown_content, generated_at, provider) VALUES (%s, %s, %s, %s, %s)",
        (report_id, body.batchId, markdown, now, provider_name)
    )
    conn.commit()
    cur.close()
    conn.close()

    return {
        "id": report_id,
        "batchId": body.batchId,
        "markdownContent": markdown,
        "generatedAt": now.isoformat(),
        "provider": provider_name,
    }


@router.get("/latest")
def get_latest_report(batchId: Optional[str] = None):
    conn = get_conn()
    cur = conn.cursor()

    if batchId:
        cur.execute("SELECT * FROM audit_reports WHERE batch_id = %s ORDER BY generated_at DESC LIMIT 1", (batchId,))
    else:
        cur.execute("SELECT * FROM audit_reports ORDER BY generated_at DESC LIMIT 1")

    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail={"error": "No report found", "details": None})

    return {
        "id": row["id"],
        "batchId": row["batch_id"],
        "markdownContent": row["markdown_content"],
        "generatedAt": row["generated_at"].isoformat(),
        "provider": row["provider"],
    }
