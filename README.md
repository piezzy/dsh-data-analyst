# dsh-data-analyst

Autonomous, evidence-driven data investigation for DeepSeek Harness. It transforms a natural-language analytical goal into **hypotheses → deterministic evidence → verified findings → a reproducible investigation report**.

## Not a normal CSV analyzer

A normal CSV analyzer (or a natural-language-to-SQL wrapper) answers a question once and returns a number. This project answers a question through an auditable chain:

- **Hypotheses are recorded before any analysis runs**, so the question being tested is fixed up front — not reverse-engineered from whatever the analysis happened to return. (Seed hypotheses; bounded follow-up refinements reference their parent explicitly.)
- **Every number in a finding is backed by a stored evidence record** containing the exact engine request and its recorded result. A finding without evidence cannot be created (enforced at the service layer).
- **Verification is deterministic re-execution, not judgment.** The evidence's original request is re-run through the analysis engine and the recomputed result is compared to the recorded result with deep equality. No LLM ever decides whether a number is correct.
- **The report is a pure snapshot of settled state**, assembled only after the investigation completes, and rendered to Markdown by a pure function.

## Responsibilities

| Layer | Role | Never does |
|---|---|---|
| LLM (policy/planning) | Proposes the next loop step: `STOP` / `TEST_NEXT` / `REFINE` | Authors analysis code, computes numbers, mutates state |
| Deterministic engine | `aggregate` / `compare` / `trend` over loaded rows | Interprets results, judges correctness |
| Evidence layer | Stores every request + result verbatim per round | Invents data |
| Verification | Re-executes evidence, compares with deep equality | Validates statistics or the engine itself |
| Report | Snapshots settled investigation state to JSON + Markdown | Runs analysis, adds conclusions |

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
├── loop/          InvestigationPolicy seam, deterministic + LLM policies,
│                  bounded prompt/evidence summaries
│   └── providers/ DeepSeekClient — optional native-fetch adapter (no SDK)
├── tools/         10 harness tools (see below), incl. run_investigation (end-to-end agent)
├── utils/         Deterministic confidence, deep equality, ID generation, typed errors
└── index.ts       Plugin entry: constructs services, registers tools
```

Layering rule: tools orchestrate, services enforce invariants, the engine computes, the policy only chooses the next step. Services never generate hypotheses or interpret data; the report layer never runs analysis.

## Supported formats

`.csv`, `.tsv`, `.json`, `.jsonl`, `.xlsx`, `.xls` — dispatched by file extension through a loader registry. Loaders only read files; the source dataset is never mutated.

## Investigation workflow

`run_investigation` executes the full pipeline in one call:

1. **Load & profile** the dataset (`inspect_dataset` semantics: schema, types, stats, sample).
2. **Create** an investigation for the goal (`planning → investigating`).
3. **Parse intent** from the goal (compare / trend / aggregate; metric, group column, named groups, time period).
4. **Generate seed hypotheses BEFORE analysis** and record them (`proposed → testing`).
5. **Run deterministic analyses** (aggregate / compare / trend) through the engine.
6. **Record evidence** — each engine request + result is stored with `{round, hypothesisId}` metadata.
7. **Evaluate each hypothesis from the evidence** (supported / rejected / inconclusive), never merely because execution succeeded.
8. **Ask the policy** whether to test the next seed, refine once, or stop — then repeat from step 5 while plans remain and budgets allow.
9. **Record a finding** — a factual claim referencing ≥1 evidence IDs, all validated to exist and belong to this investigation.
10. **Verify the finding** by re-executing the evidence through the engine (`verifying`).
11. **Complete** the investigation, then assemble the **structured report** and render the **Markdown report** (`completed`).

State machine (`src/models/investigation.ts`):

```
planning → investigating → verifying → completed
any non-terminal state → failed        (partial evidence preserved)
```

## Autonomous loop (policy)

The loop driver drains a queue of hypothesis plans inside a fixed budget:

- `InvestigationPolicy.decide(ctx)` returns data only: `STOP` | `TEST_NEXT` | `REFINE` (`DESCRIPTIVE_FALLBACK` | `GROUP_DISTRIBUTION`).
- `DeterministicInvestigationPolicy` is the default: pending seeds first, one follow-up per inconclusive hypothesis, stop on support, terminal states, or budget.
- Bounds: `max_rounds` (default 5), `max_evidence` (default 12), plus a no-progress stop. A refinement that is itself inconclusive ends its chain.
- Refinements never mutate history: the follow-up is a new `H(n+1)` whose rationale names its parent (e.g. `Refines H1 based on evidence from round 1`).
- The LLM policy Tier 1 chooses only the strategy; deterministic code builds every analysis request from the dataset profile and recorded evidence. There is no mechanism for model-authored queries, SQL, Python, or shell.

## Evidence & verification model

An evidence record is `{ id, investigationId, type, operation, input, result, createdAt }` where `input`/`result` are the exact deterministic engine request/response (plus additive `{round, hypothesisId}` the engine ignores and verification replays identically).

Verification checks, as distinct concepts: evidence **exists**, is **structurally valid**, **belongs to the same investigation**, is **reproducible**, and **matches** its recomputed result:

| Outcome | Meaning |
|---|---|
| `verified` | All evidence re-executed and matched (deep equality) |
| `rejected` | Missing/invalid/cross-investigation evidence, or a mismatch |
| `unverified` | Valid evidence that cannot be re-executed — never silently upgraded |

Verification proves **reproducibility and matching** — that the recorded result is exactly what the engine deterministically recomputes. It does not prove the engine itself correct and performs no statistical validation.

Confidence is a pure deterministic function of evidence availability and hypothesis support (`src/utils/confidence.ts`: `0.5·min(n/3,1) + 0.5·supported/linked`, rounded to 2 decimals) — explicitly not model certainty.

## Example: 6-row rejection case

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

## Example: realistic E2E (`sales-2024.csv`)

Deterministic seed-42 fixture, **1,020 rows**: `date, region (North/South/East/West), product (Widget A/B/C), revenue, quantity` — with **24 missing revenue values**, **16 missing quantity values**, and **20 duplicate rows**. Overall mean revenue per order row is **102777.94** (min 54499.15, max 154739.16).

Three end-to-end `run_investigation` runs, each completing with `verified` findings and a full report:

- **Compare (regions):** `Compare North vs South revenue` → North mean **123097.6** vs South mean **83853.08** — North **31.9% higher**. Verified.
- **Aggregate (product mix):** `What is the average revenue by product?` → Widget A **112949.53**, Widget B **100865.24**, Widget C **94501.82**; by region 83853.08 (South) to 123097.6 (North). Verified.
- **Trend (time):** `Show the revenue trend over time` → **366 daily periods**, 2024-01-01 mean **100132.64** to 2024-12-31 mean **106425.22** (1.5% higher overall). Verified.
- **Quantity (descriptive):** mean quantity per row by region is nearly flat — North **97.7**, South **101.1**, East **97.8**, West **100.1**; by product, A **102.5**, B **93.6**, C **101.3**. No material regional difference is claimed, and none is inferred.

Revenue-per-order explanation: revenue is recorded per order row, so group means are per-row averages. The North–South gap is a **described mean difference, not an explained mechanism**: price, discount, and channel fields do not exist in this dataset, so no decomposition is possible and none is attempted. The analysis is **descriptive throughout — no statistical inference is performed**.

## DSH Desktop integration

The plugin runs inside the actual DeepSeek Harness Desktop runtime (**0.2.0-rc.2**) as a local profile bundle:

- `package.json` declares `dsh.bundle.patch: ./cordis.patch.yml`; the project-local `cordis.patch.yml` inserts one row (`id: dsh-data-analyst`, `name: dsh-data-analyst`).
- The profile installer auto-selects the bundle into `dsh.profile.bundles` on install; profile-owned `cordis.yml` / `cordis.patch.yml` are never hand-edited.
- Install (local path, official mechanism):
  `<dsh-install>\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add <absolute-path-to-this-project>`
- Dependency alignment: `@deepseek-ai/dsh-tools` pinned to the runtime's `0.2.0-rc.2` (the 0.0.1-era `ToolRegistry` export is now `ToolRuntime`); `@deepseek-ai/cordis 4.0.4` satisfies the runtime's `~4.0.4` peer.

## LLM provider (optional)

The loop works fully offline via `DeterministicInvestigationPolicy` (the default). To let a model propose the next loop step, the host composes the provider **outside** the plugin and injects it through `deps.policy`:

```ts
import { DeepSeekClient } from './dist/loop/providers/deepseek-client.js';
import { LLMInvestigationPolicy } from './dist/loop/llm-policy.js';

