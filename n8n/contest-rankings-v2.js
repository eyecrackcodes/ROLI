// ══════════════════════════════════════════════════════════════════
// T3 WEEKLY GRIND — Contest Standings Engine (v2)
// Includes Leads Pool dials & talk time, with/without-sales rankings,
// and daily point verification breakdown for agent transparency.
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://bcibmmbxrjfiulofserv.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjaWJtbWJ4cmpmaXVsb2ZzZXJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTMzNzAsImV4cCI6MjA4OTY4OTM3MH0.IIuxX_m34M4QOPORUr7v04AO3aLgdQnvMhD8rOjVnhQ';
const SHEET_ID = '1Z3DuoOrmpapM7bAOBjGK93vGdBOZxCI8sHHJEq0ICqI';
const PAD_ROWS = 200;
const COLS = 13;
const hdr = { apikey: SUPABASE_KEY };
const PRIZES = ['$300', '$250', '$200', '$150', '$100'];

const p2 = n => String(n).padStart(2, '0');
const fmtDate = d => d.getFullYear() + '-' + p2(d.getMonth()+1) + '-' + p2(d.getDate());
const fmtShort = d => p2(d.getMonth()+1) + '/' + p2(d.getDate());
const fmtCurrency = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const ordinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
const getDayName = dateStr => {
  const d = new Date(dateStr + 'T12:00:00');
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
};

// ── Time Context (Central Time) ──
const now = new Date();
const ctStr = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
const ct = new Date(ctStr);
let dow = ct.getDay();
const hour = ct.getHours();
const min = ct.getMinutes();

const today = new Date(ct);
if (dow === 0) today.setDate(today.getDate() - 2);
if (dow === 6) today.setDate(today.getDate() - 1);
dow = today.getDay();
const todayStr = fmtDate(today);

const monday = new Date(today);
monday.setDate(today.getDate() - (dow - 1));
const mondayStr = fmtDate(monday);
const friday = new Date(monday);
friday.setDate(monday.getDate() + 4);
const fridayStr = fmtDate(friday);

const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const todayLabel = dayNames[dow] || '';
const isFinal = (hour === 17 && min >= 30) || hour > 17;
const runType = isFinal ? 'FINAL' : 'LIVE';
const h12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
const ampm = hour >= 12 ? 'PM' : 'AM';
const timeLabel = h12 + ':' + p2(min) + ' ' + ampm;

// ── Fetch from Supabase (read-only) ──
const roster = await this.helpers.httpRequest({
  method: 'GET',
  url: SUPABASE_URL + '/agents?tier=eq.T3&is_active=eq.true&select=name,site',
  headers: hdr, json: true
});

const weekData = await this.helpers.httpRequest({
  method: 'GET',
  url: SUPABASE_URL + '/daily_scrape_data?tier=eq.T3&scrape_date=gte.' + mondayStr + '&scrape_date=lte.' + fridayStr + '&select=agent_name,scrape_date,total_dials,talk_time_minutes,ib_sales,ob_sales,custom_sales,ib_premium,ob_premium,custom_premium',
  headers: hdr, json: true
});

const poolData = await this.helpers.httpRequest({
  method: 'GET',
  url: SUPABASE_URL + '/leads_pool_daily_data?scrape_date=gte.' + mondayStr + '&scrape_date=lte.' + fridayStr + '&select=agent_name,scrape_date,calls_made,talk_time_minutes',
  headers: hdr, json: true
});

const siteMap = {};
const rosterNames = new Set();
for (const a of roster) { siteMap[a.name] = a.site; rosterNames.add(a.name); }

