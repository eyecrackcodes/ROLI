import fs from "fs";

/**
 * Builds a migration SQL file from a saved Supabase MCP response (JSON with .result
 * string containing untrusted-data payload wrapper).
 *
 * Usage: node scripts/build-marketing-backfill.mjs <path-to-mcp-output.txt> [--out=custom.sql]
 */

const argv = process.argv.slice(2);
const outArg = argv.find((a) => a.startsWith("--out="));
const outPath = outArg ? outArg.slice("--out=".length) : "supabase/migrations/011_backfill_daily_marketing_summary.sql";
const src = argv.find((a) => !a.startsWith("--"));
if (!src) {
  console.error("Usage: node scripts/build-marketing-backfill.mjs <path-to-mcp-output.txt> [--out=custom.sql]");
  process.exit(1);
}

const raw = fs.readFileSync(src, "utf8");
const outer = JSON.parse(raw);
const r = outer.result;
const start = r.indexOf('[{"payload"');
if (start < 0) throw new Error('Could not find [{"payload" in MCP .result string');

/** MCP may use \\n or \\r\\n before </untrusted-data> */
function findPayloadEnd(s, from) {
  const a = s.indexOf("}]\n</untrusted-data", from);
  const b = s.indexOf("}]\r\n</untrusted-data", from);
  const c = s.indexOf("}]</untrusted-data", from);
  const candidates = [a, b, c].filter((i) => i >= 0);
  if (candidates.length === 0) throw new Error("Could not locate end }]</untrusted-data in MCP output");
  return Math.min(...candidates);
}

const endMarker = findPayloadEnd(r, start);
const afterClose = r.slice(endMarker, endMarker + 5);
const closeLen = afterClose.startsWith("}]\r\n") ? 4 : afterClose.startsWith("}]\n") ? 3 : 2;

const arr = JSON.parse(r.slice(start, endMarker + closeLen));
const payload = arr[0].payload;
if (!Array.isArray(payload) || payload.length === 0) throw new Error("payload is empty or not an array");
for (const row of payload) {
  if (!row || typeof row.report_date !== "string") throw new Error("Each row must have report_date string");
}

const json = JSON.stringify(payload);
const tag = "mktjson";
const sql = `-- Backfill daily_marketing_summary from marketingAar company_daily_metrics (${payload.length} rows)
INSERT INTO daily_marketing_summary (
  report_date, total_cost, cpc, total_calls, total_sales, total_premium, avg_premium, roas, marketing_acq_pct, cost_per_sale
)
SELECT
  (e->>'report_date')::date,
  (e->>'total_cost')::numeric,
  (e->>'cpc')::numeric,
  (e->>'total_calls')::integer,
  (e->>'total_sales')::integer,
  (e->>'total_premium')::numeric,
  (e->>'avg_premium')::numeric,
  (e->>'roas')::numeric,
  (e->>'marketing_acq_pct')::numeric,
  (e->>'cost_per_sale')::integer
FROM jsonb_array_elements($${tag}$${json}$${tag}$::jsonb) AS e
ON CONFLICT (report_date) DO UPDATE SET
  total_cost = EXCLUDED.total_cost,
  cpc = EXCLUDED.cpc,
  total_calls = EXCLUDED.total_calls,
  total_sales = EXCLUDED.total_sales,
  total_premium = EXCLUDED.total_premium,
  avg_premium = EXCLUDED.avg_premium,
  roas = EXCLUDED.roas,
  marketing_acq_pct = EXCLUDED.marketing_acq_pct,
  cost_per_sale = EXCLUDED.cost_per_sale,
  synced_at = now();
`;

fs.writeFileSync(outPath, sql);
console.log("Wrote", outPath, sql.length, "bytes,", payload.length, "rows");
