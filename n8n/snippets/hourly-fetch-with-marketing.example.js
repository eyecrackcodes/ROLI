/**
 * Safe template (committed). Replace every YOUR_* below, then merge into workflow:
 *   node n8n/snippets/merge-hourly-fetch.mjs --example
 * Or copy to `hourly-fetch-with-marketing.js` (gitignored): merge prefers that file.
 *
 * Remote hourly scope: RMT + AUS, selling or training. Operations excluded.
 * Intraday: cumulative MTD from latest snapshot + rolling deltas vs prior snapshot (≈ hourly scrape cadence).
 * Marketing blend: calendar week-to-date (Mon–last completed day) when AAR rows exist; else trailing 7 days.
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

/** Weekday index Sun=0..Sat=6 in America/Chicago (never parse locale strings into Date — breaks on n8n servers). */
function chicagoWeekdayShort(ms) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).format(new Date(ms));
}

function chicagoDateString(ms) {
  return new Date(ms).toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
}

/** Monday YYYY-MM-DD (Chicago) for the week containing `now`. */
let mondayStr = centralStr;
let tScan = now.getTime();
for (let i = 0; i < 8; i++) {
  if (chicagoWeekdayShort(tScan) === "Mon") {
    mondayStr = chicagoDateString(tScan);
    break;
  }
  tScan -= 24 * 60 * 60 * 1000;
}

const dowOrder = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const dayOfWeek = dowOrder[chicagoWeekdayShort(now.getTime())] ?? 1;
const daysThisWeek = Math.min(dayOfWeek === 0 ? 5 : dayOfWeek, 5);

function inCoachingScope(a) {
  const st = String(a.agent_status || "selling").toLowerCase();
  return st === "selling" || st === "training";
}