const client = new DeepSeekClient({ apiKey: process.env.DSH_LLM_API_KEY! });
const policy = new LLMInvestigationPolicy(client); // deterministic fallback built in
```

Environment (composition root only — core code never reads `process.env`):

- `DSH_LLM_API_KEY` — required to enable the provider; when absent, `smoke-llm.ts` skips and the deterministic policy runs.
- `DSH_LLM_BASE_URL` — optional override for OpenAI-compatible endpoints (must be `https://`).
- `DSH_LLM_MODEL` — optional override (default `deepseek-chat`).

Guarantees: native `fetch`, no SDK dependency; the model returns only a Tier 1 decision (`STOP`/`TEST_NEXT`/`REFINE` + ≤300-char text) that local code validates; timeout (~30s, enforced even against uncooperative transports) and any failure (invalid JSON, provider error) fall back to the deterministic policy. Keys never appear in errors, logs, reports, or evidence. Note: Tier-1 `hypothesis` text is length-checked but intentionally not propagated into analysis — the driver builds every request.

## Security model

- **No code execution:** no `child_process`, `eval`, dynamic `Function`, or generated Python anywhere in `src/`. Analyses are plain in-memory TypeScript.
- **Read-only:** loaders only read files; `src/` performs no file writes. The engine operates on loaded rows without mutating them.
- **No network in core:** investigation, analysis, verification, and reporting are local-only. The single exception is the optional `DeepSeekClient` provider adapter (`src/loop/providers/`), HTTPS-only, constructed outside the plugin and used only when the host supplies an API key.
- **Deterministic verification:** the LLM (reasoning layer) proposes goals and reads results; it never judges numerical correctness — correctness is engine re-execution + deep equality.
- **Paths:** file paths are passed straight to the OS file APIs with the host process's permissions; the plugin reads only the file it is pointed at. No path is used to construct commands.

