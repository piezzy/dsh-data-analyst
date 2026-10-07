/**
 * run_investigation tool (PRD §28 Milestone 6).
 *
 * Autonomous end-to-end investigation agent.
 *
 * Input:
 *   { "path": "sales.csv", "goal": "Why did revenue decline in Q3?" }
 *
 * Workflow:
 *   1. inspect_dataset (load + profile)
 *   2. start_investigation (create investigation for goal)
 *   3. generate hypotheses (heuristic based on goal + profile)
 *   4. run analyses (aggregate/compare/trend) to test hypotheses
 *   5. record_evidence (deterministic results)
 *   6. record_finding (claims backed by evidence)
 *   7. verify_finding (re-execute evidence through engine)
 *   8. return final report with findings, verification status, confidence
 *
 * The agent uses simple heuristics to generate hypotheses and choose
 * analyses. For production use, the LLM (reasoning layer, PRD §10.1)
 * would drive steps 3-4 via tool calls.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { DatasetService } from "../services/dataset-service.js";
import type { InvestigationService } from "../services/investigation-service.js";
import type { EvidenceService } from "../services/evidence-service.js";
import type { FindingService } from "../services/finding-service.js";
import type { VerificationService } from "../services/verification-service.js";
import type { NativeAnalysisEngine } from "../engines/native-engine.js";
import type { AggregateRequest, CompareRequest, TrendRequest } from "../models/analysis.js";
import type { DatasetProfile } from "../models/profile.js";
import type { VerificationResult, EvidenceVerification } from "../models/verification.js";
import type { InvestigationReport } from "../models/report.js";
import { DataAnalystError, DatasetNotFoundError } from "../utils/errors.js";

export interface ParsedGoalIntent {
  analysisType: "aggregate" | "compare" | "trend";
  metric: string;
  groupColumn: string;
  baseGroup?: string | undefined;
  compareGroup?: string | undefined;
  timePeriod?: string | undefined;
  confidence: number;
}

export function parseGoalIntent(goal: string, profile: DatasetProfile): ParsedGoalIntent {
  const lowerGoal = goal.toLowerCase().trim();
  const numericColumns = getNumericColumns(profile);
  const dateColumns = getDateColumns(profile);
  const categoricalColumns = getCategoricalColumns(profile);
  const allColumns = [...numericColumns, ...dateColumns, ...categoricalColumns];

  // Helper: find column name mentioned in goal (case-insensitive, exact match)
  const findColumn = (cols: string[]): string | undefined => {
    for (const col of cols) {
      if (lowerGoal.includes(col.toLowerCase())) {
        return col;
      }
    }
    return undefined;
  };

  // Helper: infer group column from extracted group values using categoricalStats and sample data
  const inferGroupColumn = (groups: string[]): string | undefined => {
    // First try categoricalStats.topValues
    for (const catCol of categoricalColumns) {
      const colProfile = profile.columnProfiles[catCol];
      if (colProfile?.categoricalStats?.topValues) {
        const topValues = colProfile.categoricalStats.topValues.map(v => v.toLowerCase());
        const allMatch = groups.every(g => topValues.includes(g.toLowerCase()));
        if (allMatch) return catCol;
      }
    }
    // Fallback: check sample data for columns containing all group values
    if (profile.sample && profile.sample.length > 0) {
      for (const catCol of categoricalColumns) {
        const valuesInSample = new Set(profile.sample.map(row => String(row[catCol] ?? "").toLowerCase()));
        const allMatch = groups.every(g => valuesInSample.has(g.toLowerCase()));
        if (allMatch) return catCol;
      }
    }
    return undefined;
  };

// Helper: match "X vs Y" or "X versus Y" or "X compared to Y" pattern
  // Then validate/clean extracted groups against known categorical values
  const extractCompareGroups = (goal: string): [string | undefined, string | undefined] => {
    // Patterns that skip leading "Compare " or similar words
    const patterns = [
      // "Compare X vs Y" or "X vs Y" - capture X and Y, not "Compare"
      /(?:^compare\s+)?(\w+(?:\s+\w+)?)\s+vs\s+(\w+(?:\s+\w+)?)/i,
      /(?:^compare\s+)?(\w+(?:\s+\w+)?)\s+versus\s+(\w+(?:\s+\w+)?)/i,
      /(?:^compare\s+)?(\w+(?:\s+\w+)?)\s+compared\s+to\s+(\w+(?:\s+\w+)?)/i,
    ];
    for (const pattern of patterns) {
      const match = goal.match(pattern);
      if (match) {
        let g1 = match[1]?.trim() ?? "";
        let g2 = match[2]?.trim() ?? "";

        // Clean: strip trailing metric words from g2
        for (const metric of numericColumns) {
          if (g2.toLowerCase().endsWith(" " + metric.toLowerCase())) {
            g2 = g2.slice(0, -(metric.length + 1)).trim();
          }
        }

        // Filter out common false positives
        const excludeWords = ["compare", "versus", "vs", "revenue", "quantity", "sales", "value", "metric", "the", "and", "or"];
        const isExcluded = (s: string) => excludeWords.some(w => s.toLowerCase() === w || s.toLowerCase().startsWith(w + " "));
        if (g1 && g2 && !isExcluded(g1) && !isExcluded(g2)) {
          return [g1, g2];
        }
      }
    }
    return [undefined, undefined];
  };

  // Helper: extract time period phrase (Q1, Q2, Q3, Q4, 2024, Jan, etc.)
  const extractTimePeriod = (goal: string): string | undefined => {
    const patterns = [
      /\b(Q[1-4])\b/i,
      /\b(20\d{2})\b/,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i,
    ];
    for (const pattern of patterns) {
      const match = goal.match(pattern);
      if (match) return match[1];
    }
    return undefined;
  };

  // 1. Compare intent: "Compare X vs Y metric" or "Compare metric across groups"
  if (
    lowerGoal.includes("compare") ||
    lowerGoal.includes("vs") ||
    lowerGoal.includes("versus") ||
    lowerGoal.includes("difference")
  ) {
    let metric: string = findColumn(numericColumns) ?? numericColumns[0] ?? "";
    let groupColumn = findColumn(categoricalColumns);
    let confidence = 0.5;

    if (metric) confidence += 0.2;
    if (groupColumn) confidence += 0.2;

    // Try to extract explicit groups from goal
    const [extractedBase, extractedCompare] = extractCompareGroups(goal);
    let baseGroup: string | undefined;
    let compareGroup: string | undefined;
    
    // Validate extracted groups against dataset - only keep if they exist in some categorical column
    if (extractedBase && extractedCompare) {
      const groupsExist = categoricalColumns.some(catCol => {
        const colProfile = profile.columnProfiles[catCol];
        if (colProfile?.categoricalStats?.topValues) {
          const topValues = colProfile.categoricalStats.topValues.map(v => v.toLowerCase());
          return topValues.includes(extractedBase.toLowerCase()) && topValues.includes(extractedCompare.toLowerCase());
        }
        if (profile.sample && profile.sample.length > 0) {
          const valuesInSample = new Set(profile.sample.map(row => String(row[catCol] ?? "").toLowerCase()));
          return valuesInSample.has(extractedBase.toLowerCase()) && valuesInSample.has(extractedCompare.toLowerCase());
        }
        return false;
      });
      
      if (groupsExist) {
        baseGroup = extractedBase;
        compareGroup = extractedCompare;
        confidence += 0.2;

        // Infer groupColumn from the validated groups
        for (const catCol of categoricalColumns) {
          const colProfile = profile.columnProfiles[catCol];
          if (colProfile?.categoricalStats?.topValues) {
            const topValues = colProfile.categoricalStats.topValues.map(v => v.toLowerCase());
            if (topValues.includes(extractedBase.toLowerCase()) && topValues.includes(extractedCompare.toLowerCase())) {
              groupColumn = catCol;
              break;
            }
          }
          if (profile.sample && profile.sample.length > 0) {
            const valuesInSample = new Set(profile.sample.map(row => String(row[catCol] ?? "").toLowerCase()));
            if (valuesInSample.has(extractedBase.toLowerCase()) && valuesInSample.has(extractedCompare.toLowerCase())) {
              groupColumn = catCol;
              break;
            }
          }
        }
      }
    }

    // Ensure groupColumn is never undefined at return
    if (!groupColumn && categoricalColumns.length > 0) {
      groupColumn = categoricalColumns[0];
    }

    return {
      analysisType: "compare",
      metric,
      groupColumn: groupColumn!,
      baseGroup,
      compareGroup,
      confidence: Math.min(confidence, 1),
    };
  }

  // 2. Trend intent: "trend", "over time", "change"
  if (
    lowerGoal.includes("trend") ||
    lowerGoal.includes("over time") ||
    lowerGoal.includes("change")
  ) {
    let metric: string = findColumn(numericColumns) ?? numericColumns[0] ?? "";
    const timeCol = findColumn(dateColumns) ?? dateColumns[0];
    const timePeriod = extractTimePeriod(goal);

    let confidence = 0.5;
    if (metric) confidence += 0.2;
    if (timeCol) confidence += 0.2;
    if (timePeriod) confidence += 0.1;

    return {
      analysisType: "trend",
      metric,
      groupColumn: timeCol!,
      timePeriod,
      confidence: Math.min(confidence, 1),
    };
  }

  // 3. Aggregate intent: "average X by Y", "X by Y", "sum X", etc.
  if (
    lowerGoal.includes("average") ||
    lowerGoal.includes("mean") ||
    lowerGoal.includes("sum") ||
    lowerGoal.includes("total") ||
    lowerGoal.includes("by") ||
    lowerGoal.includes("aggregate") ||
    lowerGoal.includes("distribution")
  ) {
    let metric: string = findColumn(numericColumns) ?? numericColumns[0] ?? "";
    let groupColumn = findColumn(categoricalColumns);
    if (!groupColumn && categoricalColumns.length > 0) {
      groupColumn = categoricalColumns[0];
    }

    let confidence = 0.5;
    if (metric) confidence += 0.2;
    if (groupColumn) confidence += 0.2;

    return {
      analysisType: "aggregate",
      metric,
      groupColumn: groupColumn!,
      confidence: Math.min(confidence, 1),
    };
  }

  // Default fallback: aggregate with low confidence
  return {
    analysisType: "aggregate",
    metric: numericColumns[0] ?? "",
    groupColumn: categoricalColumns[0]!,
    confidence: 0.3,
  };
}

export interface AgentInvestigationToolDeps {
  datasetService: DatasetService;
  investigationService: InvestigationService;
  evidenceService: EvidenceService;
  findingService: FindingService;
  verificationService: VerificationService;
  analysisEngine: NativeAnalysisEngine;
  reportService?: {
    generateReport: (investigationId: string) => InvestigationReport;
  };
  markdownRenderer?: { render: (report: InvestigationReport) => string };
}

interface HypothesisPlan {
  id: string;
  statement: string;
  rationale: string;
  analysisType: "aggregate" | "compare" | "trend";
  request: AggregateRequest | CompareRequest | TrendRequest;
  /** True when the statement makes a directional claim (A higher than B). */
  directional?: boolean;
}

