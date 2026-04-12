/**
 * Safe template (committed). Copy to `hourly-fetch-with-marketing.js` (gitignored), fill YOUR_*.
 * Merge into workflow JSON: `node n8n/snippets/merge-hourly-fetch.mjs` (prefers local gitignored file).
 */
const apikey = "YOUR_ROLI_ANON_KEY";
let base = "YOUR_ROLI_SUPABASE_URL";
base = base.replace(/\/+$/, "");

const mktApikey = "YOUR_MARKETING_AAR_ANON_KEY";
let mktBase = "YOUR_MARKETING_AAR_REST_URL";
mktBase = mktBase.replace(/\/+$/, "");

/** PostgREST base: `https://<ref>.supabase.co/rest/v1` */
function toRestV1(origin) {
  const u = origin.replace(/\/+$/, "");
  return /\/rest\/v1$/i.test(u) ? u : `${u}/rest/v1`;
}
base = toRestV1(base);
mktBase = toRestV1(mktBase);

const hdr = { apikey, Authorization: `Bearer ${apikey}` };
const hdrMkt = { apikey: mktApikey, Authorization: `Bearer ${mktApikey}` };

const now = new Date();
const centralStr = now.toLocaleDateString("en-CA", {
  timeZone: "America/Chicago",
});
const centralHour = Number(
  now.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  })
);

const centralNow = new Date(
  now.toLocaleString("en-US", { timeZone: "America/Chicago" })
);
const dayOfWeek = centralNow.getDay();
const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
const monday = new Date(centralNow);
monday.setDate(monday.getDate() - mondayOffset);
const mondayStr = monday.toISOString().slice(0, 10);
const daysThisWeek = Math.min(dayOfWeek === 0 ? 5 : dayOfWeek, 5);

function isPlaceholder(v) {
  return !v || String(v).startsWith("YOUR_");
}

const mktConfigured = !isPlaceholder(mktApikey) && !isPlaceholder(mktBase);

const mktCols =
  "report_date,total_cost,cpc,total_calls,total_sales,total_premium,avg_premium,roas,marketing_acq_pct";

/** Isolated GET so a Marketing 401/RLS error does not fail the whole ROLI fetch. */
const mktGet = async (queryAfterSelect) => {
  if (!mktConfigured) return [];
  try {
    const data = await this.helpers.httpRequest({
      method: "GET",
      url: `${mktBase}/company_daily_metrics?select=${mktCols}&${queryAfterSelect}`,
      headers: hdrMkt,
      json: true,
    });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

const DEFAULT_LEAD_COST = 60;
const DEFAULT_AVG_PREM = 1150;

function rowFromMkt(r) {
  const cpc = Number(r.cpc) || DEFAULT_LEAD_COST;
  const avgPrem = Number(r.avg_premium) || DEFAULT_AVG_PREM;
  const tCost = Number(r.total_cost) || 0;
  const tSales = Number(r.total_sales) || 0;
  const costPerSale = tSales > 0 ? Math.round(tCost / tSales) : 0;
  return {
    report_date: String(r.report_date ?? "").slice(0, 10),
    total_cost: tCost,
    cpc,
    total_calls: Number(r.total_calls) || 0,
    total_sales: tSales,
    total_premium: Number(r.total_premium) || 0,
    avg_premium: avgPrem,
    roas: Number(r.roas) || 0,
    marketing_acq_pct: Number(r.marketing_acq_pct) || 0,
    cost_per_sale: costPerSale,
  };
}

/** Mean of up to 7 completed AAR days (report_date < centralStr) for intraday CPC / org premium. */
function averageMarketingRows(rows, anchorDate) {
  if (!rows || rows.length === 0) return null;
  const norm = rows.map(r => rowFromMkt(r));
  const dates = [
    ...new Set(norm.map(r => String(r.report_date).slice(0, 10))),
  ].sort();
  const from = dates[0] || anchorDate;
  const to = dates[dates.length - 1] || anchorDate;
  const n = norm.length;
  const mean = pick => norm.reduce((s, r) => s + pick(r), 0) / n;
  const sumCost = norm.reduce((s, r) => s + r.total_cost, 0);
  const sumSales = norm.reduce((s, r) => s + r.total_sales, 0);
  const costPerSale = sumSales > 0 ? Math.round(sumCost / sumSales) : 0;
  return {
    report_date: anchorDate,
    total_cost: mean(r => r.total_cost),
    cpc: mean(r => r.cpc),
    total_calls: Math.round(mean(r => r.total_calls)),
    total_sales: Math.round(mean(r => r.total_sales)),
    total_premium: mean(r => r.total_premium),
    avg_premium: mean(r => r.avg_premium),
    roas: mean(r => r.roas),
    marketing_acq_pct: mean(r => r.marketing_acq_pct),
    cost_per_sale: costPerSale,
    summary_mode: "rolling_7d_intraday",
    rolling_window: { from, to, days: n },
  };
}

const [
  roster,
  weeklyData,
  intradayData,
  pipelineData,
  poolData,
  weeklyPoolData,
  mktExact,
  mktLast7,
] = await Promise.all([
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/agents?select=name,site,tier,manager&is_active=eq.true`,
    headers: hdr,
    json: true,
  }),
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/daily_scrape_data?select=agent_name,scrape_date,ib_leads_delivered,ob_leads_delivered,ib_sales,ob_sales,custom_sales&scrape_date=gte.${mondayStr}&scrape_date=lte.${centralStr}&order=scrape_date.asc`,
    headers: hdr,
    json: true,
  }),
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/intraday_snapshots?select=agent_name,scrape_hour,total_dials,talk_time_minutes,ib_leads_delivered,ib_sales,ob_leads_delivered,ob_sales,ib_premium,ob_premium,custom_premium,pool_dials,pool_talk_minutes,pool_self_assigned,pool_answered,pool_long_calls&scrape_date=eq.${centralStr}&order=scrape_hour.desc`,
    headers: hdr,
    json: true,
  }),
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/pipeline_compliance_daily?select=agent_name,past_due_follow_ups,new_leads,call_queue_count,todays_follow_ups&scrape_date=eq.${centralStr}`,
    headers: hdr,
    json: true,
  }),
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/leads_pool_daily_data?select=agent_name,calls_made,talk_time_minutes,self_assigned_leads,answered_calls,long_calls,sales_made&scrape_date=eq.${centralStr}`,
    headers: hdr,
    json: true,
  }),
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/leads_pool_daily_data?select=agent_name,sales_made&scrape_date=gte.${mondayStr}&scrape_date=lte.${centralStr}`,
    headers: hdr,
    json: true,
  }),
  mktGet(`report_date=eq.${centralStr}&limit=1`),
  mktGet(`report_date=lt.${centralStr}&order=report_date.desc&limit=7`),
]);

