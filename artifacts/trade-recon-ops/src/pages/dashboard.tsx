import React, { useMemo, useState, useEffect } from "react";
import {
  useGetDashboard, getGetDashboardQueryKey,
  useGetBatches, getGetBatchesQueryKey,
  useGetResults, getGetResultsQueryKey,
} from "@workspace/api-client-react";
import type { DashboardSummary, ReconciliationResult, UploadBatch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2,
  ChevronRight, ChevronsRight, CircleDot, ExternalLink,
  FileStack, Layers, RefreshCw, Shield, ShieldAlert,
  TrendingDown, TrendingUp, TriangleAlert, XCircle,
  ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon, Minus,
} from "lucide-react";

const OPENING_BALANCE_KEY = "tradeReconOps_openingBalance";

/* ─── Colour helpers ─────────────────────────────────────────── */

function riskColor(level: string) {
  if (level === "CRITICAL") return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500", badge: "bg-red-100 text-red-800" };
  if (level === "HIGH")     return { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700", dot: "bg-orange-500", badge: "bg-orange-100 text-orange-800" };
  if (level === "MEDIUM")   return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500", badge: "bg-amber-100 text-amber-800" };
  return { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", dot: "bg-green-500", badge: "bg-green-100 text-green-800" };
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    MATCHED: "Matched", FX_VARIANCE: "FX Variance",
    AMOUNT_MISMATCH: "Mismatch", UNMATCHED_BANK: "Unmatched Bank",
    UNMATCHED_LEDGER: "Unmatched Ledger", POSSIBLE_DUPLICATE: "Duplicate",
    MANUAL_REVIEW: "Manual Review",
  };
  return map[s] || s;
}

function statusBadgeClass(s: string) {
  if (s === "MATCHED")           return "bg-green-100 text-green-800";
  if (s === "FX_VARIANCE")       return "bg-amber-100 text-amber-800";
  if (s === "AMOUNT_MISMATCH")   return "bg-orange-100 text-orange-800";
  if (s === "POSSIBLE_DUPLICATE")return "bg-purple-100 text-purple-800";
  if (s === "UNMATCHED_BANK" || s === "UNMATCHED_LEDGER") return "bg-red-100 text-red-800";
  return "bg-blue-100 text-blue-800";
}

function fmtCny(v?: string | null) {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return `¥ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function batchReviewStatus(score: number): { label: string; color: string } {
  if (score <= 30) return { label: "Reconciled", color: "bg-green-100 text-green-700" };
  if (score <= 60) return { label: "Review Recommended", color: "bg-amber-100 text-amber-700" };
  if (score <= 80) return { label: "Needs Analyst Review", color: "bg-orange-100 text-orange-700" };
  return { label: "Critical Review Required", color: "bg-red-100 text-red-700" };
}

function AuditRiskMeter({ score, driverText, topRisk }: {
  score: number;
  driverText?: string;
  topRisk?: string;
}) {
  const status = batchReviewStatus(score);
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Audit Risk Meter</p>
          <p className="text-xs text-slate-400 mt-0.5">Higher score = more analyst attention required</p>
        </div>
        <div className="text-right">
          <div>
            <span className="text-3xl font-black text-slate-900">{score}</span>
            <span className="text-lg text-slate-400"> / 100</span>
          </div>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>
      <div className="relative mb-1.5">
        <div className="flex h-5 rounded-lg overflow-hidden gap-px">
          <div className="flex-[30] bg-green-400" title="LOW: 0–30" />
          <div className="flex-[30] bg-amber-400" title="MEDIUM: 31–60" />
          <div className="flex-[20] bg-orange-400" title="HIGH: 61–80" />
          <div className="flex-[20] bg-red-500" title="CRITICAL: 81–100" />
        </div>
        <div
          className="absolute top-0 bottom-0 w-1 bg-slate-900 rounded-full shadow"
          style={{ left: `calc(${Math.min(Math.max(score, 0), 100)}% - 2px)` }}
        />
      </div>
      <div className="flex text-[10px] font-semibold uppercase tracking-wide">
        <span className="flex-[30] text-green-600">Low</span>
        <span className="flex-[30] text-center text-amber-600">Medium</span>
        <span className="flex-[20] text-center text-orange-600">High</span>
        <span className="flex-[20] text-right text-red-600">Critical</span>
      </div>
      <div className="flex text-[9px] text-slate-300 mt-0.5">
        <span className="flex-[30]">0</span>
        <span className="flex-[30] text-center">30</span>
        <span className="flex-[20] text-center">60</span>
        <span className="flex-[20] text-right">80&nbsp;&nbsp;100</span>
      </div>
      {(driverText || topRisk) && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
          {driverText && (
            <p className="text-[11px] text-slate-500 leading-snug">{driverText}</p>
          )}
          {topRisk && (
            <p className="text-[11px] text-orange-600 font-medium leading-snug">{topRisk}</p>
          )}
        </div>
      )}
    </div>
  );
}

function riskBannerInfo(score: number) {
  if (score >= 75) return { label: "CRITICAL RISK", bg: "from-red-700 to-red-900", text: "text-red-100", tagBg: "bg-red-500/30 text-red-100 border-red-400/40", icon: <XCircle className="w-6 h-6" /> };
  if (score >= 40) return { label: "HIGH RISK", bg: "from-orange-600 to-orange-800", text: "text-orange-100", tagBg: "bg-orange-500/30 text-orange-100 border-orange-400/40", icon: <TriangleAlert className="w-6 h-6" /> };
  if (score >= 15) return { label: "MEDIUM RISK", bg: "from-amber-600 to-amber-800", text: "text-amber-100", tagBg: "bg-amber-500/30 text-amber-100 border-amber-400/40", icon: <ShieldAlert className="w-6 h-6" /> };
  return { label: "LOW RISK", bg: "from-emerald-600 to-emerald-800", text: "text-emerald-100", tagBg: "bg-emerald-500/30 text-emerald-100 border-emerald-400/40", icon: <Shield className="w-6 h-6" /> };
}

/* ─── Deterministic AI Memo (rule-engine derived only) ────────── */

function buildAiMemo(
  d: DashboardSummary,
  unmatchedBank: number,
  unmatchedLedger: number,
  confirmedAmt: string,
  potentialAmt: string,
  totalExposure: string,
): { headline: string; body: string; nextAction: string; findings: string[] } {
  const critical = d.riskScoreBreakdown.criticalCount;
  const mismatch = d.riskScoreBreakdown.amountMismatchCount;
  const dup = d.possibleDuplicateCount;
  const fx = d.fxVarianceCount;
  const unmatched = unmatchedBank + unmatchedLedger;
  const total = d.totalBankTransactions;

  let headline = "";
  let body = "";
  let nextAction = "";

  if (critical > 0) {
    headline = `Analyst review required — ${critical} critical item${critical > 1 ? "s" : ""} need${critical === 1 ? "s" : ""} immediate attention.`;
    body = `The rule engine has classified ${critical} transaction${critical > 1 ? "s" : ""} as CRITICAL risk based on large unresolved CNY differences. ${mismatch > 0 ? `${mismatch} amount mismatch${mismatch > 1 ? "es" : ""} were identified where the converted USD amount deviates from the CNY ledger beyond FX tolerance. ` : ""}These items cannot be resolved by FX rate variance alone and require manual accounting review.`;
    nextAction = "Open Reconciliation Results, filter by CRITICAL, and begin line-by-line review.";
  } else if (mismatch > 0) {
    headline = `${mismatch} amount mismatch${mismatch > 1 ? "es" : ""} require${mismatch === 1 ? "s" : ""} accounting clarification.`;
    body = `The reconciliation engine found ${mismatch} bank transaction${mismatch > 1 ? "s" : ""} where the FX-converted USD amount does not reconcile with CNY ledger entries within tolerance. These are real discrepancies, not FX rounding.`;
    nextAction = "Review each AMOUNT_MISMATCH item and cross-reference with ledger invoices.";
  } else if (fx > 0 && mismatch === 0) {
    headline = "All discrepancies fall within FX tolerance — no accounting anomalies detected.";
    body = `${fx} transaction${fx > 1 ? "s" : ""} showed small USD/CNY differences classified as FX_VARIANCE (within 0.5% or ¥50 absolute). No actual accounting mismatches were found.`;
    nextAction = "Review FX variance items if spot-rate justification is required for audit trail.";
  } else {
    headline = "Reconciliation complete — no actionable discrepancies detected.";
    body = `All ${total} bank transaction${total > 1 ? "s" : ""} reconcile with the CNY internal ledger within configured thresholds. The batch is clean.`;
    nextAction = "Generate the audit report and archive this batch.";
  }

  const fmtMoney = (s: string) => {
    const n = parseFloat(s);
    return isNaN(n) ? s : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const findings: string[] = [];
  if (dup > 0) findings.push(`${dup} potential duplicate transaction${dup > 1 ? "s" : ""} detected — verify with treasury before processing.`);
  if (fx > 0) findings.push(`${fx} FX variance item${fx > 1 ? "s" : ""} classified within tolerance (≤0.5% or ≤¥50 absolute).`);
  if (unmatched > 0) {
    const parts: string[] = [];
    if (unmatchedBank > 0) parts.push(`${unmatchedBank} bank-only ${unmatchedBank === 1 ? "item" : "items"}`);
    if (unmatchedLedger > 0) parts.push(`${unmatchedLedger} ledger-only ${unmatchedLedger === 1 ? "item" : "items"}`);
    findings.push(`${unmatched} transaction${unmatched > 1 ? "s" : ""} remain${unmatched === 1 ? "s" : ""} unmatched: ${parts.join(" and ")}.`);
  }
  if (critical > 0) findings.push("Largest risk exposure is in CRITICAL-rated items — review bank references first.");
  if (parseFloat(totalExposure) > 0) {
    findings.push(`Total review exposure: ¥${fmtMoney(totalExposure)} (confirmed unresolved ¥${fmtMoney(confirmedAmt)} + potential duplicate ¥${fmtMoney(potentialAmt)}).`);
  }
  if (findings.length === 0) findings.push("All transactions reconciled within acceptable variance bands.");

  return { headline, body, nextAction, findings };
}

/* ─── Status Pie chart ───────────────────────────────────────── */

const PIE_COLORS: Record<string, string> = {
  MATCHED: "#22c55e", FX_VARIANCE: "#f59e0b",
  AMOUNT_MISMATCH: "#f97316", UNMATCHED_BANK: "#ef4444",
  UNMATCHED_LEDGER: "#dc2626", POSSIBLE_DUPLICATE: "#a855f7",
  MANUAL_REVIEW: "#3b82f6",
};

/* ─── Empty state ────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-2rem)] p-8">
      <div className="max-w-md text-center space-y-6">
        <div className="w-16 h-16 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto border border-slate-200">
          <Layers className="w-8 h-8" />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-2">RECONCILIATION CONTROL ROOM</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">No Active Reconciliation Batch</h1>
          <p className="text-slate-500 mt-2 text-sm leading-relaxed">Upload your USD bank statement and CNY internal ledger to begin cross-border financial reconciliation.</p>
        </div>
        <Button asChild size="lg" className="w-full">
          <Link href="/upload">Start Reconciliation <ArrowRight className="ml-2 w-4 h-4" /></Link>
        </Button>
      </div>
    </div>
  );
}

/* ─── Loading skeleton ───────────────────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-9 w-96" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-40 col-span-1" />
        <Skeleton className="h-40 col-span-2" />
      </div>
    </div>
  );
}

/* ─── Exception queue item ────────────────────────────────────── */

function ExceptionItem({ r, rank }: { r: ReconciliationResult; rank: number }) {
  const rc = riskColor(r.riskLevel);
  return (
    <div className={`flex items-start gap-4 p-4 rounded-lg border ${rc.bg} ${rc.border} group`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5 ${rc.dot}`}>
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass(r.status)}`}>
            {statusLabel(r.status)}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rc.badge}`}>
            {r.riskLevel}
          </span>
          {r.bankReference && (
            <span className="text-xs font-mono text-slate-500 bg-white/60 px-1.5 py-0.5 rounded border border-slate-200">
              {r.bankReference}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {r.ledgerVendorClient && (
            <span className="text-sm font-medium text-slate-700 truncate">{r.ledgerVendorClient}</span>
          )}
          {r.ledgerInvoiceId && (
            <span className="text-xs text-slate-500 font-mono">{r.ledgerInvoiceId}</span>
          )}
        </div>
        {r.reason && (
          <p className="text-xs text-slate-500 mt-1 leading-snug">{r.reason}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        {r.differenceAmount && parseFloat(r.differenceAmount) !== 0 && (
          <div className={`text-sm font-bold font-mono ${rc.text}`}>{fmtCny(r.differenceAmount)}</div>
        )}
        {r.differencePct && parseFloat(r.differencePct) !== 0 && (
          <div className="text-xs text-slate-400">{r.differencePct}% var</div>
        )}
        <Link href="/results">
          <Button variant="ghost" size="sm" className="mt-1 text-xs h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
            Review <ChevronRight className="w-3 h-3 ml-0.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Compact outcome card ───────────────────────────────────── */

function OutcomeCard({
  label, value, sub, color = "text-slate-700", dotColor = "bg-slate-400",
}: { label: string; value: string | number; sub?: string; color?: string; dotColor?: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-lg px-4 py-3 flex items-start gap-3 shadow-sm">
      <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dotColor}`} />
      <div className="min-w-0">
        <div className={`text-lg font-bold leading-tight ${color}`}>{value}</div>
        <div className="text-xs text-slate-500 leading-snug">{label}</div>
        {sub && <div className="text-xs font-mono text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

/* ─── Main dashboard ─────────────────────────────────────────── */

export default function Dashboard() {
  const [openingBalance, setOpeningBalanceState] = useState<string>("100000.00");

  useEffect(() => {
    const stored = localStorage.getItem(OPENING_BALANCE_KEY);
    if (stored) setOpeningBalanceState(stored);
    const onStorage = (e: StorageEvent) => {
      if (e.key === OPENING_BALANCE_KEY && e.newValue) setOpeningBalanceState(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { data: dashboard, isLoading: dashLoading } = useGetDashboard(undefined, {
    query: { queryKey: getGetDashboardQueryKey() }
  });

  const { data: batches } = useGetBatches({
    query: { queryKey: getGetBatchesQueryKey() }
  });

  const criticalParams = { riskLevel: "CRITICAL", pageSize: 5, page: 1 };
  const highParams = { riskLevel: "HIGH", pageSize: 5, page: 1 };

  const { data: criticalResults } = useGetResults(criticalParams, {
    query: { queryKey: getGetResultsQueryKey(criticalParams), enabled: !!dashboard?.activeBatchId }
  });
  const { data: highResults } = useGetResults(highParams, {
    query: { queryKey: getGetResultsQueryKey(highParams), enabled: !!dashboard?.activeBatchId }
  });

  const activeBatch: UploadBatch | undefined = useMemo(
    () => batches?.find(b => b.id === dashboard?.activeBatchId) || batches?.[0],
    [batches, dashboard?.activeBatchId]
  );

  const exceptionQueue: ReconciliationResult[] = useMemo(() => {
    const all = [
      ...(criticalResults?.results || []),
      ...(highResults?.results || []).filter(r => r.riskLevel === "HIGH"),
    ];
    const seen = new Set<string>();
    const unique = all.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
    return unique
      .sort((a, b) => {
        const riskOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1 };
        const ro = (riskOrder[a.riskLevel] ?? 2) - (riskOrder[b.riskLevel] ?? 2);
        if (ro !== 0) return ro;
        return (parseFloat(b.differenceAmount || "0")) - (parseFloat(a.differenceAmount || "0"));
      })
      .slice(0, 5);
  }, [criticalResults, highResults]);

  if (dashLoading) return <LoadingSkeleton />;

  const isEmpty = !dashboard || (dashboard.totalBankTransactions === 0 && dashboard.totalLedgerEntries === 0);
  if (isEmpty) return <EmptyState />;

  const d = dashboard!;
  const dAny = d as unknown as Record<string, string | number>;
  const unmatchedBank = (dAny.unmatchedBankCount as number) ?? d.riskScoreBreakdown.unmatchedCount;
  const unmatchedLedger = (dAny.unmatchedLedgerCount as number) ?? 0;
  const confirmedAmt = (dAny.confirmedUnresolvedAmount as string) ?? d.totalUnresolvedAmount ?? "0.00";
  const potentialAmt = (dAny.potentialDuplicateExposure as string) ?? "0.00";
  const totalExposure = (dAny.totalReviewExposure as string) ?? d.totalUnresolvedAmount ?? "0.00";
  const mismatchExposure = (dAny.mismatchExposure as string) ?? "0.00";
  const unmatchedBankExposure = (dAny.unmatchedBankExposure as string) ?? "0.00";
  const unmatchedLedgerExposure = (dAny.unmatchedLedgerExposure as string) ?? "0.00";
  const totalInflowConverted = (dAny.totalInflowConverted as string) ?? "0.00";
  const totalOutflowConverted = (dAny.totalOutflowConverted as string) ?? "0.00";
  const apiNetFlow = (dAny.netFlow as string) ?? "0.00";

  // Cash flow & balance — opening balance from localStorage
  const openingBalanceNum = parseFloat(openingBalance) || 100000;
  const inflowNum = parseFloat(totalInflowConverted) || 0;
  const outflowNum = parseFloat(totalOutflowConverted) || 0;
  const netFlowNum = inflowNum - outflowNum;
  const expectedEndingNum = openingBalanceNum + netFlowNum;

  const fmtCnyFull = (n: number) => {
    const sign = n < 0 ? "−¥" : "¥";
    return `${sign}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const bannerInfo = riskBannerInfo(d.riskScore);
  const memo = buildAiMemo(d, unmatchedBank, unmatchedLedger, confirmedAmt, potentialAmt, totalExposure);

  const criticalCount = d.riskScoreBreakdown.criticalCount;
  const totalTxns = d.totalBankTransactions + d.totalLedgerEntries;
  const matchRate = totalTxns > 0 ? Math.round((d.matched / d.totalBankTransactions) * 100) : 0;

  // Risk Meter driver text
  const breakdown = d.riskScoreBreakdown;
  const criticalMismatches = Math.min(breakdown.criticalCount, breakdown.amountMismatchCount);
  const highMismatches = breakdown.amountMismatchCount - criticalMismatches;
  const driverParts: string[] = [];
  if (criticalMismatches > 0) driverParts.push(`${criticalMismatches} critical mismatch${criticalMismatches > 1 ? "es" : ""}`);
  if (highMismatches > 0) driverParts.push(`${highMismatches} high mismatch${highMismatches > 1 ? "es" : ""}`);
  if (breakdown.duplicateCount > 0) driverParts.push(`${breakdown.duplicateCount} potential duplicate${breakdown.duplicateCount > 1 ? "s" : ""}`);
  if (breakdown.unmatchedCount > 0) driverParts.push(`${breakdown.unmatchedCount} unmatched item${breakdown.unmatchedCount > 1 ? "s" : ""}`);
  const driverText = driverParts.length > 0 ? `Score driven by ${driverParts.join(", ")}.` : undefined;
  const topRiskItem = exceptionQueue[0];
  const topRisk = topRiskItem?.ledgerVendorClient && topRiskItem?.differenceAmount && parseFloat(topRiskItem.differenceAmount) > 0
    ? `Top risk: ${topRiskItem.ledgerVendorClient} mismatch, ¥${parseFloat(topRiskItem.differenceAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} difference.`
    : undefined;

  const pieData = d.statusDistribution
    .filter(s => s.count > 0)
    .map(s => ({ name: statusLabel(s.status), value: s.count, key: s.status }));

  const riskBarData = [
    { name: "Critical", value: criticalCount, fill: "#ef4444" },
    { name: "High", value: d.riskScoreBreakdown.amountMismatchCount, fill: "#f97316" },
    { name: "FX Var", value: d.fxVarianceCount, fill: "#f59e0b" },
    { name: "Matched", value: d.matched, fill: "#22c55e" },
  ].filter(x => x.value > 0);

  const bankTotal = d.totalBankTransactions;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ── 1. Header ───────────────────────────────────────────── */}
        <div className="space-y-1">
          <p className="text-xs font-bold tracking-widest text-slate-400 uppercase">RECONCILIATION CONTROL ROOM</p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cross-border reconciliation batch review</h1>
          <p className="text-sm text-slate-500">Review USD bank statements against CNY internal ledgers. FX variance is separated from real accounting discrepancies.</p>
        </div>

        {/* Batch metadata strip */}
        {activeBatch && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500 bg-white border border-slate-100 rounded-lg px-4 py-2.5 shadow-sm">
            <span><span className="text-slate-400 mr-1">Batch</span><code className="font-mono text-slate-700 bg-slate-100 px-1 rounded">{activeBatch.id.slice(0, 14)}…</code></span>
            <span><span className="text-slate-400 mr-1">Bank</span><span className="text-slate-700">{activeBatch.bankFileName || "—"}</span></span>
            <span><span className="text-slate-400 mr-1">Ledger</span><span className="text-slate-700">{activeBatch.ledgerFileName || "—"}</span></span>
            <span><span className="text-slate-400 mr-1">FX pair</span><span className="font-semibold text-slate-700">USD → CNY</span></span>
            <span><span className="text-slate-400 mr-1">Reconciled</span><span className="text-slate-700">{fmtDate(activeBatch.reconciledAt)}</span></span>
            <span className="ml-auto">
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${batchReviewStatus(d.riskScore).color}`}>
                {batchReviewStatus(d.riskScore).label}
              </span>
            </span>
          </div>
        )}

        {/* ── 2. Review Status Banner ─────────────────────────────── */}
        <div className={`bg-gradient-to-r ${bannerInfo.bg} rounded-xl p-5 text-white shadow-md`}>
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                {bannerInfo.icon}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className={`text-xs font-bold tracking-widest border px-2 py-0.5 rounded ${bannerInfo.tagBg}`}>
                    {bannerInfo.label}
                  </span>
                  <span className="text-white/60 text-xs">•</span>
                  <span className="text-sm font-medium text-white/90">Risk Score: <span className="font-bold text-white text-base">{d.riskScore}</span><span className="text-white/60">/100</span></span>
                </div>
                <p className="text-white/80 text-sm leading-snug line-clamp-2">{memo.headline}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 shrink-0">
              <div className="text-center" title="Total Review Exposure = amount mismatch differences + unmatched bank converted amounts + unmatched ledger amounts + potential duplicate exposure. FX variance within tolerance is not included.">
                <div className="text-xl font-black text-white">{fmtCny(totalExposure)}</div>
                <div className="text-xs text-white/60 flex items-center gap-1 justify-center">
                  Total Review Exposure
                  <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/20 text-white/70 text-[9px] font-bold leading-none cursor-help">?</span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-xl font-black text-white">{criticalCount}</div>
                <div className="text-xs text-white/60">Critical items</div>
              </div>
              <div className="flex gap-2 ml-2">
                <Link href="/results">
                  <Button size="sm" className="bg-white/20 hover:bg-white/30 border border-white/30 text-white text-xs h-8">
                    View Results <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
                <Link href="/ai-insights">
                  <Button size="sm" className="bg-white/20 hover:bg-white/30 border border-white/30 text-white text-xs h-8">
                    AI Insights <BrainCircuit className="w-3 h-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ── 2b. Audit Risk Meter ────────────────────────────────── */}
        <AuditRiskMeter score={d.riskScore} driverText={driverText} topRisk={topRisk} />

        {/* ── 3. Priority Review Queue ─────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <div>
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Priority Review Queue</h2>
                <p className="text-[10px] text-slate-400 leading-none mt-0.5">Critical and high-risk items requiring review.</p>
              </div>
              {exceptionQueue.length > 0 && (
                <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">
                  {exceptionQueue.length} item{exceptionQueue.length > 1 ? "s" : ""} pending
                </span>
              )}
            </div>
            <Link href="/results">
              <Button variant="ghost" size="sm" className="text-xs text-slate-500 h-7 px-2">
                View all in Results <ChevronsRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </div>

          {exceptionQueue.length === 0 ? (
            <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
              <div>
                <p className="font-semibold text-emerald-800 text-sm">No critical or high-risk items detected</p>
                <p className="text-emerald-700 text-xs mt-0.5">All reconciliation items fall within acceptable risk thresholds.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {exceptionQueue.map((r, i) => (
                <ExceptionItem key={r.id} r={r} rank={i + 1} />
              ))}
            </div>
          )}
        </div>

        {/* ── 4. AI Audit Memo + Findings ─────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Memo */}
          <div className="lg:col-span-3 bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">AI Audit Memo Preview</h2>
              <span className="text-xs text-slate-400 ml-auto">Rule-engine derived · read-only summary</span>
            </div>

            <div className="border-l-4 border-slate-300 pl-4 space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">To: Audit Analyst</p>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Re: Batch {activeBatch?.id?.slice(0, 8) || "—"} · USD/CNY Reconciliation</p>
            </div>

            <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
              <p className="text-sm font-semibold text-slate-800 mb-2 leading-snug">{memo.headline}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{memo.body}</p>
            </div>

            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
              <ArrowRight className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-0.5">Recommended Next Action</p>
                <p className="text-xs text-blue-700 leading-snug">{memo.nextAction}</p>
              </div>
            </div>

            <p className="text-xs text-slate-400 italic">
              AI summarises rule-engine output only. Statuses, risk levels, amounts, and FX classifications are determined exclusively by the deterministic reconciliation engine.
            </p>
          </div>

          {/* Findings feed */}
          <div className="lg:col-span-2 bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <CircleDot className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">AI Findings Feed</h2>
            </div>

            <div className="space-y-2">
              {memo.findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2.5 py-2 border-b border-slate-50 last:border-0">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    f.toLowerCase().includes("critical") || f.toLowerCase().includes("duplicate") ? "bg-red-500" :
                    f.toLowerCase().includes("mismatch") || f.toLowerCase().includes("unresolved") ? "bg-orange-500" :
                    f.toLowerCase().includes("fx") ? "bg-amber-500" : "bg-emerald-500"
                  }`} />
                  <p className="text-xs text-slate-600 leading-snug">{f}</p>
                </div>
              ))}
            </div>

            {/* Exposure Breakdown */}
            <div className="mt-4 border border-slate-100 rounded-lg p-3 bg-slate-50 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Exposure Breakdown</p>
                <span className="text-[10px] text-slate-400 font-mono">{fmtCny(totalExposure)} total</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Amt mismatch differences", value: mismatchExposure, color: "text-orange-600" },
                  { label: "Unmatched bank (converted)", value: unmatchedBankExposure, color: "text-red-600" },
                  { label: "Unmatched ledger records", value: unmatchedLedgerExposure, color: "text-red-700" },
                  { label: "Potential duplicate exposure", value: potentialAmt, color: "text-purple-600" },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">{row.label}</span>
                    <span className={`font-mono font-semibold ${parseFloat(row.value) > 0 ? row.color : "text-slate-400"}`}>
                      {parseFloat(row.value) > 0 ? fmtCny(row.value) : "—"}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-[11px] border-t border-slate-200 pt-1.5 mt-1">
                  <span className="font-semibold text-slate-700">Total Review Exposure</span>
                  <span className="font-mono font-bold text-slate-900">{fmtCny(totalExposure)}</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 leading-snug pt-1 border-t border-slate-100">
                FX variance within tolerance is tracked separately and not included above.
              </p>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                  style={{ width: `${matchRate}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span className="text-emerald-600 font-medium">{matchRate}% matched</span>
                <span>{100 - matchRate}% needs review</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── 5. Outcome Summary ──────────────────────────────────── */}
        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Outcome Summary</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <OutcomeCard label="Matched" value={d.matched} dotColor="bg-emerald-500" color="text-emerald-700" />
            <OutcomeCard label="FX Variance" value={d.fxVarianceCount} dotColor="bg-amber-500" color="text-amber-700" />
            <OutcomeCard label="Amt Mismatch" value={breakdown.amountMismatchCount} dotColor="bg-orange-500" color="text-orange-700" />
            <OutcomeCard label="Duplicates" value={d.possibleDuplicateCount} dotColor="bg-purple-500" color="text-purple-700" />
            <OutcomeCard label="Unmatched Bank" value={unmatchedBank} dotColor="bg-red-500" color="text-red-700" />
            <OutcomeCard label="Unmatched Ledger" value={unmatchedLedger} dotColor="bg-red-700" color="text-red-800" />
            <OutcomeCard label="Ledger Records" value={d.totalLedgerEntries} dotColor="bg-slate-400" color="text-slate-700" />
            <OutcomeCard
              label="Review Exposure"
              value={`¥${parseFloat(totalExposure).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              dotColor="bg-red-600"
              color="text-red-700"
            />
          </div>
        </div>

        {/* ── 5b. Cash Flow & Balance ─────────────────────────────── */}
        <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Cash Flow &amp; Balance</p>
              <p className="text-xs text-slate-400 mt-0.5">Money movement for this batch period</p>
            </div>
            <Link href="/upload">
              <Button variant="ghost" size="sm" className="text-xs text-slate-400 h-7 px-2">
                Edit Opening Balance <ChevronRight className="w-3 h-3 ml-0.5" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
            {/* Opening Balance */}
            <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Opening Balance</p>
              <p className="text-sm font-bold text-slate-700 font-mono">{fmtCnyFull(openingBalanceNum)}</p>
            </div>
            {/* Inflow */}
            <div className="bg-green-50 rounded-lg px-4 py-3 border border-green-100">
              <div className="flex items-center gap-1 mb-1">
                <ArrowDownLeft className="w-3 h-3 text-green-600" />
                <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide">Total Inflow</p>
              </div>
              <p className="text-sm font-bold text-green-700 font-mono">+{fmtCnyFull(inflowNum)}</p>
              <p className="text-[10px] text-green-500 mt-0.5">bank credits, converted</p>
            </div>
            {/* Outflow */}
            <div className="bg-blue-50 rounded-lg px-4 py-3 border border-blue-100">
              <div className="flex items-center gap-1 mb-1">
                <ArrowUpRightIcon className="w-3 h-3 text-blue-600" />
                <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">Total Outflow</p>
              </div>
              <p className="text-sm font-bold text-blue-700 font-mono">−{fmtCnyFull(outflowNum)}</p>
              <p className="text-[10px] text-blue-500 mt-0.5">bank debits, converted</p>
            </div>
            {/* Net Flow */}
            <div className={`rounded-lg px-4 py-3 border ${netFlowNum >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-orange-50 border-orange-100"}`}>
              <div className="flex items-center gap-1 mb-1">
                <Minus className="w-3 h-3 text-slate-500" />
                <p className={`text-[10px] font-semibold uppercase tracking-wide ${netFlowNum >= 0 ? "text-emerald-600" : "text-orange-600"}`}>Net Flow</p>
              </div>
              <p className={`text-sm font-bold font-mono ${netFlowNum >= 0 ? "text-emerald-700" : "text-orange-700"}`}>
                {netFlowNum >= 0 ? "+" : "−"}{fmtCnyFull(Math.abs(netFlowNum))}
              </p>
              <p className={`text-[10px] mt-0.5 ${netFlowNum >= 0 ? "text-emerald-500" : "text-orange-500"}`}>inflow − outflow</p>
            </div>
            {/* Expected Ending Balance */}
            <div className="bg-blue-50 rounded-lg px-4 py-3 border border-blue-200">
              <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide mb-1">Expected Ending Balance</p>
              <p className="text-sm font-bold text-blue-900 font-mono">{fmtCnyFull(expectedEndingNum)}</p>
              <p className="text-[10px] text-blue-500 mt-0.5">opening balance + net flow</p>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 italic leading-snug border-t border-slate-100 pt-3">
            Cash Flow &amp; Balance reflects money movement. Review Exposure reflects reconciliation risk. They are related but not the same. Opening balance can be changed in Reconciliation Settings.
          </p>
        </div>

        {/* ── 6. Charts ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Status Distribution — stacked bar */}
          <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Status Distribution</h2>
            {pieData.length > 0 ? (
              <div className="space-y-3">
                {/* Stacked colour bar */}
                <div className="flex h-8 rounded-lg overflow-hidden gap-px">
                  {pieData.map((entry) => {
                    const total = pieData.reduce((s, x) => s + x.value, 0);
                    const pct = total > 0 ? (entry.value / total) * 100 : 0;
                    if (pct === 0) return null;
                    return (
                      <div
                        key={entry.key}
                        title={`${entry.name}: ${entry.value}`}
                        className="transition-all"
                        style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[entry.key] || "#94a3b8" }}
                      />
                    );
                  })}
                </div>
                {/* Legend rows */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                  {pieData.map((entry) => {
                    const total = pieData.reduce((s, x) => s + x.value, 0);
                    const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
                    return (
                      <div key={entry.key} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[entry.key] || "#94a3b8" }} />
                          <span className="text-xs text-slate-600 truncate">{entry.name}</span>
                        </div>
                        <div className="text-right shrink-0 ml-2">
                          <span className="text-xs font-bold text-slate-700">{entry.value}</span>
                          <span className="text-[10px] text-slate-400 ml-1">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No data</div>
            )}
          </div>

          {/* Risk Breakdown — horizontal bars */}
          <div className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm space-y-4">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Risk Breakdown</h2>
            {riskBarData.length > 0 ? (
              <div className="space-y-3">
                {riskBarData.map((entry) => {
                  const maxVal = Math.max(...riskBarData.map(x => x.value));
                  const pct = maxVal > 0 ? (entry.value / maxVal) * 100 : 0;
                  return (
                    <div key={entry.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 font-medium">{entry.name}</span>
                        <span className="font-bold text-slate-700">{entry.value}</span>
                      </div>
                      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: entry.fill }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No data</div>
            )}
            <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
              <p className="text-[10px] font-mono text-slate-400 leading-relaxed">{d.riskScoreBreakdown.formula}</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
