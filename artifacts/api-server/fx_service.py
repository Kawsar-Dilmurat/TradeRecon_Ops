from decimal import Decimal
from datetime import date, timedelta
from database import get_conn

FALLBACK_RATES = {
    "2026-04-25": Decimal("7.2415"),
    "2026-04-26": Decimal("7.2380"),
    "2026-04-27": Decimal("7.2350"),
    "2026-04-28": Decimal("7.2310"),
    "2026-04-29": Decimal("7.2290"),
    "2026-04-30": Decimal("7.2320"),
    "2026-05-01": Decimal("7.2350"),
    "2026-05-02": Decimal("7.2400"),
    "2026-05-03": Decimal("7.2380"),
    "2026-05-04": Decimal("7.2310"),
    "2026-05-05": Decimal("7.2280"),
    "2026-05-06": Decimal("7.2300"),
    "2026-05-07": Decimal("7.2340"),
}

DEFAULT_RATE = Decimal("7.2350")


def get_fx_rate_usd_to_cny(transaction_date: str) -> Decimal:
    """Get USD to CNY rate for a given date, searching +/-7 days if exact date not found."""
    try:
        conn = get_conn()
        cur = conn.cursor()

        d = date.fromisoformat(transaction_date)
        for delta in range(0, 8):
            for sign in ([0] if delta == 0 else [1, -1]):
                search_date = (d + timedelta(days=delta * sign)).isoformat()
                cur.execute(
                    "SELECT usd_to_cny FROM fx_rates WHERE date = %s",
                    (search_date,)
                )
                row = cur.fetchone()
                if row:
                    cur.close()
                    conn.close()
                    return Decimal(str(row["usd_to_cny"]))

        cur.close()
        conn.close()
    except Exception:
        pass

    for delta in range(0, 8):
        for sign in ([0] if delta == 0 else [1, -1]):
            try:
                d = date.fromisoformat(transaction_date)
                search_date = (d + timedelta(days=delta * sign)).isoformat()
                if search_date in FALLBACK_RATES:
                    return FALLBACK_RATES[search_date]
            except Exception:
                pass

    return DEFAULT_RATE


def get_all_fx_rates() -> list[dict]:
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT date, usd_to_cny, cny_to_usd, source FROM fx_rates ORDER BY date DESC")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [
            {
                "date": r["date"],
                "usdToCny": str(r["usd_to_cny"]),
                "cnyToUsd": str(r["cny_to_usd"]),
                "source": r["source"]
            }
            for r in rows
        ]
    except Exception:
        return [
            {
                "date": d,
                "usdToCny": str(r),
                "cnyToUsd": str((Decimal("1") / r).quantize(Decimal("0.00001"))),
                "source": "local_fallback"
            }
            for d, r in sorted(FALLBACK_RATES.items(), reverse=True)
        ]
