# dsh-data-analyst

An autonomous, evidence-driven data investigation agent for [DeepSeek Harness](https://github.com/deepseek-ai). It transforms a natural-language analytical goal into **hypotheses → deterministic evidence → verified findings → a reproducible investigation report**.

## Not a normal CSV analyzer

A normal CSV analyzer (or a natural-language-to-SQL wrapper) answers a question once and returns a number. This project answers a question through an auditable chain:

- **Hypotheses are recorded before any analysis runs**, so the question being tested is fixed up front — not reverse-engineered from whatever the analysis happened to return.
- **Every number in a finding is backed by a stored evidence record** containing the exact engine request and its recorded result. A finding without evidence cannot be created (enforced at the service layer).
- **Verification is deterministic re-execution, not judgment.** The evidence's original request is re-run through the analysis engine and the recomputed result is compared to the recorded result with deep equality. No LLM ever decides whether a number is correct.
- **The report is a pure snapshot of settled state**, assembled only after the investigation completes, and rendered to Markdown by a pure function.

## Architecture

```
src/
├── formats/       Loaders: CSV, TSV, JSON/JSONL, Excel (read-only)
├── models/        Plain-JSON data models + state machine (investigation, hypothesis,
│                  evidence, finding, verification, report)
├── services/      DatasetService, InvestigationService, EvidenceService,
│                  FindingService, VerificationService, ReportService,
│                  MarkdownReportRenderer, ProfilingService
├── engines/       NativeAnalysisEngine — deterministic in-memory aggregate/compare/trend
├── tools/         8 harness tools (see below), incl. run_investigation (end-to-end agent)
├── utils/         Deterministic confidence, deep equality, ID generation, typed errors
└── index.ts       Plugin entry: constructs services, registers tools
```

Layering rule: tools orchestrate, services enforce invariants, the engine computes. Services never generate hypotheses or interpret data; the report layer never runs analysis.

## Supported formats

`.csv`, `.tsv`, `.json`, `.jsonl`, `.xlsx`, `.xls` — dispatched by file extension through a loader registry. Loaders only read files.

## Investigation workflow

`run_investigation` executes the full pipeline in one call:

1. **Load & profile** the dataset (`inspect_dataset` semantics: schema, types, stats, sample).
2. **Create** an investigation for the goal (`planning → investigating`).
3. **Parse intent** from the goal (compare / trend / aggregate; metric, group column, named groups, time period).
4. **Generate hypotheses BEFORE analysis** and record them (`proposed → testing`).
5. **Run deterministic analyses** (aggregate / compare / trend) through the engine.
6. **Record evidence** — each engine request + result is stored verbatim.
7. **Evaluate each hypothesis from the evidence** (supported / rejected / inconclusive), never merely because execution succeeded.
8. **Record a finding** — a factual claim referencing ≥1 evidence IDs, all validated to exist and belong to this investigation.
9. **Verify the finding** by re-executing the evidence through the engine (`verifying`).
10. **Complete** the investigation, then assemble the **structured report** and render the **Markdown report** (`completed`).

State machine (unchanged, `src/models/investigation.ts`):

```
planning → investigating → verifying → completed
any non-terminal state → failed        (partial evidence preserved)
```

## Evidence & verification model

An evidence record is `{ id, investigationId, type, operation, input, result, createdAt }` where `input`/`result` are the exact deterministic engine request/response.

Verification checks, as distinct concepts: evidence **exists**, is **structurally valid**, **belongs to the same investigation**, is **reproducible**, and **matches** its recomputed result:

| Outcome | Meaning |
|---|---|
| `verified` | All evidence re-executed and matched (deep equality) |
| `rejected` | Missing/invalid/cross-investigation evidence, or a mismatch |
| `unverified` | Valid evidence that cannot be re-executed — never silently upgraded |

Confidence is a pure deterministic function of evidence availability and hypothesis support (`src/utils/confidence.ts`) — explicitly not model certainty.


## Example

Goal (fixture `tests/fixtures/sample.csv`, 6 rows):

```
Compare Jakarta vs Surabaya revenue
```

What the pipeline produces:

- **Intent:** compare, metric `revenue`, group `region`, named groups `Jakarta` / `Surabaya`.
- **Hypothesis (recorded before analysis):** `H1 — Jakarta revenue is higher than Surabaya revenue.` (directional, falsifiable)
- **Evidence:** `compare` request `{ groupColumn: region, valueColumn: revenue, func: mean, baseGroup: Jakarta, compareGroup: Surabaya }` → recorded result:
  - Jakarta mean = **147500.25**, Surabaya mean = **225000.375**
  - difference = 77500.125, percentage = **52.542368572256656%**
- **Finding:** `Surabaya revenue was 52.5% higher than Jakarta (mean 225000.38 vs 147500.25).`
  - The hypothesis `Jakarta > Surabaya` is **rejected** by the evidence — the numbers decide, not the phrasing of the goal.
- **Verification:** `verified` — `All 1 evidence record(s) were reproduced deterministically and match the recorded results`.
- **Report:** the result carries `report.structured` (JSON snapshot: investigation, hypotheses, evidence, findings, verification counts, summary, limitations) and `report.markdown`:

```markdown
# Investigation Report

## Goal

Compare Jakarta vs Surabaya revenue

## Hypotheses

### H1 — Rejected

Jakarta revenue is higher than Surabaya revenue.

## Evidence

### E1 — comparison

- Base group: Jakarta
- Base value: 147500.25
- Compare group: Surabaya
- Compare value: 225000.375
- Difference: 77500.125
- Percentage difference: 52.542368572256656%

## Findings

### 1. Surabaya revenue was 52.5% higher than Jakarta (mean 225000.38 vs 147500.25).

Confidence: 0.17
Verification: Verified

## Verification

- Findings: 1
- Verified: 1
- Rejected: 0
- Unverified: 0
```

## Security model

- **No code execution:** no `child_process`, `eval`, dynamic `Function`, or generated Python anywhere in `src/`. Analyses are plain in-memory TypeScript.
- **Read-only:** loaders use `fs.readFile` only; `src/` contains no file writes. The engine operates on loaded rows without mutating them.
- **No network:** no HTTP clients or outbound requests; all computation is local.
- **Deterministic verification:** the LLM (reasoning layer) proposes goals and reads results; it never judges numerical correctness — correctness is engine re-execution + deep equality.
- **Paths:** file paths are passed straight to the OS file APIs with the host process's permissions; the plugin reads only the file it is pointed at. No path is used to construct commands.

## Current limitations

- **Heuristic intent parsing.** Goal parsing is keyword-based (compare / trend / aggregate), not LLM-driven. Unusual phrasings fall back to low-confidence aggregate intent.
- **No time-period filtering.** The trend engine cannot filter to a requested period (e.g. "Q3"); when a period is requested, the claim and hypothesis explicitly say the full data range was analyzed instead of silently presenting period-specific numbers.
- **Named groups absent from the dataset** are not compared: validation drops them and the run falls back to a non-directional comparison of groups discovered in the data. The finding always describes the groups actually compared.
- **No statistical significance testing.** Differences are descriptive (means, percentage deltas), not inferential.
- **In-memory state.** Investigations/evidence/findings live for the process lifetime; no persistence layer.
- **One finding per `run_investigation` call**, synthesized from the tested hypotheses' evidence.
- **Evidence outside `aggregate`/`compare`/`trend`** cannot be re-executed, so findings on it stay `unverified` rather than being approximated.

## Running

```bash
npm install
npm test          # vitest: 181 tests across 16 files
npm run lint      # tsc --noEmit (strict, exactOptionalPropertyTypes)
npm run build     # tsc → dist/
```

As a harness plugin the package exports `{ name, inject: ["tools"], apply(ctx) }`; `apply` constructs the services and registers 8 tools:

`inspect_dataset` · `start_investigation` · `get_investigation` · `record_evidence` · `record_finding` · `verify_finding` · `get_finding` · `run_investigation`
