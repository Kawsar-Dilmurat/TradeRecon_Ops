import React, { useState } from "react";
import {
  useGenerateReport,
  useGetLatestReport,
  getGetLatestReportQueryKey,
  useGetBatches,
  getGetBatchesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Copy, Download, CheckCircle2, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function ReportPage() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [generatedBatchId, setGeneratedBatchId] = useState<string | undefined>(undefined);

  const { data: batches } = useGetBatches({ query: { queryKey: getGetBatchesQueryKey() } });
  const latestBatch = batches?.find(b => b.status === "reconciled");

  const latestReportParams = generatedBatchId ? { batchId: generatedBatchId } : {};
  const { data: existingReport, isLoading: loadingReport, refetch } = useGetLatestReport(
    latestReportParams,
    { query: { queryKey: getGetLatestReportQueryKey(latestReportParams) } }
  );

  const generateMutation = useGenerateReport();

  const handleGenerate = () => {
    if (!latestBatch?.id) return;
    generateMutation.mutate({ data: { batchId: latestBatch.id } }, {
      onSuccess: (res) => {
        setGeneratedBatchId(latestBatch.id);
        refetch();
      },
    });
  };

  const report = existingReport;
  const markdownContent = report?.markdownContent || "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdownContent);
    setCopied(true);
    toast({ title: "Copied to clipboard", description: "Report content copied." });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([markdownContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradereconops-audit-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: "Report saved as .md file." });
  };

  if (!latestBatch) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="max-w-sm text-center space-y-4">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold">No Reconciliation Data</h2>
          <p className="text-muted-foreground text-sm">Run a reconciliation first before generating a report.</p>
          <Button asChild variant="outline">
            <Link href="/upload">Go to Upload</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Audit Report</h1>
          <p className="text-muted-foreground mt-1">Generate and export an audit-ready Markdown report for this reconciliation batch.</p>
        </div>
        <div className="flex gap-2">
          {markdownContent && (
            <>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <CheckCircle2 className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download .md
              </Button>
            </>
          )}
          <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating...</>
            ) : (
              <><FileText className="w-4 h-4 mr-2" />{report ? "Regenerate" : "Generate Report"}</>
            )}
          </Button>
        </div>
      </div>

      {(loadingReport || generateMutation.isPending) && (
        <Card>
          <CardContent className="py-8 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      )}

      {report && !loadingReport && !generateMutation.isPending && (
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Audit Report</CardTitle>
                <CardDescription>
                  Generated {new Date(report.generatedAt).toLocaleString()} · Provider: <span className="font-mono">{report.provider}</span>
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleCopy}>
                  {copied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDownload}>
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="whitespace-pre-wrap font-mono text-xs text-foreground p-6 bg-muted/20 rounded-b-lg overflow-auto max-h-[70vh] leading-relaxed">
              {markdownContent}
            </pre>
          </CardContent>
        </Card>
      )}

      {!report && !loadingReport && !generateMutation.isPending && (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">No report generated yet for this batch.</p>
            <p className="text-sm text-muted-foreground">Click "Generate Report" to create an audit-ready Markdown document including AI summary and recommended actions.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