function evaluateAggregateResult(result: unknown): "supported" | "rejected" | "inconclusive" {
  if (!Array.isArray(result) || result.length < 2) return "inconclusive";
  const vals: number[] = [];
  for (const row of result as Array<Record<string, unknown>>) {
    if (typeof row !== "object" || row === null) continue;
    const cand = typeof row["mean"] === "number"
      ? (row["mean"] as number)
      : (Object.values(row).find((v) => typeof v === "number") as number | undefined);
    if (typeof cand === "number" && Number.isFinite(cand)) vals.push(cand);
  }
  if (vals.length < 2) return "inconclusive";
  return new Set(vals).size > 1 ? "supported" : "rejected";
}

function evaluateCompareResult(result: unknown, directional: boolean): "supported" | "rejected" | "inconclusive" {
  if (typeof result !== "object" || result === null) return "inconclusive";
  const r = result as Record<string, unknown>;
  const b = r["baseValue"];
  const c = r["compareValue"];
  if (typeof b !== "number" || typeof c !== "number") return "inconclusive";
  if (!Number.isFinite(b) || !Number.isFinite(c)) return "inconclusive";
  if (directional) return b > c ? "supported" : "rejected";
  return b !== c ? "supported" : "rejected";
}

function evaluateTrendResult(result: unknown): "supported" | "rejected" | "inconclusive" {
  if (!Array.isArray(result)) return "inconclusive";
  const vals = (result as Array<Record<string, unknown>>)
    .map((row) => (typeof row?.["value"] === "number" ? (row["value"] as number) : undefined))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length < 2) return "inconclusive";
  const first = vals[0] as number;
  return vals.some((v) => v !== first) ? "supported" : "rejected";
}

