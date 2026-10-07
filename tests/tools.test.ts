import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LoaderRegistry } from "../src/formats/loader.js";
import { CsvLoader } from "../src/formats/csv-loader.js";
import { DatasetService } from "../src/services/dataset-service.js";
import { InvestigationService } from "../src/services/investigation-service.js";
import { EvidenceService } from "../src/services/evidence-service.js";
import { defineStartInvestigationTool } from "../src/tools/start-investigation.js";
import { defineRecordEvidenceTool } from "../src/tools/record-evidence.js";
import { defineGetInvestigationTool } from "../src/tools/get-investigation.js";
import {
  DatasetNotFoundError,
  InvestigationNotFoundError,
} from "../src/utils/errors.js";
import { resetCounters } from "../src/utils/id-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

/** Minimal stand-in for the Cordis ToolRunContext (tools here ignore it). */
const noopExec = {} as any;

describe("M4 investigation tools", () => {
  let datasetService: DatasetService;
  let investigationService: InvestigationService;
  let evidenceService: EvidenceService;

  beforeEach(() => {
    resetCounters();
    const registry = new LoaderRegistry();
    registry.register(new CsvLoader());
    datasetService = new DatasetService(registry);
    investigationService = new InvestigationService();
    evidenceService = new EvidenceService(investigationService);
  });

  describe("start_investigation", () => {
    it("should create an investigation for a loaded dataset (PRD §13)", async () => {
      const dataset = await datasetService.loadDataset(
        path.join(fixturesDir, "sample.csv"),
      );
      const tool = defineStartInvestigationTool({
        datasetService,
        investigationService,
      });

      const result = (await tool.execute(
        {
          dataset_id: dataset.metadata.datasetId,
          goal: "Why did revenue decline in Q3?",
        },
        noopExec,
      )) as any;

      expect(result.investigationId).toBe("investigation-001");
      expect(result.datasetId).toBe("dataset-001");
      expect(result.goal).toBe("Why did revenue decline in Q3?");
      expect(result.status).toBe("planning");
      expect(result.hypotheses).toEqual([]);
      expect(result.evidenceIds).toEqual([]);
    });

    it("should reject an unknown dataset_id", async () => {
      const tool = defineStartInvestigationTool({
        datasetService,
        investigationService,
      });

      await expect(
        tool.execute(
          { dataset_id: "dataset-999", goal: "Why?" },
          noopExec,
        ),
      ).rejects.toThrow(DatasetNotFoundError);
    });

    it("should reject an empty goal", async () => {
      const dataset = await datasetService.loadDataset(
        path.join(fixturesDir, "sample.csv"),
      );
      const tool = defineStartInvestigationTool({
        datasetService,
        investigationService,
      });

      await expect(
        tool.execute(
          { dataset_id: dataset.metadata.datasetId, goal: "  " },
          noopExec,
        ),
      ).rejects.toThrow();
    });
  });

  describe("record_evidence", () => {
    it("should record evidence and link it to the investigation", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why did revenue decline?",
      );
      const tool = defineRecordEvidenceTool({
        investigationService,
        evidenceService,
      });

      const result = (await tool.execute(
        {
          investigation_id: inv.investigationId,
          type: "comparison",
          operation: "revenue_by_region",
          input: { period: "Q3", groupBy: "region" },
          result: { Jakarta: -31.2, Bandung: -4.1, Surabaya: 2.8 },
        },
        noopExec,
      )) as any;

      expect(result.id).toBe("evidence-001");
      expect(result.type).toBe("comparison");
      expect(result.operation).toBe("revenue_by_region");
      expect(result.input).toEqual({
        period: "Q3",
        groupBy: "region",
      });
      expect(result.result).toEqual({
        Jakarta: -31.2,
        Bandung: -4.1,
        Surabaya: 2.8,
      });

      const stored = investigationService.getInvestigation(
        inv.investigationId,
      );
      expect(stored.evidenceIds).toEqual(["evidence-001"]);
    });

    it("should reject evidence for an unknown investigation", async () => {
      const tool = defineRecordEvidenceTool({
        investigationService,
        evidenceService,
      });

      await expect(
        tool.execute(
          {
            investigation_id: "investigation-999",
            type: "query",
            operation: "op",
          },
          noopExec,
        ),
      ).rejects.toThrow(InvestigationNotFoundError);
    });

    it("should reject an invalid evidence type", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Goal",
      );
      const tool = defineRecordEvidenceTool({
        investigationService,
        evidenceService,
      });

      await expect(
        tool.execute(
          {
            investigation_id: inv.investigationId,
            type: "forecast",
            operation: "op",
          },
          noopExec,
        ),
      ).rejects.toThrow();
    });
  });

  describe("get_investigation", () => {
    it("should return the investigation without evidence by default", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      investigationService.addHypothesis(
        inv.investigationId,
        "Sales volume decreased.",
      );
      evidenceService.recordEvidence(
        inv.investigationId,
        "profile",
        "dataset_profile",
        {},
        { rows: 6 },
      );

      const tool = defineGetInvestigationTool({
        investigationService,
        evidenceService,
      });

      const result = (await tool.execute(
        { investigation_id: inv.investigationId },
        noopExec,
      )) as any;

      expect(result.investigationId).toBe("investigation-001");
      expect(result.hypotheses).toHaveLength(1);
      expect(result.evidenceIds).toEqual(["evidence-001"]);
      expect(result.evidence).toBeUndefined();
    });

    it("should attach full evidence records when include_evidence is true", async () => {
      const inv = investigationService.createInvestigation(
        "dataset-001",
        "Why?",
      );
      evidenceService.recordEvidence(
        inv.investigationId,
        "statistic",
        "mean_revenue",
        { column: "revenue" },
        166000.25,
      );

      const tool = defineGetInvestigationTool({
        investigationService,
        evidenceService,
      });

      const result = (await tool.execute(
        { investigation_id: inv.investigationId, include_evidence: true },
        noopExec,
      )) as any;

      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0].id).toBe("evidence-001");
      expect(result.evidence[0].operation).toBe("mean_revenue");
      expect(result.evidence[0].result).toBe(166000.25);
    });

    it("should reject an unknown investigation_id", async () => {
      const tool = defineGetInvestigationTool({
        investigationService,
        evidenceService,
      });

      await expect(
        tool.execute(
          { investigation_id: "investigation-999" },
          noopExec,
        ),
      ).rejects.toThrow(InvestigationNotFoundError);
    });
  });
});