// ── Build records from CRM data ──
const records = {};
for (const r of weekData) {
  const key = r.scrape_date + '|' + r.agent_name;
  records[key] = {
    name: r.agent_name, date: r.scrape_date,
    site: siteMap[r.agent_name] || 'CHA',
    crmDials: r.total_dials || 0,
    crmTalk: parseFloat(r.talk_time_minutes) || 0,
    poolDials: 0, poolTalk: 0,
    dials: r.total_dials || 0,
    talkTime: parseFloat(r.talk_time_minutes) || 0,
    sales: (r.ib_sales||0) + (r.ob_sales||0) + (r.custom_sales||0),
    premium: (parseFloat(r.ib_premium)||0) + (parseFloat(r.ob_premium)||0) + (parseFloat(r.custom_premium)||0)
  };
}

// ── Merge pool data (only T3 roster agents get credit) ──
for (const p of poolData) {
  if (!rosterNames.has(p.agent_name)) continue;
  const key = p.scrape_date + '|' + p.agent_name;
  const pd = p.calls_made || 0;
  const pt = parseFloat(p.talk_time_minutes) || 0;
  if (records[key]) {
    records[key].poolDials = pd;
    records[key].poolTalk = pt;
    records[key].dials += pd;
    records[key].talkTime += pt;
  } else {
    records[key] = {
      name: p.agent_name, date: p.scrape_date,
      site: siteMap[p.agent_name] || 'CHA',
      crmDials: 0, crmTalk: 0,
      poolDials: pd, poolTalk: pt,
      dials: pd, talkTime: pt,
      sales: 0, premium: 0
    };
  }
}

const dates = [...new Set(Object.values(records).map(r => r.date))].sort();
const sites = ['AUS', 'CHA'];

// ── Ranking Engine ──
function rankAndScore(agentList, metric) {
  const sorted = [...agentList].sort((a, b) => b[metric] - a[metric]);
  const pts = {};
  const scale = [5, 4, 3, 2, 1];
  let pos = 0, i = 0;
  while (i < sorted.length) {
    const val = sorted[i][metric];
    let j = i;
    while (j < sorted.length && sorted[j][metric] === val) j++;
    const p = (val > 0 && pos < 5) ? scale[pos] : 0;
    for (let k = i; k < j; k++) pts[sorted[k].name] = p;
    pos += (j - i);
    i = j;
  }
  return pts;
}

// ── Accumulate Points + Daily Details ──
const wkD = {}, wkT = {}, wkS = {}, tdP = {}, tdD = {};
for (const a of roster) {
  wkD[a.name] = 0; wkT[a.name] = 0; wkS[a.name] = 0;
  tdP[a.name] = { d: 0, t: 0, s: 0 };
  tdD[a.name] = { dials: 0, talk: 0, sales: 0, premium: 0, crmDials: 0, poolDials: 0, crmTalk: 0, poolTalk: 0 };
}

const dayLog = {};
for (const date of dates) {
  dayLog[date] = {};
  for (const site of sites) {
    const agents = Object.values(records).filter(r => r.date === date && r.site === site);
    if (!agents.length) { dayLog[date][site] = []; continue; }

    const dp = rankAndScore(agents, 'dials');
    const tp = rankAndScore(agents, 'talkTime');
    const sp = rankAndScore(agents, 'sales');

    dayLog[date][site] = agents.map(a => ({
      name: a.name,
      crmDials: a.crmDials, poolDials: a.poolDials, dials: a.dials,
      crmTalk: Math.round(a.crmTalk), poolTalk: Math.round(a.poolTalk), talkTime: Math.round(a.talkTime),
      sales: a.sales, premium: a.premium,
      dialsPts: dp[a.name] || 0, talkPts: tp[a.name] || 0, salesPts: sp[a.name] || 0,
      dayTotal: (dp[a.name]||0) + (tp[a.name]||0) + (sp[a.name]||0),
      dayTotalNoSales: (dp[a.name]||0) + (tp[a.name]||0)
    })).sort((a, b) => b.dayTotal - a.dayTotal || b.dials - a.dials || a.name.localeCompare(b.name));

    for (const a of agents) {
      const d = dp[a.name]||0, t = tp[a.name]||0, s = sp[a.name]||0;
      wkD[a.name] = (wkD[a.name]||0) + d;
      wkT[a.name] = (wkT[a.name]||0) + t;
      wkS[a.name] = (wkS[a.name]||0) + s;
      if (date === todayStr) {
        tdP[a.name] = { d, t, s };
        tdD[a.name] = { dials: a.dials, talk: a.talkTime, sales: a.sales, premium: a.premium, crmDials: a.crmDials, poolDials: a.poolDials, crmTalk: a.crmTalk, poolTalk: a.poolTalk };
      }
    }
  }
}

