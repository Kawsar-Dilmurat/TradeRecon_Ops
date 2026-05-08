import os
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get("DATABASE_URL")

def get_conn():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

def init_db():
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS upload_batches (
            id TEXT PRIMARY KEY,
            bank_file_name TEXT,
            ledger_file_name TEXT,
            bank_row_count INTEGER,
            ledger_row_count INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reconciled_at TIMESTAMPTZ,
            risk_score INTEGER
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bank_transactions (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            date TEXT,
            description TEXT,
            amount NUMERIC(20, 6),
            currency TEXT,
            type TEXT,
            reference TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS ledger_entries (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            date TEXT,
            vendor_or_client TEXT,
            amount NUMERIC(20, 6),
            currency TEXT,
            invoice_id TEXT,
            category TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS fx_rates (
            date TEXT PRIMARY KEY,
            usd_to_cny NUMERIC(20, 8) NOT NULL,
            cny_to_usd NUMERIC(20, 8) NOT NULL,
            source TEXT NOT NULL DEFAULT 'local_fallback'
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS reconciliation_results (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            bank_date TEXT,
            bank_description TEXT,
            bank_amount NUMERIC(20, 6),
            bank_currency TEXT,
            bank_type TEXT,
            bank_reference TEXT,
            ledger_date TEXT,
            ledger_vendor_client TEXT,
            ledger_amount NUMERIC(20, 6),
            ledger_currency TEXT,
            ledger_invoice_id TEXT,
            ledger_category TEXT,
            exchange_rate NUMERIC(20, 8),
            converted_amount NUMERIC(20, 6),
            difference_amount NUMERIC(20, 6),
            difference_pct NUMERIC(10, 6),
            status TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            reason TEXT NOT NULL,
            fuzzy_score NUMERIC(5, 2),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_reports (
            id TEXT PRIMARY KEY,
            batch_id TEXT NOT NULL,
            markdown_content TEXT NOT NULL,
            generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            provider TEXT NOT NULL DEFAULT 'mock'
        )
    """)

    cur.execute("""
        INSERT INTO fx_rates (date, usd_to_cny, cny_to_usd, source)
        VALUES
            ('2026-04-25', 7.2415, 0.13811, 'local_fallback'),
            ('2026-04-26', 7.2380, 0.13818, 'local_fallback'),
            ('2026-04-27', 7.2350, 0.13824, 'local_fallback'),
            ('2026-04-28', 7.2310, 0.13831, 'local_fallback'),
            ('2026-04-29', 7.2290, 0.13835, 'local_fallback'),
            ('2026-04-30', 7.2320, 0.13829, 'local_fallback'),
            ('2026-05-01', 7.2350, 0.13824, 'local_fallback'),
            ('2026-05-02', 7.2400, 0.13812, 'local_fallback'),
            ('2026-05-03', 7.2380, 0.13818, 'local_fallback'),
            ('2026-05-04', 7.2310, 0.13831, 'local_fallback'),
            ('2026-05-05', 7.2280, 0.13836, 'local_fallback'),
            ('2026-05-06', 7.2300, 0.13832, 'local_fallback'),
            ('2026-05-07', 7.2340, 0.13825, 'local_fallback')
        ON CONFLICT (date) DO NOTHING
    """)

    conn.commit()
    cur.close()
    conn.close()
    print("Database initialized successfully")
