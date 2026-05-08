from typing import Optional
from fastapi import APIRouter, HTTPException
from database import get_conn

router = APIRouter()


def _format_result(r: dict) -> dict:
    def _str(v):
        return str(v) if v is not None else None

    return {
        "id": r["id"],
        "batchId": r["batch_id"],
        "bankDate": r.get("bank_date"),
        "bankDescription": r.get("bank_description"),
        "bankAmount": _str(r.get("bank_amount")),
        "bankCurrency": r.get("bank_currency"),
        "bankType": r.get("bank_type"),
        "bankReference": r.get("bank_reference"),
        "ledgerDate": r.get("ledger_date"),
        "ledgerVendorClient": r.get("ledger_vendor_client"),
        "ledgerAmount": _str(r.get("ledger_amount")),
        "ledgerCurrency": r.get("ledger_currency"),
        "ledgerInvoiceId": r.get("ledger_invoice_id"),
        "ledgerCategory": r.get("ledger_category"),
        "exchangeRate": _str(r.get("exchange_rate")),
        "convertedAmount": _str(r.get("converted_amount")),
        "differenceAmount": _str(r.get("difference_amount")),
        "differencePct": _str(r.get("difference_pct")),
        "status": r["status"],
        "riskLevel": r["risk_level"],
        "reason": r["reason"],
        "fuzzyScore": float(r["fuzzy_score"]) if r.get("fuzzy_score") is not None else None,
    }


@router.get("/results")
def get_results(
    batchId: Optional[str] = None,
    status: Optional[str] = None,
    riskLevel: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    pageSize: int = 50,
):
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
        return {"results": [], "total": 0, "page": page, "pageSize": pageSize, "totalPages": 0}

    conditions = ["batch_id = %s"]
    params = [active_batch_id]

    if status:
        conditions.append("status = %s")
        params.append(status)

    if riskLevel:
        conditions.append("risk_level = %s")
        params.append(riskLevel)

    if search:
        search_like = f"%{search}%"
        conditions.append(
            "(bank_description ILIKE %s OR ledger_vendor_client ILIKE %s OR bank_reference ILIKE %s OR ledger_invoice_id ILIKE %s)"
        )
        params.extend([search_like, search_like, search_like, search_like])

    where = " AND ".join(conditions)

    cur.execute(f"SELECT COUNT(*) as cnt FROM reconciliation_results WHERE {where}", params)
    total = cur.fetchone()["cnt"]

    offset = (page - 1) * pageSize
    cur.execute(
        f"SELECT * FROM reconciliation_results WHERE {where} ORDER BY created_at ASC LIMIT %s OFFSET %s",
        params + [pageSize, offset]
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    import math
    return {
        "results": [_format_result(dict(r)) for r in rows],
        "total": total,
        "page": page,
        "pageSize": pageSize,
        "totalPages": math.ceil(total / pageSize) if pageSize > 0 else 0,
    }


@router.get("/results/{result_id}")
def get_result_by_id(result_id: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM reconciliation_results WHERE id = %s", (result_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail={"error": "Result not found", "details": None})

    return _format_result(dict(row))