## Configuration

Tool parameters on `run_investigation`: `max_hypotheses` (default 3, caps seed plans), `max_rounds` (default 5), `max_evidence` (default 12). LLM environment: `DSH_LLM_API_KEY`, optional `DSH_LLM_BASE_URL`, `DSH_LLM_MODEL`.

## Current limitations

- **No causal inference.** Findings describe what the data shows (group means, deltas, trends), never why it happened.
- **No statistical significance testing.** Differences are descriptive (means, percentage deltas), not inferential.
- **No price/discount/channel decomposition.** The fixture has no such fields, so mechanism claims are impossible by construction.
- **Missingness may differ by group.** The profile reports global missing counts; group-conditional missingness is not analyzed.
- **Duplicate rows can exist** (20 in the realistic fixture) and are reported, not silently dropped.
- **Trend does not automatically isolate a requested group or period** (e.g. "Q3"); when one is requested, the claim states the full data range was analyzed.
- **Tier-1 LLM policy does not propagate arbitrary hypothesis text into analysis** — the model chooses a strategy; code builds the request.
- **Refinement is bounded**: one follow-up per inconclusive hypothesis, inside `max_rounds`/`max_evidence`.
- **Verification proves reproducibility, not engine correctness** — a bug in the engine would reproduce faithfully.
- **Report limitation surfacing is currently limited** to unverified findings; data-quality caveats beyond that are not auto-generated.

## Running

```bash
npm install
npm test          # vitest: 277 tests across 21 files
npm run lint      # tsc --noEmit (strict, exactOptionalPropertyTypes)
npm run build     # tsc → dist/
```

As a harness plugin the package exports `{ name, inject: ["tools"], apply(ctx) }`; `apply` constructs the services and registers 10 tools:

`inspect_dataset` · `start_investigation` · `add_hypothesis` · `transition_investigation` · `get_investigation` · `record_evidence` · `record_finding` · `verify_finding` · `get_finding` · `run_investigation`