function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function fmtPct(v: number): string {
  return `${Math.round(Math.abs(v) * 10) / 10}%`;
}


function buildCompareClaim(req: CompareRequest, result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as Record<string, unknown>;
  const b = r["baseValue"];
  const c = r["compareValue"];
  if (typeof b !== "number" || typeof c !== "number") return undefined;
  if (b === c) return `Mean ${req.valueColumn} was equal for ${req.baseGroup} and ${req.compareGroup} (${fmtNum(b)}).`;
  const pd = r["percentageDiff"];
  if (typeof pd === "number" && Number.isFinite(pd)) {
    if (c > b) return `${req.compareGroup} ${req.valueColumn} was ${fmtPct(pd)} higher than ${req.baseGroup} (mean ${fmtNum(c)} vs ${fmtNum(b)}).`;
    return `${req.baseGroup} ${req.valueColumn} was ${fmtPct(pd)} higher than ${req.compareGroup} (mean ${fmtNum(b)} vs ${fmtNum(c)}).`;
  }
  const hi = b > c ? req.baseGroup : req.compareGroup;
  const lo = b > c ? req.compareGroup : req.baseGroup;
  return `${hi} ${req.valueColumn} was higher than ${lo} (mean ${fmtNum(b)} vs ${fmtNum(c)}).`;
}

