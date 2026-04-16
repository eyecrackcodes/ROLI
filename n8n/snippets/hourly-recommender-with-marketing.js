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
  orgAgentCount,
  leadCostOverride,
  avgPremiumOverride,
} = $input.first().json;

function inCoachingScope(a) {
  const st = String(a.agent_status || "selling").toLowerCase();
  return st === "selling" || st === "training";
}

const DEFAULT_LC = 60;
const lc =
  typeof leadCostOverride === "number" && leadCostOverride > 0 ? leadCostOverride : DEFAULT_LC;

const CFG = {
  DAILY_LEADS: 7,
  LEAD_COST: lc,
  CR_TARGET: 22,
  CR_FLOOR: 20,
  CR_CRISIS: 15,
  CR_CRISIS_DAYS: 3,
  MAX_PIPELINE: 30,
  PIPELINE_CRITICAL: 40,
  POOL_DAILY_ASSIGNS: 5,
  POOL_WEEKLY_SALES: 1,
  POOL_MIN_ASSIGN_RATE: 30,
  AVG_PREMIUM_ORG:
    typeof avgPremiumOverride === "number" && avgPremiumOverride > 0 ? avgPremiumOverride : 1150,
};

function computeWeeklyCR(rows) {
  if (!rows || rows.length === 0)
    return { weeklyCR: null, dailyCRs: [], weekLeads: 0, weekSales: 0 };
  const dailyCRs = rows.map((r) => {
    const leads = r.ibLeads + r.obLeads;
    const sales = r.ibSales + r.obSales + r.customSales;
    return leads > 0 ? (sales / leads) * 100 : 0;
  });
  const totalLeads = rows.reduce((s, r) => s + r.ibLeads + r.obLeads, 0);
  const totalSales = rows.reduce(
    (s, r) => s + r.ibSales + r.obSales + r.customSales,
    0
  );
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

function recommend(
  weeklyCR,
  dailyCRs,
  weekLeads,
  weekSales,
  pipe,
  intra,
  pool,
  poolWeekSales,
  pace
) {
  const pastDue = pipe?.past_due_follow_ups ?? 0;
  const pipeSize =
    (pipe?.new_leads ?? 0) + (pipe?.todays_follow_ups ?? 0) + pastDue;
  const poolAssigns = pool?.self_assigned_leads ?? 0;
  const poolAnswered = pool?.answered_calls ?? 0;
  const assignRate =
    poolAnswered > 0 ? (poolAssigns / poolAnswered) * 100 : 0;
  const consLowDays = consLow(dailyCRs, CFG.CR_CRISIS);
  const isMidDay = centralHour >= 12;
  const weekSpend = weekLeads * CFG.LEAD_COST;

  if (pastDue > 3)
    return {
      action: "WORK_FOLLOWUPS",
      severity: "critical",
      reason: `${pastDue} past due follow-ups. $${pastDue * CFG.LEAD_COST} in paid leads aging out. Clear these before anything else.`,
    };

  if (pipeSize > CFG.PIPELINE_CRITICAL)
    return {
      action: "CLEAR_PIPELINE",
      severity: "critical",
      reason: `Pipeline at ${pipeSize} leads (limit: ${CFG.PIPELINE_CRITICAL}). Leads are rotting. Close, withdraw, or reschedule — no new activity until pipeline is under control.`,
    };

  if (consLowDays >= CFG.CR_CRISIS_DAYS && weeklyCR !== null)
    return {
      action: "REVIEW_QUALITY",
      severity: "critical",
      reason: `CR below ${CFG.CR_CRISIS}% for ${consLowDays} straight days (week: ${weeklyCR.toFixed(0)}%). ${weekLeads} leads at $${CFG.LEAD_COST}/lead = $${weekSpend} spent, ${weekSales} closed. Manager: audit calls and coach close technique.`,
    };

  if (pastDue > 0)
    return {
      action: "WORK_FOLLOWUPS",
      severity: "warning",
      reason: `${pastDue} past due follow-up${pastDue > 1 ? "s" : ""}. These are paid leads — work them before taking pool or inbound.`,
    };

  if (pipeSize > CFG.MAX_PIPELINE)
    return {
      action: "CLEAR_PIPELINE",
      severity: "warning",
      reason: `Pipeline at ${pipeSize} leads (max: ${CFG.MAX_PIPELINE}). Close out or withdraw stale leads before adding more.`,
    };

  if (weeklyCR !== null && weeklyCR < CFG.CR_FLOOR)
    return {
      action: "FOCUS_PIPELINE",
      severity: "warning",
      reason: `CR at ${weeklyCR.toFixed(0)}% — floor is ${CFG.CR_FLOOR}%. ${weekLeads} leads, ${weekSales} sales, $${weekSpend} spent. Review call quality and close technique before taking more leads.`,
    };

  const rhDials = pace?.rollingHourDials;
  const med = pace?.teamMedianRollingDials ?? 0;
  const pipeClean = pastDue === 0 && pipeSize <= 20;
  if (
    pipeClean &&
    typeof rhDials === "number" &&
    centralHour >= 10 &&
    centralHour <= 17 &&
    med >= 10 &&
    rhDials < med * 0.35
  )
    return {
      action: "PICK_UP_PACE",
      severity: "warning",
      reason: `${rhDials} dials last hour vs team median ~${Math.round(med)}. Pipeline is clean — maintain steady calling cadence.`,
    };

  if (isMidDay && poolAssigns < 3)
    return {
      action: "GET_IN_POOL",
      severity: "warning",
      reason: `${poolAssigns} pool self-assigns (need ${CFG.POOL_DAILY_ASSIGNS}). Get in pool and find 5 people to follow up with tomorrow.`,
    };

  if (poolAnswered >= 10 && assignRate < CFG.POOL_MIN_ASSIGN_RATE)
    return {
      action: "GET_IN_POOL",
      severity: "warning",
      reason: `Pool assign rate ${assignRate.toFixed(0)}% (min: ${CFG.POOL_MIN_ASSIGN_RATE}%). Self-assign every answered contact to clean the pool.`,
    };

  if (weeklyCR !== null && weeklyCR >= CFG.CR_TARGET && pipeSize <= 20 && pastDue === 0)
    return {
      action: "TAKE_MORE_LEADS",
      severity: "info",
      reason: `CR at ${weeklyCR.toFixed(0)}% with clean pipeline (${pipeSize}). Ready for additional volume.`,
    };

  if (
    weeklyCR !== null &&
    weeklyCR >= CFG.CR_FLOOR &&
    pipeSize >= 10 &&
    pipeSize <= CFG.MAX_PIPELINE
  )
    return {
      action: "STAY_IN_QUEUE",
      severity: "info",
      reason: `CR at ${weeklyCR.toFixed(0)}% · pipeline ${pipeSize}. Keep working inbound. ${
        CFG.CR_TARGET - weeklyCR > 0
          ? (CFG.CR_TARGET - weeklyCR).toFixed(0) + "% to bonus-lead eligibility."
          : "At target."
      }`,
    };

  if (
    poolAssigns < CFG.POOL_DAILY_ASSIGNS &&
    poolWeekSales < CFG.POOL_WEEKLY_SALES &&
    pipeSize < 10
  )
    return {
      action: "GET_IN_POOL",
      severity: "info",
      reason: `Pipeline light (${pipeSize}). Get in pool — find 5 contacts to follow up with tomorrow. ${poolAssigns}/${CFG.POOL_DAILY_ASSIGNS} assigns done.`,
    };

  const parts = [];
  if (weeklyCR !== null) parts.push(`CR ${weeklyCR.toFixed(0)}%`);
  parts.push(`Pipeline ${pipeSize}`);
  if (poolAssigns > 0) parts.push(`Pool ${poolAssigns} assigns`);
  if (poolWeekSales > 0) parts.push(`Pool ${poolWeekSales} sales this week`);
  return {
    action: "ON_TRACK",
    severity: "info",
    reason: parts.join(" · ") + " — on track.",
  };
}

const scopeNames = [];
for (const [name, agent] of Object.entries(rosterMap)) {
  if (inCoachingScope(agent)) scopeNames.push(name);
}

const rollingForMedian = [];
for (const name of scopeNames) {
  const intra = intradayMap[name];
  const rd = intra?.rolling_hour_dials;
  if (typeof rd === "number") rollingForMedian.push(rd);
}
rollingForMedian.sort((a, b) => a - b);
const teamMedianRollingDials = rollingForMedian.length
  ? rollingForMedian[Math.floor(rollingForMedian.length / 2)]
  : 0;

const results = [];
for (const name of scopeNames) {
  const agent = rosterMap[name];
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
  const todaysLeads =
    (intra?.ib_leads_delivered ?? 0) + (intra?.ob_leads_delivered ?? 0);
  const todaysSales =
    (intra?.ib_sales ?? 0) + (intra?.ob_sales ?? 0) + (intra?.custom_sales ?? 0);
  const todaysCR =
    todaysLeads > 0 ? (todaysSales / todaysLeads) * 100 : null;
  const todaysPremium =
    (intra?.ib_premium ?? 0) +
    (intra?.ob_premium ?? 0) +
    (intra?.custom_premium ?? 0);
  const pastDue = pipe?.past_due_follow_ups ?? 0;
  const pipeSize = pipe
    ? (pipe.new_leads ?? 0) + (pipe.todays_follow_ups ?? 0) + pastDue
    : null;

  const rollingHourDials = intra?.rolling_hour_dials ?? null;
  const rollingHourTalkMin = intra?.rolling_hour_talk_min ?? null;
  const rollingHourPoolDials = intra?.rolling_hour_pool_dials ?? null;

  const rec = recommend(
    weeklyCR,
    dailyCRs,
    weekLeads,
    weekSales,
    pipe,
    intra,
    pool,
    poolWeekSales,
    {
      rollingHourDials,
      teamMedianRollingDials,
      centralHour,
    }
  );

  const todayLeadSpend = todaysLeads * lc;
  const costPerSale = todaysSales > 0 ? Math.round(todayLeadSpend / todaysSales) : null;
  const weekLeadSpend = weekLeads * lc;
  const weekCostPerSale = weekSales > 0 ? Math.round(weekLeadSpend / weekSales) : null;

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
    rollingHourDials,
    rollingHourTalkMin,
    rollingHourPoolDials,
    rollingPriorHour: intra?.rolling_prior_hour ?? null,
    pastDue,
    pipelineSize: pipeSize,
    poolDials,
    poolSelfAssigned,
    poolAnswered,
    poolLongCalls,
    poolWeekSales,
    poolOnTrack: poolWeekSales >= CFG.POOL_WEEKLY_SALES,
    teamMedianRollingDials,
    todayLeadSpend,
    costPerSale,
    weekLeadSpend,
    weekCostPerSale,
  });
}

