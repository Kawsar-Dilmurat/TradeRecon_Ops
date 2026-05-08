import os
import io
import uuid
import pandas as pd
from decimal import Decimal
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from database import get_conn
from reconciliation_engine import reconcile, compute_risk_score
from fx_service import get_fx_rate_usd_to_cny

router = APIRouter()

SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "sample_data")

DATASETS = {
    "high_risk": {
        "bank_file": "bank_statement_high_risk.csv",
        "ledger_file": "internal_ledger_high_risk.csv",
        "label": "High Risk Batch",
    },
    "cleaner": {
        "bank_file": "bank_statement_cleaner.csv",
        "ledger_file": "internal_ledger_cleaner.csv",
        "label": "Cleaner Batch",
    },
}

# Legacy paths kept for load-and-reconcile
BANK_FILE = os.path.join(SAMPLE_DIR, "bank_statement_usd.csv")
LEDGER_FILE = os.path.join(SAMPLE_DIR, "internal_ledger_cny.csv")


def _store_bank(batch_id: str, df: pd.DataFrame) -> None:
    conn = get_conn()
    cur = conn.cursor()
    for _, row in df.iterrows():
        cur.execute(
            """INSERT INTO bank_transactions (id, batch_id, date, description, amount, currency, type, reference)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                uuid.uuid4().hex, batch_id,
                str(row.get("date", "")).strip(),
                str(row.get("description", "")).strip(),
                str(row.get("amount", "0")).strip(),
                str(row.get("currency", "USD")).strip(),
                str(row.get("type", "")).strip(),
                str(row.get("reference", "")).strip(),
            )
        )
    conn.commit()
    cur.close()
    conn.close()


def _store_ledger(batch_id: str, df: pd.DataFrame) -> None:
    conn = get_conn()
    cur = conn.cursor()
    for _, row in df.iterrows():
        cur.execute(
            """INSERT INTO ledger_entries (id, batch_id, date, vendor_or_client, amount, currency, invoice_id, category)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                uuid.uuid4().hex, batch_id,
                str(row.get("date", "")).strip(),
                str(row.get("vendor_or_client", "")).strip(),
                str(row.get("amount", "0")).strip(),
                str(row.get("currency", "CNY")).strip(),
                str(row.get("invoice_id", "")).strip(),
                str(row.get("category", "")).strip(),
            )
        )
    conn.commit()
    cur.close()
    conn.close()


@router.post("/load-samples")
def load_sample_csvs(dataset: str = "high_risk"):
    """Load sample CSVs into upload state only — does not run reconciliation.
    dataset: 'high_risk' or 'cleaner'
    """
    if dataset not in DATASETS:
        raise HTTPException(status_code=400, detail={"error": f"Unknown dataset '{dataset}'. Use 'high_risk' or 'cleaner'.", "details": None})

    meta = DATASETS[dataset]
    bank_path = os.path.join(SAMPLE_DIR, meta["bank_file"])
    ledger_path = os.path.join(SAMPLE_DIR, meta["ledger_file"])

    try:
        bank_df = pd.read_csv(bank_path, skipinitialspace=True)
        bank_df.columns = [c.strip().lower().replace(" ", "_") for c in bank_df.columns]
        bank_df = bank_df.dropna(how="all")
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": f"Could not read bank file '{meta['bank_file']}': {e}", "details": None})

    try:
        ledger_df = pd.read_csv(ledger_path, skipinitialspace=True)
        ledger_df.columns = [c.strip().lower().replace(" ", "_") for c in ledger_df.columns]
        ledger_df = ledger_df.dropna(how="all")
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": f"Could not read ledger file '{meta['ledger_file']}': {e}", "details": None})

    bank_batch_id = uuid.uuid4().hex
    ledger_batch_id = uuid.uuid4().hex

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO upload_batches (id, bank_file_name, bank_row_count, status, created_at) VALUES (%s, %s, %s, 'pending', %s)",
        (bank_batch_id, meta["bank_file"], len(bank_df), datetime.now(timezone.utc))
    )
    cur.execute(
        "INSERT INTO upload_batches (id, ledger_file_name, ledger_row_count, status, created_at) VALUES (%s, %s, %s, 'pending', %s)",
        (ledger_batch_id, meta["ledger_file"], len(ledger_df), datetime.now(timezone.utc))
    )
    conn.commit()
    cur.close()
    conn.close()

    _store_bank(bank_batch_id, bank_df)
    _store_ledger(ledger_batch_id, ledger_df)

    return {
        "bankBatchId": bank_batch_id,
        "ledgerBatchId": ledger_batch_id,
        "bankRows": len(bank_df),
        "ledgerRows": len(ledger_df),
        "bankFileName": meta["bank_file"],
        "ledgerFileName": meta["ledger_file"],
        "datasetLabel": meta["label"],
    }


