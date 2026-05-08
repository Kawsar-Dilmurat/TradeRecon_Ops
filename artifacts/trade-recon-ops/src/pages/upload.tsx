import React, { useState, useRef, useEffect } from "react";
import { useUploadBankStatement, useUploadLedger, useRunReconciliation } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Upload, FileText, CheckCircle2, AlertCircle, ChevronRight,
  Settings, ChevronDown, ChevronUp, Database,
} from "lucide-react";
import { useLocation } from "wouter";

const OPENING_BALANCE_KEY = "tradeReconOps_openingBalance";

const SAMPLE_DATASETS = [
  {
    id: "high_risk",
    label: "High Risk Batch",
    description: "Includes matched rows, FX variance, amount mismatches, duplicate, unmatched bank, and unmatched ledger.",
    bankFile: "bank_statement_high_risk.csv",
    ledgerFile: "internal_ledger_high_risk.csv",
    bankRows: 9,
    ledgerRows: 8,
  },
  {
    id: "cleaner",
    label: "Cleaner Batch",
    description: "Mostly matched transactions with lower review exposure and lower risk score.",
    bankFile: "bank_statement_cleaner.csv",
    ledgerFile: "internal_ledger_cleaner.csv",
    bankRows: 8,
    ledgerRows: 7,
  },
] as const;

type DatasetId = typeof SAMPLE_DATASETS[number]["id"];

interface UploadResult {
  batchId: string;
  rowCount: number;
  fileName: string;
  uploadType: string;
  errors: string[];
  warnings: string[];
}