function buildAggregateClaim(req: AggregateRequest, result: unknown): string | undefined {
  if (!Array.isArray(result) || result.length === 0) return undefined;
  const metric = req.aggregations[0]?.column ?? "value";
  const gcol = req.groupBy ?? "group";
  const entries: Array<{ g: string; v: number }> = [];
  for (const row of result as Array<Record<string, unknown>>) {
    if (typeof row !== "object" || row === null) continue;
    const gv = row[gcol];
    const cand = typeof row["mean"] === "number"
      ? (row["mean"] as number)
      : (Object.values(row).find((x) => typeof x === "number") as number | undefined);
    if (gv === undefined || gv === null) continue;
    if (typeof cand !== "number" || !Number.isFinite(cand)) continue;
    entries.push({ g: String(gv), v: cand });
  }
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return `Mean ${metric} by ${gcol} was ${fmtNum(entries[0]!.v)} for ${entries[0]!.g}.`;
  let mn = entries[0]!;
  let mx = entries[0]!;
  for (const e of entries) {
    if (e.v < mn.v) mn = e;
    if (e.v > mx.v) mx = e;
  }
  return `Mean ${metric} by ${gcol} ranged from ${fmtNum(mn.v)} (${mn.g}) to ${fmtNum(mx.v)} (${mx.g}) across ${entries.length} groups.`;
}

function buildTrendClaim(req: TrendRequest, result: unknown, timePeriod?: string | undefined): string | undefined {
  if (!Array.isArray(result) || result.length === 0) return undefined;
  const rows = (result as Array<Record<string, unknown>>).filter(
    (x) => typeof x?.["value"] === "number" && Number.isFinite(x["value"] as number),
  );
  if (rows.length === 0) return undefined;
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const fv = first["value"] as number;
  const lv = last["value"] as number;
  let overall = "";
  if (fv !== 0 && Number.isFinite(fv)) {
    const pct = ((lv - fv) / Math.abs(fv)) * 100;
    overall = lv >= fv ? ` (${fmtPct(pct)} higher overall)` : ` (${fmtPct(pct)} lower overall)`;
  }
  let claim = `Mean ${req.valueColumn} over ${req.timeColumn} changed from ${fmtNum(fv)} (${String(first[req.timeColumn] ?? "start")}) to ${fmtNum(lv)} (${String(last[req.timeColumn] ?? "end")})${overall} across ${rows.length} periods.`;
  if (timePeriod) claim += ` Requested period ${timePeriod} could not be filtered by the analysis engine; analysis covers the full ${req.timeColumn} range.`;
  return claim;
}

