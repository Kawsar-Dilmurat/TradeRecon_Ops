import os
from typing import Optional
from datetime import datetime, timezone


def get_ai_provider() -> str:
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    return "mock"


class MockAIProvider:
    """Deterministic mock AI provider used when no API key is configured.
    AI only summarizes rule-engine output — it never decides statuses or amounts."""

    def generate_audit_summary(self, stats: dict) -> str:
        bank_total = stats.get("bankTotal", stats.get("total", 0))
        ledger_total = stats.get("ledgerTotal", 0)
        matched = stats.get("matched", 0)
        fx_var = stats.get("fxVarianceCount", 0)
        mismatch = stats.get("amountMismatchCount", 0)
        unmatched_bank = stats.get("unmatchedBankCount", 0)
        unmatched_ledger = stats.get("unmatchedLedgerCount", 0)
        unmatched = unmatched_bank + unmatched_ledger
        duplicates = stats.get("duplicateCount", 0)
        risk_score = stats.get("riskScore", 0)
        confirmed_amt = stats.get("confirmedUnresolvedAmount", "0.00")
        potential_amt = stats.get("potentialDuplicateExposure", "0.00")
        total_exposure = stats.get("totalReviewExposure", stats.get("totalUnresolvedAmount", "0.00"))

        # Cash flow fields
        total_inflow = stats.get("totalInflowConverted", "0.00")
        total_outflow = stats.get("totalOutflowConverted", "0.00")
        net_flow = stats.get("netFlow", "0.00")
        opening_balance = stats.get("openingBalance", "100000.00")
        expected_ending = stats.get("expectedEndingBalance", "0.00")

        total_results = stats.get("total", bank_total)
        match_rate = (matched / bank_total * 100) if bank_total > 0 else 0

        def fmt_cny(s: str) -> str:
            try:
                n = float(s)
                sign = "-" if n < 0 else ""
                return f"{sign}¥{abs(n):,.2f}"
            except Exception:
                return f"¥{s}"

        # Build unmatched description with bank-only / ledger-only split
        unmatched_desc = ""
        if unmatched > 0:
            parts = []
            if unmatched_bank > 0:
                parts.append(f"{unmatched_bank} bank-only {'item' if unmatched_bank == 1 else 'items'}")
            if unmatched_ledger > 0:
                parts.append(f"{unmatched_ledger} ledger-only {'item' if unmatched_ledger == 1 else 'items'}")
            unmatched_desc = " and ".join(parts)

        lines = [
            f"## Reconciliation Batch Audit Summary",
            f"",
            f"**Batch scope:** {bank_total} bank transaction{'s' if bank_total != 1 else ''} and {ledger_total} internal ledger {'records' if ledger_total != 1 else 'record'} generated {total_results} reconciliation result {'rows' if total_results != 1 else 'row'}.",
            f"**Exact match rate:** {match_rate:.1f}% ({matched} of {bank_total} bank transaction{'s' if bank_total != 1 else ''} matched exactly after FX conversion)",
            f"",
            f"### Key Findings",
            f"",
            f"The deterministic reconciliation engine identified the following:",
            f"",
            f"- **{matched}** bank transaction{'s' if matched != 1 else ''} matched exactly to internal ledger records after USD→CNY conversion",
            f"- **{fx_var}** transaction{'s' if fx_var != 1 else ''} show minor FX variance within tolerance (≤0.5% or ≤¥50 absolute) — no action required",
            f"- **{mismatch}** transaction{'s' if mismatch != 1 else ''} {'have' if mismatch != 1 else 'has'} amount discrepancies exceeding FX tolerance — {'require' if mismatch != 1 else 'requires'} manual review",
        ]

        if unmatched > 0 and unmatched_desc:
            lines.append(f"- **{unmatched}** transaction{'s' if unmatched != 1 else ''} remain{'s' if unmatched == 1 else ''} unmatched: {unmatched_desc}")
        elif unmatched > 0:
            lines.append(f"- **{unmatched}** transaction{'s' if unmatched != 1 else ''} remain{'s' if unmatched == 1 else ''} unmatched on bank or ledger side")

        lines += [
            f"- **{duplicates}** possible duplicate transaction{'s' if duplicates != 1 else ''} detected — {'require treasury confirmation' if duplicates > 0 else 'no duplicate follow-up required'}",
            f"",
            f"### Risk Assessment",
            f"",
            f"The computed reconciliation risk score is **{risk_score}/100**.",
        ]

        if risk_score > 80:
            lines.append("This score indicates **critical reconciliation risk**. Immediate analyst review is required before closing this batch.")
        elif risk_score > 60:
            lines.append("This score indicates **elevated reconciliation risk**. Analyst review of flagged items is required.")
        elif risk_score > 30:
            lines.append("This score indicates **moderate reconciliation risk** — several items need review before sign-off.")
        else:
            lines.append("This score indicates **low reconciliation risk** — the batch is largely clean and may proceed to sign-off.")

        lines += [
            f"",
            f"**Confirmed unresolved CNY exposure:** {fmt_cny(confirmed_amt)}",
            f"**Potential duplicate exposure:** {fmt_cny(potential_amt)}",
            f"**Total review exposure:** {fmt_cny(total_exposure)}",
        ]

        # Cash flow position section
        try:
            net_n = float(net_flow)
            net_sign = "+" if net_n >= 0 else ""
        except Exception:
            net_sign = ""

        lines += [
            f"",
            f"### Cash Flow Position",
            f"",
            f"The following cash flow figures are derived from bank-side transactions converted to CNY at the prevailing spot rate. They reflect actual money movement, not reconciliation risk.",
            f"",
            f"| | Amount (CNY) |",
            f"|---|---|",
            f"| Opening Balance | {fmt_cny(opening_balance)} |",
            f"| Total Inflow (bank credits, converted) | {fmt_cny(total_inflow)} |",
            f"| Total Outflow (bank debits, converted) | {fmt_cny(total_outflow)} |",
            f"| Net Flow | {net_sign}{fmt_cny(net_flow)} |",
            f"| **Expected Ending Balance** | **{fmt_cny(expected_ending)}** |",
            f"",
            f"> *Cash Flow & Balance reflects money movement. Review Exposure reflects reconciliation risk. They are related but not the same.*",
            f"",
            f"*Note: All statuses, amounts, risk classifications, and FX conversions above are determined exclusively by the "
            f"deterministic rule engine. This summary is AI-generated based on structured rule-engine output and does not "
            f"override any financial decisions.*",
        ]

        return "\n".join(lines)

    def generate_risk_explanations(self, high_risk_items: list[dict]) -> list[dict]:
        explanations = []
        for item in high_risk_items[:5]:
            status = item.get("status", "")
            risk_level = item.get("riskLevel", "")
            reason = item.get("reason", "")
            bank_ref = item.get("bankReference", "N/A")
            diff_amount = item.get("differenceAmount", "N/A")
            diff_pct = item.get("differencePct", "N/A")
            vendor = item.get("ledgerVendorClient", "N/A")

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

            if status == "AMOUNT_MISMATCH":
                explanation = (
                    f"Bank reference {bank_ref} has an amount discrepancy of {_fmt_amt(diff_amount)} "
                    f"({_fmt_pct(diff_pct)}%) against ledger entry for '{vendor}'. The rule engine classified this as "
                    f"{risk_level} risk because the difference exceeds the configured FX variance tolerance. "
                    f"Manual verification of the original invoice amount and bank confirmation is recommended."
                )
            elif status == "POSSIBLE_DUPLICATE":
                explanation = (
                    f"Reference {bank_ref} may represent a duplicate transaction. "
                    f"The rule engine detected a near-identical bank transaction — same amount, similar description, "
                    f"and within 3 days of a previously matched entry. Contact treasury or the counterparty to confirm "
                    f"whether this represents an intentional double-payment before closing."
                )
            elif status in ("UNMATCHED_BANK", "UNMATCHED_LEDGER"):
                side = "bank statement" if status == "UNMATCHED_BANK" else "internal ledger"
                explanation = (
                    f"This entry appears only in the {side} with no matching counterpart found within "
                    f"the configured date window and fuzzy matching threshold. It may represent a timing difference, "
                    f"a missing invoice, or a data entry error. Manual investigation and ledger posting are required."
                )
            elif status == "MANUAL_REVIEW":
                explanation = (
                    f"The rule engine flagged this transaction for manual review. Reason: {reason}. "
                    f"A finance team member should validate this item before finalizing the reconciliation."
                )
            else:
                explanation = (
                    f"This {risk_level.lower()} risk item was flagged by the reconciliation engine. "
                    f"Reason: {reason}. Please review the associated bank and ledger entries."
                )

            explanations.append({
                "resultId": item.get("id", ""),
                "explanation": explanation,
                "riskLevel": risk_level,
            })

        return explanations

    def generate_recommended_actions(self, stats: dict, items: list[dict]) -> list[dict]:
        actions = []

        mismatch_count = stats.get("amountMismatchCount", 0)
        duplicate_count = stats.get("duplicateCount", 0)
        unmatched_count = stats.get("unmatchedCount", 0)
        fx_count = stats.get("fxVarianceCount", 0)

        if mismatch_count > 0:
            actions.append({
                "priority": "HIGH",
                "category": "Amount Discrepancy Resolution",
                "action": f"Review {mismatch_count} amount mismatch(es). Cross-reference bank confirmations with original invoices. Verify whether exchange rates applied by the bank differ from internal rate assumptions. Update the CNY ledger or request a bank amendment as appropriate.",
                "affectedItems": mismatch_count,
            })

        if duplicate_count > 0:
            actions.append({
                "priority": "HIGH",
                "category": "Duplicate Transaction Investigation",
                "action": f"Investigate {duplicate_count} possible duplicate transaction(s). Contact counterparties or the bank to confirm. If double-payment is confirmed, initiate a refund or debit note immediately. Do not post until resolved.",
                "affectedItems": duplicate_count,
            })

        if unmatched_count > 0:
            # Use highest risk level among unmatched items, fall back to MEDIUM
            unmatched_statuses = {"UNMATCHED_BANK", "UNMATCHED_LEDGER"}
            unmatched_risk_levels = [
                i.get("riskLevel", "LOW") for i in items
                if i.get("status") in unmatched_statuses
            ]
            risk_order = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0}
            unmatched_priority = max(unmatched_risk_levels, key=lambda r: risk_order.get(r, 0), default="MEDIUM")
            actions.append({
                "priority": unmatched_priority,
                "category": "Unmatched Transaction Resolution",
                "action": f"Resolve {unmatched_count} unmatched transaction(s). Check for timing differences, missing invoice records, or data entry errors. Consider widening the date matching window for near-month-end transactions.",
                "affectedItems": unmatched_count,
            })

        if fx_count > 0:
            actions.append({
                "priority": "LOW",
                "category": "FX Variance Documentation",
                "action": f"Document {fx_count} FX variance item(s) in the audit trail. These variances are within configured tolerance and do not require correction, but must be recorded for regulatory and audit compliance.",
                "affectedItems": fx_count,
            })

        actions.append({
            "priority": "LOW",
            "category": "Process Improvement",
            "action": "Ensure CNY ledger entries are posted within 1 business day of the bank value date to minimize date-window mismatches in future reconciliation cycles.",
            "affectedItems": 0,
        })

        return actions


