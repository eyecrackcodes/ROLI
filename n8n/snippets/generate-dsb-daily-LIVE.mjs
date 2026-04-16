/**
 * Builds gitignored n8n/dsb-daily-scrape-v5-pool-LIVE.json for copy-paste into n8n.
 *
 * Pulls ROLI Supabase anon + URL from n8n/snippets/hourly-fetch-with-marketing.js (if present).
 * Pulls Slack webhook from n8n/hourly-action-alert-LIVE.json Send to Slack (if present).
 * Optional Apify + CRM: create gitignored n8n/dsb-daily-n8n-secrets.json:
 *   { "apifyToken": "...", "crmUsername": "...", "crmPassword": "...", "slackWebhookDsb": "..." }
 *   (slackWebhookDsb overrides hourly Slack for DSB-only channel if set.)
 *
 * Run from repo root: node n8n/snippets/generate-dsb-daily-LIVE.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const n8nRoot = path.join(__dirname, "..");
const templatePath = path.join(n8nRoot, "dsb-daily-scrape-v5-pool.json");
const outPath = path.join(n8nRoot, "dsb-daily-scrape-v5-pool-LIVE.json");
const fetchJsPath = path.join(__dirname, "hourly-fetch-with-marketing.js");
const hourlyLivePath = path.join(n8nRoot, "hourly-action-alert-LIVE.json");
const extraPath = path.join(n8nRoot, "dsb-daily-n8n-secrets.json");

function parseRoliFromFetchJs(js) {
  let apikey = "";
  let origin = "";
  const mKey = js.match(/const apikey\s*=\s*(?:\n\s*)?['"]([^'"]+)['"]/);
  if (mKey) apikey = mKey[1];
  const mBase = js.match(/let base\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
  if (mBase) origin = mBase[1].replace(/\/+$/, "");
  const refMatch = origin.match(/https:\/\/([^.]+)\.supabase\.co/);
  const projectRef = refMatch ? refMatch[1] : "";
  return { apikey, origin, projectRef };
}

function parseSlackFromHourlyLive(text) {
  try {
    const j = JSON.parse(text);
    const n = j.nodes?.find((x) => x.name === "Send to Slack");
    const url = n?.parameters?.url;
    return typeof url === "string" && url.startsWith("http") ? url : "";
  } catch {
    return "";
  }
}

const j = JSON.parse(fs.readFileSync(templatePath, "utf8"));

let roli = { apikey: "", origin: "", projectRef: "" };
if (fs.existsSync(fetchJsPath)) {
  roli = parseRoliFromFetchJs(fs.readFileSync(fetchJsPath, "utf8"));
}

let slackDsb = "";
if (fs.existsSync(hourlyLivePath)) {
  slackDsb = parseSlackFromHourlyLive(fs.readFileSync(hourlyLivePath, "utf8"));
}

let apifyToken = "";
let crmUser = "";
let crmPass = "";
if (fs.existsSync(extraPath)) {
  try {
    const x = JSON.parse(fs.readFileSync(extraPath, "utf8"));
    apifyToken = String(x.apifyToken || "").trim();
    crmUser = String(x.crmUsername || "").trim();
    crmPass = String(x.crmPassword || "").trim();
    if (String(x.slackWebhookDsb || "").trim().startsWith("http")) {
      slackDsb = String(x.slackWebhookDsb).trim();
    }
  } catch (e) {
    console.warn("Could not parse dsb-daily-n8n-secrets.json:", e.message);
  }
}

const ref = roli.projectRef || "YOUR_SUPABASE_PROJECT_REF";
const sbOrigin = roli.origin || `https://${ref}.supabase.co`;
const anon = roli.apikey || "YOUR_ROLI_ANON_KEY";
const slack = slackDsb || "YOUR_SLACK_INBOUND_WEBHOOK_URL";
const apify = apifyToken || "YOUR_APIFY_TOKEN";
const crmU = crmUser || "YOUR_CRM_USERNAME";
const crmP = crmPass || "YOUR_CRM_PASSWORD";

const ingestBase = `${sbOrigin}/functions/v1`;

for (const n of j.nodes) {
  if (n.name === "Start Apify Run") {
    n.parameters.url = `https://api.apify.com/v2/acts/MIlgC3KEFTXzIcnMt/runs?token=${apify}`;
    const scrapeIife = `(() => { const central = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); const [y,m,dd] = central.split('-').map(Number); const d = new Date(y, m-1, dd); const day = d.getDay(); if (day === 0) d.setDate(d.getDate() - 2); else if (day === 6) d.setDate(d.getDate() - 1); const py = d.getFullYear(); const pm = String(d.getMonth()+1).padStart(2,'0'); const pd = String(d.getDate()).padStart(2,'0'); return py+'-'+pm+'-'+pd; })()`;
    n.parameters.jsonBody = `={{ JSON.stringify({ crmUsername: ${JSON.stringify(crmU)}, crmPassword: ${JSON.stringify(crmP)}, poolReconcileDays: 5, saleMadeOutboundTypeBySite: { RMT: '', AUS: '' }, scrapeDate: ${scrapeIife} }) }}`;
  }
  if (n.name === "Check Run Status") {
    n.parameters.url = `=https://api.apify.com/v2/actor-runs/{{ $node['Start Apify Run'].json.data.id }}?token=${apify}`;
  }
  if (n.name === "Fetch Dataset & Build Payload" && n.parameters.jsCode) {
    n.parameters.jsCode = n.parameters.jsCode.replace(
      /const token = 'YOUR_APIFY_TOKEN';/,
      `const token = '${apify.replace(/'/g, "\\'")}';`
    );
  }
  if (n.type === "n8n-nodes-base.httpRequest" && n.parameters?.url) {
    const u = n.parameters.url;
    if (typeof u === "string" && u.includes("ingest-daily-scrape")) {
      n.parameters.url = `${ingestBase}/ingest-daily-scrape`;
    }
    if (typeof u === "string" && u.includes("ingest-leads-pool")) {
      n.parameters.url = `${ingestBase}/ingest-leads-pool`;
    }
    if (typeof u === "string" && u.includes("ingest-agent-performance")) {
      n.parameters.url = `${ingestBase}/ingest-agent-performance`;
    }
    if (u === "YOUR_SLACK_INBOUND_WEBHOOK_URL") {
      if (n.name === "Send to Slack" || n.name === "Alert Slack Error") {
        n.parameters.url = slack;
      }
    }
  }
  if (n.name === "Build Slack Summary" && n.parameters.jsCode) {
    let code = n.parameters.jsCode;
    code = code.replace(
      /const apikey = "YOUR_ROLI_ANON_KEY"/,
      `const apikey = ${JSON.stringify(anon)}`
    );
    code = code.replace(
      /const base = "https:\/\/YOUR_SUPABASE_PROJECT_REF\.supabase\.co\/rest\/v1"/,
      `const base = ${JSON.stringify(`${sbOrigin}/rest/v1`)}`
    );
    n.parameters.jsCode = code;
  }
}

fs.writeFileSync(outPath, JSON.stringify(j, null, 2));
console.log("Wrote:", path.relative(process.cwd(), outPath));
if (!roli.projectRef) console.warn("ROLI: missing hourly-fetch-with-marketing.js — using template placeholders.");
if (slack === "YOUR_SLACK_INBOUND_WEBHOOK_URL")
  console.warn(
    "Slack: set webhook in hourly-action-alert-LIVE.json or dsb-daily-n8n-secrets.json slackWebhookDsb."
  );
if (!apifyToken)
  console.warn("Apify/CRM: add n8n/dsb-daily-n8n-secrets.json or edit LIVE JSON manually.");
