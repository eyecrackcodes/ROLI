import { Actor, log } from "apify";
import { chromium, type Page } from "playwright";

// ============================================================
// DSB Pipeline Compliance Scraper — Apify Actor
// Scrapes the Advanced Dashboard Stats page per agent to extract
// pipeline hygiene metrics: past-due follow-ups, new leads,
// call queue size, today's follow-ups, and post-sale count.
// ============================================================

interface ActorInput {
  crmUsername: string;
  crmPassword: string;
  loginUrl?: string;
  targetAgents?: string[];
  agentTiers?: Record<string, string>;
  agentCrmIds?: Record<string, string>;
  nameAliases?: Record<string, string>;
  requestDelay?: number;
}

interface CrmAgentOption {
  agentId: string;
  name: string;
}

interface PipelineRecord {
  agent_name: string;
  agent_id_crm: string;
  tier: string;
  past_due_follow_ups: number;
  new_leads: number;
  call_queue_count: number;
  todays_follow_ups: number;
  post_sale_leads: number;
  total_stale: number;
  revenue_at_risk: number;
  projected_recovery: number;
}

const CRM_BASE = "https://crm.digitalseniorbenefits.com";
const DASHBOARD_URL = (agentId: string) =>
  `${CRM_BASE}/agent-advanced-dashboard-stats/?agent_id=${agentId}`;

// Unified model. The "stale lead" composite was retired in favour of CRM-native
// buckets the agent actually sees: Past Dues + Untouched (new leads) = Actionable.
// Active call queue is workload, not backlog — the cadence engine works it.
//
// `total_stale` and `revenue_at_risk` columns are kept in the DB for backwards
// compatibility but now hold the new honest math:
//   total_stale     = past_due + new_leads           (Actionable Leads)
//   revenue_at_risk = Actionable × AVG_PREMIUM       (Premium @ Stake — option B)
//   projected_recovery = 0 (deprecated; computed at query time when needed)
const AVG_PREMIUM = 700;

function todayISO(): string {
  const central = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const [y, m, dd] = central.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  else if (day === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function parseNumber(val: string | undefined | null): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$,\s]/g, "").trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function fuzzyMatch(crmName: string, targetName: string): boolean {
  const a = normalizeForMatch(crmName);
  const b = normalizeForMatch(targetName);
  if (a === b) return true;

  // Handle "Last, First" vs "First Last"
  const crmParts = crmName.split(",").map((s) => s.trim().toLowerCase());
  if (crmParts.length === 2) {
    const flipped = `${crmParts[1]}${crmParts[0]}`.replace(/[^a-z]/g, "");
    if (flipped === b) return true;
  }

  // Require both first AND last name tokens to appear in the CRM name
  const targetTokens = targetName.toLowerCase().split(/\s+/).map(t => t.replace(/[^a-z]/g, "")).filter(t => t.length > 1);
  const crmLower = crmName.toLowerCase();
  if (targetTokens.length >= 2 && targetTokens.every(tok => crmLower.includes(tok))) {
    return true;
  }

  return false;
}