const sev = { critical: 0, warning: 1, info: 2 };
results.sort((a, b) => sev[a.severity] - sev[b.severity]);

function compareAlertUrgency(a, b) {
  const pda = a.pastDue ?? 0;
  const pdb = b.pastDue ?? 0;
  if (pdb !== pda) return pdb - pda;
  const pia = a.pipelineSize ?? 0;
  const pib = b.pipelineSize ?? 0;
  if (pib !== pia) return pib - pia;
  const cra = a.weeklyCR ?? 999;
  const crb = b.weeklyCR ?? 999;
  return cra - crb;
}
const critical = results
  .filter((r) => r.severity === "critical")
  .sort(compareAlertUrgency);
const warning = results
  .filter((r) => r.severity === "warning")
  .sort(compareAlertUrgency);
const onTrack = results
  .filter((r) => r.severity === "info")
  .sort((a, b) => {
    const ca = a.weeklyCR ?? -1;
    const cb = b.weeklyCR ?? -1;
    if (cb !== ca) return cb - ca;
    return a.name.localeCompare(b.name);
  });

return [
  {
    json: {
      scrapeDate,
      centralHour,
      agentCount,
      orgAgentCount:
        typeof orgAgentCount === "number" ? orgAgentCount : agentCount,
      daysThisWeek,
      critical,
      warning,
      onTrack,
      results,
      cfg: CFG,
      teamMedianRollingDials,
    },
  },
];