function buildFindingClaim(
  intent: ParsedGoalIntent,
  outcomes: Array<{ analysisType: "aggregate" | "compare" | "trend"; request: AggregateRequest | CompareRequest | TrendRequest; result: unknown }>,
): string {
  const parts: string[] = [];
  for (const o of outcomes) {
    if (o.analysisType === "compare") {
      const c = buildCompareClaim(o.request as CompareRequest, o.result);
      if (c) parts.push(c);
    } else if (o.analysisType === "aggregate") {
      const c = buildAggregateClaim(o.request as AggregateRequest, o.result);
      if (c) parts.push(c);
    } else {
      const c = buildTrendClaim(o.request as TrendRequest, o.result, intent.timePeriod);
      if (c) parts.push(c);
    }
  }
  if (parts.length > 0) return parts.join(" ");
  if (intent.timePeriod) {
    return `Observed ${intent.analysisType} of ${intent.metric} by ${intent.groupColumn} across ${outcomes.length} analysis run(s). Requested period ${intent.timePeriod} could not be filtered by the analysis engine; analysis covers the full data range.`;
  }
  return `Observed ${intent.analysisType} of ${intent.metric} by ${intent.groupColumn} across ${outcomes.length} analysis run(s).`;
}

function inferAnalysisType(goal: string, _profile: DatasetProfile): "aggregate" | "compare" | "trend" {
  const lowerGoal = goal.toLowerCase();
  if (lowerGoal.includes("trend") || lowerGoal.includes("over time") || lowerGoal.includes("change")) {
    return "trend";
  }
  if (lowerGoal.includes("compare") || lowerGoal.includes("vs") || lowerGoal.includes("versus") || lowerGoal.includes("difference")) {
    return "compare";
  }
  return "aggregate";
}

function getNumericColumns(profile: DatasetProfile): string[] {
  return profile.metadata.schema
    .filter((s): s is typeof s & { type: "number" } => s.type === "number")
    .map((s) => s.name);
}

function getDateColumns(profile: DatasetProfile): string[] {
  return profile.metadata.schema
    .filter((s): s is typeof s & { type: "date" } => s.type === "date")
    .map((s) => s.name);
}

function getCategoricalColumns(profile: DatasetProfile): string[] {
  return profile.metadata.schema
    .filter((s): s is typeof s & { type: "string" | "boolean" } => s.type === "string" || s.type === "boolean")
    .map((s) => s.name);
}

