/**
 * DSB daily scrape — Slack production digest (all active agents).
 * All agents are remote (RMT). No site filtering or grouping.
 * Merge: node n8n/snippets/merge-dsb-daily-slack.mjs
 *
 * Template uses YOUR_* placeholders; filled by generate-dsb-daily-LIVE.mjs for local paste.
 */
const payload = $node["Fetch Dataset & Build Payload"].json;
const agents = payload.agents || [];
const scrapeDate = payload.scrape_date;
const apikey = "YOUR_ROLI_ANON_KEY";
const base = "https://YOUR_SUPABASE_PROJECT_REF.supabase.co/rest/v1";
const hdr = { apikey: apikey };

const rosterNames = new Set();
try {
  const roster = await this.helpers.httpRequest({
    method: "GET",
    url: base + "/agents?select=name&is_active=eq.true",
    headers: hdr,
    json: true,
  });
  for (const r of roster) rosterNames.add(r.name);
} catch (e) {}

function inRoster(agentName) {
  return rosterNames.size === 0 || rosterNames.has(agentName);
}

const yd = new Date(scrapeDate);
yd.setDate(yd.getDate() - 1);
if (yd.getDay() === 0) yd.setDate(yd.getDate() - 2);
if (yd.getDay() === 6) yd.setDate(yd.getDate() - 1);
const yesterdayStr = yd.toISOString().slice(0, 10);
let yData = [];
try {
  yData = await this.helpers.httpRequest({
    method: "GET",
    url:
      base +
      "/daily_scrape_data?select=agent_name,ib_sales,ob_sales,custom_sales,ib_premium,ob_premium,custom_premium&scrape_date=eq." +
      yesterdayStr,
    headers: hdr,
    json: true,
  });
} catch (e) {}

let ySales = 0, yPremium = 0;
for (const a of yData) {
  if (!inRoster(a.agent_name)) continue;
  ySales += (a.ib_sales || 0) + (a.ob_sales || 0) + (a.custom_sales || 0);
  yPremium += (a.ib_premium || 0) + (a.ob_premium || 0) + (a.custom_premium || 0);
}

let totalS = 0, totalP = 0, totalIBL = 0, totalOBL = 0, totalIBS = 0, totalOBS = 0, totalBonS = 0, totalBonP = 0, agentCount = 0;

for (const a of agents) {
  const name = a.agent_name || a.name;
  if (!inRoster(name)) continue;
  agentCount++;
  totalIBS += a.ib_sales || 0;
  totalOBS += a.ob_sales || 0;
  totalBonS += a.custom_sales || 0;
  totalP += (a.ib_premium || 0) + (a.ob_premium || 0);
  totalBonP += a.custom_premium || 0;
  totalIBL += a.ib_leads_delivered || 0;
  totalOBL += a.ob_leads_delivered || 0;
}
totalS = totalIBS + totalOBS + totalBonS;
totalP += totalBonP;

const fmt = (n) => "$" + Math.round(n).toLocaleString();
const arrow = (curr, prev) => {
  if (prev === 0 && curr === 0) return "";
  if (prev === 0) return " :arrow_up:";
  const pct = (((curr - prev) / prev) * 100).toFixed(0);
  if (curr > prev) return " :chart_with_upwards_trend: +" + pct + "%";
  if (curr < prev) return " :chart_with_downwards_trend: " + pct + "%";
  return " :arrow_right: 0%";
};

const now = new Date();
const h = now.getUTCHours() - 6;
const ampm = h >= 12 ? "PM" : "AM";
const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
const mm = String(now.getUTCMinutes()).padStart(2, "0");
const time = h12 + ":" + mm + " " + ampm;

const totalIBCR = totalIBL > 0 ? ((totalIBS / totalIBL) * 100).toFixed(1) + "%" : "--";
const totalOBCR = totalOBL > 0 ? ((totalOBS / totalOBL) * 100).toFixed(1) + "%" : "--";
const totalLeads = totalIBL + totalOBL;
const overallCR = totalLeads > 0 ? (((totalIBS + totalOBS) / totalLeads) * 100).toFixed(1) + "%" : "--";

const hasYesterday = yData.length > 0;
const vsYesterday = hasYesterday
  ? "\n_vs yesterday:_ Sales" + arrow(totalS, ySales) + "  |  Premium" + arrow(totalP, yPremium)
  : "";

const poolAgents = payload.pool_agents || [];
const poolInventory = payload.pool_inventory || [];
let poolSection = "";
if (poolAgents.length > 0) {
  const inRosterPool = poolAgents.filter((a) => inRoster(a.agent_name));
  const poolCalls = inRosterPool.reduce((s, a) => s + (a.calls_made || 0), 0);
  const poolLong = inRosterPool.reduce((s, a) => s + (a.long_calls || 0), 0);
  const poolAssigned = inRosterPool.reduce((s, a) => s + (a.self_assigned_leads || 0), 0);
  const poolSales = inRosterPool.reduce((s, a) => s + (a.sales_made || 0), 0);
  const poolPrem = inRosterPool.reduce((s, a) => s + (a.premium || 0), 0);
  const poolAnswered = inRosterPool.reduce((s, a) => s + (a.answered_calls || 0), 0);
  const contactRate = poolCalls > 0 ? ((poolAnswered / poolCalls) * 100).toFixed(0) : "--";
  const totalPoolLeads = poolInventory.reduce((s, i) => s + (i.total_leads || 0), 0);
  poolSection =
    "\n\n:busts_in_silhouette: *Leads pool:*  " + inRosterPool.length + " agents  |  " +
    poolCalls + " calls  |  " + contactRate + "% contact rate\n" +
    poolLong + " long calls  |  " + poolAssigned + " self-assigned  |  " +
    poolSales + " sales  |  " + fmt(poolPrem) +
    (totalPoolLeads > 0 ? "\n:package: Pool inventory: " + totalPoolLeads + " contactable leads" : "");
}

const message = {
  text: "DSB production digest \u2014 " + scrapeDate,
  blocks: [
    { type: "header", text: { type: "plain_text", text: "DSB production digest \u2014 " + scrapeDate, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: "*" + agentCount + " agents* at *" + time + " CST*" } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text:
      "*" + totalS + " sales  |  " + fmt(totalP) + " premium*\n" +
      "IB CR: *" + totalIBCR + "*  |  OB CR: *" + totalOBCR + "*  |  Overall: *" + overallCR + "*" +
      (totalBonS > 0 ? "\n:star: *Bonus / custom:*  " + totalBonS + " sales  |  " + fmt(totalBonP) + " premium" : "") +
      vsYesterday + poolSection
    }},
    { type: "context", elements: [{ type: "mrkdwn", text: "Report date: " + scrapeDate + "  |  Ingested to Supabase  |  Next run in ~1 hour" }] },
  ],
};

return [{ json: message }];
