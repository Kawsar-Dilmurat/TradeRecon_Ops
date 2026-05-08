from decimal import Decimal
from typing import Optional
from fastapi import APIRouter
from database import get_conn
from reconciliation_engine import RISK_SCORE_FORMULA

router = APIRouter()

DEFAULT_OPENING_BALANCE = Decimal("100000.00")


def batch_review_status(risk_score: int) -> str:
    if risk_score <= 30:
        return "Reconciled"
    if risk_score <= 60:
        return "Review Recommended"
    if risk_score <= 80:
        return "Needs Analyst Review"
    return "Critical Review Required"


def get_direction(bank_type: Optional[str], bank_description: Optional[str]) -> str:
    if bank_type:
        t = bank_type.lower().strip()
        if t == "credit":
            return "INFLOW"
        if t == "debit":
            return "OUTFLOW"
    if bank_description:
        d = bank_description.lower()
        if any(kw in d for kw in ["wire from", "revenue from", "received from"]):
            return "INFLOW"
        if any(kw in d for kw in ["payment to", "paid to", "service fee"]):
            return "OUTFLOW"
    return "UNKNOWN"


@router.get("/dashboard")
def get_dashboard(batchId: Optional[str] = None):
    conn = get_conn()
    cur = conn.cursor()

    active_batch_id = batchId
    if not active_batch_id:
        cur.execute("SELECT id FROM upload_batches WHERE status = 'reconciled' ORDER BY reconciled_at DESC LIMIT 1")
        row = cur.fetchone()
        if row:
            active_batch_id = row["id"]

    if not active_batch_id:
        cur.close()
        conn.close()
        return {
            "totalBankTransactions": 0,
            "totalLedgerEntries": 0,
            "matched": 0,
            "fxVarianceCount": 0,
            "realDiscrepancyCount": 0,
            "manualReviewCount": 0,
            "possibleDuplicateCount": 0,
            "totalUnresolvedAmount": "0.00",
            "confirmedUnresolvedAmount": "0.00",
            "potentialDuplicateExposure": "0.00",
            "totalReviewExposure": "0.00",
            "amountMismatchCount": 0,
            "unmatchedBankCount": 0,
            "unmatchedLedgerCount": 0,
            "riskScore": 0,
            "batchReviewStatus": "Reconciled",
            "riskScoreBreakdown": {
                "unmatchedCount": 0,
                "amountMismatchCount": 0,
                "duplicateCount": 0,
                "criticalCount": 0,
                "fxVarianceCount": 0,
                "formula": RISK_SCORE_FORMULA,
            },
            "statusDistribution": [],
            "lastReconciliationAt": None,
            "activeBatchId": None,
            "totalInflowConverted": "0.00",
            "totalOutflowConverted": "0.00",
            "netFlow": "0.00",
            "unknownFlowConverted": "0.00",
        }

    cur.execute("SELECT * FROM upload_batches WHERE id = %s", (active_batch_id,))
    batch = cur.fetchone()

    cur.execute(
        "SELECT status, risk_level, difference_amount, converted_amount, ledger_amount, bank_type, bank_description, bank_amount "
        "FROM reconciliation_results WHERE batch_id = %s",
        (active_batch_id,)
    )
    results = cur.fetchall()

    cur.close()
    conn.close()

    total_bank = batch["bank_row_count"] or 0
    total_ledger = batch["ledger_row_count"] or 0
    risk_score = batch["risk_score"] or 0
    last_recon = batch["reconciled_at"]

    matched = sum(1 for r in results if r["status"] == "MATCHED")
    fx_var = sum(1 for r in results if r["status"] == "FX_VARIANCE")
    mismatch = sum(1 for r in results if r["status"] == "AMOUNT_MISMATCH")
    unmatched_bank = sum(1 for r in results if r["status"] == "UNMATCHED_BANK")
    unmatched_ledger = sum(1 for r in results if r["status"] == "UNMATCHED_LEDGER")
    duplicate = sum(1 for r in results if r["status"] == "POSSIBLE_DUPLICATE")
    manual = sum(1 for r in results if r["status"] == "MANUAL_REVIEW")
    critical = sum(1 for r in results if r["risk_level"] == "CRITICAL")

    # Exposure breakdown
    confirmed_unresolved = Decimal("0")
    potential_duplicate = Decimal("0")
    mismatch_exp = Decimal("0")
    unmatched_bank_exp = Decimal("0")
    unmatched_ledger_exp = Decimal("0")

    # Cash flow: only bank-side rows (skip UNMATCHED_LEDGER which has no bank data)
    total_inflow = Decimal("0")
    total_outflow = Decimal("0")
    unknown_flow = Decimal("0")
    net_bank_usd = Decimal("0")

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
                    potential_duplicate += Decimal(str(amt))
                except Exception:
                    pass
        elif status == "MANUAL_REVIEW":
            amt = r.get("converted_amount") or r.get("ledger_amount")
            if amt:
                try:
                    confirmed_unresolved += Decimal(str(amt))
                except Exception:
                    pass

        # Cash flow: bank-side rows only (exclude UNMATCHED_LEDGER)
        if status != "UNMATCHED_LEDGER":
            converted = r.get("converted_amount")
            bank_amt_raw = r.get("bank_amount")
            if converted:
                try:
                    amt_dec = Decimal(str(converted))
                    direction = get_direction(r.get("bank_type"), r.get("bank_description"))
                    if direction == "INFLOW":
                        total_inflow += amt_dec
                    elif direction == "OUTFLOW":
                        total_outflow += amt_dec
                    else:
                        unknown_flow += amt_dec
                    # Track net bank USD (signed: INFLOW positive, OUTFLOW negative)
                    if bank_amt_raw:
                        bank_dec = Decimal(str(bank_amt_raw))
                        if direction == "INFLOW":
                            net_bank_usd += bank_dec
                        elif direction == "OUTFLOW":
                            net_bank_usd -= bank_dec
                except Exception:
                    pass

    total_review = confirmed_unresolved + potential_duplicate
    net_flow = total_inflow - total_outflow

    status_dist = [
        {"status": "MATCHED", "count": matched},
        {"status": "FX_VARIANCE", "count": fx_var},
        {"status": "AMOUNT_MISMATCH", "count": mismatch},
        {"status": "UNMATCHED_BANK", "count": unmatched_bank},
        {"status": "UNMATCHED_LEDGER", "count": unmatched_ledger},
        {"status": "POSSIBLE_DUPLICATE", "count": duplicate},
        {"status": "MANUAL_REVIEW", "count": manual},
    ]

    q = Decimal("0.01")
    return {
        "totalBankTransactions": total_bank,
        "totalLedgerEntries": total_ledger,
        "matched": matched,
        "fxVarianceCount": fx_var,
        "amountMismatchCount": mismatch,
        "realDiscrepancyCount": mismatch,
        "manualReviewCount": manual,
        "possibleDuplicateCount": duplicate,
        "unmatchedBankCount": unmatched_bank,
        "unmatchedLedgerCount": unmatched_ledger,
        "totalUnresolvedAmount": str(total_review.quantize(q)),
        "confirmedUnresolvedAmount": str(confirmed_unresolved.quantize(q)),
        "potentialDuplicateExposure": str(potential_duplicate.quantize(q)),
        "totalReviewExposure": str(total_review.quantize(q)),
        "mismatchExposure": str(mismatch_exp.quantize(q)),
        "unmatchedBankExposure": str(unmatched_bank_exp.quantize(q)),
        "unmatchedLedgerExposure": str(unmatched_ledger_exp.quantize(q)),
        "totalInflowConverted": str(total_inflow.quantize(q)),
        "totalOutflowConverted": str(total_outflow.quantize(q)),
        "netFlow": str(net_flow.quantize(q)),
        "netBankAmountUsd": str(net_bank_usd.quantize(Decimal("0.01"))),
        "unknownFlowConverted": str(unknown_flow.quantize(q)),
        "riskScore": risk_score,
        "batchReviewStatus": batch_review_status(risk_score),
        "riskScoreBreakdown": {
            "unmatchedCount": unmatched_bank + unmatched_ledger,
            "amountMismatchCount": mismatch,
            "duplicateCount": duplicate,
            "criticalCount": critical,
            "fxVarianceCount": fx_var,
            "formula": RISK_SCORE_FORMULA,
        },
        "statusDistribution": status_dist,
        "lastReconciliationAt": last_recon.isoformat() if last_recon else None,
        "activeBatchId": active_batch_id,
    }
