const {
  scrapeDate,
  centralHour,
  daysThisWeek,
  rosterMap,
  weeklyByAgent,
  weeklyPoolSales,
  intradayMap,
  pipeMap,
  poolMapData,
  agentCount,
  leadCostOverride,
  avgPremiumOverride,
} = $input.first().json;

const DEFAULT_LC = 60;
const lc =
  typeof leadCostOverride === 'number' && leadCostOverride > 0 ? leadCostOverride : DEFAULT_LC;

const CFG = {
  DAILY_LEADS: 7,
  LEAD_COST: lc,
  CR_TARGET: 15,
  CR_FLOOR: 10,
  CR_CRISIS: 7,
  CR_CRISIS_DAYS: 3,
  MAX_PIPELINE: 30,
  PIPELINE_CRITICAL: 40,
  POOL_DAILY_ASSIGNS: 5,
  POOL_WEEKLY_SALES: 1,
  POOL_MIN_ASSIGN_RATE: 30,
  AVG_PREMIUM_ORG: typeof avgPremiumOverride === 'number' && avgPremiumOverride > 0 ? avgPremiumOverride : 1150,
};

function computeWeeklyCR(rows) {
  if (!rows || rows.length === 0) return { weeklyCR: null, dailyCRs: [], weekLeads: 0, weekSales: 0 };
  const dailyCRs = rows.map((r) => {
    const leads = r.ibLeads + r.obLeads;
    const sales = r.ibSales + r.obSales + r.customSales;
    return leads > 0 ? (sales / leads) * 100 : 0;
  });
  const totalLeads = rows.reduce((s, r) => s + r.ibLeads + r.obLeads, 0);
  const totalSales = rows.reduce((s, r) => s + r.ibSales + r.obSales + r.customSales, 0);
  return {
    weeklyCR: totalLeads > 0 ? (totalSales / totalLeads) * 100 : null,
    dailyCRs,
    weekLeads: totalLeads,
    weekSales: totalSales,
  };
}

function consLow(dailyCRs, threshold) {
  let c = 0;
  for (let i = dailyCRs.length - 1; i >= 0; i--) {
    if (dailyCRs[i] < threshold) c++;
    else break;
  }
  return c;
}

function recommend(weeklyCR, dailyCRs, weekLeads, weekSales, pipe, intra, pool, poolWeekSales) {
  const pastDue = pipe?.past_due_follow_ups ?? 0;
  const pipeSize = (pipe?.new_leads ?? 0) + (pipe?.todays_follow_ups ?? 0) + pastDue;
  const poolAssigns = pool?.self_assigned_leads ?? 0;
  const poolAnswered = pool?.answered_calls ?? 0;
  const assignRate = poolAnswered > 0 ? (poolAssigns / poolAnswered) * 100 : 0;
  const consLowDays = consLow(dailyCRs, CFG.CR_CRISIS);
  const isMidDay = centralHour >= 12;

  if (pastDue > 3)
    return {
      action: 'WORK_FOLLOWUPS',
      severity: 'critical',
      reason: `${pastDue} past due follow-ups — $${pastDue * CFG.LEAD_COST} in lead spend at risk.`,
    };

  if (pipeSize > CFG.PIPELINE_CRITICAL)
    return {
      action: 'CLEAR_PIPELINE',
      severity: 'critical',
      reason: `Pipeline at ${pipeSize} leads (critical threshold: ${CFG.PIPELINE_CRITICAL}). Revenue rotting.`,
    };

  if (consLowDays >= CFG.CR_CRISIS_DAYS && weeklyCR !== null)
    return {
      action: 'REVIEW_QUALITY',
      severity: 'critical',
      reason: `CR below ${CFG.CR_CRISIS}% for ${consLowDays} consecutive days (weekly: ${weeklyCR.toFixed(0)}%). Audit calls.`,
    };

  if (pastDue > 0)
    return {
      action: 'WORK_FOLLOWUPS',
      severity: 'warning',
      reason: `${pastDue} past due follow-up${pastDue > 1 ? 's' : ''}. Work before pool or inbound.`,
    };

  if (pipeSize > CFG.MAX_PIPELINE)
    return {
      action: 'CLEAR_PIPELINE',
      severity: 'warning',
      reason: `Pipeline at ${pipeSize} leads (max: ${CFG.MAX_PIPELINE}). Close out or withdraw stale leads.`,
    };

  if (weeklyCR !== null && weeklyCR < CFG.CR_FLOOR)
    return {
      action: 'FOCUS_PIPELINE',
      severity: 'warning',
      reason: `Weekly CR at ${weeklyCR.toFixed(0)}% (target: ${CFG.CR_TARGET}%). Focus on converting existing leads.`,
    };

  if (isMidDay && poolAssigns < 3)
    return {
      action: 'GET_IN_POOL',
      severity: 'warning',
      reason: `Only ${poolAssigns} pool self-assigns today (target: ${CFG.POOL_DAILY_ASSIGNS}). Find 5 people to follow up with.`,
    };

  if (poolAnswered >= 10 && assignRate < CFG.POOL_MIN_ASSIGN_RATE)
    return {
      action: 'GET_IN_POOL',
      severity: 'warning',
      reason: `Pool assign rate at ${assignRate.toFixed(0)}% (min: ${CFG.POOL_MIN_ASSIGN_RATE}%). Self-assign every answered contact.`,
    };

  if (weeklyCR !== null && weeklyCR >= CFG.CR_TARGET && pipeSize <= 20 && pastDue === 0)
    return {
      action: 'TAKE_MORE_LEADS',
      severity: 'info',
      reason: `CR at ${weeklyCR.toFixed(0)}% with clean pipeline (${pipeSize}). Eligible for additional inbound leads.`,
    };

  if (weeklyCR !== null && weeklyCR >= CFG.CR_FLOOR && pipeSize >= 10 && pipeSize <= CFG.MAX_PIPELINE)
    return {
      action: 'STAY_IN_QUEUE',
      severity: 'info',
      reason: `CR at ${weeklyCR.toFixed(0)}% · Pipeline ${pipeSize} — keep working inbound queue. ${
        CFG.CR_TARGET - weeklyCR > 0 ? (CFG.CR_TARGET - weeklyCR).toFixed(0) + '% to bonus-lead eligibility.' : ''
      }`,
    };

  if (poolAssigns < CFG.POOL_DAILY_ASSIGNS && poolWeekSales < CFG.POOL_WEEKLY_SALES && pipeSize < 10)
    return {
      action: 'GET_IN_POOL',
      severity: 'info',
      reason: `Light pipeline (${pipeSize}) and ${poolAssigns}/${CFG.POOL_DAILY_ASSIGNS} pool assigns. Build tomorrow's follow-up pipeline from pool.`,
    };

  const parts = [];
  if (weeklyCR !== null) parts.push(`CR ${weeklyCR.toFixed(0)}%`);
  parts.push(`Pipeline ${pipeSize}`);
  if (poolAssigns > 0) parts.push(`Pool ${poolAssigns} assigns`);
  if (poolWeekSales > 0) parts.push(`Pool ${poolWeekSales} sales this week`);
  return { action: 'ON_TRACK', severity: 'info', reason: parts.join(' · ') + ' — on track.' };
}

