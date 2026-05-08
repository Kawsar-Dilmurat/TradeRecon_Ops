from decimal import Decimal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime, timezone
from database import get_conn
from ai_service import get_provider
from routes.dashboard import get_direction, DEFAULT_OPENING_BALANCE

router = APIRouter()


class AiRequest(BaseModel):
    batchId: str


def _get_batch_stats(batch_id: str) -> dict:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM upload_batches WHERE id = %s", (batch_id,))
    batch = cur.fetchone()
    cur.execute(
        "SELECT status, risk_level, difference_amount, converted_amount, ledger_amount, bank_type, bank_description "
        "FROM reconciliation_results WHERE batch_id = %s",
        (batch_id,)
    )
    results = cur.fetchall()
    cur.close()
    conn.close()

    if not results:
        raise HTTPException(status_code=400, detail={"error": "No reconciliation results for this batch", "details": None})

    matched = sum(1 for r in results if r["status"] == "MATCHED")
    fx_var = sum(1 for r in results if r["status"] == "FX_VARIANCE")
    mismatch = sum(1 for r in results if r["status"] == "AMOUNT_MISMATCH")
    unmatched_bank = sum(1 for r in results if r["status"] == "UNMATCHED_BANK")
    unmatched_ledger = sum(1 for r in results if r["status"] == "UNMATCHED_LEDGER")
    unmatched = unmatched_bank + unmatched_ledger
    duplicate = sum(1 for r in results if r["status"] == "POSSIBLE_DUPLICATE")
    risk_score = batch["risk_score"] if batch else 0

    confirmed_unresolved = Decimal("0")
    potential_duplicate_exp = Decimal("0")
    mismatch_exp = Decimal("0")
    unmatched_bank_exp = Decimal("0")
    unmatched_ledger_exp = Decimal("0")

    total_inflow = Decimal("0")
    total_outflow = Decimal("0")
    unknown_flow = Decimal("0")

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

        # Cash flow: bank-side rows only
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
                    else:
                        unknown_flow += amt_dec
                except Exception:
                    pass

    confirmed_str = str(confirmed_unresolved.quantize(Decimal("0.01")))
    potential_str = str(potential_duplicate_exp.quantize(Decimal("0.01")))
    total_str = str((confirmed_unresolved + potential_duplicate_exp).quantize(Decimal("0.01")))
    net_flow = total_inflow - total_outflow
    opening_balance = DEFAULT_OPENING_BALANCE
    expected_ending = opening_balance + net_flow

    return {
        "total": len(results),
        "bankTotal": batch["bank_row_count"] if batch else 0,
        "ledgerTotal": batch["ledger_row_count"] if batch else 0,
        "matched": matched,
        "fxVarianceCount": fx_var,
        "amountMismatchCount": mismatch,
        "unmatchedCount": unmatched,
        "unmatchedBankCount": unmatched_bank,
        "unmatchedLedgerCount": unmatched_ledger,
        "duplicateCount": duplicate,
        "riskScore": risk_score,
        "confirmedUnresolvedAmount": confirmed_str,
        "potentialDuplicateExposure": potential_str,
        "totalReviewExposure": total_str,
        "totalUnresolvedAmount": total_str,
        "mismatchExposure": str(mismatch_exp.quantize(Decimal("0.01"))),
        "unmatchedBankExposure": str(unmatched_bank_exp.quantize(Decimal("0.01"))),
        "unmatchedLedgerExposure": str(unmatched_ledger_exp.quantize(Decimal("0.01"))),
        "totalInflowConverted": str(total_inflow.quantize(Decimal("0.01"))),
        "totalOutflowConverted": str(total_outflow.quantize(Decimal("0.01"))),
        "netFlow": str(net_flow.quantize(Decimal("0.01"))),
        "openingBalance": str(opening_balance.quantize(Decimal("0.01"))),
        "expectedEndingBalance": str(expected_ending.quantize(Decimal("0.01"))),
    }


def _get_high_risk_items(batch_id: str) -> list[dict]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT * FROM reconciliation_results WHERE batch_id = %s AND risk_level IN ('HIGH', 'CRITICAL') ORDER BY risk_level DESC LIMIT 10",
        (batch_id,)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "id": r["id"],
            "status": r["status"],
            "riskLevel": r["risk_level"],
            "reason": r["reason"],
            "bankReference": r.get("bank_reference"),
            "differenceAmount": str(r["difference_amount"]) if r.get("difference_amount") else None,
            "differencePct": str(r["difference_pct"]) if r.get("difference_pct") else None,
            "ledgerVendorClient": r.get("ledger_vendor_client"),
        }
        for r in rows
    ]


@router.post("/audit-summary")
def generate_audit_summary(body: AiRequest):
    stats = _get_batch_stats(body.batchId)
    high_risk_items = _get_high_risk_items(body.batchId)

    provider = get_provider()
    summary = provider.generate_audit_summary(stats)
    explanations = provider.generate_risk_explanations(high_risk_items)

    return {
        "batchId": body.batchId,
        "summary": summary,
        "highRiskExplanations": explanations,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "openai" if "OpenAI" in type(provider).__name__ else "mock",
    }


@router.post("/recommended-actions")
def generate_recommended_actions(body: AiRequest):
    stats = _get_batch_stats(body.batchId)
    high_risk_items = _get_high_risk_items(body.batchId)

    provider = get_provider()
    actions = provider.generate_recommended_actions(stats, high_risk_items)

    return {
        "batchId": body.batchId,
        "actions": actions,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "openai" if "OpenAI" in type(provider).__name__ else "mock",
    }
