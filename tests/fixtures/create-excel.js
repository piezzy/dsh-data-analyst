import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = [
  { date: "2024-01-15", product: "Widget A", region: "Jakarta", revenue: 150000.50, quantity: 100, is_active: true },
  { date: "2024-01-16", product: "Widget B", region: "Bandung", revenue: 85000.00, quantity: 50, is_active: false },
  { date: "2024-01-17", product: "Widget C", region: "Surabaya", revenue: 230000.75, quantity: 200, is_active: true },
  { date: "2024-02-01", product: "Widget A", region: "Jakarta", revenue: 145000.00, quantity: 95, is_active: true },
  { date: "2024-02-15", product: "Widget B", region: "Bandung", revenue: null, quantity: 45, is_active: false },
  { date: "2024-03-01", product: "Widget C", region: "Surabaya", revenue: 220000.00, quantity: 180, is_active: true }
];

const ws = XLSX.utils.json_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

const outputPath = path.join(__dirname, 'sample.xlsx');
XLSX.writeFile(wb, outputPath);
console.log(`Created ${outputPath}`);
