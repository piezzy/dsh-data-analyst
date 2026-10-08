/**
 * Deterministic generator for M8 realistic fixture: sales-2024.csv
 * Seeded PRNG (mulberry32, seed 42). No dependencies.
 * Run: node tests/fixtures/generate-sales-2024.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "sales-2024.csv");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const regions = ["North", "South", "East", "West"];
const products = ["Widget A", "Widget B", "Widget C"];
const regionEffect = { North: 25000, South: -15000, East: 8000, West: 0 };
const productEffect = { "Widget A": 12000, "Widget B": 0, "Widget C": -6000 };

const BASE_ROWS = 1000;
const rows = [];

for (let i = 0; i < BASE_ROWS; i++) {
  // Spread dates across leap year 2024 deterministically (~366 distinct days).
  const dayOffset = (i * 37) % 366;
  const d = new Date(Date.UTC(2024, 0, 1) + dayOffset * 86400000);
  const date = d.toISOString().slice(0, 10);
  const month = d.getUTCMonth() + 1;
  const region = regions[i % regions.length];
  const product = products[Math.floor(i / regions.length) % products.length];
  const monthTrend = (month - 1) * 3000;
  const noise = (rand() - 0.5) * 10000;
  let revenue = 80000 + monthTrend + regionEffect[region] + productEffect[product] + noise;
  revenue = Math.round(revenue * 100) / 100;
  let quantity = 20 + Math.floor(rand() * 150) + (product === "Widget A" ? 10 : 0);

  // Deterministic missing values (~2% revenue, ~1.4% quantity)
  const revenueCell = i % 50 === 0 ? "" : revenue.toFixed(2);
  const quantityCell = i % 71 === 0 ? "" : String(quantity);

  rows.push({ date, region, product, revenue: revenueCell, quantity: quantityCell });
}

// Deterministic duplicates: copy 20 evenly spaced rows
for (let k = 0; k < 20; k++) {
  const src = rows[k * 10];
  rows.push({ ...src });
}

const header = "date,region,product,revenue,quantity";
const lines = [header, ...rows.map((r) => `${r.date},${r.region},${r.product},${r.revenue},${r.quantity}`)];
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`Wrote ${OUT}: ${rows.length} rows`);