function generateHypotheses(intent: ParsedGoalIntent, profile: DatasetProfile, datasetId: string): HypothesisPlan[] {
  const numericColumns = getNumericColumns(profile);
  const categoricalColumns = getCategoricalColumns(profile);

  const plans: HypothesisPlan[] = [];
  const analysisType = intent.analysisType;
  const metric = intent.metric || numericColumns[0];
  const groupColumn = intent.groupColumn || categoricalColumns[0];

  if (analysisType === "trend" && groupColumn && metric) {
    const timeCol = groupColumn;
    const valueCol = metric;
    const periodNote = intent.timePeriod
      ? ` Full ${timeCol} range is analyzed because the engine cannot filter to ${intent.timePeriod}.`
      : "";
    plans.push({
      id: "H1",
      statement: `Mean ${valueCol} changed over time (${timeCol}).${periodNote}`,
      rationale: `Trend of ${valueCol} over ${timeCol} from parsed goal intent`,
      analysisType: "trend",
      request: {
        datasetId,
        timeColumn: timeCol,
        valueColumn: valueCol,
        func: "mean",
      } as TrendRequest,
    });
  }

  if (analysisType === "compare" && groupColumn && metric) {
    const groupCol = groupColumn;
    const valueCol = metric;
    if (intent.baseGroup && intent.compareGroup) {
      plans.push({
        id: "H1",
        statement: `${intent.baseGroup} ${valueCol} is higher than ${intent.compareGroup} ${valueCol}.`,
        rationale: `Directional comparison from parsed goal intent (${groupCol}: ${intent.baseGroup} vs ${intent.compareGroup})`,
        analysisType: "compare",
        directional: true,
        request: {
          datasetId,
          groupColumn: groupCol,
          valueColumn: valueCol,
          func: "mean",
          baseGroup: intent.baseGroup,
          compareGroup: intent.compareGroup,
        } as CompareRequest,
      });
    } else {
      plans.push({
        id: "H1",
        statement: `Mean ${valueCol} differs across ${groupCol}.`,
        rationale: `Compare ${valueCol} across ${groupCol} from parsed goal intent`,
        analysisType: "compare",
        directional: false,
        request: {
          datasetId,
          groupColumn: groupCol,
          valueColumn: valueCol,
          func: "mean",
          baseGroup: "",
          compareGroup: "",
        } as CompareRequest,
      });
    }
  }

  if (analysisType === "aggregate" && metric) {
    const valueCol = metric;
    const groupCol = groupColumn || categoricalColumns[0] || null;
    plans.push({
      id: "H1",
      statement: groupCol ? `Mean ${valueCol} differs across ${groupCol}.` : `Mean ${valueCol} is representative of the dataset.`,
      rationale: groupCol ? `Aggregate ${valueCol} by ${groupCol} from parsed goal intent` : "Aggregate to understand overall distribution",
      analysisType: "aggregate",
      request: {
        datasetId,
        aggregations: [{ column: valueCol, func: "mean", alias: "mean" }],
        groupBy: groupCol ?? undefined,
      } as AggregateRequest,
    });

    if (groupCol) {
      const groupCol2 = categoricalColumns.find((c) => c !== groupCol);
      if (groupCol2) {
        plans.push({
          id: "H2",
          statement: `Mean ${valueCol} differs across ${groupCol2}.`,
          rationale: `Alternative grouping ${groupCol2} from fallback discovery`,
          analysisType: "aggregate",
          request: {
            datasetId,
            aggregations: [{ column: valueCol, func: "mean", alias: "mean" }],
            groupBy: groupCol2,
          } as AggregateRequest,
        });
      }
    }
  }

  if (plans.length === 0 && numericColumns.length > 0) {
    const valueCol = numericColumns[0];
    plans.push({
      id: "H1",
      statement: `Descriptive statistics for ${valueCol}`,
      rationale: "Basic statistical profile",
      analysisType: "aggregate",
      request: {
        datasetId,
        aggregations: [
          { column: valueCol, func: "mean", alias: "mean" },
          { column: valueCol, func: "sum", alias: "sum" },
          { column: valueCol, func: "min", alias: "min" },
          { column: valueCol, func: "max", alias: "max" },
        ],
      } as AggregateRequest,
    });
  }

  return plans;
}

function extractGroupsForComparison(result: unknown, groupColumn: string): string[] {
  if (Array.isArray(result)) {
    return [...new Set(result.map((r: any) => r[groupColumn]).filter(Boolean))];
  }
  return [];
}

interface AgentInvestigationResult {
  investigationId: string;
  goal: string;
  datasetId: string;
  profile: {
    rows: number;
    columns: number;
    schema: Array<{ name: string; type: string; nullable: boolean }>;
  };
  hypotheses: Array<{
    id: string;
    investigationId: string;
    statement: string;
    rationale: string | null;
    status: string;
  }>;
  evidenceCount: number;
  findings: Array<{
    id: string;
    claim: string;
    evidenceIds: string[];
    hypothesisIds: string[];
    confidence: number;
    verificationStatus: string;
    verificationReason: string | null;
  }>;
  verificationDetails: {
    findingId: string;
    investigationId: string;
    claim: string;
    status: string;
    reason: string;
    checkedEvidence: Array<{
      evidenceId: string;
      exists: boolean;
      structurallyValid: boolean;
      sameInvestigation: boolean;
      reproducible: boolean;
      recordedResult: unknown;
      reproducedResult: unknown;
      matches: boolean | null;
      reason: string | null;
    }>;
    verifiedAt: string;
  };
  report?: {
    structured: InvestigationReport;
    markdown: string;
  };
  status: string;
}

