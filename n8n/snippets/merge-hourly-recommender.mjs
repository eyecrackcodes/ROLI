/**
 * Injects "Run Recommender + Pace Engine" code into n8n/hourly-action-alert.json
 * from hourly-recommender-with-marketing.js.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snippetPath = path.join(__dirname, "hourly-recommender-with-marketing.js");
const workflowPath = path.join(__dirname, "..", "hourly-action-alert.json");

const code = fs.readFileSync(snippetPath, "utf8");
const j = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const n = j.nodes.find((x) => x.name === "Run Recommender + Pace Engine");
if (!n) throw new Error('Node "Run Recommender + Pace Engine" not found');
n.parameters.jsCode = code;
fs.writeFileSync(workflowPath, JSON.stringify(j, null, 2));
console.log("Merged:", path.basename(snippetPath), "→", path.relative(process.cwd(), workflowPath));
