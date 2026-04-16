/**
 * Refreshes gitignored n8n/hourly-action-alert-LIVE.json from local snippets:
 * - Fetch: hourly-fetch-with-marketing.js (your keys — gitignored)
 * - Recommender: hourly-recommender-with-marketing.js
 * - Slack: build-hourly-slack-alert.js
 *
 * Preserves your Slack webhook URLs and all node metadata already in LIVE.
 *
 * Usage: node n8n/snippets/merge-hourly-action-LIVE.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const livePath = path.join(__dirname, "..", "hourly-action-alert-LIVE.json");
const fetchPath = path.join(__dirname, "hourly-fetch-with-marketing.js");
const recPath = path.join(__dirname, "hourly-recommender-with-marketing.js");
const slackPath = path.join(__dirname, "build-hourly-slack-alert.js");

if (!fs.existsSync(livePath)) {
  console.error("Missing:", livePath);
  process.exit(1);
}
if (!fs.existsSync(fetchPath)) {
  console.error("Missing local fetch (keys):", fetchPath);
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(livePath, "utf8"));
const fetchCode = fs.readFileSync(fetchPath, "utf8");
const recCode = fs.readFileSync(recPath, "utf8");
const slackCode = fs.readFileSync(slackPath, "utf8");

const nf = j.nodes.find((x) => x.name === "Fetch All Data Sources");
const nr = j.nodes.find((x) => x.name === "Run Recommender + Pace Engine");
const ns = j.nodes.find((x) => x.name === "Build Unified Slack Alert");
if (!nf || !nr || !ns) throw new Error("Expected code nodes not found in LIVE workflow");

nf.parameters.jsCode = fetchCode;
nr.parameters.jsCode = recCode;
ns.parameters.jsCode = slackCode;

fs.writeFileSync(livePath, JSON.stringify(j, null, 2));
console.log("Updated LIVE workflow:", path.relative(process.cwd(), livePath));