class OpenAIProvider:
    """Real OpenAI-compatible provider. Used when OPENAI_API_KEY is set.
    AI only summarizes rule-engine output — never decides statuses or amounts."""

    def __init__(self):
        import openai
        self.client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    def _chat(self, prompt: str) -> str:
        try:
            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an expert financial auditor assistant. You summarize and explain "
                            "structured reconciliation results produced by a deterministic rule engine. "
                            "You MUST NOT override, change, or second-guess any reconciliation status, "
                            "risk level, amount, FX rate, or classification decided by the rule engine. "
                            "Your role is to explain and recommend manual review actions based solely on "
                            "the structured data provided. Be concise, professional, and audit-ready."
                        )
                    },
                    {"role": "user", "content": prompt}
                ],
                max_tokens=1500,
                temperature=0.2,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            mock = MockAIProvider()
            return f"[AI generation failed: {e}]\n\n" + mock.generate_audit_summary({})

    def generate_audit_summary(self, stats: dict) -> str:
        bank_total = stats.get("bankTotal", stats.get("total", 0))
        ledger_total = stats.get("ledgerTotal", 0)
        inflow = stats.get("totalInflowConverted", "0.00")
        outflow = stats.get("totalOutflowConverted", "0.00")
        net_flow = stats.get("netFlow", "0.00")
        opening = stats.get("openingBalance", "100000.00")
        expected_ending = stats.get("expectedEndingBalance", "0.00")
        prompt = f"""Generate a concise, professional audit summary for this USD/CNY reconciliation batch:

Statistics (from deterministic rule engine — do not override):
- Bank transactions: {bank_total}
- Ledger entries: {ledger_total}
- Exactly matched: {stats.get('matched', 0)}
- FX Variance (within tolerance): {stats.get('fxVarianceCount', 0)}
- Amount Mismatch (real discrepancy): {stats.get('amountMismatchCount', 0)}
- Unmatched (bank or ledger): {stats.get('unmatchedCount', 0)}
- Possible Duplicates: {stats.get('duplicateCount', 0)}
- Risk Score: {stats.get('riskScore', 0)}/100
- Total at-risk CNY exposure: {stats.get('totalUnresolvedAmount', '0')}

Cash Flow Position (bank-side, converted CNY):
- Opening Balance: ¥{opening}
- Total Inflow: ¥{inflow}
- Total Outflow: ¥{outflow}
- Net Flow: ¥{net_flow}
- Expected Ending Balance: ¥{expected_ending}

Write a 200-300 word audit-style summary in a formal finance tone. Include a Cash Flow Position paragraph. Note that all statuses and classifications were decided by the rule engine, not AI. Conclude with a clear recommendation."""
        try:
            return self._chat(prompt)
        except Exception:
            mock = MockAIProvider()
            return mock.generate_audit_summary(stats)

    def generate_risk_explanations(self, high_risk_items: list[dict]) -> list[dict]:
        mock = MockAIProvider()
        return mock.generate_risk_explanations(high_risk_items)

    def generate_recommended_actions(self, stats: dict, items: list[dict]) -> list[dict]:
        mock = MockAIProvider()
        return mock.generate_recommended_actions(stats, items)


def get_provider():
    if get_ai_provider() == "openai":
        try:
            return OpenAIProvider()
        except Exception:
            pass
    return MockAIProvider()