const mktTodayEq = Array.isArray(mktExact) && mktExact[0] ? mktExact[0] : null;
let mktRow = mktTodayEq;
if (!mktRow && mktConfigured) {
  const mktLatest = await mktGet("order=report_date.desc&limit=1");
  mktRow = mktLatest[0] || null;
}

const last7 = Array.isArray(mktLast7) ? mktLast7 : [];
const blended = averageMarketingRows(last7, centralStr);

let marketingDaily = null;
let leadCostOverride = DEFAULT_LEAD_COST;
let avgPremiumOverride = DEFAULT_AVG_PREM;

if (blended) {
  marketingDaily = blended;
  leadCostOverride = Math.round(blended.cpc);
  avgPremiumOverride = Math.round(blended.avg_premium);
} else if (mktRow) {
  marketingDaily = rowFromMkt(mktRow);
  leadCostOverride = Math.round(marketingDaily.cpc);
  avgPremiumOverride = Math.round(marketingDaily.avg_premium);
}

if (mktTodayEq) {
  const todayBody = rowFromMkt(mktTodayEq);
  try {
    await this.helpers.httpRequest({
      method: "POST",
      url: `${base}/daily_marketing_summary?on_conflict=report_date`,
      headers: {
        ...hdr,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: todayBody,
      json: true,
    });
  } catch (syncErr) {
    // Table may not exist yet or RLS — workflow continues
  }
}

if (!roster || roster.length === 0) {
  throw new Error("No active agents found");
}

const rosterMap = {};
for (const a of roster) rosterMap[a.name] = a;

const weeklyByAgent = {};
for (const r of weeklyData || []) {
  if (!rosterMap[r.agent_name]) continue;
  if (!weeklyByAgent[r.agent_name]) weeklyByAgent[r.agent_name] = [];
  weeklyByAgent[r.agent_name].push({
    date: r.scrape_date,
    ibLeads: r.ib_leads_delivered || 0,
    obLeads: r.ob_leads_delivered || 0,
    ibSales: r.ib_sales || 0,
    obSales: r.ob_sales || 0,
    customSales: r.custom_sales || 0,
  });
}

const weeklyPoolSales = {};
for (const r of weeklyPoolData || []) {
  if (!rosterMap[r.agent_name]) continue;
  weeklyPoolSales[r.agent_name] =
    (weeklyPoolSales[r.agent_name] || 0) + (r.sales_made || 0);
}

const intradayMap = {};
for (const r of intradayData || []) {
  if (!intradayMap[r.agent_name] && rosterMap[r.agent_name]) {
    intradayMap[r.agent_name] = r;
  }
}

const pipeMap = {};
for (const r of pipelineData || []) {
  if (rosterMap[r.agent_name]) pipeMap[r.agent_name] = r;
}

const poolMapData = {};
for (const r of poolData || []) {
  if (rosterMap[r.agent_name]) poolMapData[r.agent_name] = r;
}

return [
  {
    json: {
      scrapeDate: centralStr,
      centralHour,
      mondayStr,
      daysThisWeek,
      rosterMap,
      weeklyByAgent,
      weeklyPoolSales,
      intradayMap,
      pipeMap,
      poolMapData,
      agentCount: roster.length,
      marketingDaily,
      leadCostOverride,
      avgPremiumOverride,
    },
  },
];
