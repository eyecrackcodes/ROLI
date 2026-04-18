/**
 * Run an immediate Sales-only backfill for the past N business days using the
 * dsb-crm-scraper Apify actor (build with salesBackfillDates support), then
 * apply alias-resolved PATCH/INSERT against daily_scrape_data via PostgREST.
 *
 * This bypasses the not-yet-redeployed ingest-daily-scrape edge function so we
 * can lock in WTD truth NOW. Once the function is redeployed, the n8n workflow
 * (dsb-sales-late-sweep) will take over on a 3x/day schedule.
 *
 * Usage:
 *   node n8n/snippets/run-sales-backfill-now.mjs           # past 7 business days
 *   node n8n/snippets/run-sales-backfill-now.mjs 14        # past 14 business days
 *   node n8n/snippets/run-sales-backfill-now.mjs 2026-04-13 2026-04-14 ...  # explicit dates
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const secrets = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "n8n", "dsb-daily-n8n-secrets.json"), "utf8")
);
const { apifyToken, crmUsername, crmPassword, supabaseUrl, supabaseAnonKey } = secrets;
const APIFY_ACTOR_ID = "MIlgC3KEFTXzIcnMt";
const POLL_INTERVAL_MS = 15_000;
const POLL_MAX_MS = 30 * 60_000; // 30 min hard cap

const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
const hdr = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

// ---------- date list ----------
function pastBusinessDaysCST(n) {
  const central = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, d] = central.split("-").map(Number);
  const cur = new Date(y, m - 1, d);
  const out = [];
  while (out.length < n) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      out.push(
        cur.getFullYear() +
          "-" +
          String(cur.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(cur.getDate()).padStart(2, "0")
      );
    }
    cur.setDate(cur.getDate() - 1);
  }
  return out.reverse();
}

const args = process.argv.slice(2);
let backfillDates;
if (args.length === 0) {
  backfillDates = pastBusinessDaysCST(7);
} else if (args.length === 1 && /^\d+$/.test(args[0])) {
  backfillDates = pastBusinessDaysCST(Number(args[0]));
} else {
  backfillDates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
}
if (backfillDates.length === 0) {
  console.error("No valid backfill dates resolved. Pass YYYY-MM-DD args or a count.");
  process.exit(1);
}

// ---------- alias map ----------
async function loadAliasMap() {
  const r = await fetch(`${rest}/agent_name_aliases?select=crm_name,canonical_name`, { headers: hdr });
  if (!r.ok) throw new Error(`alias load failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  const map = new Map();
  for (const row of rows) {
    if (row?.crm_name && row?.canonical_name) map.set(row.crm_name.trim(), row.canonical_name.trim());
  }
  return map;
}
async function loadActiveAgentSet() {
  const r = await fetch(`${rest}/agents?select=name,is_active`, { headers: hdr });
  if (!r.ok) throw new Error(`agents load failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return new Set(rows.filter((x) => x.is_active).map((x) => x.name));
}
function resolveCanonical(name, aliasMap, activeSet) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  if (activeSet.has(trimmed)) return trimmed;
  const a = aliasMap.get(trimmed);
  if (a) return a;
  return trimmed; // fall back to raw -- still upsert under that name
}

// ---------- Apify ----------
async function startActor() {
  const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${apifyToken}`;
  const body = {
    crmUsername,
    crmPassword,
    salesBackfillDates: backfillDates,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Apify start failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data;
}
async function pollRun(runId) {
  const url = `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`;
  const start = Date.now();
  while (Date.now() - start < POLL_MAX_MS) {
    const r = await fetch(url);
    const j = await r.json();
    const s = j?.data?.status;
    process.stdout.write(`  [${new Date().toLocaleTimeString()}] status=${s}\n`);
    if (s === "SUCCEEDED") return j.data;
    if (s === "FAILED" || s === "ABORTED" || s === "TIMED-OUT") {
      throw new Error(`Apify run ended: ${s}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Apify run did not finish within poll cap");
}
async function fetchDataset(datasetId) {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&clean=true`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`dataset fetch failed: ${r.status} ${await r.text()}`);
  return await r.json();
}

// ---------- Supabase patch ----------
const SALE_COLS = ["ib_sales", "ob_sales", "custom_sales", "ib_premium", "ob_premium", "custom_premium"];

async function getRow(date, name) {
  const url = `${rest}/daily_scrape_data?scrape_date=eq.${date}&agent_name=eq.${encodeURIComponent(name)}&select=*`;
  const r = await fetch(url, { headers: hdr });
  if (!r.ok) throw new Error(`GET row failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}
async function patchRow(date, name, patch) {
  const url = `${rest}/daily_scrape_data?scrape_date=eq.${date}&agent_name=eq.${encodeURIComponent(name)}`;
  const r = await fetch(url, { method: "PATCH", headers: hdr, body: JSON.stringify(patch) });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text() };
}
async function insertRow(payload) {
  const url = `${rest}/daily_scrape_data`;
  const r = await fetch(url, { method: "POST", headers: hdr, body: JSON.stringify(payload) });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text() };
}

// ---------- main ----------
(async () => {
  console.log(`===== SALES BACKFILL (${backfillDates.length} dates) =====`);
  console.log(`Dates: ${backfillDates.join(", ")}\n`);

  const [aliasMap, activeSet] = await Promise.all([loadAliasMap(), loadActiveAgentSet()]);
  console.log(`Loaded ${aliasMap.size} aliases, ${activeSet.size} active agents.\n`);

  console.log(`Starting Apify actor ${APIFY_ACTOR_ID}...`);
  const run = await startActor();
  console.log(`  Run id: ${run.id}\n  Status URL: https://console.apify.com/actors/${APIFY_ACTOR_ID}/runs/${run.id}\n`);

  console.log(`Polling run...`);
  const finished = await pollRun(run.id);
  console.log(`Run finished. Fetching dataset ${finished.defaultDatasetId}...`);
  const items = await fetchDataset(finished.defaultDatasetId);
  const backfills = items.filter((i) => i._type === "sale_made_backfill");
  console.log(`  ${items.length} dataset items, ${backfills.length} sale_made_backfill items.\n`);

  let totalAgents = 0,
    patched = 0,
    inserted = 0,
    failed = 0,
    aliasResolved = 0;
  const log = [];

  for (const b of backfills) {
    const date = b.scrape_date;
    const agents = Array.isArray(b.agents) ? b.agents : [];
    console.log(`\n[${date}] ${agents.length} agents from CRM`);
    for (const a of agents) {
      totalAgents++;
      const canonical = resolveCanonical(a.agent_name, aliasMap, activeSet);
      if (canonical !== a.agent_name) aliasResolved++;
      const sales = {
        ib_sales: Number(a.ib_sales || 0),
        ob_sales: Number(a.ob_sales || 0),
        custom_sales: Number(a.custom_sales || 0),
        ib_premium: Number(a.ib_premium || 0),
        ob_premium: Number(a.ob_premium || 0),
        custom_premium: Number(a.custom_premium || 0),
      };
      const totalS = sales.ib_sales + sales.ob_sales + sales.custom_sales;
      if (totalS === 0) continue;

      const existing = await getRow(date, canonical);
      if (existing) {
        const patch = {};
        let needsUpdate = false;
        for (const c of SALE_COLS) {
          const cur = Number(existing[c] || 0);
          const next = Number(sales[c] || 0);
          // For counts (ib_sales/ob_sales/custom_sales) require exact diff.
          // For premiums use $1 tolerance to suppress float-precision noise.
          const isCount = c.endsWith("_sales");
          const diff = Math.abs(cur - next);
          if ((isCount && diff !== 0) || (!isCount && diff >= 1)) {
            patch[c] = next;
            needsUpdate = true;
          }
        }
        if (!needsUpdate) {
          continue;
        }
        const res = await patchRow(date, canonical, patch);
        if (res.ok) {
          patched++;
          log.push(`  ${date} ${canonical}: PATCH ${JSON.stringify(patch)}`);
        } else {
          failed++;
          log.push(`  ${date} ${canonical}: PATCH FAILED ${res.status} ${res.text}`);
        }
      } else {
        const payload = {
          scrape_date: date,
          agent_name: canonical,
          tier: a.tier || "T2",
          ib_leads_delivered: 0,
          ob_leads_delivered: 0,
          custom_leads: 0,
          total_dials: 0,
          talk_time_minutes: 0,
          ...sales,
        };
        const res = await insertRow(payload);
        if (res.ok) {
          inserted++;
          log.push(`  ${date} ${canonical}: INSERT (${totalS} sales / $${(sales.ib_premium + sales.ob_premium + sales.custom_premium).toFixed(0)})`);
        } else {
          failed++;
          log.push(`  ${date} ${canonical}: INSERT FAILED ${res.status} ${res.text}`);
        }
      }
    }
  }

  console.log(`\n===== SUMMARY =====`);
  console.log(`Dates processed   : ${backfills.length}`);
  console.log(`CRM agent rows    : ${totalAgents}`);
  console.log(`Alias resolved    : ${aliasResolved}`);
  console.log(`Patched           : ${patched}`);
  console.log(`Inserted          : ${inserted}`);
  console.log(`Failed            : ${failed}`);
  console.log(`\nDetails:`);
  for (const l of log) console.log(l);
})();
