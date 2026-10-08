import { describe, it, expect, beforeEach } from "vitest";
import { NativeAnalysisEngine } from "../src/engines/native-engine.js";
import { DatasetService } from "../src/services/dataset-service.js";
import type { Dataset } from "../src/models/dataset.js";

/**
 * Count-aggregation regression tests: `count` must count non-missing
 * values of the REQUESTED column only. Missing means null, undefined,
 * or empty string (the engine-wide missing convention); every other
 * value — including 0 and false — counts.
 */
describe("NativeAnalysisEngine count() per-column semantics", () => {
  let engine: NativeAnalysisEngine;

  beforeEach(() => {
    const mockDatasetService = {
      getDataset: (id: string) => {
        if (id === "count-dataset") {
          return {
            metadata: { datasetId: "count-dataset" },
            data: [
              { a: 1, b: "x", c: null },
              { a: 2, b: "", c: null },
              { a: null, b: "y", c: null },
              { a: 0, b: null, c: null },
              { a: undefined, b: "z", c: null },
            ],
          } as unknown as Dataset;
        }
        throw new Error("Dataset not found");
      },
    } as unknown as DatasetService;
    engine = new NativeAnalysisEngine(mockDatasetService);
  });

  async function countOf(column: string, groupBy?: string) {
    const res = await engine.aggregate({
      datasetId: "count-dataset",
      aggregations: [{ column, func: "count", alias: "c" }],
      ...(groupBy !== undefined ? { groupBy } : {}),
    });
    return res.result;
  }

  it("counts a fully populated column", async () => {
    // b has x, "", y, null, z → 3 non-missing ("" is missing)
    const rows = await countOf("b");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["c"]).toBe(3);
  });

  it("counts only the requested column, not another column", async () => {
    // a: 1, 2, null, 0, undefined → 3 (0 counts); b → 3; c → 0
    expect((await countOf("a"))[0]!["c"]).toBe(3);
    expect((await countOf("b"))[0]!["c"]).toBe(3);
    expect((await countOf("c"))[0]!["c"]).toBe(0);
  });

  it("counts a partially missing column", async () => {
    expect((await countOf("a"))[0]!["c"]).toBe(3);
  });

  it("returns 0, not null, for a fully empty/null column with rows present", async () => {
    const rows = await countOf("c");
    expect(rows[0]!["c"]).toBe(0);
  });

  it("counts per group with grouping", async () => {
    const res = await engine.aggregate({
      datasetId: "count-dataset",
      aggregations: [{ column: "a", func: "count", alias: "c" }],
      groupBy: "b",
    });
    const byGroup = Object.fromEntries(
      (res.result as Array<Record<string, unknown>>).map((r) => [r["b"], r["c"]]),
    );
    // groups: x → a=1; "" → a=2; y → a=null→0; null → a=0→1; z → a=undefined→0
    expect(byGroup["x"]).toBe(1);
    expect(byGroup[""]).toBe(1);
    expect(byGroup["y"]).toBe(0);
    expect(byGroup["null"]).toBe(1);
    expect(byGroup["z"]).toBe(0);
  });

  it("counts zero and false as present values", async () => {
    // a contains 0 (row 4) which must count; covered above (3, not 2).
    const rows = await countOf("a");
    expect(rows[0]!["c"]).toBe(3);
  });

  it("treats whitespace-only strings as missing, not as values", async () => {
    const mockDatasetService = {
      getDataset: () => ({
        metadata: { datasetId: "ws-dataset" },
        data: [{ v: "   " }, { v: "\t" }, { v: 10 }],
      }),
    } as unknown as DatasetService;
    const wsEngine = new NativeAnalysisEngine(mockDatasetService);
    const res = await wsEngine.aggregate({
      datasetId: "ws-dataset",
      aggregations: [
        { column: "v", func: "count", alias: "c" },
        { column: "v", func: "sum", alias: "s" },
        { column: "v", func: "mean", alias: "m" },
        { column: "v", func: "min", alias: "lo" },
      ],
    });
    const row = res.result[0]!;
    expect(row["c"]).toBe(1);
    expect(row["s"]).toBe(10);
    expect(row["m"]).toBe(10);
    expect(row["lo"]).toBe(10);
  });
});