async function login(page: Page, loginUrl: string, username: string, password: string): Promise<void> {
  log.info(`Navigating to login: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill('input[name="email"], input[name="username"], input[type="email"], input[type="text"]', username);
  await page.fill('input[name="password"], input[type="password"]', password);
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
  await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });
  log.info("Login successful");
}

async function extractAgentDropdown(page: Page): Promise<CrmAgentOption[]> {
  const firstAgentUrl = DASHBOARD_URL("1");
  log.info(`Loading dashboard to extract agent dropdown: ${firstAgentUrl}`);
  await page.goto(firstAgentUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  // The dropdown is a <select class="select2"> with option values = agent_id
  const options = await page.$$eval(
    'select.select2 option, select[name*="agent"] option, select#agent_id option',
    (opts) =>
      opts
        .map((opt) => ({
          agentId: (opt as HTMLOptionElement).value?.trim(),
          name: (opt as HTMLOptionElement).textContent?.trim() ?? "",
        }))
        .filter((o) => o.agentId && o.agentId !== "" && o.agentId !== "0" && o.name !== "")
  );

  log.info(`Extracted ${options.length} agent options from dropdown`);
  return options;
}

function matchAgents(
  dropdownOptions: CrmAgentOption[],
  targetNames: string[],
  aliases: Record<string, string> = {}
): CrmAgentOption[] {
  const matched: CrmAgentOption[] = [];
  const unmatched: string[] = [];

  for (const target of targetNames) {
    // Try direct fuzzy match first
    let match = dropdownOptions.find((opt) => fuzzyMatch(opt.name, target));

    // If no match and we have an alias, try matching with the CRM name alias
    if (!match && aliases[target]) {
      const alias = aliases[target];
      match = dropdownOptions.find((opt) => fuzzyMatch(opt.name, alias));
      if (match) {
        log.info(`Matched ${target} via alias "${alias}" → CRM ID ${match.agentId}`);
      }
    }

    if (match) {
      matched.push({ ...match, name: target }); // Use our canonical name
    } else {
      unmatched.push(target);
    }
  }

  if (unmatched.length > 0) {
    log.warning(`Could not match ${unmatched.length} agents to CRM dropdown: ${unmatched.join(", ")}`);
  }
  log.info(`Matched ${matched.length}/${targetNames.length} target agents to CRM IDs`);

  return matched;
}

async function scrapeDashboard(
  page: Page,
  agentId: string,
  agentName: string,
  tier: string,
  pslOverride?: number
): Promise<PipelineRecord> {
  const url = DASHBOARD_URL(agentId);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  const SPAN_IDS = [
    "past-due-follow-ups",
    "user-new-leads",
    "call-queue-count-field",
    "todays-follow-ups",
    "leads-in-post-sale",
  ];

  const readAll = async (): Promise<number[]> => {
    const vals: number[] = [];
    for (const spanId of SPAN_IDS) {
      const val = await page.$eval(`#${spanId}`, (el) => el.textContent?.trim() ?? "0").catch(() => "0");
      vals.push(parseNumber(val));
    }
    return vals;
  };

  // Wait for spans to appear in the DOM with any content
  try {
    await page.waitForFunction(
      (ids: string[]) => ids.every((id) => {
        const el = document.getElementById(id);
        return el && el.textContent !== null && el.textContent.trim() !== "";
      }),
      SPAN_IDS,
      { timeout: 10000 }
    );
  } catch {
    log.warning(`Some dashboard spans did not populate within 10s for ${agentName}`);
  }

  // Stability loop: read values, wait, read again until they stop changing.
  // The CRM page fires multiple AJAX calls that progressively update the spans.
  let prev = await readAll();
  let stable = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(2000);
    const current = await readAll();
    if (current.every((v, i) => v === prev[i])) {
      stable = true;
      break;
    }
    log.info(`  [${agentName}] Values still changing (attempt ${attempt + 1}): ${prev.join(",")} → ${current.join(",")}`);
    prev = current;
  }

  if (!stable) {
    log.warning(`  [${agentName}] Values did not stabilize after 4 attempts, using last read`);
  }

  const [pastDue, newLeads, callQueue, todaysFollowUps, postSale] = prev;

  log.info(`  → ${agentName}: PastDue=${pastDue} New=${newLeads} Queue=${callQueue} F/U=${todaysFollowUps} PostSale=${postSale}`);

  const psl = pslOverride ?? AVG_PREMIUM;
  // Simplified: actionable backlog the agent must clear NOW.
  const actionableLeads = pastDue + newLeads;
  const premiumAtStake = Math.round(actionableLeads * psl);

  return {
    agent_name: agentName,
    agent_id_crm: agentId,
    tier,
    past_due_follow_ups: pastDue,
    new_leads: newLeads,
    call_queue_count: callQueue,
    todays_follow_ups: todaysFollowUps,
    post_sale_leads: postSale,
    // Legacy column names — same physical fields, new honest math.
    total_stale: actionableLeads,
    revenue_at_risk: premiumAtStake,
    projected_recovery: 0,
  };
}

// ---- Main ----

await Actor.init();

