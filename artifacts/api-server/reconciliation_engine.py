from decimal import Decimal, ROUND_HALF_UP
from datetime import date, timedelta
from typing import Optional
import uuid
from rapidfuzz import fuzz


def parse_date(date_str: str) -> Optional[date]:
    if not date_str:
        return None
    for fmt in ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d"]:
        try:
            return date.fromisoformat(date_str.strip()) if fmt == "%Y-%m-%d" else date.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def dates_within_window(d1: Optional[date], d2: Optional[date], window_days: int) -> bool:
    if d1 is None or d2 is None:
        return False
    return abs((d1 - d2).days) <= window_days


def fuzzy_match(s1: str, s2: str) -> float:
    if not s1 or not s2:
        return 0.0
    return fuzz.token_set_ratio(s1.lower(), s2.lower())


def compute_risk_level(
    status: str,
    diff_pct: Optional[Decimal] = None,
    diff_cny: Optional[Decimal] = None,
    review_exposure_cny: Optional[Decimal] = None,
) -> tuple[str, str]:
    """Return (risk_level, risk_reason) for a reconciliation result."""
    if status == "MATCHED":
        return "LOW", "Exact match — no discrepancy."

    if status == "FX_VARIANCE":
        return "LOW", "Minor FX rounding difference within tolerance — no action needed."

    if status == "MANUAL_REVIEW":
        return "HIGH", "Flagged for manual review."

    if status == "AMOUNT_MISMATCH":
        pct = diff_pct or Decimal("0")
        cny = diff_cny or Decimal("0")
        if pct >= Decimal("10") or cny >= Decimal("1000"):
            return "CRITICAL", (
                f"Amount mismatch is {float(pct):.1f}% / ¥{float(cny):,.2f} — "
                f"exceeds 10% or ¥1,000 critical threshold."
            )
        if pct >= Decimal("3") or cny >= Decimal("300"):
            return "HIGH", (
                f"Amount mismatch is {float(pct):.1f}% / ¥{float(cny):,.2f} — "
                f"exceeds 3% or ¥300 high-risk threshold."
            )
        return "MEDIUM", (
            f"Amount mismatch is {float(pct):.1f}% / ¥{float(cny):,.2f} — "
            f"above FX tolerance but below high-risk threshold."
        )

    if status in ("UNMATCHED_BANK", "UNMATCHED_LEDGER", "POSSIBLE_DUPLICATE"):
        exp = review_exposure_cny or Decimal("0")
        label = {
            "UNMATCHED_BANK": "Unmatched bank exposure",
            "UNMATCHED_LEDGER": "Unmatched ledger exposure",
            "POSSIBLE_DUPLICATE": "Possible duplicate exposure",
        }[status]
        if exp >= Decimal("5000"):
            return "CRITICAL", f"{label} ¥{float(exp):,.2f} — exceeds ¥5,000 critical threshold."
        if exp >= Decimal("2000"):
            return "HIGH", f"{label} ¥{float(exp):,.2f} — exceeds ¥2,000 high-risk threshold."
        if exp >= Decimal("500"):
            return "MEDIUM", f"{label} ¥{float(exp):,.2f} — exceeds ¥500 medium-risk threshold."
        return "LOW", f"{label} ¥{float(exp):,.2f} — below ¥500, low risk."

    return "MEDIUM", "Unclassified status."


