/**
 * Injects Fetch node code into n8n/hourly-action-alert.json.
 * Uses hourly-fetch-with-marketing.js if present (gitignored, may contain secrets),
 * otherwise hourly-fetch-with-marketing.example.js.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const local = path.join(__dirname, "hourly-fetch-with-marketing.js");
const example = path.join(__dirname, "hourly-fetch-with-marketing.example.js");
const workflowPath = path.join(__dirname, "..", "hourly-action-alert.json");

const useExample = process.argv.includes("--example");
const snippetPath = useExample ? example : fs.existsSync(local) ? local : example;
const code = fs.readFileSync(snippetPath, "utf8");
const j = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const n = j.nodes.find((x) => x.name === "Fetch All Data Sources");
if (!n) throw new Error('Node "Fetch All Data Sources" not found');
n.parameters.jsCode = code;
fs.writeFileSync(workflowPath, JSON.stringify(j, null, 2));
console.log("Merged:", path.basename(snippetPath), "→", path.relative(process.cwd(), workflowPath));
