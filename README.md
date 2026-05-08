# TradeReconOps

A cross-border reconciliation and audit platform for comparing USD bank transactions with CNY internal ledger records.

TradeReconOps is built around a practical finance operations problem in international trade: bank statements and internal ledger records often differ because of currency conversion, settlement timing, inconsistent descriptions, missing records, and exchange-rate assumptions.

The app helps classify reconciliation results into matched transactions, acceptable FX variance, real amount discrepancies, unmatched records, and possible duplicate transactions. It also calculates review exposure, tracks cash flow impact, and generates audit-oriented summaries and reports.

---

## Why I Built This

I wanted to build a portfolio project that connects my background in international trade and finance operations with backend development, data processing, and audit workflow design.

Instead of building a generic dashboard, TradeReconOps focuses on a real reconciliation workflow:

- Compare USD bank statement records against CNY internal ledger records
- Convert USD transactions into CNY using transaction-level FX rates
- Separate acceptable FX variance from real accounting discrepancies
- Calculate review exposure for transactions that require analyst attention
- Track cash flow and expected ending balance separately from reconciliation risk
- Generate audit-oriented summaries and recommended actions

---

## Key Features

### Cross-Border Reconciliation

TradeReconOps reconciles USD bank activity against CNY internal ledger records. Bank-side transactions remain in USD, while converted amounts and comparison differences are expressed in CNY for ledger matching.

The reconciliation engine classifies rows into:

- Matched
- FX Variance
- Amount Mismatch
- Possible Duplicate
- Unmatched Bank
- Unmatched Ledger

### Rule-Based Reconciliation Engine

The core financial logic is deterministic. Transaction status, FX conversion, risk level, review exposure, and cash flow are calculated by the rule engine.

AI is used only to summarize and explain the results. It does not override financial classifications, amounts, FX calculations, or risk levels.

### Review Exposure

The app calculates review exposure to show how much money still requires analyst review.

Review exposure includes:

- Amount mismatch differences
- Unmatched bank transactions converted to CNY
- Unmatched ledger records
- Potential duplicate exposure

FX variance within tolerance is tracked separately and is not included in review exposure.

### Risk Scoring

Each reconciliation batch receives a risk score based on the number and severity of review items, including mismatches, unmatched records, possible duplicates, critical-risk items, and FX variance.

The dashboard highlights:

- Batch risk level
- Priority review queue
- Critical and high-risk items
- Top risk driver
- Total review exposure

### Cash Flow and Balance

TradeReconOps separates reconciliation risk from actual money movement.

Cash flow is calculated from bank-side transactions:

- Total inflow
- Total outflow
- Net flow
- Opening balance
- Expected ending balance

This makes it clear that cash movement and reconciliation exposure are related but not the same.

### AI Audit Insights

The AI Audit Insights page generates:

- Batch audit summary
- Key findings
- Risk assessment
- Cash flow position
- Recommended actions

If no external AI key is provided, the app can use a deterministic mock AI provider for demo-ready audit summaries.

### Audit Report Export

The app generates a Markdown audit report that includes:

- Batch summary
- Financial exposure breakdown
- Cash flow and balance summary
- FX variance summary
- Real discrepancy summary
- Risk score formula
- AI audit summary
- Recommended actions

---

## Sample Datasets

The app includes two sample reconciliation datasets for demonstration.

### High Risk Batch

A higher-risk batch that includes amount mismatches, unmatched records, and a possible duplicate transaction. This dataset is useful for demonstrating the Priority Review Queue, higher risk score, and larger review exposure.

### Cleaner Batch

A lower-risk batch with more matched transactions and fewer review items. This dataset is useful for showing how the dashboard, results table, risk score, and report update when reconciliation quality improves.

Sample CSV files are stored in:

```text
artifacts/api-server/sample_data/
```

Main demo files:

| Demo Batch | Bank Statement | Internal Ledger |
|---|---|---|
| High Risk Batch | `bank_statement_high_risk.csv` | `internal_ledger_high_risk.csv` |
| Cleaner Batch | `bank_statement_cleaner.csv` | `internal_ledger_cleaner.csv` |

