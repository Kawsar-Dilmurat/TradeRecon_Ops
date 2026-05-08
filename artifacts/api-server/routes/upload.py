import io
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, HTTPException
import pandas as pd
from database import get_conn

router = APIRouter()

BANK_REQUIRED_COLS = {"date", "description", "amount", "currency", "type", "reference"}
LEDGER_REQUIRED_COLS = {"date", "vendor_or_client", "amount", "currency", "invoice_id", "category"}


def _store_bank_transactions(batch_id: str, df: pd.DataFrame) -> None:
    conn = get_conn()
    cur = conn.cursor()
    for _, row in df.iterrows():
        cur.execute(
            """INSERT INTO bank_transactions (id, batch_id, date, description, amount, currency, type, reference)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                uuid.uuid4().hex,
                batch_id,
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


def _store_ledger_entries(batch_id: str, df: pd.DataFrame) -> None:
    conn = get_conn()
    cur = conn.cursor()
    for _, row in df.iterrows():
        cur.execute(
            """INSERT INTO ledger_entries (id, batch_id, date, vendor_or_client, amount, currency, invoice_id, category)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                uuid.uuid4().hex,
                batch_id,
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


def _create_or_get_batch(upload_type: str, file_name: str, row_count: int) -> str:
    """Always create a fresh batch for each upload pair."""
    batch_id = uuid.uuid4().hex
    conn = get_conn()
    cur = conn.cursor()
    if upload_type == "bank":
        cur.execute(
            """INSERT INTO upload_batches (id, bank_file_name, bank_row_count, status, created_at)
               VALUES (%s, %s, %s, 'pending', %s)""",
            (batch_id, file_name, row_count, datetime.now(timezone.utc))
        )
    else:
        cur.execute(
            """INSERT INTO upload_batches (id, ledger_file_name, ledger_row_count, status, created_at)
               VALUES (%s, %s, %s, 'pending', %s)""",
            (batch_id, file_name, row_count, datetime.now(timezone.utc))
        )
    conn.commit()
    cur.close()
    conn.close()
    return batch_id


@router.post("/bank")
async def upload_bank_statement(file: UploadFile = File(...)):
    content = await file.read()
    errors = []
    warnings = []

    try:
        df = pd.read_csv(io.BytesIO(content), skipinitialspace=True)
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    except Exception as e:
        raise HTTPException(status_code=400, detail={"error": f"Could not parse CSV: {e}", "details": None})

    missing = BANK_REQUIRED_COLS - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail={
            "error": f"Missing required columns: {', '.join(sorted(missing))}",
            "details": f"Required: {', '.join(sorted(BANK_REQUIRED_COLS))}"
        })

    df = df.dropna(how="all")
    row_count = len(df)

    if row_count == 0:
        raise HTTPException(status_code=400, detail={"error": "CSV has no data rows", "details": None})

    batch_id = _create_or_get_batch("bank", file.filename or "bank_statement.csv", row_count)
    _store_bank_transactions(batch_id, df)

    return {
        "batchId": batch_id,
        "rowCount": row_count,
        "fileName": file.filename or "bank_statement.csv",
        "uploadType": "bank",
        "errors": errors,
        "warnings": warnings,
    }


@router.post("/ledger")
async def upload_ledger(file: UploadFile = File(...)):
    content = await file.read()
    errors = []
    warnings = []

    try:
        df = pd.read_csv(io.BytesIO(content), skipinitialspace=True)
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    except Exception as e:
        raise HTTPException(status_code=400, detail={"error": f"Could not parse CSV: {e}", "details": None})

    missing = LEDGER_REQUIRED_COLS - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail={
            "error": f"Missing required columns: {', '.join(sorted(missing))}",
            "details": f"Required: {', '.join(sorted(LEDGER_REQUIRED_COLS))}"
        })

    df = df.dropna(how="all")
    row_count = len(df)

    if row_count == 0:
        raise HTTPException(status_code=400, detail={"error": "CSV has no data rows", "details": None})

    batch_id = _create_or_get_batch("ledger", file.filename or "internal_ledger.csv", row_count)
    _store_ledger_entries(batch_id, df)

    return {
        "batchId": batch_id,
        "rowCount": row_count,
        "fileName": file.filename or "internal_ledger.csv",
        "uploadType": "ledger",
        "errors": errors,
        "warnings": warnings,
    }
