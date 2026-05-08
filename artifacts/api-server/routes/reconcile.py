import uuid
from decimal import Decimal
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_conn
from reconciliation_engine import reconcile, compute_risk_score
from fx_service import get_fx_rate_usd_to_cny

router = APIRouter()


class ReconciliationSettings(BaseModel):
    fuzzyThreshold: int = 80
    dateWindowDays: int = 3
    fxVariancePct: float = 0.5
    fxVarianceAbs: float = 50.0


class ReconcileRequest(BaseModel):
    bankBatchId: str
    ledgerBatchId: str
    settings: Optional[ReconciliationSettings] = None


def _load_bank_transactions(batch_id: str) -> list[dict]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM bank_transactions WHERE batch_id = %s", (batch_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


def _load_ledger_entries(batch_id: str) -> list[dict]:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM ledger_entries WHERE batch_id = %s", (batch_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


def _map_bank_for_engine(row: dict) -> dict:
    return {
        "_id": row.get("id"),
        "date": row.get("date"),
        "description": row.get("description"),
        "amount": row.get("amount"),
        "currency": row.get("currency"),
        "type": row.get("type"),
        "reference": row.get("reference"),
    }


def _map_ledger_for_engine(row: dict) -> dict:
    return {
        "_id": row.get("id"),
        "date": row.get("date"),
        "vendor_or_client": row.get("vendor_or_client"),
        "amount": row.get("amount"),
        "currency": row.get("currency"),
        "invoice_id": row.get("invoice_id"),
        "category": row.get("category"),
    }