---

## Screenshots

Add screenshots to a `screenshots/` folder and update the image paths below.

### Dashboard
<img width="2559" height="1252" alt="Dashboard-1" src="https://github.com/user-attachments/assets/f6696dfa-8cb2-40a0-9151-4813b934f786" />
<img width="2530" height="1390" alt="Dashboard_2" src="https://github.com/user-attachments/assets/e7be32dd-c8cd-43ad-9c43-2b173824b801" />



### Upload Data

<img width="2559" height="1055" alt="Upload_Data" src="https://github.com/user-attachments/assets/dd43eccc-5664-488b-879e-1430878f3761" />

### Reconciliation Results

<img width="2557" height="1289" alt="Reconciliation Results" src="https://github.com/user-attachments/assets/d5a6bd49-5ab6-4a53-9caf-5b55f648797c" />

### AI Audit Insights

<img width="2486" height="1427" alt="AI Audit Insights" src="https://github.com/user-attachments/assets/7d5fb3af-2a9b-4a31-a0b6-e3763cb58ea1" /><img width="2521" height="1425" alt="AI Audit Insights_2" src="https://github.com/user-attachments/assets/0ba7760d-fac3-43cf-8371-753ac4bcdc4a" />


### Audit Report Export

<img width="2559" height="1280" alt="Export Report" src="https://github.com/user-attachments/assets/ed87e7a7-04c2-4d71-a743-0a92fb645087" />

---

## Tech Stack

### Frontend

- React
- Vite
- Tailwind CSS
- Wouter
- TanStack Query

### Backend

- Python
- FastAPI
- PostgreSQL
- Pandas
- RapidFuzz
- Pydantic

### AI Summary Layer

- OpenAI-compatible provider support
- Built-in mock AI provider for local demos without an API key

### Data Processing

- CSV upload and parsing
- FX conversion logic
- Rule-based reconciliation classification
- Review exposure calculation
- Markdown report generation

---

## Architecture

```text
React / Vite Frontend
        |
        | REST API calls
        v
FastAPI Backend
        |
        |-- Upload and sample data routes
        |-- Reconciliation engine
        |-- FX rate service
        |-- Dashboard aggregation
        |-- Results API
        |-- AI audit summary service
        |-- Report generation
        v
PostgreSQL Database
```

---

## Project Structure

```text
.
├── artifacts/
│   ├── api-server/
│   │   ├── main.py
│   │   ├── routes/
│   │   ├── sample_data/
│   │   └── requirements.txt
│   └── trade-recon-ops/
│       ├── src/
│       ├── package.json
│       └── vite.config.ts
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── package.json
└── README.md
```

---

## How to Run Locally

### Prerequisites

Install the following tools before running the project locally:

- Python 3.11+
- Node.js 24+
- pnpm
- PostgreSQL

### 1. Clone the repository

```bash
git clone <repo-url>
cd <repo-folder>
```

### 2. Install dependencies

Install Node workspace dependencies:

```bash
pnpm install
```

Install Python backend dependencies:

```bash
pip install -r artifacts/api-server/requirements.txt
```

### 3. Configure environment variables

Create a `.env` file inside `artifacts/api-server/`, or export the variables in your shell.

Required:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/tradereconops
```

Optional:

```bash
OPENAI_API_KEY=sk-...
```

`OPENAI_API_KEY` is optional. If it is not provided, the app uses the built-in mock AI provider for audit summaries.

### 4. Start the backend

From the project root:

```bash
uvicorn main:app --host 0.0.0.0 --port 8080 --reload --app-dir artifacts/api-server
```

The API will be available at:

```text
http://localhost:8080/api
```

### 5. Start the frontend

From the project root:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/trade-recon-ops run dev
```

The frontend will be available at:

```text
http://localhost:5173
```

### 6. Local API proxy

When running locally, the frontend needs `/api` requests to reach the FastAPI backend at `http://localhost:8080`.

If needed, add a Vite proxy in `artifacts/trade-recon-ops/vite.config.ts`:

