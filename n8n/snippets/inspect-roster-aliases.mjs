/** Inspect the current roster + aliases vs CRM names to find missing entries. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const secrets = JSON.parse(fs.readFileSync(path.join(repoRoot, "n8n", "dsb-daily-n8n-secrets.json"), "utf8"));
const { supabaseUrl, supabaseAnonKey } = secrets;

const rest = supabaseUrl.replace(/\/+$/, "") + "/rest/v1";
const hdr = { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` };

const CRM_NAMES_OBSERVED = [
  "Arron Hutton Sr", "Eric Marrs", "John Sivy", "Jonathan K Dubbs", "Leslie S Chandler",
  "Magifira Jemal", "Ugo Bosah", "Kameron Dollar", "Matthew Reyes", "Jonathon Mejia",
  "Drew Idahosa", "Frederick Holguin", "Freddy Holguin", "Chris Cantu", "Mark Kaufman",
  "Benjamin Martin", "Mario Herrera", "Noah Wimberly", "Austin Houser", "Jonathan K Dubbs",
  "Tanya Nel", "Melodee Young", "Andrew Idahosa", "Jonathan Dubbs", "AD Hutton",
];

(async () => {
  const [aliasesR, agentsR] = await Promise.all([
    fetch(`${rest}/agent_name_aliases?select=*&order=canonical_name`, { headers: hdr }),
    fetch(`${rest}/agents?select=name,site,is_active,terminated_date,crm_agent_id&order=name`, { headers: hdr }),
  ]);
  if (!aliasesR.ok) {
    console.error(`aliases fetch failed: ${aliasesR.status} ${await aliasesR.text()}`);
  }
  const aliases = aliasesR.ok ? await aliasesR.json() : [];
  const agents = agentsR.ok ? await agentsR.json() : [];

  console.log(`\n${aliases.length} aliases:`);
  for (const a of aliases) console.log(`  "${a.crm_name}" -> "${a.canonical_name}"${a.is_active === false ? " (inactive)" : ""}`);

  console.log(`\n${agents.filter(a=>a.is_active).length} active agents:`);
  for (const a of agents.filter(a=>a.is_active)) console.log(`  ${a.name.padEnd(28)} site=${a.site} crm_id=${a.crm_agent_id || "-"}`);

  console.log(`\n${agents.filter(a=>!a.is_active).length} INACTIVE agents (terminated):`);
  for (const a of agents.filter(a=>!a.is_active)) console.log(`  ${a.name.padEnd(28)} terminated=${a.terminated_date || "-"}`);

  console.log("\n========== CRM NAMES OBSERVED ==========");
  const aliasMap = Object.fromEntries(aliases.map(a => [a.crm_name, a.canonical_name]));
  const activeNames = new Set(agents.filter(a=>a.is_active).map(a=>a.name));
  const allNames = new Set(agents.map(a=>a.name));

  for (const crmName of [...new Set(CRM_NAMES_OBSERVED)].sort()) {
    let resolved;
    let status;
    if (activeNames.has(crmName)) { resolved = crmName; status = "DIRECT_ACTIVE"; }
    else if (aliasMap[crmName]) {
      const canon = aliasMap[crmName];
      if (activeNames.has(canon)) { resolved = canon; status = "ALIAS_OK"; }
      else if (allNames.has(canon)) { resolved = canon; status = "ALIAS_TO_INACTIVE"; }
      else { resolved = canon; status = "ALIAS_TO_NONEXISTENT"; }
    }
    else if (allNames.has(crmName)) { resolved = crmName; status = "DIRECT_INACTIVE"; }
    else { resolved = null; status = "NEEDS_ALIAS_OR_ROSTER_ADD"; }
    console.log(`  ${crmName.padEnd(28)} ${status.padEnd(28)} ${resolved ?? "(no canonical)"}`);
  }
})();