@router.post("/load-and-reconcile")
def load_sample_and_reconcile():
    """Load built-in sample data and run reconciliation in one step."""
    try:
        bank_df = pd.read_csv(BANK_FILE, skipinitialspace=True)
        bank_df.columns = [c.strip().lower().replace(" ", "_") for c in bank_df.columns]
        bank_df = bank_df.dropna(how="all")
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": f"Could not read sample bank file: {e}", "details": None})

    try:
        ledger_df = pd.read_csv(LEDGER_FILE, skipinitialspace=True)
        ledger_df.columns = [c.strip().lower().replace(" ", "_") for c in ledger_df.columns]
        ledger_df = ledger_df.dropna(how="all")
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": f"Could not read sample ledger file: {e}", "details": None})

    bank_batch_id = uuid.uuid4().hex
    ledger_batch_id = uuid.uuid4().hex
    recon_batch_id = uuid.uuid4().hex

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO upload_batches (id, bank_file_name, bank_row_count, status, created_at) VALUES (%s, %s, %s, 'pending', %s)",
        (bank_batch_id, "bank_statement_usd.csv", len(bank_df), datetime.now(timezone.utc))
    )
    cur.execute(
        "INSERT INTO upload_batches (id, ledger_file_name, ledger_row_count, status, created_at) VALUES (%s, %s, %s, 'pending', %s)",
        (ledger_batch_id, "internal_ledger_cny.csv", len(ledger_df), datetime.now(timezone.utc))
    )
    conn.commit()
    cur.close()
    conn.close()

    _store_bank(bank_batch_id, bank_df)
    _store_ledger(ledger_batch_id, ledger_df)

    bank_rows = [
        {
            "_id": uuid.uuid4().hex,
            "date": str(r.get("date", "")).strip(),
            "description": str(r.get("description", "")).strip(),
            "amount": str(r.get("amount", "0")).strip(),
            "currency": str(r.get("currency", "USD")).strip(),
            "type": str(r.get("type", "")).strip(),
            "reference": str(r.get("reference", "")).strip(),
        }
        for _, r in bank_df.iterrows()
    ]
    ledger_rows = [
        {
            "_id": uuid.uuid4().hex,
            "date": str(r.get("date", "")).strip(),
            "vendor_or_client": str(r.get("vendor_or_client", "")).strip(),
            "amount": str(r.get("amount", "0")).strip(),
            "currency": str(r.get("currency", "CNY")).strip(),
            "invoice_id": str(r.get("invoice_id", "")).strip(),
            "category": str(r.get("category", "")).strip(),
        }
        for _, r in ledger_df.iterrows()
    ]

    results = reconcile(
        bank_rows=bank_rows,
        ledger_rows=ledger_rows,
        get_fx_rate=get_fx_rate_usd_to_cny,
        fuzzy_threshold=80,
        date_window_days=3,
        fx_variance_pct=Decimal("0.5"),
        fx_variance_abs=Decimal("50.0"),
        batch_id=recon_batch_id,
    )

    risk_score, _ = compute_risk_score(results)

    conn = get_conn()
    cur = conn.cursor()
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
            r["id"], recon_batch_id,
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

    cur.execute("""
        INSERT INTO upload_batches (id, bank_file_name, ledger_file_name, bank_row_count, ledger_row_count, status, created_at, reconciled_at, risk_score)
        VALUES (%s, %s, %s, %s, %s, 'reconciled', NOW(), NOW(), %s)
    """, (
        recon_batch_id,
        "bank_statement_usd.csv",
        "internal_ledger_cny.csv",
        len(bank_df),
        len(ledger_df),
        risk_score,
    ))
    conn.commit()
    cur.close()
    conn.close()

    return {
        "batchId": recon_batch_id,
        "bankRows": len(bank_df),
        "ledgerRows": len(ledger_df),
        "totalResults": len(results),
        "riskScore": risk_score,
    }
