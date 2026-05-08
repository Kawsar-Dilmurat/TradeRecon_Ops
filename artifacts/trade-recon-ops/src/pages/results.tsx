import React, { useState } from "react";
import {
  useGetResults,
  getGetResultsQueryKey,
  useGetBatches,
  getGetBatchesQueryKey,
  useGetDashboard,
  getGetDashboardQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ChevronLeft, ChevronRight, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";

type StatusType = "MATCHED" | "FX_VARIANCE" | "AMOUNT_MISMATCH" | "UNMATCHED_BANK" | "UNMATCHED_LEDGER" | "POSSIBLE_DUPLICATE" | "MANUAL_REVIEW";
type RiskType = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const STATUS_COLORS: Record<StatusType, string> = {
  MATCHED: "bg-green-100 text-green-800",
  FX_VARIANCE: "bg-yellow-100 text-yellow-800",
  AMOUNT_MISMATCH: "bg-orange-100 text-orange-800",
  UNMATCHED_BANK: "bg-red-100 text-red-800",
  UNMATCHED_LEDGER: "bg-red-100 text-red-800",
  POSSIBLE_DUPLICATE: "bg-purple-100 text-purple-800",
  MANUAL_REVIEW: "bg-blue-100 text-blue-800",
};

const RISK_COLORS: Record<RiskType, string> = {
  LOW: "bg-green-50 text-green-700 border-green-200",
  MEDIUM: "bg-yellow-50 text-yellow-700 border-yellow-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  CRITICAL: "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  MATCHED: "Matched",
  FX_VARIANCE: "FX Variance",
  AMOUNT_MISMATCH: "Amount Mismatch",
  UNMATCHED_BANK: "Unmatched Bank",
  UNMATCHED_LEDGER: "Unmatched Ledger",
  POSSIBLE_DUPLICATE: "Possible Duplicate",
  MANUAL_REVIEW: "Manual Review",
};

function fmt(v: string | null | undefined): string {
  if (!v) return "—";
  return v;
}

function fmtAmount(v: string | null | undefined, currency?: string | null): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ""}`.trim();
}

function getRowDescription(r: {
  status: string;
  bankDescription?: string | null;
  reason?: string | null;
}): { main: string; sub: string } {
  if (r.status === "UNMATCHED_LEDGER") {
    return {
      main: "Ledger entry without matching bank transaction",
      sub: "",
    };
  }
  if (r.status === "UNMATCHED_BANK") {
    return {
      main: r.bankDescription || "Bank transaction without matching ledger entry",
      sub: "Bank transaction without matching ledger entry",
    };
  }
  if (r.status === "POSSIBLE_DUPLICATE") {
    const reason = r.reason || "";
    const match = reason.match(/Possible duplicate of reference ([\w-]+)/i);
    const ref = match ? match[1] : null;
    return {
      main: r.bankDescription || "—",
      sub: ref ? `Possible duplicate of ${ref}` : (reason.slice(0, 70) + (reason.length > 70 ? "…" : "")),
    };
  }
  const reason = r.reason || "";
  return {
    main: r.bankDescription || "—",
    sub: reason.slice(0, 60) + (reason.length > 60 ? "…" : ""),
  };
}

function getDirection(bankType?: string | null, bankDescription?: string | null): "INFLOW" | "OUTFLOW" | "UNKNOWN" {
  if (bankType) {
    const t = bankType.toLowerCase().trim();
    if (t === "credit") return "INFLOW";
    if (t === "debit") return "OUTFLOW";
  }
  if (bankDescription) {
    const d = bankDescription.toLowerCase();
    if (["wire from", "revenue from", "received from"].some(kw => d.includes(kw))) return "INFLOW";
    if (["payment to", "paid to", "service fee"].some(kw => d.includes(kw))) return "OUTFLOW";
  }
  return "UNKNOWN";
}

function DirectionBadge({ direction }: { direction: "INFLOW" | "OUTFLOW" | "UNKNOWN" }) {
  if (direction === "INFLOW") return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
      ↑ INFLOW
    </span>
  );
  if (direction === "OUTFLOW") return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap">
      ↓ OUTFLOW
    </span>
  );
  return (
    <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 whitespace-nowrap">
      — UNKNOWN
    </span>
  );
}

function calcReviewExposure(r: {
  status: string;
  differenceAmount?: string | null;
  convertedAmount?: string | null;
  ledgerAmount?: string | null;
}): string {
  if (r.status === "MATCHED" || r.status === "FX_VARIANCE" || r.status === "MANUAL_REVIEW") return "0.00";
  if (r.status === "AMOUNT_MISMATCH") {
    const diff = r.differenceAmount;
    return diff ? Math.abs(parseFloat(diff)).toFixed(2) : "0.00";
  }
  if (r.status === "UNMATCHED_BANK" || r.status === "POSSIBLE_DUPLICATE") {
    return r.convertedAmount ? parseFloat(r.convertedAmount).toFixed(2) : "0.00";
  }
  if (r.status === "UNMATCHED_LEDGER") {
    return r.ledgerAmount ? parseFloat(r.ledgerAmount).toFixed(2) : "0.00";
  }
  return "0.00";
}

function getDiffCell(r: {
  status: string;
  riskLevel: string;
  differenceAmount?: string | null;
  differencePct?: string | null;
}): { cellClass: string; valueClass: string; display: JSX.Element } {
  const diff = r.differenceAmount;
  const hasDiff = diff && diff !== "0.00" && diff !== "0";

  if (!hasDiff) {
    return {
      cellClass: "",
      valueClass: "",
      display: <span className="text-green-600 text-xs">—</span>,
    };
  }

  const n = parseFloat(diff!);
  const fmtd = `${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CNY`;

  if (r.riskLevel === "CRITICAL") {
    return {
      cellClass: "bg-red-50",
      valueClass: "text-red-700 font-bold",
      display: (
        <>
          <span className="text-red-700 font-bold font-mono text-xs">{fmtd}</span>
          {r.differencePct && <span className="block text-red-400 text-[10px]">{r.differencePct}%</span>}
        </>
      ),
    };
  }
  if (r.riskLevel === "HIGH") {
    return {
      cellClass: "bg-orange-50",
      valueClass: "text-orange-700 font-bold",
      display: (
        <>
          <span className="text-orange-700 font-bold font-mono text-xs">{fmtd}</span>
          {r.differencePct && <span className="block text-orange-400 text-[10px]">{r.differencePct}%</span>}
        </>
      ),
    };
  }
  if (r.status === "FX_VARIANCE") {
    return {
      cellClass: "",
      valueClass: "text-amber-600",
      display: (
        <>
          <span className="text-amber-600 font-mono text-xs">{fmtd}</span>
          {r.differencePct && <span className="block text-amber-400 text-[10px]">{r.differencePct}%</span>}
        </>
      ),
    };
  }
  return {
    cellClass: "",
    valueClass: n > 0 ? "text-orange-600" : "text-red-600",
    display: (
      <>
        <span className={`font-mono text-xs ${n > 0 ? "text-orange-600" : "text-red-600"}`}>{fmtd}</span>
        {r.differencePct && <span className="block text-muted-foreground text-[10px]">{r.differencePct}%</span>}
      </>
    ),
  };
}

export default function ResultsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [riskLevel, setRiskLevel] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const params = {
    status: status !== "all" ? status : undefined,
    riskLevel: riskLevel !== "all" ? riskLevel : undefined,
    search: search || undefined,
    page,
    pageSize,
  };

  const { data, isLoading } = useGetResults(params, {
    query: { queryKey: getGetResultsQueryKey(params) }
  });

  const { data: batches } = useGetBatches({ query: { queryKey: getGetBatchesQueryKey() } });
  const latestBatch = batches?.[0];

  const { data: dashboard } = useGetDashboard(undefined, { query: { queryKey: getGetDashboardQueryKey() } });
  const dAny = dashboard as unknown as Record<string, string | number> | undefined;

  const results = data?.results || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const noFilters = status === "all" && riskLevel === "all" && !search;

  return (
    <div className="p-8 space-y-6 max-w-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Reconciliation Results</h1>
          {latestBatch && (
            <p className="text-muted-foreground mt-1 text-sm">
              Batch <code className="bg-muted px-1 rounded text-xs">{latestBatch.id?.slice(0, 12)}...</code> — {latestBatch.bankFileName} / {latestBatch.ledgerFileName}
            </p>
          )}
        </div>
        {total > 0 && (
          <div className="text-sm text-muted-foreground bg-muted px-3 py-1.5 rounded-lg">
            {total} result{total !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Result row count line */}
      {latestBatch && total > 0 && (
        <p className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg px-3 py-2">
          {noFilters
            ? `${total} reconciliation result ${total === 1 ? "row" : "rows"} generated from ${latestBatch.bankRowCount ?? "?"} bank ${latestBatch.bankRowCount === 1 ? "transaction" : "transactions"} and ${latestBatch.ledgerRowCount ?? "?"} internal ledger ${latestBatch.ledgerRowCount === 1 ? "record" : "records"}.`
            : `${total} result${total !== 1 ? "s" : ""} match current filters — batch contains ${latestBatch.bankRowCount ?? "?"} bank transactions and ${latestBatch.ledgerRowCount ?? "?"} internal ledger records.`
          }
        </p>
      )}

      {/* FX currency note */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-xs text-blue-700">
        <span className="font-semibold shrink-0">FX Note:</span>
        <span>Bank amounts are in USD. All reconciliation comparisons are made in CNY. <span className="font-medium">Conv. Amt</span> = bank USD converted to CNY at the spot rate on the bank date. <span className="font-medium">Diff</span> = Conv. Amt minus Ledger CNY amount. Hover column headers for details.</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search description, vendor, reference, invoice..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="MATCHED">Matched</SelectItem>
            <SelectItem value="FX_VARIANCE">FX Variance</SelectItem>
            <SelectItem value="AMOUNT_MISMATCH">Amount Mismatch</SelectItem>
            <SelectItem value="UNMATCHED_BANK">Unmatched Bank</SelectItem>
            <SelectItem value="UNMATCHED_LEDGER">Unmatched Ledger</SelectItem>
            <SelectItem value="POSSIBLE_DUPLICATE">Possible Duplicate</SelectItem>
            <SelectItem value="MANUAL_REVIEW">Manual Review</SelectItem>
          </SelectContent>
        </Select>

        <Select value={riskLevel} onValueChange={(v) => { setRiskLevel(v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All risk" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All risk levels</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground">No results found.</p>
            <Button asChild variant="link" className="mt-2">
              <Link href="/upload">Upload data to begin reconciliation</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Risk</th>
                  <th
                    className="px-4 py-3 text-left font-medium text-muted-foreground cursor-help"
                    title="Direction — whether the bank transaction was money coming in (INFLOW/credit) or going out (OUTFLOW/debit). Determined by the bank CSV 'type' field, or inferred from the transaction description. Not applicable for ledger-only rows."
                  >
                    Direction
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Bank Ref / Date</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Description</th>
                  <th
                    className="px-4 py-3 text-right font-medium text-muted-foreground cursor-help"
                    title="Bank Amt — original bank statement amount, usually in USD"
                  >
                    Bank Amt <span className="text-[10px] text-muted-foreground/60">(USD)</span>
                  </th>
                  <th
                    className="px-4 py-3 text-right font-medium text-muted-foreground cursor-help"
                    title="Ledger Amt — internal CNY ledger amount as posted"
                  >
                    Ledger Amt <span className="text-[10px] text-muted-foreground/60">(CNY)</span>
                  </th>
                  <th
                    className="px-4 py-3 text-right font-medium text-muted-foreground cursor-help"
                    title="Converted Amt — bank amount converted to CNY using the spot FX rate on the bank transaction date"
                  >
                    Converted Amt <span className="text-[10px] text-muted-foreground/60">(CNY)</span>
                  </th>
                  <th
                    className="px-4 py-3 text-right font-medium text-muted-foreground cursor-help"
                    title="Diff — Conv. Amt minus Ledger Amt in CNY. Bold red/orange = exceeds tolerance. Amber = within FX variance tolerance."
                  >
                    Diff <span className="text-[10px] text-muted-foreground/60">(CNY)</span>
                  </th>
                  <th
                    className="px-4 py-3 text-right font-medium text-muted-foreground cursor-help bg-amber-50/50"
                    title="Review Exposure — row-level contribution to Total Review Exposure. AMOUNT_MISMATCH: abs(diff). UNMATCHED_BANK/POSSIBLE_DUPLICATE: converted amount. UNMATCHED_LEDGER: ledger amount. MATCHED/FX_VARIANCE: 0.00. Sum of this column = Dashboard Total Review Exposure."
                  >
                    Review Exposure <span className="text-[10px] text-muted-foreground/60">(CNY)</span>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium text-muted-foreground cursor-help"
                    title="USD/CNY spot rate used to convert the bank amount on the transaction date"
                  >
                    FX Rate <span className="text-[10px] text-muted-foreground/60">(USD/CNY)</span>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Vendor / Invoice</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const isUnmatchedLedger = r.status === "UNMATCHED_LEDGER";
                  const desc = getRowDescription({ status: r.status, bankDescription: r.bankDescription, reason: r.reason });
                  const diff = getDiffCell({ status: r.status, riskLevel: r.riskLevel, differenceAmount: r.differenceAmount, differencePct: r.differencePct });
                  const rowBase = isUnmatchedLedger ? "bg-slate-50/70" : i % 2 === 0 ? "" : "bg-muted/10";
                  const direction = isUnmatchedLedger ? "UNKNOWN" as const : getDirection((r as any).bankType, r.bankDescription);
                  return (
                    <tr key={r.id} className={`border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${rowBase}`}>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[r.status as StatusType] || "bg-gray-100 text-gray-700"}`}>
                          {STATUS_LABELS[r.status] || r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded border ${RISK_COLORS[r.riskLevel as RiskType] || ""}`}>
                          {r.riskLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isUnmatchedLedger
                          ? <span className="text-[10px] font-semibold tracking-wide text-muted-foreground/50 uppercase">LEDGER ONLY</span>
                          : <DirectionBadge direction={direction} />
                        }
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-foreground">{fmt(r.bankReference)}</div>
                        <div className="text-xs text-muted-foreground">{fmt(r.bankDate)}</div>
                      </td>
                      <td className="px-4 py-3 max-w-48">
                        <div className={`truncate ${isUnmatchedLedger ? "text-muted-foreground italic" : "text-foreground"}`}>
                          {desc.main}
                        </div>
                        {desc.sub && (
                          <div className="text-xs text-muted-foreground truncate mt-0.5">{desc.sub}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        {isUnmatchedLedger ? (
                          <span className="text-muted-foreground">—</span>
                        ) : r.bankAmount ? (
                          <span className={direction === "INFLOW" ? "text-green-700" : direction === "OUTFLOW" ? "text-blue-700" : "text-foreground"}>
                            {direction === "INFLOW" ? "+" : direction === "OUTFLOW" ? "−" : ""}
                            {fmtAmount(r.bankAmount, r.bankCurrency)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        {r.ledgerAmount ? (
                          <span className={
                            direction === "INFLOW" ? "text-green-700" :
                            direction === "OUTFLOW" ? "text-blue-700" :
                            "text-foreground"
                          }>
                            {direction === "INFLOW" ? "+" : direction === "OUTFLOW" ? "−" : ""}
                            {fmtAmount(r.ledgerAmount, r.ledgerCurrency)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                        {isUnmatchedLedger ? (
                          <span className="text-muted-foreground">—</span>
                        ) : r.convertedAmount ? (
                          <span className={
                            direction === "INFLOW" ? "text-green-700" :
                            direction === "OUTFLOW" ? "text-blue-700" :
                            "text-foreground"
                          }>
                            {direction === "INFLOW" ? "+" : direction === "OUTFLOW" ? "−" : ""}
                            {fmtAmount(r.convertedAmount, "CNY")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right whitespace-nowrap ${diff.cellClass}`}>
                        {diff.display}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap bg-amber-50/30">
                        {(() => {
                          const exp = calcReviewExposure({ status: r.status, differenceAmount: r.differenceAmount, convertedAmount: r.convertedAmount, ledgerAmount: r.ledgerAmount });
                          const n = parseFloat(exp);
                          if (n === 0) return <span className="font-mono text-xs text-muted-foreground/50">0.00</span>;
                          return <span className="font-mono text-xs font-semibold text-amber-700">{n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {r.exchangeRate ? parseFloat(r.exchangeRate).toFixed(4) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-foreground">{fmt(r.ledgerVendorClient)}</div>
                        <div className="text-xs text-muted-foreground font-mono">{fmt(r.ledgerInvoiceId)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total} results
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Result Summary strip */}
          {dashboard && (() => {
            const summaryRows = dashboard.statusDistribution?.reduce((s: number, x: { count: number }) => s + x.count, 0) ?? total;
            const netBankUsd = parseFloat((dAny?.netBankAmountUsd as string) ?? "0");
            const netFlowCny = parseFloat((dAny?.netFlow as string) ?? "0");
            const totalExp = parseFloat((dAny?.totalReviewExposure as string) ?? "0");
            const fmtUsd = (n: number) => {
              const sign = n < 0 ? "−$" : "+$";
              return `${sign}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            };
            const fmtCny = (n: number) => {
              const sign = n < 0 ? "−¥" : n > 0 ? "+¥" : "¥";
              return `${sign}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            };
            const fmtCnyPlain = (n: number) => `¥${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            return (
              <div className="border border-border rounded-lg bg-muted/30 px-4 py-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2.5">Result Summary</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">Result Rows</p>
                    <p className="text-sm font-bold text-foreground font-mono">{summaryRows}</p>
                  </div>
                  <div title="Signed sum of Bank Amt (USD) across all bank-side rows. INFLOW = positive, OUTFLOW = negative.">
                    <p className="text-[10px] text-muted-foreground mb-0.5 cursor-help">Net Bank Amount <span className="text-muted-foreground/60">(USD)</span></p>
                    <p className={`text-sm font-bold font-mono ${netBankUsd >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtUsd(netBankUsd)}</p>
                  </div>
                  <div title="Total bank-side inflow converted to CNY minus total bank-side outflow converted to CNY. Matches Dashboard Net Flow.">
                    <p className="text-[10px] text-muted-foreground mb-0.5 cursor-help">Converted Net Flow <span className="text-muted-foreground/60">(CNY)</span></p>
                    <p className={`text-sm font-bold font-mono ${netFlowCny >= 0 ? "text-green-700" : "text-orange-700"}`}>{fmtCny(netFlowCny)}</p>
                  </div>
                  <div title="Sum of the Review Exposure column — amount mismatch differences + unmatched amounts + potential duplicate exposure.">
                    <p className="text-[10px] text-muted-foreground mb-0.5 cursor-help">Total Review Exposure <span className="text-muted-foreground/60">(CNY)</span></p>
                    <p className="text-sm font-bold font-mono text-amber-700">{fmtCnyPlain(totalExp)}</p>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