def _store_results(batch_id: str, results: list[dict]) -> None:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM reconciliation_results WHERE batch_id = %s", (batch_id,))
    for r in results:
        def _dec(v):
            if v is None:
                return None
            try:
                return str(Decimal(str(v)))
            except Exception:
                return None

        cur.execute("""
            INSERT INTO reconciliation_results (
                id, batch_id,
                bank_date, bank_description, bank_amount, bank_currency, bank_type, bank_reference,
                ledger_date, ledger_vendor_client, ledger_amount, ledger_currency, ledger_invoice_id, ledger_category,
                exchange_rate, converted_amount, difference_amount, difference_pct,
                status, risk_level, reason, fuzzy_score
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            r["id"], batch_id,
            r.get("bankDate"), r.get("bankDescription"),
            _dec(r.get("bankAmount")), r.get("bankCurrency"),
            r.get("bankType"), r.get("bankReference"),
            r.get("ledgerDate"), r.get("ledgerVendorClient"),
            _dec(r.get("ledgerAmount")), r.get("ledgerCurrency"),
            r.get("ledgerInvoiceId"), r.get("ledgerCategory"),
            _dec(r.get("exchangeRate")), _dec(r.get("convertedAmount")),
            _dec(r.get("differenceAmount")), _dec(r.get("differencePct")),
            r["status"], r["riskLevel"], r["reason"],
            float(r["fuzzyScore"]) if r.get("fuzzyScore") is not None else None
        ))
    conn.commit()
    cur.close()
    conn.close()


def _update_batch(batch_id: str, bank_batch_id: str, ledger_batch_id: str, risk_score: int) -> str:
    """Merge bank/ledger batch IDs into a single reconciliation batch record."""
    conn = get_conn()
    cur = conn.cursor()

    # Get bank batch info
    cur.execute("SELECT bank_file_name, bank_row_count FROM upload_batches WHERE id = %s", (bank_batch_id,))
    bank_row = cur.fetchone()
    cur.execute("SELECT ledger_file_name, ledger_row_count FROM upload_batches WHERE id = %s", (ledger_batch_id,))
    ledger_row = cur.fetchone()

    recon_batch_id = uuid.uuid4().hex
    cur.execute("""
        INSERT INTO upload_batches (id, bank_file_name, ledger_file_name, bank_row_count, ledger_row_count, status, created_at, reconciled_at, risk_score)
        VALUES (%s, %s, %s, %s, %s, 'reconciled', NOW(), NOW(), %s)
    """, (
        recon_batch_id,
        bank_row["bank_file_name"] if bank_row else None,
        ledger_row["ledger_file_name"] if ledger_row else None,
        bank_row["bank_row_count"] if bank_row else None,
        ledger_row["ledger_row_count"] if ledger_row else None,
        risk_score,
    ))
    conn.commit()
    cur.close()
    conn.close()
    return recon_batch_id


def _compute_summary(results: list[dict]) -> dict:
    from decimal import Decimal
    matched = sum(1 for r in results if r["status"] == "MATCHED")
    fx_var = sum(1 for r in results if r["status"] == "FX_VARIANCE")
    mismatch = sum(1 for r in results if r["status"] == "AMOUNT_MISMATCH")
    unmatched_bank = sum(1 for r in results if r["status"] == "UNMATCHED_BANK")
    unmatched_ledger = sum(1 for r in results if r["status"] == "UNMATCHED_LEDGER")
    duplicate = sum(1 for r in results if r["status"] == "POSSIBLE_DUPLICATE")
    manual = sum(1 for r in results if r["status"] == "MANUAL_REVIEW")

    unresolved_statuses = {"AMOUNT_MISMATCH", "UNMATCHED_BANK", "UNMATCHED_LEDGER", "POSSIBLE_DUPLICATE", "MANUAL_REVIEW"}
    total_unresolved = Decimal("0")
    for r in results:
        if r["status"] in unresolved_statuses:
            amt = r.get("convertedAmount") or r.get("ledgerAmount")
            if amt:
                try:
                    total_unresolved += Decimal(str(amt))
                except Exception:
                    pass

    return {
        "matched": matched,
        "fxVariance": fx_var,
        "amountMismatch": mismatch,
        "unmatchedBank": unmatched_bank,
        "unmatchedLedger": unmatched_ledger,
        "possibleDuplicate": duplicate,
        "manualReview": manual,
        "totalUnresolvedAmount": str(total_unresolved.quantize(Decimal("0.01"))),
    }


@router.post("/reconcile")
def run_reconciliation(body: ReconcileRequest):
    settings = body.settings or ReconciliationSettings()

    bank_rows_raw = _load_bank_transactions(body.bankBatchId)
    ledger_rows_raw = _load_ledger_entries(body.ledgerBatchId)

    if not bank_rows_raw:
        raise HTTPException(status_code=400, detail={"error": "No bank transactions found for given batch ID", "details": None})
    if not ledger_rows_raw:
        raise HTTPException(status_code=400, detail={"error": "No ledger entries found for given batch ID", "details": None})

    bank_rows = [_map_bank_for_engine(r) for r in bank_rows_raw]
    ledger_rows = [_map_ledger_for_engine(r) for r in ledger_rows_raw]

    recon_batch_id = uuid.uuid4().hex

    results = reconcile(
        bank_rows=bank_rows,
        ledger_rows=ledger_rows,
        get_fx_rate=get_fx_rate_usd_to_cny,
        fuzzy_threshold=settings.fuzzyThreshold,
        date_window_days=settings.dateWindowDays,
        fx_variance_pct=Decimal(str(settings.fxVariancePct)),
        fx_variance_abs=Decimal(str(settings.fxVarianceAbs)),
        batch_id=recon_batch_id,
    )

    risk_score, breakdown = compute_risk_score(results)

    _store_results(recon_batch_id, results)

    # Create a consolidated batch record
    conn = get_conn()
    cur = conn.cursor()
    bank_info = None
    ledger_info = None
    try:
        cur.execute("SELECT bank_file_name, bank_row_count FROM upload_batches WHERE id = %s", (body.bankBatchId,))
        bank_info = cur.fetchone()
        cur.execute("SELECT ledger_file_name, ledger_row_count FROM upload_batches WHERE id = %s", (body.ledgerBatchId,))
        ledger_info = cur.fetchone()
    except Exception:
        pass

    cur.execute("""
        INSERT INTO upload_batches (id, bank_file_name, ledger_file_name, bank_row_count, ledger_row_count, status, created_at, reconciled_at, risk_score)
        VALUES (%s, %s, %s, %s, %s, 'reconciled', NOW(), NOW(), %s)
    """, (
        recon_batch_id,
        bank_info["bank_file_name"] if bank_info else None,
        ledger_info["ledger_file_name"] if ledger_info else None,
        bank_info["bank_row_count"] if bank_info else len(bank_rows),
        ledger_info["ledger_row_count"] if ledger_info else len(ledger_rows),
        risk_score,
    ))
    conn.commit()
    cur.close()
    conn.close()

    summary = _compute_summary(results)

    return {
        "batchId": recon_batch_id,
        "totalResults": len(results),
        "riskScore": risk_score,
        "summary": summary,
        "results": results,
    }


@router.get("/batches")
def get_batches():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM upload_batches ORDER BY created_at DESC")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "id": r["id"],
            "bankFileName": r["bank_file_name"],
            "ledgerFileName": r["ledger_file_name"],
            "bankRowCount": r["bank_row_count"],
            "ledgerRowCount": r["ledger_row_count"],
            "status": r["status"],
            "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
            "reconciledAt": r["reconciled_at"].isoformat() if r["reconciled_at"] else None,
            "riskScore": r["risk_score"],
        }
        for r in rows
    ]