// ── Build ranked list for a site ──
function getSiteRanked(site) {
  return roster
    .filter(a => a.site === site)
    .map(a => {
      const tp = tdP[a.name] || { d: 0, t: 0, s: 0 };
      const td = tdD[a.name] || { dials: 0, talk: 0, sales: 0, premium: 0, crmDials: 0, poolDials: 0, crmTalk: 0, poolTalk: 0 };
      const dayTotal = tp.d + tp.t + tp.s;
      const weekly = (wkD[a.name]||0) + (wkT[a.name]||0) + (wkS[a.name]||0);
      const weeklyNoSales = (wkD[a.name]||0) + (wkT[a.name]||0);
      return { name: a.name, weekly, weeklyNoSales, dayTotal, wkD: wkD[a.name]||0, wkT: wkT[a.name]||0, wkS: wkS[a.name]||0, tp, td };
    })
    .sort((a, b) => b.weekly - a.weekly || b.dayTotal - a.dayTotal || a.name.localeCompare(b.name));
}

// ══════════════════════════════════════
// GOOGLE SHEET
// ══════════════════════════════════════
const emptyRow = new Array(COLS).fill('');
const rows = [];

const sheetTitle = 'T3 WEEKLY GRIND \u2014 Mon ' + fmtShort(monday) + ' thru Fri ' + fmtShort(friday);
const sheetSub = 'Updated ' + todayLabel + ' ' + timeLabel + ' CT \u00B7 ' + runType + ' \u00B7 Includes Leads Pool dials & talk time';
rows.push([sheetTitle, '', '', '', '', '', '', '', '', '', '', '', '']);
rows.push([sheetSub, '', '', '', '', '', '', '', '', '', '', '', '']);
rows.push(emptyRow);

for (const site of sites) {
  const siteLabel = site === 'AUS' ? 'AUSTIN (AUS)' : 'CHARLOTTE (CHA)';
  rows.push([siteLabel, '', '', '', '', '', '', '', '1st $300 / 2nd $250 / 3rd $200 / 4th $150 / 5th $100', '', '', '', '']);
  rows.push(['#', 'Prize', 'Agent', 'Dials Pts', 'Talk Pts', 'Sales Pts', 'WEEKLY PTS', 'PTS (no Sales)', 'Today Dials', 'Today Talk', 'Today Sales', 'Today Premium', 'Today Pts']);

  getSiteRanked(site).forEach((a, i) => {
    rows.push([
      ordinal(i + 1),
      i < 5 ? PRIZES[i] : '--',
      a.name,
      a.wkD || '--',
      a.wkT || '--',
      a.wkS || '--',
      a.weekly || '--',
      a.weeklyNoSales || '--',
      a.td.dials,
      Math.round(a.td.talk) + ' min',
      a.td.sales,
      fmtCurrency(a.td.premium),
      a.dayTotal || '--'
    ]);
  });
  rows.push(emptyRow);
}

// ── Daily Point Verification Section ──
rows.push(emptyRow);
rows.push(['\u2550\u2550\u2550 DAILY POINT VERIFICATION \u2550\u2550\u2550', '', '', '', '', '', '', '', '', '', '', '', '']);
rows.push(['Agents earn 5/4/3/2/1 pts for 1st\u20135th place per metric per day per site. Zero activity = 0 pts. Pool dials & talk are merged into totals.', '', '', '', '', '', '', '', '', '', '', '', '']);
rows.push(emptyRow);