function isPlaceholder(v) {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "" || s.startsWith("YOUR_");
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

/** Mean of marketing rows; `summaryMode` documents blend (week resets Monday CST). */
function averageMarketingRows(rows, anchorDate, summaryMode) {
  if (!rows || rows.length === 0) return null;
  const norm = rows.map((r) => rowFromMkt(r));
  const dates = [
    ...new Set(norm.map((r) => String(r.report_date).slice(0, 10))),
  ].sort();
  const from = dates[0] || anchorDate;
  const to = dates[dates.length - 1] || anchorDate;
  const n = norm.length;
  const mean = (pick) => norm.reduce((s, r) => s + pick(r), 0) / n;
  const sumCost = norm.reduce((s, r) => s + r.total_cost, 0);
  const sumSales = norm.reduce((s, r) => s + r.total_sales, 0);
  const costPerSale = sumSales > 0 ? Math.round(sumCost / sumSales) : 0;
  return {
    report_date: anchorDate,
    total_cost: mean((r) => r.total_cost),
    cpc: mean((r) => r.cpc),
    total_calls: Math.round(mean((r) => r.total_calls)),
    total_sales: Math.round(mean((r) => r.total_sales)),
    total_premium: mean((r) => r.total_premium),
    avg_premium: mean((r) => r.avg_premium),
    roas: mean((r) => r.roas),
    marketing_acq_pct: mean((r) => r.marketing_acq_pct),
    cost_per_sale: costPerSale,
    summary_mode: summaryMode || "rolling_7d_intraday",
    rolling_window: { from, to, days: n, resets_monday_cst: true },
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
  mktWeekWtd,
  mktLast7,
] = await Promise.all([
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/agents?select=name,site,tier,manager,agent_status&is_active=eq.true`,
    headers: hdr,
    json: true,
  }),
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/daily_scrape_data?select=agent_name,scrape_date,ib_leads_delivered,ob_leads_delivered,ib_sales,ob_sales,custom_sales&scrape_date=gte.${mondayStr}&scrape_date=lte.${centralStr}&order=scrape_date.asc&limit=5000`,
    headers: hdr,
    json: true,
  }),
  this.helpers.httpRequest({
    method: "GET",
    url: `${base}/intraday_snapshots?select=agent_name,scrape_hour,total_dials,talk_time_minutes,ib_leads_delivered,ib_sales,ob_leads_delivered,ob_sales,ib_premium,ob_premium,custom_premium,pool_dials,pool_talk_minutes,pool_self_assigned,pool_answered,pool_long_calls&scrape_date=eq.${centralStr}&limit=5000`,
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
  mktGet(
    `report_date=gte.${mondayStr}&report_date=lt.${centralStr}&order=report_date.asc`
  ),
  mktGet(`report_date=lt.${centralStr}&order=report_date.desc&limit=7`),
]);

const mktTodayEq = Array.isArray(mktExact) && mktExact[0] ? mktExact[0] : null;
let mktRow = mktTodayEq;
if (!mktRow && mktConfigured) {
  const mktLatest = await mktGet("order=report_date.desc&limit=1");
  mktRow = mktLatest[0] || null;
}

const weekRows = Array.isArray(mktWeekWtd) ? mktWeekWtd : [];
const last7 = Array.isArray(mktLast7) ? mktLast7 : [];
const useWeekBlend = weekRows.length > 0;
const blended = averageMarketingRows(
  useWeekBlend ? weekRows : last7,
  centralStr,
  useWeekBlend ? "week_to_date_cst" : "rolling_7d_fallback"
);

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

function num(x) {
  return Number(x) || 0;
}

/** Latest snapshot at or before `maxHour`, vs prior snapshot — rolling production between scrapes (~1h). */
function buildIntradayRolling(rows, maxHour) {
  const sorted = [...rows].sort(
    (a, b) => Number(a.scrape_hour) - Number(b.scrape_hour)
  );
  const upTo = sorted.filter((r) => Number(r.scrape_hour) <= maxHour);
  const latest =
    upTo.length > 0 ? upTo[upTo.length - 1] : sorted[sorted.length - 1];
  if (!latest) return null;
  const prior = upTo.length >= 2 ? upTo[upTo.length - 2] : null;
  /** Only defined when two snapshots exist — otherwise cumulative would fake a "rolling hour". */
  const roll = (k) =>
    prior ? Math.max(0, num(latest[k]) - num(prior[k])) : null;
  return {
    scrape_hour: latest.scrape_hour,
    total_dials: num(latest.total_dials),
    talk_time_minutes: num(latest.talk_time_minutes),
    ib_leads_delivered: num(latest.ib_leads_delivered),
    ob_leads_delivered: num(latest.ob_leads_delivered),
    ib_sales: num(latest.ib_sales),
    ob_sales: num(latest.ob_sales),
    custom_sales: num(latest.custom_sales),
    ib_premium: num(latest.ib_premium),
    ob_premium: num(latest.ob_premium),
    custom_premium: num(latest.custom_premium),
    pool_dials: num(latest.pool_dials),
    pool_talk_minutes: num(latest.pool_talk_minutes),
    pool_self_assigned: num(latest.pool_self_assigned),
    pool_answered: num(latest.pool_answered),
    pool_long_calls: num(latest.pool_long_calls),
    rolling_anchor_hour: maxHour,
    rolling_prior_hour: prior ? prior.scrape_hour : null,
    rolling_hour_dials: roll("total_dials"),
    rolling_hour_talk_min: roll("talk_time_minutes"),
    rolling_hour_pool_dials: roll("pool_dials"),
    rolling_hour_pool_talk_min: roll("pool_talk_minutes"),
    rolling_hour_pool_self: roll("pool_self_assigned"),
    rolling_hour_pool_answered: roll("pool_answered"),
    rolling_hour_pool_long: roll("pool_long_calls"),
    rolling_hour_ib_leads: roll("ib_leads_delivered"),
    rolling_hour_ob_leads: roll("ob_leads_delivered"),
    rolling_hour_ib_sales: roll("ib_sales"),
    rolling_hour_ob_sales: roll("ob_sales"),
    rolling_hour_custom_sales: roll("custom_sales"),
  };
}

const intradayByAgent = {};
for (const r of intradayData || []) {
  if (!rosterMap[r.agent_name]) continue;
  if (!intradayByAgent[r.agent_name]) intradayByAgent[r.agent_name] = [];
  intradayByAgent[r.agent_name].push(r);
}

const intradayMap = {};
for (const name of Object.keys(rosterMap)) {
  const rows = intradayByAgent[name];
  intradayMap[name] =
    rows && rows.length ? buildIntradayRolling(rows, centralHour) : null;
}

const pipeMap = {};
for (const r of pipelineData || []) {
  if (rosterMap[r.agent_name]) pipeMap[r.agent_name] = r;
}

const poolMapData = {};
for (const r of poolData || []) {
  if (rosterMap[r.agent_name]) poolMapData[r.agent_name] = r;
}

const coachingFiltered = roster.filter(inCoachingScope);

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
      orgAgentCount: roster.length,
      agentCount: coachingFiltered.length,
      marketingDaily,
      leadCostOverride,
      avgPremiumOverride,
    },
  },
];
