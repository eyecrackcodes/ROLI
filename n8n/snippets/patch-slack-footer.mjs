import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, "..", "hourly-action-alert.json");
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const n = j.nodes.find((x) => x.name === "Build Unified Slack Alert");
const s = n.parameters.jsCode;

const old =
  "  `Targets: CR ${cfg.CR_TARGET}%+ (1 deal per ${cfg.DAILY_LEADS} leads)  |  Pipeline \\u2264${cfg.MAX_PIPELINE}  |  Pool: ${cfg.POOL_DAILY_ASSIGNS} assigns/day, ${cfg.POOL_WEEKLY_SALES} sale/wk  |  Past Due: 0`";
const neu =
  "  `Targets: CR ${cfg.CR_TARGET}%+ (1 deal per ${cfg.DAILY_LEADS} leads)  |  Pipeline \\u2264${cfg.MAX_PIPELINE}  |  Pool: ${cfg.POOL_DAILY_ASSIGNS} assigns/day, ${cfg.POOL_WEEKLY_SALES} sale/wk  |  Past Due: 0  |  CPC: $${cfg.LEAD_COST}  |  Org avg prem: $${cfg.AVG_PREMIUM_ORG}`";

console.log("includes old:", s.includes(old));
if (s.includes(old) && !s.includes("Org avg prem")) {
  n.parameters.jsCode = s.replace(old, neu);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
  console.log("patched");
} else {
  console.log("skip or already patched");
}