const results = [];
for (const [name, agent] of Object.entries(rosterMap)) {
  const weekRows = weeklyByAgent[name] || [];
  const { weeklyCR, dailyCRs, weekLeads, weekSales } = computeWeeklyCR(weekRows);
  const pipe = pipeMap[name];
  const pool = poolMapData[name];
  const intra = intradayMap[name];
  const poolWeekSales = weeklyPoolSales[name] || 0;

  const poolSelfAssigned = pool?.self_assigned_leads ?? 0;
  const poolAnswered = pool?.answered_calls ?? 0;
  const poolDials = pool?.calls_made ?? 0;
  const poolLongCalls = pool?.long_calls ?? 0;
  const totalDials = intra?.total_dials ?? 0;
  const todaysLeads = (intra?.ib_leads_delivered ?? 0) + (intra?.ob_leads_delivered ?? 0);
  const todaysSales = (intra?.ib_sales ?? 0) + (intra?.ob_sales ?? 0);
  const todaysCR = todaysLeads > 0 ? (todaysSales / todaysLeads) * 100 : null;
  const todaysPremium = (intra?.ib_premium ?? 0) + (intra?.ob_premium ?? 0) + (intra?.custom_premium ?? 0);
  const pastDue = pipe?.past_due_follow_ups ?? 0;
  const pipeSize = pipe ? (pipe.new_leads ?? 0) + (pipe.todays_follow_ups ?? 0) + pastDue : null;

  const rec = recommend(weeklyCR, dailyCRs, weekLeads, weekSales, pipe, intra, pool, poolWeekSales);

  results.push({
    name,
    site: agent.site,
    manager: agent.manager || null,
    ...rec,
    weeklyCR: weeklyCR !== null ? Math.round(weeklyCR * 10) / 10 : null,
    weekLeads,
    weekSales,
    todaysCR: todaysCR !== null ? Math.round(todaysCR * 10) / 10 : null,
    todaysLeads,
    todaysSales,
    todaysPremium: Math.round(todaysPremium),
    todaysDials: totalDials,
    todaysTalkMin: Math.round(intra?.talk_time_minutes ?? 0),
    pastDue,
    pipelineSize: pipeSize,
    poolDials,
    poolSelfAssigned,
    poolAnswered,
    poolLongCalls,
    poolWeekSales,
    poolOnTrack: poolWeekSales >= CFG.POOL_WEEKLY_SALES,
  });
}

const sev = { critical: 0, warning: 1, info: 2 };
results.sort((a, b) => sev[a.severity] - sev[b.severity]);

const critical = results.filter((r) => r.severity === 'critical');
const warning = results.filter((r) => r.severity === 'warning');
const onTrack = results.filter((r) => r.severity === 'info');

return [
  {
    json: {
      scrapeDate,
      centralHour,
      agentCount,
      daysThisWeek,
      critical,
      warning,
      onTrack,
      results,
      cfg: CFG,
    },
  },
];