interface AgentInvestigationFailure {
  investigationId: string;
  goal: string;
  status: "failed";
  error: string;
  findings: never[];
}

export function defineAgentInvestigationTool(deps: AgentInvestigationToolDeps) {
  return defineTool({
    name: "run_investigation",
    description:
      "Run a full autonomous investigation on a dataset. Loads the dataset, creates an investigation, " +
      "generates hypotheses, runs deterministic analyses, records evidence, creates findings, verifies them, " +
      "and returns a complete report. Use this for end-to-end testing and demos.",

    parameters: {
      path: {
        type: "string",
        required: true,
        description: "Path to the dataset file (CSV, TSV, JSON, JSONL, XLSX, XLS).",
      },
      goal: {
        type: "string",
        required: true,
        description: "Analytical goal, e.g. 'Why did revenue decline in Q3?'",
      },
      max_hypotheses: {
        type: "number",
        description: "Maximum number of hypotheses to test (default: 3).",
      },
    },

    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [
        {
          type: "text",
          text: JSON.stringify(value, null, 2),
        },
      ],
    },

    async execute(args: { path: string; goal: string; max_hypotheses?: number }): Promise<Record<string, any>> {
      const { path, goal, max_hypotheses = 3 } = args;

      const dataset = await deps.datasetService.loadDataset(path);

      const { ProfilingService } = await import("../services/profiling-service.js");
      const profilingService = new ProfilingService();
      const datasetProfile = profilingService.profile(dataset);

      const investigation = deps.investigationService.createInvestigation(
        dataset.metadata.datasetId,
        goal,
      );

      deps.investigationService.transitionTo(investigation.investigationId, "investigating");

      const intent = parseGoalIntent(goal, datasetProfile);
      const hypothesisPlans = generateHypotheses(intent, datasetProfile, dataset.metadata.datasetId).slice(0, max_hypotheses);

      const evidenceIds: string[] = [];
      const hypothesisIds: string[] = [];
      const claimOutcomes: Array<{ analysisType: "aggregate" | "compare" | "trend"; request: AggregateRequest | CompareRequest | TrendRequest; result: unknown }> = [];

      for (const plan of hypothesisPlans) {
        const hypothesis = deps.investigationService.addHypothesis(
          investigation.investigationId,
          plan.statement,
          plan.rationale,
        );
        hypothesisIds.push(hypothesis.id);
        deps.investigationService.setHypothesisStatus(
          investigation.investigationId,
          hypothesis.id,
          "testing",
        );

        const request = { ...plan.request, datasetId: dataset.metadata.datasetId };

        let analysisResult: any;
        try {
          if (plan.analysisType === "aggregate") {
            analysisResult = await deps.analysisEngine.aggregate(request as AggregateRequest);
          } else if (plan.analysisType === "compare") {
            const compareReq = request as CompareRequest;
            // Parsed intent groups win. Only discover groups when the intent
            // did not name them; never override intent-provided groups.
            if (!compareReq.baseGroup || !compareReq.compareGroup) {
              const aggResult = await deps.analysisEngine.aggregate({
                datasetId: dataset.metadata.datasetId,
                aggregations: [{ column: compareReq.valueColumn, func: compareReq.func }],
                groupBy: compareReq.groupColumn,
              });
              const groups = extractGroupsForComparison(aggResult.result, compareReq.groupColumn);
              if (groups.length >= 2) {
                compareReq.baseGroup = groups[0]!;
                compareReq.compareGroup = groups[1]!;
              } else if (groups.length === 1) {
                compareReq.baseGroup = groups[0]!;
                compareReq.compareGroup = groups[0]!;
              }
            }
            analysisResult = await deps.analysisEngine.compare(compareReq);
          } else if (plan.analysisType === "trend") {
            analysisResult = await deps.analysisEngine.trend(request as TrendRequest);
          }

          const evidence = deps.evidenceService.recordEvidence(
            investigation.investigationId,
            plan.analysisType === "trend" ? "statistic" : "comparison",
            plan.analysisType,
            request,
            analysisResult.result,
          );
          evidenceIds.push(evidence.id);
          claimOutcomes.push({ analysisType: plan.analysisType, request: request as AggregateRequest | CompareRequest | TrendRequest, result: analysisResult.result });

          // Hypotheses are evaluated from evidence, never from mere execution.
          const verdict =
            plan.analysisType === "aggregate"
              ? evaluateAggregateResult(analysisResult.result)
              : plan.analysisType === "compare"
                ? evaluateCompareResult(analysisResult.result, plan.directional ?? false)
                : evaluateTrendResult(analysisResult.result);
          deps.investigationService.setHypothesisStatus(
            investigation.investigationId,
            hypothesis.id,
            verdict,
          );
        } catch (err) {
          deps.investigationService.setHypothesisStatus(
            investigation.investigationId,
            hypothesis.id,
            "rejected",
          );
        }
      }

      if (evidenceIds.length === 0) {
        deps.investigationService.fail(
          investigation.investigationId,
          "No evidence could be generated for any hypothesis",
        );
        const failureResult: AgentInvestigationFailure = {
          investigationId: investigation.investigationId,
          goal,
          status: "failed",
          error: "No evidence generated",
          findings: [],
        };
        return failureResult as Record<string, any>;
      }

      const claim = buildFindingClaim(intent, claimOutcomes);
      const finding = deps.findingService.recordFinding(
        investigation.investigationId,
        claim,
        evidenceIds,
        { hypothesisIds },
      );

      const verifiedFinding = await deps.verificationService.verifyFinding(finding.id);

      deps.investigationService.transitionTo(investigation.investigationId, "verifying");

      deps.investigationService.transitionTo(investigation.investigationId, "completed");

      // M7.3: report the FINAL state only — hypotheses, evidence,
      // findings, and verification are all settled above. No new
      // analysis, evidence, findings, or verification happens here.
      let reportField: AgentInvestigationResult["report"];
      if (deps.reportService && deps.markdownRenderer) {
        const structured = deps.reportService.generateReport(
          investigation.investigationId,
        );
        reportField = {
          structured,
          markdown: deps.markdownRenderer.render(structured),
        };
      }

      const finalInvestigation = deps.investigationService.getInvestigation(investigation.investigationId);
      const allFindings = deps.findingService.getFindingsForInvestigation(investigation.investigationId);

      const successResult: AgentInvestigationResult = {
        investigationId: investigation.investigationId,
        goal,
        datasetId: dataset.metadata.datasetId,
        profile: {
          rows: datasetProfile.metadata.rows,
          columns: datasetProfile.metadata.columns,
          schema: datasetProfile.metadata.schema.map(s => ({
            name: s.name,
            type: s.type,
            nullable: s.nullable,
          })),
        },
        hypotheses: finalInvestigation.hypotheses.map(h => ({
          id: h.id,
          investigationId: h.investigationId,
          statement: h.statement,
          rationale: h.rationale ?? null,
          status: h.status,
        })),
        evidenceCount: evidenceIds.length,
        findings: allFindings.map((f) => ({
          id: f.id,
          claim: f.claim,
          evidenceIds: f.evidenceIds,
          hypothesisIds: f.hypothesisIds ?? [],
          confidence: f.confidence,
          verificationStatus: f.verificationStatus,
          verificationReason: f.verificationReason ?? null,
        })),
        verificationDetails: {
          findingId: verifiedFinding.findingId,
          investigationId: verifiedFinding.investigationId,
          claim: verifiedFinding.claim,
          status: verifiedFinding.status,
          reason: verifiedFinding.reason,
          checkedEvidence: verifiedFinding.checkedEvidence.map((ev: EvidenceVerification) => ({
            evidenceId: ev.evidenceId,
            exists: ev.exists,
            structurallyValid: ev.structurallyValid,
            sameInvestigation: ev.sameInvestigation,
            reproducible: ev.reproducible,
            recordedResult: ev.recordedResult ?? null,
            reproducedResult: ev.reproducedResult ?? null,
            matches: ev.matches ?? null,
            reason: ev.reason ?? null,
          })),
          verifiedAt: verifiedFinding.verifiedAt,
        },
        status: "completed",
      };
      if (reportField !== undefined) {
        successResult.report = reportField;
      }
      return successResult as Record<string, any>;
    },
  });
}