try {
  const input = (await Actor.getInput()) as ActorInput;
  if (!input.crmUsername || !input.crmPassword) {
    throw new Error("CRM username and password are required");
  }

  const loginUrl = input.loginUrl || `${CRM_BASE}/login`;
  const targetAgents = input.targetAgents ?? [];
  const agentTiers = input.agentTiers ?? {};
  const knownIds = input.agentCrmIds ?? {};
  const aliases = input.nameAliases ?? {};
  const requestDelay = input.requestDelay ?? 1500;
  const scrapeDate = todayISO();

  if (targetAgents.length === 0) {
    log.warning("No target agents provided — nothing to scrape. Pass targetAgents array.");
    const dataset = await Actor.openDataset();
    await dataset.pushData({ _type: "pipeline_compliance", scrape_date: scrapeDate, agents: [], crmDropdown: [] });
    await Actor.exit();
  }

  log.info(`Pipeline Compliance scrape starting — ${targetAgents.length} target agents, date: ${scrapeDate}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await login(page, loginUrl, input.crmUsername, input.crmPassword);

  // Step 1: Extract the master dropdown to map names → CRM agent_ids
  const dropdownOptions = await extractAgentDropdown(page);

  // Step 2: Build agent list — use stored CRM IDs first, fuzzy match as fallback
  const matchedAgents: CrmAgentOption[] = [];
  const needsFuzzy: string[] = [];

  for (const name of targetAgents) {
    if (knownIds[name]) {
      matchedAgents.push({ agentId: knownIds[name], name });
      log.info(`Using stored CRM ID for ${name}: ${knownIds[name]}`);
    } else {
      needsFuzzy.push(name);
    }
  }

  if (needsFuzzy.length > 0) {
    log.info(`${needsFuzzy.length} agents need fuzzy matching (no stored CRM ID), ${Object.keys(aliases).length} aliases available`);
    const fuzzyMatched = matchAgents(dropdownOptions, needsFuzzy, aliases);
    matchedAgents.push(...fuzzyMatched);
  }

  log.info(`Total agents to scrape: ${matchedAgents.length} (${targetAgents.length - needsFuzzy.length} by ID, ${matchedAgents.length - (targetAgents.length - needsFuzzy.length)} by fuzzy match)`);

  // Step 3: Scrape each matched agent's dashboard
  const results: PipelineRecord[] = [];
  let scraped = 0;

  for (const agent of matchedAgents) {
    const tier = agentTiers[agent.name] ?? "T3";
    try {
      log.info(`[${++scraped}/${matchedAgents.length}] Scraping: ${agent.name} (ID: ${agent.agentId}, ${tier})`);
      const record = await scrapeDashboard(page, agent.agentId, agent.name, tier);
      results.push(record);

      // Log high-risk agents immediately
      if (record.total_stale > 20) {
        log.warning(`HIGH BACKLOG: ${agent.name} has ${record.total_stale} actionable leads ($${record.revenue_at_risk} premium @ stake)`);
      }
    } catch (err) {
      log.error(`Failed to scrape ${agent.name}: ${err instanceof Error ? err.message : err}`);
    }

    // Polite delay between requests
    if (scraped < matchedAgents.length) {
      await page.waitForTimeout(requestDelay);
    }
  }

  await browser.close();

  // Summary logging — total_stale column now holds Actionable Leads (Past Due + Untouched).
  const totalActionable = results.reduce((s, r) => s + r.total_stale, 0);
  const totalPremiumAtStake = results.reduce((s, r) => s + r.revenue_at_risk, 0);

  log.info(`\n========== PIPELINE COMPLIANCE SUMMARY ==========`);
  log.info(`Agents scraped: ${results.length}`);
  log.info(`Total actionable leads (past due + untouched): ${totalActionable}`);
  log.info(`Total premium @ stake: $${totalPremiumAtStake.toLocaleString()}`);

  for (const tier of ["T1", "T2", "T3"]) {
    const tierResults = results.filter((r) => r.tier === tier);
    if (tierResults.length > 0) {
      const tierActionable = tierResults.reduce((s, r) => s + r.total_stale, 0);
      const tierStake = tierResults.reduce((s, r) => s + r.revenue_at_risk, 0);
      log.info(`  ${tier}: ${tierResults.length} agents, ${tierActionable} actionable, $${tierStake.toLocaleString()} @ stake`);
    }
  }

  // Push results
  const dataset = await Actor.openDataset();
  await dataset.pushData({
    _type: "pipeline_compliance",
    scrape_date: scrapeDate,
    agents: results,
    crmDropdown: dropdownOptions,
    summary: {
      total_agents: results.length,
      total_actionable_leads: totalActionable,
      total_premium_at_stake: totalPremiumAtStake,
      unmatched_agents: targetAgents.length - matchedAgents.length,
    },
  });

  const { count } = (await dataset.getInfo()) ?? { count: 0 };
  log.info(`Dataset: ${count} items stored. Actor complete.`);
} catch (err) {
  log.error(`Actor failed: ${err instanceof Error ? err.message : err}`);
  throw err;
} finally {
  await Actor.exit();
}