function DropZone({
  label, description, required_cols, result, onFile, loading,
}: {
  label: string; description: string; required_cols: string;
  result: UploadResult | null; onFile: (file: File) => void; loading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-5 transition-all cursor-pointer ${
        dragging ? "border-primary bg-primary/5"
          : result ? "border-green-500 bg-green-50/60"
          : "border-border hover:border-primary/50"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept=".csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <div className="flex items-center gap-4">
        <div className={`p-2.5 rounded-lg shrink-0 ${result ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground"}`}>
          {result ? <CheckCircle2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm text-foreground">{label}</span>
            {loading && <span className="text-xs text-muted-foreground animate-pulse">Uploading...</span>}
            {result && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">{result.rowCount} rows</span>}
          </div>
          {result ? (
            <p className="text-xs text-green-700 font-medium truncate">{result.fileName}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-1">{description}</p>
              <p className="text-[10px] font-mono text-muted-foreground/70">{required_cols}</p>
            </>
          )}
          {result?.errors?.map((e, i) => (
            <div key={i} className="mt-1 text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />{e}
            </div>
          ))}
        </div>
        {!result
          ? <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
          : <button className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 px-1"
              onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Replace</button>
        }
      </div>
    </div>
  );
}

function CollapsibleHelp({ trigger, children }: { trigger: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {trigger}
      </button>
      {open && (
        <div className="mt-2 ml-4 text-xs text-muted-foreground space-y-1.5 border-l border-border pl-3">
          {children}
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  const [, navigate] = useLocation();
  const [bankResult, setBankResult] = useState<UploadResult | null>(null);
  const [ledgerResult, setLedgerResult] = useState<UploadResult | null>(null);
  const [selectedDataset, setSelectedDataset] = useState<DatasetId>("high_risk");
  const [loadedDataset, setLoadedDataset] = useState<DatasetId | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [fuzzyThreshold, setFuzzyThreshold] = useState(80);
  const [dateWindow, setDateWindow] = useState(3);
  const [fxVariancePct, setFxVariancePct] = useState(0.5);
  const [openingBalance, setOpeningBalance] = useState("100000.00");
  const [showSettings, setShowSettings] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(OPENING_BALANCE_KEY);
    if (stored) setOpeningBalance(stored);
  }, []);

  const bankUpload = useUploadBankStatement();
  const ledgerUpload = useUploadLedger();
  const reconcile = useRunReconciliation();

  const handleBankFile = (file: File) => {
    setLoadedDataset(null);
    const fd = new FormData(); fd.append("file", file);
    bankUpload.mutate({ data: fd as any }, { onSuccess: (res) => setBankResult(res as UploadResult) });
  };

  const handleLedgerFile = (file: File) => {
    setLoadedDataset(null);
    const fd = new FormData(); fd.append("file", file);
    ledgerUpload.mutate({ data: fd as any }, { onSuccess: (res) => setLedgerResult(res as UploadResult) });
  };

  const handleLoadSamples = async () => {
    setSampleLoading(true);
    setReconcileError(null);
    try {
      const res = await fetch(`/api/demo/load-samples?dataset=${selectedDataset}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail?.error || "Failed to load sample data");
      }
      const data = await res.json();
      setBankResult({ batchId: data.bankBatchId, rowCount: data.bankRows, fileName: data.bankFileName, uploadType: "bank", errors: [], warnings: [] });
      setLedgerResult({ batchId: data.ledgerBatchId, rowCount: data.ledgerRows, fileName: data.ledgerFileName, uploadType: "ledger", errors: [], warnings: [] });
      setLoadedDataset(selectedDataset);
    } catch (e: any) {
      setReconcileError(e?.message || "Failed to load sample data");
    } finally {
      setSampleLoading(false);
    }
  };

  const handleReconcile = () => {
    if (!bankResult || !ledgerResult) return;
    setReconcileError(null);
    reconcile.mutate({
      data: {
        bankBatchId: bankResult.batchId,
        ledgerBatchId: ledgerResult.batchId,
        settings: { fuzzyThreshold, dateWindowDays: dateWindow, fxVariancePct, fxVarianceAbs: 50 }
      }
    }, {
      onSuccess: () => navigate("/results"),
      onError: (err: any) => setReconcileError(err?.data?.error || "Reconciliation failed"),
    });
  };

  const loadedMeta = loadedDataset ? SAMPLE_DATASETS.find(d => d.id === loadedDataset) : null;
  const canReconcile = !!(bankResult && ledgerResult && !reconcile.isPending);

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Upload Data</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload your CSV files or load a sample dataset, then click Run Reconciliation.
        </p>
      </div>

      {/* Sample dataset selector */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Choose sample dataset</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SAMPLE_DATASETS.map((ds) => (
            <button
              key={ds.id}
              onClick={() => setSelectedDataset(ds.id)}
              className={`text-left rounded-lg border p-3 transition-all ${
                selectedDataset === ds.id
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border hover:border-primary/40 bg-background"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <p className="text-sm font-semibold text-foreground">{ds.label}</p>
                {selectedDataset === ds.id && (
                  <span className="text-[10px] font-bold tracking-wide text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded shrink-0">
                    Selected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{ds.description}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1.5 font-mono">
                {ds.bankRows} bank txns · {ds.ledgerRows} ledger records
              </p>
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLoadSamples}
          disabled={sampleLoading}
          className="gap-1.5"
        >
          {sampleLoading
            ? <><span className="w-3 h-3 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin" />Loading...</>
            : <><Database className="w-3.5 h-3.5" />Load Selected Sample CSVs</>
          }
        </Button>
      </div>

      {/* Success / loaded state */}
      {loadedMeta && (
        <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 px-4 py-3 rounded-lg">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">{loadedMeta.label} loaded.</span>
            {" "}Click <strong>Run Reconciliation</strong> to process the batch.
            <div className="text-[11px] text-green-600 mt-0.5 font-mono space-y-0.5">
              <div>Bank: {loadedMeta.bankFile}</div>
              <div>Ledger: {loadedMeta.ledgerFile}</div>
            </div>
          </div>
        </div>
      )}

      {/* Help */}
      <CollapsibleHelp trigger="Need help understanding these files?">
        <p><span className="font-medium text-foreground">Bank Statement:</span> What actually happened in the bank account — money received or paid.</p>
        <p><span className="font-medium text-foreground">Internal Ledger:</span> What the company recorded internally — customer/vendor, invoice, category, and expected amount.</p>
        <p><span className="font-medium text-foreground">Reconciliation:</span> The system compares bank activity against internal records to find matches, FX variance, missing records, duplicates, and mismatches.</p>
      </CollapsibleHelp>

      {/* Upload zones */}
      <div className="space-y-3">
        <DropZone
          label="Bank Statement (USD)"
          description="USD bank statement export"
          required_cols="date · description · amount · currency · type · reference"
          result={bankResult}
          onFile={handleBankFile}
          loading={bankUpload.isPending}
        />
        <div className="pl-1">
          <CollapsibleHelp trigger="What does the type column mean?">
            <p>From the company bank account perspective:</p>
            <p><code className="bg-muted px-1 rounded font-mono text-green-700">credit</code> — money <strong>received into</strong> the account (INFLOW)</p>
            <p><code className="bg-muted px-1 rounded font-mono text-blue-700">debit</code> — money <strong>paid out from</strong> the account (OUTFLOW)</p>
            <p className="text-muted-foreground/70">Direction is used for Cash Flow &amp; Balance reporting. It does not replace reconciliation matching.</p>
            <details className="mt-1">
              <summary className="cursor-pointer hover:text-foreground">Show example CSV</summary>
              <pre className="bg-muted rounded p-2 font-mono text-[10px] overflow-x-auto leading-relaxed mt-1 whitespace-pre">
{`date,description,amount,currency,type,reference
2026-05-01,Wire from Apex Trading,1000,USD,credit,BANK-001
2026-05-03,Payment to Sunrise Freight,500,USD,debit,BANK-003`}
              </pre>
            </details>
          </CollapsibleHelp>
        </div>
        <DropZone
          label="Internal Ledger (CNY)"
          description="Internal accounting ledger with CNY entries"
          required_cols="date · vendor_or_client · amount · currency · invoice_id · category"
          result={ledgerResult}
          onFile={handleLedgerFile}
          loading={ledgerUpload.isPending}
        />
      </div>

      {/* Settings */}
      <Card className="shadow-none">
        <CardHeader className="pb-2 pt-4 px-4">
          <button className="flex items-center justify-between w-full text-left"
            onClick={() => setShowSettings(!showSettings)}>
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Reconciliation Settings</CardTitle>
            </div>
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${showSettings ? "rotate-90" : ""}`} />
          </button>
        </CardHeader>
        {showSettings && (
          <CardContent className="space-y-5 px-4 pb-4">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2 text-xs text-blue-800">
              <p><strong>Fuzzy Match Threshold:</strong> How similar descriptions must be to count as a match. Higher = stricter.</p>
              <p><strong>Date Window:</strong> How many days apart bank and ledger dates can be and still match.</p>
              <p><strong>FX Variance Tolerance:</strong> Small conversion differences below this % are FX Variance, not a real mismatch.</p>
              <p><strong>Opening Balance:</strong> Starting CNY balance — used on Dashboard to show expected ending balance.</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between"><Label className="text-xs">Fuzzy Match Threshold</Label><span className="text-xs font-mono font-semibold text-primary">{fuzzyThreshold}</span></div>
              <Slider min={50} max={100} step={5} value={[fuzzyThreshold]} onValueChange={([v]) => setFuzzyThreshold(v)} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between"><Label className="text-xs">Date Window</Label><span className="text-xs font-mono font-semibold text-primary">±{dateWindow} days</span></div>
              <Slider min={0} max={14} step={1} value={[dateWindow]} onValueChange={([v]) => setDateWindow(v)} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between"><Label className="text-xs">FX Variance Tolerance</Label><span className="text-xs font-mono font-semibold text-primary">{fxVariancePct}%</span></div>
              <Slider min={0.1} max={5} step={0.1} value={[fxVariancePct]} onValueChange={([v]) => setFxVariancePct(parseFloat(v.toFixed(1)))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opening-balance" className="text-xs">Opening Balance (CNY)</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">¥</span>
                <Input id="opening-balance" type="number" step="0.01" min="0" value={openingBalance}
                  onChange={(e) => { setOpeningBalance(e.target.value); localStorage.setItem(OPENING_BALANCE_KEY, e.target.value); }}
                  className="font-mono h-8 text-sm" placeholder="100000.00" />
              </div>
              <p className="text-xs text-muted-foreground">Used on the Dashboard to calculate expected ending balance.</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Error */}
      {reconcileError && (
        <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />{reconcileError}
        </div>
      )}

      {/* Run Reconciliation */}
      <Button className="w-full" size="lg" disabled={!canReconcile} onClick={handleReconcile}>
        {reconcile.isPending ? "Running Reconciliation..." : "Run Reconciliation"}
        <ChevronRight className="ml-2 w-4 h-4" />
      </Button>

      {!canReconcile && !reconcile.isPending && (
        <p className="text-center text-xs text-muted-foreground">
          {!bankResult && !ledgerResult ? "Load a sample dataset or upload both files to continue"
            : !bankResult ? "Upload the bank statement to continue"
            : "Upload the internal ledger to continue"}
        </p>
      )}

    </div>
  );
}
