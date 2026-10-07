import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LoaderRegistry } from "../src/formats/loader.js";
import { CsvLoader } from "../src/formats/csv-loader.js";
import { DatasetService } from "../src/services/dataset-service.js";
import { ProfilingService } from "../src/services/profiling-service.js";
import { parseGoalIntent } from "../src/tools/agent-investigation.js";
import { resetCounters } from "../src/utils/id-generator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

describe("Goal intent parser", () => {
  let datasetService: DatasetService;
  let profilingService: ProfilingService;
  let datasetProfile: any;

  beforeEach(async () => {
    resetCounters();
    const registry = new LoaderRegistry();
    registry.register(new CsvLoader());
    datasetService = new DatasetService(registry);
    const dataset = await datasetService.loadDataset(
      path.join(fixturesDir, "sample.csv"),
    );
    profilingService = new ProfilingService();
    datasetProfile = profilingService.profile(dataset);
  });

  describe("Compare intent", () => {
    it("should parse 'Compare Jakarta vs Surabaya revenue'", () => {
      const intent = parseGoalIntent(
        "Compare Jakarta vs Surabaya revenue",
        datasetProfile,
      );

      expect(intent.analysisType).toBe("compare");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("region");
      // Group values extracted but not yet validated against dataset
      expect(intent.baseGroup).toBe("Jakarta");
      expect(intent.compareGroup).toBe("Surabaya");
      expect(intent.confidence).toBeGreaterThan(0.5);
    });

    it("should parse 'Compare revenue across regions'", () => {
      const intent = parseGoalIntent(
        "Compare revenue across regions",
        datasetProfile,
      );

      expect(intent.analysisType).toBe("compare");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("region");
      expect(intent.confidence).toBeGreaterThan(0.5);
    });

    it("should parse 'Jakarta versus Surabaya revenue'", () => {
      const intent = parseGoalIntent(
        "Jakarta versus Surabaya revenue",
        datasetProfile,
      );

      expect(intent.analysisType).toBe("compare");
      expect(intent.metric).toBe("revenue");
      expect(intent.baseGroup).toBe("Jakarta");
      expect(intent.compareGroup).toBe("Surabaya");
    });

    it("should parse 'difference in revenue between Jakarta and Surabaya'", () => {
      const intent = parseGoalIntent(
        "difference in revenue between Jakarta and Surabaya",
        datasetProfile,
      );

      expect(intent.analysisType).toBe("compare");
      expect(intent.metric).toBe("revenue");
    });
  });

  describe("Trend intent", () => {
    it("should parse 'revenue trend'", () => {
      const intent = parseGoalIntent("revenue trend", datasetProfile);

      expect(intent.analysisType).toBe("trend");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("date");
    });

    it("should parse 'revenue trend in Q3'", () => {
      const intent = parseGoalIntent("revenue trend in Q3", datasetProfile);

      expect(intent.analysisType).toBe("trend");
      expect(intent.metric).toBe("revenue");
      expect(intent.timePeriod).toBe("Q3");
    });

    it("should parse 'show revenue over time'", () => {
      const intent = parseGoalIntent("show revenue over time", datasetProfile);

      expect(intent.analysisType).toBe("trend");
      expect(intent.metric).toBe("revenue");
    });

    it("should parse 'how has revenue changed'", () => {
      const intent = parseGoalIntent("how has revenue changed", datasetProfile);

      expect(intent.analysisType).toBe("trend");
      expect(intent.metric).toBe("revenue");
    });
  });

  describe("Aggregate intent", () => {
    it("should parse 'average revenue by region'", () => {
      const intent = parseGoalIntent("average revenue by region", datasetProfile);

      expect(intent.analysisType).toBe("aggregate");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("region");
    });

    it("should parse 'average revenue by product'", () => {
      const intent = parseGoalIntent("average revenue by product", datasetProfile);

      expect(intent.analysisType).toBe("aggregate");
      expect(intent.metric).toBe("revenue");
      expect(intent.groupColumn).toBe("product");
    });

    it("should parse 'total revenue'", () => {
      const intent = parseGoalIntent("total revenue", datasetProfile);

      expect(intent.analysisType).toBe("aggregate");
      expect(intent.metric).toBe("revenue");
    });

    it("should parse 'revenue distribution'", () => {
      const intent = parseGoalIntent("revenue distribution", datasetProfile);

      expect(intent.analysisType).toBe("aggregate");
      expect(intent.metric).toBe("revenue");
    });

    it("should parse 'mean quantity by region'", () => {
      const intent = parseGoalIntent("mean quantity by region", datasetProfile);

      expect(intent.analysisType).toBe("aggregate");
      expect(intent.metric).toBe("quantity");
      expect(intent.groupColumn).toBe("region");
    });
  });

  describe("Fallback behavior", () => {
    it("should fallback to aggregate for ambiguous goal", () => {
      const intent = parseGoalIntent("analyze the data", datasetProfile);

      expect(intent.analysisType).toBe("aggregate");
      expect(intent.metric).toBe("revenue"); // first numeric column
      expect(intent.confidence).toBeLessThan(0.5);
    });

    it("should not invent column names", () => {
      const intent = parseGoalIntent("analyze profit by customer", datasetProfile);

      // profit and customer don't exist in sample.csv
      expect(intent.metric).toBe("revenue"); // falls back to first numeric
      expect(intent.groupColumn).toBe("product"); // falls back to first categorical
    });

    it("should not invent group values", () => {
      const intent = parseGoalIntent("Compare Tokyo vs Osaka revenue", datasetProfile);

      // Tokyo and Osaka don't exist in sample.csv
      expect(intent.baseGroup).toBeUndefined();
      expect(intent.compareGroup).toBeUndefined();
    });
  });

  describe("Confidence scoring", () => {
    it("should have higher confidence when metric and group are identified", () => {
      const highConfidence = parseGoalIntent(
        "average revenue by region",
        datasetProfile,
      );
      const lowConfidence = parseGoalIntent("analyze stuff", datasetProfile);

      expect(highConfidence.confidence).toBeGreaterThan(lowConfidence.confidence);
    });
  });
});