```ts
server: {
  proxy: {
    "/api": "http://localhost:8080"
  }
}
```

### 7. Run the demo workflow

1. Open the frontend in the browser
2. Go to the Upload Data page
3. Select either High Risk Batch or Cleaner Batch
4. Load the sample CSVs
5. Run reconciliation
6. Review the Dashboard and Results pages
7. Generate AI Audit Insights
8. Export the Markdown audit report

---

## CSV Data Model

### Bank Statement CSV

Required fields:

```text
date, description, amount, currency, type, reference
```

Example:

```csv
2026-06-01,Wire from Pacific Components,1500,USD,credit,BNKB-001
2026-06-03,Payment to WestBridge Retail,500,USD,debit,BNKB-003
```

The `type` field is interpreted from the company bank account perspective:

- `credit` = money received into the account, shown as INFLOW
- `debit` = money paid out from the account, shown as OUTFLOW

### Internal Ledger CSV

Required fields:

```text
date, vendor_or_client, amount, currency, invoice_id, category
```

Example:

```csv
2026-06-01,Pacific Components,10862.25,CNY,INV-B001,Revenue
2026-06-03,WestBridge Retail,3617.50,CNY,INV-B003,Expense
```

---

## Reconciliation Logic

A USD bank transaction is converted into CNY using the transaction-date FX rate.

```text
Converted Amount = Bank Amount × FX Rate
Difference = Converted Amount - Ledger Amount
```

If the difference is small and within tolerance, the item is classified as FX Variance.

If the difference exceeds tolerance, the item is classified as Amount Mismatch and included in review exposure.

### FX Variance Tolerance

FX variance tolerance prevents normal exchange-rate and rounding differences from becoming false exceptions.

Example:

```text
Converted Amount: ¥10,862.25
Ledger Amount:    ¥10,854.35
Difference:       ¥7.90
```

If this difference is within tolerance, the transaction is classified as FX Variance instead of Amount Mismatch.

---

## Review Exposure Calculation

Review exposure is calculated at the row level and then summarized at the batch level.

| Status | Review Exposure Contribution |
|---|---|
| Matched | 0.00 |
| FX Variance | 0.00 |
| Amount Mismatch | Absolute difference amount |
| Unmatched Bank | Converted bank amount |
| Unmatched Ledger | Ledger amount |
| Possible Duplicate | Converted bank amount |

This lets the dashboard total be traced back to individual rows in the Results table.

---

## API Overview

The FastAPI backend exposes routes under `/api`, including:

| Area | Purpose |
|---|---|
| `/api/upload` | Upload bank and ledger CSV files |
| `/api/reconcile` | Run reconciliation logic |
| `/api/dashboard` | Retrieve dashboard metrics |
| `/api/results` | Retrieve reconciliation result rows |
| `/api/ai` | Generate AI audit summaries and actions |
| `/api/reports` | Generate and retrieve audit reports |
| `/api/demo` | Load built-in sample datasets |
| `/api/fx` | Retrieve FX rate data |

---

## What This Project Demonstrates

- Backend API design with FastAPI
- CSV-based financial data processing
- Cross-currency reconciliation logic
- FX variance handling
- Rule-based risk classification
- Review exposure calculation
- Cash flow and balance reporting
- AI-assisted but rule-grounded audit summaries
- Markdown audit report generation
- Business domain understanding in international trade and finance operations

---

## Future Improvements

- User authentication and role-based access control
- Persistent audit logs for reconciliation actions
- Configurable base currency and reporting currency
- More advanced FX rate source integration
- Expanded matching rules for invoice numbers and references
- Background processing for large CSV files
- Cloud file storage for uploaded bank and ledger files
- Deployment-ready Docker configuration
- CI/CD pipeline for backend tests and frontend build validation

---

## Notes

This is a portfolio project built with sample reconciliation data. It is not intended for production financial use without additional controls such as authentication, audit logs, formal validation, secure file storage, and compliance review.

All financial statuses, amounts, risk levels, and FX calculations are determined by the deterministic rule engine. AI-generated summaries are used only to explain the rule-engine output.
