import React, { useState } from "react";
import {
  useGenerateAuditSummary,
  useGenerateRecommendedActions,
  useGetBatches,
  getGetBatchesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainCircuit, AlertTriangle, ChevronDown, ChevronUp, Info, Zap, UploadCloud } from "lucide-react";
import { Link } from "wouter";

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "bg-orange-100 text-orange-800 border-orange-200",
  MEDIUM: "bg-yellow-100 text-yellow-800 border-yellow-200",
  LOW: "bg-blue-100 text-blue-800 border-blue-200",
};

const RISK_COLORS: Record<string, string> = {
  CRITICAL: "text-red-700 bg-red-50 border-red-200",
  HIGH: "text-orange-700 bg-orange-50 border-orange-200",
  MEDIUM: "text-yellow-700 bg-yellow-50 border-yellow-200",
  LOW: "text-green-700 bg-green-50 border-green-200",
};

function ErrorBanner({ message, batchExists }: { message: string; batchExists: boolean }) {
  const isNoResults = message.toLowerCase().includes("no reconciliation results");
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-orange-800">
            {isNoResults
              ? "No reconciliation results found for this batch"
              : message}
          </p>
          {(isNoResults || !batchExists) && (
            <p className="text-xs text-orange-700">
              Please load sample data or run reconciliation first before generating AI insights.
            </p>
          )}
        </div>
      </div>
      {!batchExists && (
        <div className="flex gap-2 pt-1">
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link href="/upload">Go to Upload</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AiInsightsPage() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [summaryData, setSummaryData] = useState<any>(null);
  const [actionsData, setActionsData] = useState<any>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [actionsError, setActionsError] = useState<string | null>(null);

  const { data: batches } = useGetBatches({ query: { queryKey: getGetBatchesQueryKey() } });
  const latestBatch = batches?.find(b => b.status === "reconciled");
  const hasBatch = !!latestBatch;

  const auditMutation = useGenerateAuditSummary();
  const actionsMutation = useGenerateRecommendedActions();

  const handleGenerateSummary = () => {
    if (!latestBatch?.id) return;
    setSummaryError(null);
    auditMutation.mutate({ data: { batchId: latestBatch.id } }, {
      onSuccess: (res) => setSummaryData(res),
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || "Failed to generate summary";
        setSummaryError(msg);
      },
    });
  };

  const handleGenerateActions = () => {
    if (!latestBatch?.id) return;
    setActionsError(null);
    actionsMutation.mutate({ data: { batchId: latestBatch.id } }, {
      onSuccess: (res) => setActionsData(res),
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || "Failed to generate actions";
        setActionsError(msg);
      },
    });
  };

  const toggleExpand = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  if (!hasBatch) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="max-w-sm text-center space-y-4">
          <BrainCircuit className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">No Reconciliation Data</h2>
          <p className="text-muted-foreground text-sm">
            No reconciliation results found. Please load sample data or run reconciliation first before generating AI insights.
          </p>
          <div className="flex gap-2 justify-center">
            <Button asChild>
              <Link href="/upload">
                <UploadCloud className="w-4 h-4 mr-1.5" />
                Go to Upload
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Audit Insights</h1>
        <p className="text-muted-foreground mt-1">
          AI summarizes and explains the rule engine output. All statuses, amounts, and risk classifications are determined by the deterministic rule engine — not AI.
        </p>
      </div>

      <div className="bg-muted/60 border border-border rounded-lg px-4 py-3 flex gap-3 items-start">
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">AI Governance Notice: </span>
          The AI assistant summarizes and explains structured reconciliation results. It does not override reconciliation statuses, risk levels, amounts, FX calculations, or discrepancy classifications. The rule engine is the source of truth.
        </p>
      </div>

      {latestBatch && (
        <div className="text-xs text-muted-foreground bg-muted/40 border border-border rounded px-3 py-2 flex items-center gap-2">
          <span className="font-medium text-foreground">Active batch:</span>
          <code className="font-mono">{latestBatch.id.slice(0, 16)}...</code>
          <span>·</span>
          <span>{latestBatch.bankFileName} / {latestBatch.ledgerFileName}</span>
          {latestBatch.riskScore !== undefined && latestBatch.riskScore !== null && (
            <>
              <span>·</span>
              <span>Risk Score: <span className="font-semibold">{latestBatch.riskScore}/100</span></span>
            </>
          )}
        </div>
      )}

      {/* Audit Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-primary" />
                Batch Audit Summary
              </CardTitle>
              <CardDescription>
                {summaryData
                  ? "AI-generated summary of the latest reconciliation batch"
                  : "Generate a detailed narrative summary of the reconciliation results, risk assessment, and cash flow position"}
              </CardDescription>
            </div>
            <Button
              onClick={handleGenerateSummary}
              disabled={auditMutation.isPending || !hasBatch}
              size="sm"
              title={!hasBatch ? "Run reconciliation first" : undefined}
            >
              {auditMutation.isPending
                ? "Generating..."
                : summaryData ? "Regenerate" : "Generate Summary"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {summaryError && <ErrorBanner message={summaryError} batchExists={hasBatch} />}

          {auditMutation.isPending && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {summaryData && !auditMutation.isPending && (
            <div className="space-y-6">
              <div className="prose prose-sm max-w-none">
                <div className="whitespace-pre-wrap text-sm text-foreground leading-relaxed font-mono bg-muted/40 p-4 rounded-lg border">
                  {summaryData.summary}
                </div>
              </div>

              {summaryData.highRiskExplanations?.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    High-Risk Item Explanations ({summaryData.highRiskExplanations.length})
                  </h3>
                  <div className="space-y-2">
                    {summaryData.highRiskExplanations.map((item: any, i: number) => (
                      <div key={i} className={`border rounded-lg overflow-hidden ${RISK_COLORS[item.riskLevel] || ""}`}>
                        <button
                          className="w-full flex items-center justify-between px-4 py-3 text-left"
                          onClick={() => toggleExpand(i)}
                        >
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className={`text-xs ${RISK_COLORS[item.riskLevel] || ""}`}>
                              {item.riskLevel}
                            </Badge>
                            <span className="text-xs font-mono opacity-70">Result {item.resultId?.slice(0, 8)}...</span>
                          </div>
                          {expanded.has(i) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {expanded.has(i) && (
                          <div className="px-4 pb-4 text-sm">
                            {item.explanation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Generated at {new Date(summaryData.generatedAt).toLocaleString()}</span>
                <span>·</span>
                <span>Provider: <span className="font-mono">{summaryData.provider}</span></span>
              </div>
            </div>
          )}

          {!summaryData && !auditMutation.isPending && !summaryError && (
            <p className="text-sm text-muted-foreground">
              Click <strong>Generate Summary</strong> to create a full audit narrative — including risk assessment, key findings, and cash flow position — based on the latest reconciliation batch.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recommended Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Recommended Actions
              </CardTitle>
              <CardDescription>
                {actionsData
                  ? "Practical next steps based on rule engine output"
                  : "Generate a prioritised action list for your finance team based on the reconciliation findings"}
              </CardDescription>
            </div>
            <Button
              onClick={handleGenerateActions}
              disabled={actionsMutation.isPending || !hasBatch}
              size="sm"
              variant="outline"
              title={!hasBatch ? "Run reconciliation first" : undefined}
            >
              {actionsMutation.isPending
                ? "Generating..."
                : actionsData ? "Regenerate" : "Generate Actions"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {actionsError && <ErrorBanner message={actionsError} batchExists={hasBatch} />}

          {actionsMutation.isPending && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {actionsData && !actionsMutation.isPending && (
            <div className="space-y-3">
              {actionsData.actions?.map((action: any, i: number) => (
                <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded border ${PRIORITY_COLORS[action.priority] || ""}`}>
                      {action.priority}
                    </span>
                    <span className="text-sm font-semibold text-foreground">{action.category}</span>
                    {action.affectedItems > 0 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {action.affectedItems} item{action.affectedItems !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{action.action}</p>
                </div>
              ))}
              <div className="text-xs text-muted-foreground flex items-center gap-2 pt-1">
                <span>Generated at {new Date(actionsData.generatedAt).toLocaleString()}</span>
                <span>·</span>
                <span>Provider: <span className="font-mono">{actionsData.provider}</span></span>
              </div>
            </div>
          )}

          {!actionsData && !actionsMutation.isPending && !actionsError && (
            <p className="text-sm text-muted-foreground">
              Click <strong>Generate Actions</strong> to receive a prioritised list of practical next steps for your finance team based on the reconciliation findings.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
