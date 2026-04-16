/**
 * Injects Build Unified Slack Alert code from build-hourly-slack-alert.js.
 * Usage: node n8n/snippets/merge-hourly-slack.mjs [path/to/workflow.json]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snippetPath = path.join(__dirname, "build-hourly-slack-alert.js");
const defaultWorkflow = path.join(__dirname, "..", "hourly-action-alert.json");
const workflowPath = path.resolve(process.argv[2] || defaultWorkflow);

const code = fs.readFileSync(snippetPath, "utf8");
const j = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const n = j.nodes.find((x) => x.name === "Build Unified Slack Alert");
if (!n) throw new Error('Node "Build Unified Slack Alert" not found');
n.parameters.jsCode = code;
fs.writeFileSync(workflowPath, JSON.stringify(j, null, 2));
console.log("Merged Slack →", path.relative(process.cwd(), workflowPath));