for (const date of dates) {
  const d = new Date(date + 'T12:00:00');
  const dateHeader = getDayName(date).toUpperCase() + ' ' + fmtShort(d);

  for (const site of sites) {
    const siteCode = site === 'AUS' ? 'AUS' : 'CHA';
    const entries = (dayLog[date] && dayLog[date][site]) || [];
    if (!entries.length) continue;

    rows.push([dateHeader + ' \u2014 ' + siteCode, '', '', '', '', '', '', '', '', '', '', '', '']);
    rows.push(['Agent', 'CRM Dials', 'Pool Dials', 'Total Dials', 'CRM Talk', 'Pool Talk', 'Total Talk', 'Sales', 'Dials Pts', 'Talk Pts', 'Sales Pts', 'Day Pts', 'Pts (no Sales)']);

    for (const e of entries) {
      rows.push([
        e.name,
        e.crmDials,
        e.poolDials || '',
        e.dials,
        e.crmTalk + ' min',
        e.poolTalk ? e.poolTalk + ' min' : '',
        e.talkTime + ' min',
        e.sales,
        e.dialsPts || '--',
        e.talkPts || '--',
        e.salesPts || '--',
        e.dayTotal || '--',
        e.dayTotalNoSales || '--'
      ]);
    }
    rows.push(emptyRow);
  }
}

while (rows.length < PAD_ROWS) rows.push(emptyRow);

// ══════════════════════════════════════
// SLACK (Block Kit)
// ══════════════════════════════════════
const medals = [':first_place_medal:', ':second_place_medal:', ':third_place_medal:', ':four:', ':five:'];
const blocks = [];

blocks.push({ type: 'header', text: { type: 'plain_text', text: ':fire:  T3 WEEKLY GRIND  :fire:', emoji: true } });

blocks.push({ type: 'context', elements: [
  { type: 'mrkdwn', text: 'Mon ' + fmtShort(monday) + ' \u2013 Fri ' + fmtShort(friday) + '  |  ' + todayLabel + ' ' + timeLabel + ' CT  |  *' + runType + '*  |  _Pool dials & talk included_' }
] });

blocks.push({ type: 'divider' });

for (const site of sites) {
  const siteCode = site === 'AUS' ? 'ATX' : 'CLT';
  const siteFull = site === 'AUS' ? 'AUSTIN' : 'CHARLOTTE';
  const ranked = getSiteRanked(site).slice(0, 5);

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ':trophy:  *' + siteFull + ' (' + siteCode + ')*' } });

  const lines = [];
  ranked.forEach((a, i) => {
    lines.push(medals[i] + '  *' + a.name + '*  \u2014  *' + a.weekly + ' pts*  (' + a.weeklyNoSales + ' w/o sales)  (' + PRIZES[i] + ')');
    const poolNote = a.td.poolDials ? '  \u00B7  +' + a.td.poolDials + ' pool dials' : '';
    lines.push('      ' + a.td.dials + ' dials  \u00B7  ' + Math.round(a.td.talk) + ' min  \u00B7  ' + a.td.sales + ' sales  \u00B7  ' + fmtCurrency(a.td.premium) + poolNote);
    lines.push('');
  });

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } });

  if (site === 'AUS') blocks.push({ type: 'divider' });
}

blocks.push({ type: 'context', elements: [
  { type: 'mrkdwn', text: '_Scoring: 1st=5  2nd=4  3rd=3  4th=2  5th=1  \u00B7  Dials + Talk Time + Sales  \u00B7  Max ' + (dow * 15) + ' pts (' + dow + ' days)  \u00B7  Pool dials & talk count toward totals_' }
] });

const fallbackText = ':fire: T3 Weekly Grind \u2014 ' + todayLabel + ' ' + timeLabel + ' CT (' + runType + ')';

return [{ json: {
  writeBody: JSON.stringify({ values: rows }),
  slackBody: JSON.stringify({ text: fallbackText, blocks }),
  title: sheetTitle,
  runType
} }];
