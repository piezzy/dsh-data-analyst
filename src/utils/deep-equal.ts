/**
 * Deterministic deep equality for JSON-serializable values.
 *
 * Used by the verification service to compare a recorded evidence
 * result against a recomputed result (PRD §17). The comparison is:
 *
 * - order-insensitive for object keys (engine results are objects
 *   whose key order is not semantically meaningful)
 * - order-sensitive for arrays (engine result rows are ordered)
 * - NaN-aware (Object.is treats NaN === NaN)
 *
 * Evidence results are JSON values, so no special handling for
 * Date, Map, Set, etc. is required.
 */

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  const keysA = Object.keys(recordA);
  const keysB = Object.keys(recordB);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(recordB, key) &&
      deepEqual(recordA[key], recordB[key]),
  );
}