def reconcile(
    bank_rows: list[dict],
    ledger_rows: list[dict],
    get_fx_rate,
    fuzzy_threshold: int = 80,
    date_window_days: int = 3,
    fx_variance_pct: Decimal = Decimal("0.5"),
    fx_variance_abs: Decimal = Decimal("50"),
    batch_id: str = "",
) -> list[dict]:
    results = []
    matched_ledger_ids = set()
    matched_bank_ids = set()

    for bank in bank_rows:
        bank_date_str = str(bank.get("date", "")).strip()
        bank_desc = str(bank.get("description", "")).strip()
        bank_amount_raw = bank.get("amount")
        bank_currency = str(bank.get("currency", "USD")).strip().upper()
        bank_reference = str(bank.get("reference", "")).strip()
        bank_type = str(bank.get("type", "")).strip()
        bank_id = str(bank.get("_id", uuid.uuid4().hex))

        try:
            bank_amount = Decimal(str(bank_amount_raw))
        except Exception:
            bank_amount = Decimal("0")

        bank_date = parse_date(bank_date_str)

        rate = get_fx_rate(bank_date_str if bank_date_str else "2026-05-01")
        if bank_currency == "USD":
            bank_in_cny = (bank_amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif bank_currency == "CNY":
            bank_in_cny = bank_amount
            rate = Decimal("1")
        else:
            bank_in_cny = bank_amount * rate

        best_match = None
        best_score = 0.0
        best_ledger = None

        for ledger in ledger_rows:
            if ledger.get("_id") in matched_ledger_ids:
                continue

            ledger_date_str = str(ledger.get("date", "")).strip()
            ledger_date = parse_date(ledger_date_str)
            ledger_vendor = str(ledger.get("vendor_or_client", "")).strip()
            ledger_amount_raw = ledger.get("amount")
            ledger_currency = str(ledger.get("currency", "CNY")).strip().upper()

            try:
                ledger_amount = Decimal(str(ledger_amount_raw))
            except Exception:
                ledger_amount = Decimal("0")

            if ledger_currency == "CNY":
                ledger_in_cny = ledger_amount
            elif ledger_currency == "USD":
                ledger_rate = get_fx_rate(ledger_date_str if ledger_date_str else "2026-05-01")
                ledger_in_cny = (ledger_amount * ledger_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            else:
                ledger_in_cny = ledger_amount

            if not dates_within_window(bank_date, ledger_date, date_window_days):
                continue

            score = fuzzy_match(bank_desc, ledger_vendor)
            if score < fuzzy_threshold:
                continue

            if score > best_score:
                best_score = score
                best_ledger = ledger
                best_match = ledger_in_cny

        if best_ledger is None:
            ub_risk, ub_reason = compute_risk_level(
                "UNMATCHED_BANK", review_exposure_cny=bank_in_cny
            )
            results.append({
                "id": uuid.uuid4().hex,
                "batchId": batch_id,
                "bankDate": bank_date_str,
                "bankDescription": bank_desc,
                "bankAmount": str(bank_amount),
                "bankCurrency": bank_currency,
                "bankType": bank_type,
                "bankReference": bank_reference,
                "ledgerDate": None,
                "ledgerVendorClient": None,
                "ledgerAmount": None,
                "ledgerCurrency": None,
                "ledgerInvoiceId": None,
                "ledgerCategory": None,
                "exchangeRate": str(rate),
                "convertedAmount": str(bank_in_cny),
                "differenceAmount": None,
                "differencePct": None,
                "status": "UNMATCHED_BANK",
                "riskLevel": ub_risk,
                "reason": ub_reason,
                "fuzzyScore": None,
            })
            continue

        matched_bank_ids.add(bank_id)
        matched_ledger_ids.add(best_ledger.get("_id"))

        diff = (bank_in_cny - best_match).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        diff_abs = abs(diff)

        ledger_amount_raw2 = best_ledger.get("amount")
        try:
            ledger_amount2 = Decimal(str(ledger_amount_raw2))
        except Exception:
            ledger_amount2 = Decimal("0")
        ledger_currency2 = str(best_ledger.get("currency", "CNY")).strip().upper()
        ledger_date_str2 = str(best_ledger.get("date", "")).strip()
        ledger_vendor2 = str(best_ledger.get("vendor_or_client", "")).strip()
        ledger_invoice_id2 = str(best_ledger.get("invoice_id", "")).strip()
        ledger_category2 = str(best_ledger.get("category", "")).strip()

        if best_match != Decimal("0"):
            diff_pct = (diff_abs / best_match * Decimal("100")).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        else:
            diff_pct = Decimal("0")

        if diff_abs == Decimal("0"):
            status = "MATCHED"
        elif diff_abs <= fx_variance_abs or diff_pct <= fx_variance_pct:
            status = "FX_VARIANCE"
        else:
            status = "AMOUNT_MISMATCH"

        risk_level, risk_reason = compute_risk_level(
            status, diff_pct=diff_pct, diff_cny=diff_abs
        )

        # Append a human-readable matching note before the risk reason
        if status == "MATCHED":
            match_note = f"Exact match after USD→CNY FX conversion at {float(rate):.4f}. Fuzzy score: {best_score:.0f}. "
        elif status == "FX_VARIANCE":
            match_note = (
                f"Difference ¥{float(diff_abs):,.2f} ({float(diff_pct):.2f}%) within FX tolerance "
                f"(≤{fx_variance_pct}% or ≤¥{fx_variance_abs}). Rate: {float(rate):.4f}. "
            )
        else:
            match_note = (
                f"Difference ¥{float(diff_abs):,.2f} ({float(diff_pct):.2f}%) after conversion "
                f"at {float(rate):.4f}. "
            )

        reason = match_note + risk_reason

        results.append({
            "id": uuid.uuid4().hex,
            "batchId": batch_id,
            "bankDate": bank_date_str,
            "bankDescription": bank_desc,
            "bankAmount": str(bank_amount),
            "bankCurrency": bank_currency,
            "bankType": bank_type,
            "bankReference": bank_reference,
            "ledgerDate": ledger_date_str2,
            "ledgerVendorClient": ledger_vendor2,
            "ledgerAmount": str(ledger_amount2),
            "ledgerCurrency": ledger_currency2,
            "ledgerInvoiceId": ledger_invoice_id2,
            "ledgerCategory": ledger_category2,
            "exchangeRate": str(rate),
            "convertedAmount": str(bank_in_cny),
            "differenceAmount": str(diff),
            "differencePct": str(diff_pct),
            "status": status,
            "riskLevel": risk_level,
            "reason": reason,
            "fuzzyScore": best_score,
        })

    # Unmatched ledger entries
    for ledger in ledger_rows:
        if ledger.get("_id") in matched_ledger_ids:
            continue
        ledger_date_str = str(ledger.get("date", "")).strip()
        ledger_vendor = str(ledger.get("vendor_or_client", "")).strip()
        ledger_amount_raw = ledger.get("amount")
        ledger_currency = str(ledger.get("currency", "CNY")).strip().upper()
        ledger_invoice_id = str(ledger.get("invoice_id", "")).strip()
        ledger_category = str(ledger.get("category", "")).strip()
        try:
            ledger_amount = Decimal(str(ledger_amount_raw))
        except Exception:
            ledger_amount = Decimal("0")

        ul_risk, ul_reason = compute_risk_level(
            "UNMATCHED_LEDGER", review_exposure_cny=ledger_amount
        )
        results.append({
            "id": uuid.uuid4().hex,
            "batchId": batch_id,
            "bankDate": None,
            "bankDescription": None,
            "bankAmount": None,
            "bankCurrency": None,
            "bankType": None,
            "bankReference": None,
            "ledgerDate": ledger_date_str,
            "ledgerVendorClient": ledger_vendor,
            "ledgerAmount": str(ledger_amount),
            "ledgerCurrency": ledger_currency,
            "ledgerInvoiceId": ledger_invoice_id,
            "ledgerCategory": ledger_category,
            "exchangeRate": None,
            "convertedAmount": None,
            "differenceAmount": None,
            "differencePct": None,
            "status": "UNMATCHED_LEDGER",
            "riskLevel": ul_risk,
            "reason": ul_reason,
            "fuzzyScore": None,
        })

    # Detect possible duplicates among bank transactions
    for i, r1 in enumerate(results):
        if r1["status"] in ("UNMATCHED_BANK", "MATCHED", "FX_VARIANCE"):
            for j, r2 in enumerate(results):
                if i >= j:
                    continue
                if r2["status"] not in ("UNMATCHED_BANK", "MATCHED", "FX_VARIANCE"):
                    continue
                if r1["bankDescription"] and r2["bankDescription"]:
                    desc_score = fuzzy_match(r1["bankDescription"], r2["bankDescription"])
                    if desc_score >= 90 and r1["bankAmount"] == r2["bankAmount"]:
                        d1 = parse_date(r1.get("bankDate", ""))
                        d2 = parse_date(r2.get("bankDate", ""))
                        if dates_within_window(d1, d2, 3):
                            dup_exposure = Decimal(str(r2.get("convertedAmount") or "0"))
                            dup_risk, dup_reason = compute_risk_level(
                                "POSSIBLE_DUPLICATE", review_exposure_cny=dup_exposure
                            )
                            results[j]["status"] = "POSSIBLE_DUPLICATE"
                            results[j]["riskLevel"] = dup_risk
                            results[j]["reason"] = (
                                f"Possible duplicate of {r1.get('bankReference', 'N/A')} — "
                                f"same amount, similar description, within 3 days. "
                                + dup_reason
                            )

    return results


RISK_SCORE_FORMULA = "min(100, unmatched × 8 + mismatch × 10 + duplicate × 12 + critical × 15 + fx_variance × 2)"


def compute_risk_score(results: list[dict]) -> tuple[int, dict]:
    unmatched_count = sum(1 for r in results if r["status"] in ("UNMATCHED_BANK", "UNMATCHED_LEDGER"))
    amount_mismatch_count = sum(1 for r in results if r["status"] == "AMOUNT_MISMATCH")
    duplicate_count = sum(1 for r in results if r["status"] == "POSSIBLE_DUPLICATE")
    critical_count = sum(1 for r in results if r["riskLevel"] == "CRITICAL")
    fx_variance_count = sum(1 for r in results if r["status"] == "FX_VARIANCE")

    score = min(
        100,
        unmatched_count * 8 +
        amount_mismatch_count * 10 +
        duplicate_count * 12 +
        critical_count * 15 +
        fx_variance_count * 2
    )

    breakdown = {
        "unmatchedCount": unmatched_count,
        "amountMismatchCount": amount_mismatch_count,
        "duplicateCount": duplicate_count,
        "criticalCount": critical_count,
        "fxVarianceCount": fx_variance_count,
        "formula": RISK_SCORE_FORMULA,
    }

    return score, breakdown
