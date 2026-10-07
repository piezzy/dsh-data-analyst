/**
 * dsh-data-analyst — Plugin entry point.
 *
 * This is a DeepSeek Harness (DSH) plugin built on the Cordis framework.
 * Every plugin exports:
 *   - name: plugin identifier
 *   - inject: required services (Cordis will wait until they are available)
 *   - apply(ctx): registration function
 *
 * Registered tools:
 *   - inspect_dataset (M2): load + profile a dataset
 *   - start_investigation (M4): create an investigation for a dataset
 *   - record_evidence (M4): record deterministic evidence for an investigation
 *   - get_investigation (M4): read back an investigation + its evidence
 *   - record_finding (M5): record an evidence-backed finding
 *   - verify_finding (M5): deterministically verify a finding
 *   - get_finding (M5): read back a finding + its verification result
 *
 * Future milestones will add the end-to-end agent workflow (M6).
 *
 * PRD: §11 Plugin Structure, §12.1 inspect_dataset spec, §13 start_investigation
 *      spec, §16 finding model, §17 verification
 */

import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { CsvLoader } from "./formats/csv-loader.js";
import { TsvLoader } from "./formats/tsv-loader.js";
import { JsonLoader } from "./formats/json-loader.js";
import { ExcelLoader } from "./formats/excel-loader.js";
import { LoaderRegistry } from "./formats/loader.js";
import { DatasetService } from "./services/dataset-service.js";
import { ProfilingService } from "./services/profiling-service.js";
import { InvestigationService } from "./services/investigation-service.js";
import { EvidenceService } from "./services/evidence-service.js";
import { FindingService } from "./services/finding-service.js";
import { VerificationService } from "./services/verification-service.js";
import { ReportService } from "./services/report-service.js";
import { MarkdownReportRenderer } from "./services/markdown-report-renderer.js";
import { NativeAnalysisEngine } from "./engines/native-engine.js";
import { defineStartInvestigationTool } from "./tools/start-investigation.js";
import { defineRecordEvidenceTool } from "./tools/record-evidence.js";
import { defineGetInvestigationTool } from "./tools/get-investigation.js";
import { defineRecordFindingTool } from "./tools/record-finding.js";
import { defineVerifyFindingTool } from "./tools/verify-finding.js";
import { defineGetFindingTool } from "./tools/get-finding.js";
import { defineAgentInvestigationTool } from "./tools/agent-investigation.js";
import { DataAnalystError } from "./utils/errors.js";

export const name = "dsh-data-analyst";
export const inject = ["tools"];

export function apply(ctx: Context): void {
  // ── Data layer setup ──────────────────────────────────────────────────────
  const registry = new LoaderRegistry();
  registry.register(new CsvLoader());
  registry.register(new TsvLoader());
  registry.register(new JsonLoader());
  registry.register(new ExcelLoader());

  const datasetService = new DatasetService(registry);
  const profilingService = new ProfilingService();
  const investigationService = new InvestigationService();
  const evidenceService = new EvidenceService(investigationService);
  const findingService = new FindingService(
    investigationService,
    evidenceService,
  );

  // The deterministic analysis engine (M3) powers M5 verification:
  // findings are verified by re-executing their evidence through
  // this engine — never by LLM judgment (PRD §10.2, §17).
  const analysisEngine = new NativeAnalysisEngine(datasetService);
  const verificationService = new VerificationService(
    investigationService,
    evidenceService,
    findingService,
    analysisEngine,
  );
  const reportService = new ReportService(
    investigationService,
    evidenceService,
    findingService,
    verificationService,
  );
  const markdownRenderer = new MarkdownReportRenderer();

  // ── Tool: inspect_dataset ─────────────────────────────────────────────────
  //
  // M2: Returns dataset schema, duplicates, missing values, sample, and stats.
  //
  // PRD §12.1 spec — Input: { path }, Output: { dataset_id, format, rows, ... }
  ctx.tools.register(
    defineTool({
      name: "inspect_dataset",
      description:
        "Load a dataset file and return its schema, profiling stats, and basic metadata. " +
        "Supported formats: .csv, .tsv, .json, .jsonl, .xlsx, .xls. " +
        "Returns a profiling payload with a dataset_id that can be used in subsequent analysis tools.",

      parameters: {
        path: {
          type: "string",
          required: true,
          description:
            "Absolute or relative path to the dataset file to inspect.",
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

      async execute(args) {
        try {
          const dataset = await datasetService.loadDataset(args.path);
          const profile = profilingService.profile(dataset);
          return profile as any;
        } catch (err) {
          if (err instanceof DataAnalystError) {
            throw new Error(`[${err.code}] ${err.message}`);
          }
          throw err;
        }
      },
    }),
  );

  // ── Tool: start_investigation (M4, PRD §13) ───────────────────────
  //
  // Creates an investigation for a loaded dataset. The investigation
  // starts in "planning" status; hypotheses and evidence are added
  // through the investigation workflow tools.
  ctx.tools.register(
    defineStartInvestigationTool({ datasetService, investigationService }),
  );

  // ── Tool: record_evidence (M4, PRD §15) ───────────────────────────
  //
  // Records the reproducible output of a deterministic computation.
  // Every finding (M5) must reference at least one evidence record.
  ctx.tools.register(
    defineRecordEvidenceTool({ investigationService, evidenceService }),
  );

  // ── Tool: get_investigation (M4, PRD §11) ─────────────────────────
  //
  // Reads back an investigation with its hypotheses, status, and
  // (optionally) the full evidence records linked to it.
  ctx.tools.register(
    defineGetInvestigationTool({ investigationService, evidenceService }),
  );

  // ── Tool: record_finding (M5, PRD §16) ────────────────────────────
  //
  // Records an evidence-backed claim. Enforces the PRD §16 invariant
  // (evidenceIds.length > 0, AC-04) and starts the finding as
  // "unverified" (AC-05).
  ctx.tools.register(defineRecordFindingTool({ findingService }));

  // ── Tool: verify_finding (M5, PRD §17) ────────────────────────────
  //
  // Deterministically re-executes the finding's evidence through the
  // analysis engine and compares recomputed results against the
  // recorded results. The LLM never judges numerical correctness.
  ctx.tools.register(defineVerifyFindingTool({ verificationService }));

  // ── Tool: get_finding (M5, PRD §11/§16) ───────────────────────────
  //
  // Reads back a finding with its confidence and verification status,
  // optionally including the latest structured verification result.
  ctx.tools.register(
    defineGetFindingTool({ findingService, verificationService }),
  );

  // ── Tool: run_investigation (M6, PRD §28) ──────────────────────────
  //
  // Autonomous end-to-end investigation agent. Loads a dataset, creates
  // an investigation, generates hypotheses, runs deterministic analyses,
  // records evidence, creates findings, verifies them, and returns a
  // complete report. Demonstrates the full M1–M5 workflow.
  ctx.tools.register(
    defineAgentInvestigationTool({
      datasetService,
      investigationService,
      evidenceService,
      findingService,
      verificationService,
      analysisEngine,
      reportService,
      markdownRenderer,
    }),
  );
}
