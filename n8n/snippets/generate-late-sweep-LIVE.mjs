/**
 * Generate gitignored n8n/dsb-sales-late-sweep-LIVE.json with credentials inlined.
 * Pulls from n8n/dsb-daily-n8n-secrets.json (gitignored).
 *
 * Run: node n8n/snippets/generate-late-sweep-LIVE.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const templatePath = path.join(repoRoot, "n8n", "dsb-sales-late-sweep.json");
const outPath = path.join(repoRoot, "n8n", "dsb-sales-late-sweep-LIVE.json");
const secretsPath = path.join(repoRoot, "n8n", "dsb-daily-n8n-secrets.json");
const fetchJsPath = path.join(repoRoot, "n8n", "snippets", "hourly-fetch-with-marketing.js");
const hourlyLivePath = path.join(repoRoot, "n8n", "hourly-action-alert-LIVE.json");

if (!fs.existsSync(secretsPath)) {
  console.error(`Missing ${secretsPath}. Create it from dsb-daily-n8n-secrets.example.json.`);
  process.exit(1);
}
const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
const apifyToken = String(secrets.apifyToken || "").trim();
const crmUser = String(secrets.crmUsername || "").trim();
const crmPass = String(secrets.crmPassword || "").trim();
let supabaseRef = "";
let supabaseAnon = String(secrets.supabaseAnonKey || "").trim();
let supabaseUrl = String(secrets.supabaseUrl || "").trim();
if (supabaseUrl) {
  const m = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (m) supabaseRef = m[1];
}

if (!apifyToken || !crmUser || !crmPass) {
  console.error("dsb-daily-n8n-secrets.json is missing apifyToken, crmUsername, or crmPassword.");
  process.exit(1);
}

// Pull fallback Supabase creds from hourly-fetch-with-marketing.js if not in secrets.
if ((!supabaseRef || !supabaseAnon) && fs.existsSync(fetchJsPath)) {
  const js = fs.readFileSync(fetchJsPath, "utf8");
  const mKey = js.match(/const apikey\s*=\s*(?:\n\s*)?['"]([^'"]+)['"]/);
  if (mKey && !supabaseAnon) supabaseAnon = mKey[1];
  const mBase = js.match(/let base\s*=\s*['"](https?:\/\/[^'"]+)['"]/);
  if (mBase && !supabaseRef) {
    const m = mBase[1].match(/https:\/\/([^.]+)\.supabase\.co/);
    if (m) supabaseRef = m[1];
  }
}

// Pull Slack from hourly-action-alert-LIVE.json or secrets override.
let slack = String(secrets.slackWebhookDsb || "").trim();
if (!slack && fs.existsSync(hourlyLivePath)) {
  try {
    const j = JSON.parse(fs.readFileSync(hourlyLivePath, "utf8"));
    const n = j.nodes?.find((x) => x.name === "Send to Slack");
    const u = n?.parameters?.url;
    if (typeof u === "string" && u.startsWith("http")) slack = u;
  } catch {}
}

if (!supabaseRef || !supabaseAnon) {
  console.error("Could not resolve Supabase project ref or anon key. Add to dsb-daily-n8n-secrets.json.");
  process.exit(1);
}
if (!slack) {
  console.warn("No Slack webhook found — workflow will post to YOUR_SLACK_INBOUND_WEBHOOK_URL placeholder.");
  slack = "YOUR_SLACK_INBOUND_WEBHOOK_URL";
}

let txt = fs.readFileSync(templatePath, "utf8");
txt = txt
  .replaceAll("YOUR_APIFY_TOKEN", apifyToken)
  .replaceAll("YOUR_CRM_USERNAME", crmUser)
  .replaceAll("YOUR_CRM_PASSWORD", crmPass)
  .replaceAll("YOUR_SUPABASE_REF", supabaseRef)
  .replaceAll("YOUR_ROLI_ANON_KEY", supabaseAnon)
  .replaceAll("YOUR_SLACK_INBOUND_WEBHOOK_URL", slack);

fs.writeFileSync(outPath, txt);
console.log(`Wrote ${outPath}`);
console.log(`  Apify token : ${apifyToken.slice(0, 12)}...`);
console.log(`  CRM user    : ${crmUser}`);
console.log(`  Supabase ref: ${supabaseRef}`);
console.log(`  Slack       : ${slack.slice(0, 40)}${slack.length > 40 ? "..." : ""}`);
console.log(`\nNext: open n8n, import or paste this LIVE file, activate the workflow.`);
