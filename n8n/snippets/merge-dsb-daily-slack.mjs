/**
 * Injects Build Slack Summary from dsb-build-slack-production-digest.js
 * into n8n/dsb-daily-scrape-v5-pool.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snippet = path.join(__dirname, "dsb-build-slack-production-digest.js");
const workflowPath = path.join(__dirname, "..", "dsb-daily-scrape-v5-pool.json");

const code = fs.readFileSync(snippet, "utf8");
const j = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const n = j.nodes.find((x) => x.name === "Build Slack Summary");
if (!n) throw new Error("Build Slack Summary node not found");
n.parameters.jsCode = code;
fs.writeFileSync(workflowPath, JSON.stringify(j, null, 2));
console.log("Merged DSB Slack digest →", path.relative(process.cwd(), workflowPath));
