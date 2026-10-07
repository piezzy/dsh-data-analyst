/**
 * Deterministic ID generator for datasets and future investigation artifacts.
 *
 * IDs are sequential within a session and follow the naming convention
 * used in PRD examples: dataset-001, investigation-001, evidence-001, etc.
 */

const counters: Map<string, number> = new Map();

/**
 * Generate the next sequential ID for a given prefix.
 *
 * @example
 *   nextId("dataset")     // "dataset-001"
 *   nextId("dataset")     // "dataset-002"
 *   nextId("evidence")    // "evidence-001"
 */
export function nextId(prefix: string): string {
  const current = counters.get(prefix) ?? 0;
  const next = current + 1;
  counters.set(prefix, next);
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

/**
 * Reset all counters. Intended for use in tests only.
 */
export function resetCounters(): void {
  counters.clear();
}
