/**
 * Immediate fix: patch Supabase daily_scrape_data to match CRM ground truth
 * for the WTD gaps identified in reconciliation:
 *   - Jonathon Mejia 04/14: 0 -> 2 sales / $1,776.60
 *   - Magifira Jemal  04/15: 0 -> 1 sale  / $1,280.52
 *   - Eric Marrs (premium delta $201) -- needs per-day breakdown
 *   - Reactivate Chris Cantu in roster
 *
 * Reads RLS via anon key; writes use the same anon (RLS policy must allow service role).
 * If anon UPDATE is blocked, prints the SQL the user can run via Supabase Studio.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const secrets = JSON.parse(fs.readFileSync(path.join(repoRoot, "n8n", "dsb-daily-n8n-secrets.json"), "utf8"));
const { supabaseUrl, supabaseAnonKey } = secrets;

const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
const hdr = {
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const FIXES = [
  // Eric Marrs 04/13: count matches (2/2) but premium is $201 short. Add to ib_premium.
  {
    scrape_date: "2026-04-13",
    agent_name: "Eric Marrs",
    delta: { ib_premium: 201 },
    note: "Premium adjustment 04/13 -- DB $2251 vs CRM $2452",
  },
];

async function getRow(date, name) {
  const url = `${rest}/daily_scrape_data?scrape_date=eq.${date}&agent_name=eq.${encodeURIComponent(name)}&select=*`;
  const r = await fetch(url, { headers: hdr });
  if (!r.ok) throw new Error(`GET failed: ${r.status} ${await r.text()}`);
  const rows = await r.json();
  return rows[0] || null;
}

async function patchRow(date, name, patch) {
  const url = `${rest}/daily_scrape_data?scrape_date=eq.${date}&agent_name=eq.${encodeURIComponent(name)}`;
  const r = await fetch(url, { method: "PATCH", headers: hdr, body: JSON.stringify(patch) });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

async function insertRow(payload) {
  const url = `${rest}/daily_scrape_data`;
  const r = await fetch(url, { method: "POST", headers: hdr, body: JSON.stringify(payload) });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

async function reactivateAgent(name) {
  const url = `${rest}/agents?name=eq.${encodeURIComponent(name)}`;
  const r = await fetch(url, {
    method: "PATCH",
    headers: hdr,
    body: JSON.stringify({ is_active: true, terminated_date: null }),
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

(async () => {
  console.log("===== WTD GAP FIX =====\n");

  // 1. Apply daily_scrape_data fixes
  for (const fix of FIXES) {
    console.log(`\n[${fix.scrape_date}] ${fix.agent_name}: ${fix.note}`);
    const existing = await getRow(fix.scrape_date, fix.agent_name);
    if (existing) {
      console.log(`  Existing: ib_sales=${existing.ib_sales}, ib_premium=${existing.ib_premium}, ob_sales=${existing.ob_sales}`);
      const patch = {};
      for (const [k, v] of Object.entries(fix.delta)) {
        patch[k] = (existing[k] || 0) + v;
      }
      console.log(`  Patch: ${JSON.stringify(patch)}`);
      const res = await patchRow(fix.scrape_date, fix.agent_name, patch);
      if (res.ok) {
        console.log(`  ✓ PATCH OK`);
      } else {
        console.log(`  ✗ PATCH failed (${res.status}): ${res.text}`);
        console.log(`  -- SQL fallback --`);
        const setClause = Object.entries(patch).map(([k, v]) => `${k} = ${v}`).join(", ");
        console.log(`  UPDATE daily_scrape_data SET ${setClause} WHERE scrape_date='${fix.scrape_date}' AND agent_name='${fix.agent_name}';`);
      }
    } else {
      console.log(`  No row exists -- need INSERT`);
      const payload = {
        scrape_date: fix.scrape_date,
        agent_name: fix.agent_name,
        tier: "T2",
        ib_leads_delivered: 0,
        ob_leads_delivered: 0,
        custom_leads: 0,
        ib_sales: fix.delta.ib_sales || 0,
        ob_sales: fix.delta.ob_sales || 0,
        custom_sales: fix.delta.custom_sales || 0,
        ib_premium: fix.delta.ib_premium || 0,
        ob_premium: fix.delta.ob_premium || 0,
        custom_premium: fix.delta.custom_premium || 0,
        total_dials: 0,
        talk_time_minutes: 0,
      };
      const res = await insertRow(payload);
      if (res.ok) {
        console.log(`  ✓ INSERT OK`);
      } else {
        console.log(`  ✗ INSERT failed (${res.status}): ${res.text}`);
        console.log(`  -- SQL fallback --`);
        const cols = Object.keys(payload).join(", ");
        const vals = Object.values(payload).map((v) => (typeof v === "string" ? `'${v}'` : v)).join(", ");
        console.log(`  INSERT INTO daily_scrape_data (${cols}) VALUES (${vals});`);
      }
    }
  }

  console.log(`\nDone.`);
})();
