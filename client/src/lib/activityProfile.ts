/**
 * Activity Profile — cohort-aware activity intensity analysis.
 *
 * Why this exists: Raw leaderboards conflate "agent is bad" with "agent is new".
 * A 60-day rookie shouldn't be benchmarked against a 2-year veteran on dial
 * volume — and a veteran shouldn't get a free pass for dialing like a rookie.
 * This module aggregates each agent's last-30-day activity intensity and
 * compares it to their tenure-cohort peers, surfacing specific pattern
 * anomalies (e.g. "vet-level dials but rookie-level talk time" =
 * speed-skipping, not productive efficiency).
 *
 * Inputs come from three tables:
 *   - daily_scrape_data        → production dials, IB/OB sales, talk time
 *   - leads_pool_daily_data    → pool dials, self-assigns, presentations
 *   - agent_performance_daily  → conversations + presentations bucket counts
 *
 * Outputs:
 *   - AgentActivityProfile per agent
 *   - CohortBaseline per cohort (median, p25, p75 of every metric)
 *   - Anomaly[] per agent with severity + actionable label
 */

import type { TenureCohort } from "./tenure";

// ---- Inputs (raw rolling-window aggregates per agent) ----

export interface AgentActivityRaw {
  name: string;
  hiredDate: string | null;
  cohort: TenureCohort;
  /** Days in the rolling window where the agent had ANY activity. */
  daysActive: number;
  // production (daily_scrape_data, summed over window)
  prodDials: number;
  prodTalkMin: number;
  prodIbLeads: number;
  prodObLeads: number;
  prodSales: number;
  prodPremium: number;
  // pool (leads_pool_daily_data, summed over window)
  poolDials: number;
  poolTalkMin: number;
  poolAnswered: number;
  poolSelfAssigned: number;
  poolLongCalls: number;
  poolSales: number;
  // funnel (agent_performance_daily, summed end-of-day rows)
  conversations: number;
  presentations: number;
  contactsMade: number;
}

// ---- Outputs ----

export interface AgentActivityProfile {
  name: string;
  hiredDate: string | null;
  cohort: TenureCohort;
  daysActive: number;

  // Daily averages (the "rate per active day" view — fairer than totals
  // because it self-corrects for time-off and partial weeks).
  dialsPerDay: number;          // production dials only
  poolDialsPerDay: number;
  totalDialsPerDay: number;     // production + pool
  talkMinPerDay: number;        // production + pool combined
  conversationsPerDay: number;
  presentationsPerDay: number;

  // Efficiency ratios
  talkSecPerDial: number;       // (talk_min × 60) / total_dials — pacing
  poolEfficiency: number;       // pool_talk_min / pool_dials — gaming detector
  contactRate: number;          // pool answered / pool dials × 100
  selfAssignRate: number;       // self_assigned / pool_answered × 100
  poolPresentationRate: number; // long_calls / self_assigned × 100

  // Output (kept for color/context, not the focus)
  salesPerDay: number;
  premiumPerDay: number;

  // Composite engagement score (0-100, higher = more activity intensity)
  engagementScore: number;
}

export interface CohortBaseline {
  cohort: TenureCohort;
  agentCount: number;
  // For each metric we keep median (p50), p25, p75. If agentCount < 2
  // we return the single value as all three (degenerate "baseline").
  metrics: Record<string, { p25: number; p50: number; p75: number }>;
}

export interface ActivityAnomaly {
  kind:
    | "speed_skipping"
    | "over_dwell"
    | "pool_over_reliance"
    | "pool_ignoring"
    | "self_assign_gap"
    | "presentation_drought"
    | "cohort_lagging"
    | "cohort_overperforming";
  severity: "low" | "medium" | "high";
  label: string;
  detail: string;
}

// ---- Aggregation: raw daily rows → per-agent rolling totals ----

export interface DailyScrapeRow {
  agent_name: string;
  scrape_date: string;
  total_dials: number | null;
  talk_time_minutes: number | null;
  ib_leads_delivered: number | null;
  ob_leads_delivered: number | null;
  ib_sales: number | null;
  ob_sales: number | null;
  custom_sales: number | null;
  ib_premium: number | null;
  ob_premium: number | null;
  custom_premium: number | null;
}

export interface PoolRow {
  agent_name: string;
  scrape_date: string;
  calls_made: number | null;
  talk_time_minutes: number | null;
  answered_calls: number | null;
  self_assigned_leads: number | null;
  long_calls: number | null;
  sales_made: number | null;
}

export interface FunnelRow {
  agent_name: string;
  scrape_date: string;
  scrape_hour: number | null;
  conversations: number | null;
  presentations: number | null;
  contacts_made: number | null;
}

export interface AgentRosterEntry {
  name: string;
  hired_date: string | null;
  cohort: TenureCohort;
}

/**
 * Roll up raw daily rows into per-agent window aggregates.
 * `daysActive` counts unique scrape_date values where the agent had ANY non-zero activity
 * across production OR pool, NOT funnel (which can get backfilled hourly).
 */
export function aggregateActivityRaw(
  roster: AgentRosterEntry[],
  prod: DailyScrapeRow[],
  pool: PoolRow[],
  funnel: FunnelRow[],
): AgentActivityRaw[] {
  const byName = new Map<string, AgentActivityRaw>();
  const activeDates = new Map<string, Set<string>>();

  for (const r of roster) {
    byName.set(r.name, {
      name: r.name,
      hiredDate: r.hired_date,
      cohort: r.cohort,
      daysActive: 0,
      prodDials: 0,
      prodTalkMin: 0,
      prodIbLeads: 0,
      prodObLeads: 0,
      prodSales: 0,
      prodPremium: 0,
      poolDials: 0,
      poolTalkMin: 0,
      poolAnswered: 0,
      poolSelfAssigned: 0,
      poolLongCalls: 0,
      poolSales: 0,
      conversations: 0,
      presentations: 0,
      contactsMade: 0,
    });
    activeDates.set(r.name, new Set<string>());
  }

  for (const row of prod) {
    const a = byName.get(row.agent_name);
    if (!a) continue;
    const dials = row.total_dials ?? 0;
    const talk = row.talk_time_minutes ?? 0;
    const ibSales = row.ib_sales ?? 0;
    const obSales = row.ob_sales ?? 0;
    const cuSales = row.custom_sales ?? 0;
    a.prodDials += dials;
    a.prodTalkMin += talk;
    a.prodIbLeads += row.ib_leads_delivered ?? 0;
    a.prodObLeads += row.ob_leads_delivered ?? 0;
    a.prodSales += ibSales + obSales + cuSales;
    a.prodPremium += (row.ib_premium ?? 0) + (row.ob_premium ?? 0) + (row.custom_premium ?? 0);
    if (dials > 0 || talk > 0) activeDates.get(row.agent_name)?.add(row.scrape_date);
  }

  for (const row of pool) {
    const a = byName.get(row.agent_name);
    if (!a) continue;
    const dials = row.calls_made ?? 0;
    const talk = row.talk_time_minutes ?? 0;
    a.poolDials += dials;
    a.poolTalkMin += talk;
    a.poolAnswered += row.answered_calls ?? 0;
    a.poolSelfAssigned += row.self_assigned_leads ?? 0;
    a.poolLongCalls += row.long_calls ?? 0;
    a.poolSales += row.sales_made ?? 0;
    if (dials > 0 || talk > 0) activeDates.get(row.agent_name)?.add(row.scrape_date);
  }

  // Funnel: only count end-of-day rows (scrape_hour IS NULL) so we don't
  // double-count hourly snapshots. If only hourly rows exist for a date,
  // pick the highest-hour one (the daily ingest writes EOD eventually).
  const funnelByAgentDate = new Map<string, FunnelRow>();
  for (const row of funnel) {
    const key = `${row.agent_name}::${row.scrape_date}`;
    const existing = funnelByAgentDate.get(key);
    if (!existing) {
      funnelByAgentDate.set(key, row);
      continue;
    }
    // Prefer EOD (null) over hourly; otherwise prefer higher hour.
    const isEod = row.scrape_hour == null;
    const exIsEod = existing.scrape_hour == null;
    if (isEod && !exIsEod) funnelByAgentDate.set(key, row);
    else if (!isEod && !exIsEod && (row.scrape_hour ?? 0) > (existing.scrape_hour ?? 0)) {
      funnelByAgentDate.set(key, row);
    }
  }
  for (const row of Array.from(funnelByAgentDate.values())) {
    const a = byName.get(row.agent_name);
    if (!a) continue;
    a.conversations += row.conversations ?? 0;
    a.presentations += row.presentations ?? 0;
    a.contactsMade += row.contacts_made ?? 0;
  }

  for (const a of Array.from(byName.values())) {
    a.daysActive = activeDates.get(a.name)?.size ?? 0;
  }

  return Array.from(byName.values());
}

// ---- Conversion: raw → profile (with safe div-by-zero) ----

function safeDiv(num: number, denom: number): number {
  return denom > 0 ? num / denom : 0;
}

export function buildProfile(raw: AgentActivityRaw): AgentActivityProfile {
  const days = Math.max(1, raw.daysActive); // avoid divide-by-zero; "0 days" agents get all zeros anyway
  const totalDials = raw.prodDials + raw.poolDials;
  const totalTalk = raw.prodTalkMin + raw.poolTalkMin;

  const profile: AgentActivityProfile = {
    name: raw.name,
    hiredDate: raw.hiredDate,
    cohort: raw.cohort,
    daysActive: raw.daysActive,
    dialsPerDay: raw.daysActive ? raw.prodDials / days : 0,
    poolDialsPerDay: raw.daysActive ? raw.poolDials / days : 0,
    totalDialsPerDay: raw.daysActive ? totalDials / days : 0,
    talkMinPerDay: raw.daysActive ? totalTalk / days : 0,
    conversationsPerDay: raw.daysActive ? raw.conversations / days : 0,
    presentationsPerDay: raw.daysActive ? raw.presentations / days : 0,
    talkSecPerDial: safeDiv(totalTalk * 60, totalDials),
    poolEfficiency: safeDiv(raw.poolTalkMin, raw.poolDials),
    contactRate: safeDiv(raw.poolAnswered, raw.poolDials) * 100,
    selfAssignRate: safeDiv(raw.poolSelfAssigned, raw.poolAnswered) * 100,
    poolPresentationRate: safeDiv(raw.poolLongCalls, raw.poolSelfAssigned) * 100,
    salesPerDay: raw.daysActive ? (raw.prodSales + raw.poolSales) / days : 0,
    premiumPerDay: raw.daysActive ? raw.prodPremium / days : 0,
    engagementScore: 0, // filled in below
  };

  // Engagement score: weighted composite of dial intensity, talk time, and
  // pool engagement. Calibrated so a "median" veteran lands ~50.
  //   30% dials/day      (capped at 80 dials → 30 pts)
  //   30% talk min/day   (capped at 120 min → 30 pts)
  //   20% pool dials/day (capped at 40 → 20 pts)
  //   20% conversations + presentations / day (capped at 10 → 20 pts)
  const dialPts = Math.min(profile.totalDialsPerDay / 80, 1) * 30;
  const talkPts = Math.min(profile.talkMinPerDay / 120, 1) * 30;
  const poolPts = Math.min(profile.poolDialsPerDay / 40, 1) * 20;
  const meaningfulCalls = profile.conversationsPerDay + profile.presentationsPerDay;
  const callPts = Math.min(meaningfulCalls / 10, 1) * 20;
  profile.engagementScore = Math.round(dialPts + talkPts + poolPts + callPts);

  return profile;
}

// ---- Cohort baselines (median + IQR) ----

const PROFILE_METRIC_KEYS = [
  "dialsPerDay",
  "poolDialsPerDay",
  "totalDialsPerDay",
  "talkMinPerDay",
  "conversationsPerDay",
  "presentationsPerDay",
  "talkSecPerDial",
  "poolEfficiency",
  "contactRate",
  "selfAssignRate",
  "poolPresentationRate",
  "salesPerDay",
  "premiumPerDay",
  "engagementScore",
] as const;

export type ProfileMetricKey = (typeof PROFILE_METRIC_KEYS)[number];
export const ALL_METRIC_KEYS: ProfileMetricKey[] = [...PROFILE_METRIC_KEYS];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function buildCohortBaselines(profiles: AgentActivityProfile[]): Map<TenureCohort, CohortBaseline> {
  const byCohort = new Map<TenureCohort, AgentActivityProfile[]>();
  for (const p of profiles) {
    if (p.daysActive === 0) continue; // exclude agents with no signal
    const list: AgentActivityProfile[] = byCohort.get(p.cohort) ?? [];
    list.push(p);
    byCohort.set(p.cohort, list);
  }

  const result = new Map<TenureCohort, CohortBaseline>();
  for (const [cohort, list] of Array.from(byCohort.entries())) {
    const baseline: CohortBaseline = {
      cohort,
      agentCount: list.length,
      metrics: {},
    };
    for (const key of PROFILE_METRIC_KEYS) {
      const values = list.map((p: AgentActivityProfile) => p[key]).sort((a: number, b: number) => a - b);
      baseline.metrics[key] = {
        p25: quantile(values, 0.25),
        p50: quantile(values, 0.5),
        p75: quantile(values, 0.75),
      };
    }
    result.set(cohort, baseline);
  }
  return result;
}

// ---- Anomaly detection ----

/**
 * Pattern-match an agent's profile against their cohort baseline to surface
 * specific behavioral anomalies. Each anomaly carries severity + an actionable
 * label so the dashboard can sort/filter and managers know what to talk about.
 *
 * Thresholds are conservative — we'd rather miss a soft signal than spam
 * coaching alerts. Tune as the team uses it.
 */
export function detectAnomalies(
  profile: AgentActivityProfile,
  baseline: CohortBaseline | undefined,
): ActivityAnomaly[] {
  const flags: ActivityAnomaly[] = [];
  if (profile.daysActive === 0) return flags;

  const b = baseline?.metrics;

  // 1. SPEED-SKIPPING — high dials, low talk-per-dial
  //    "vet dials, rookie talk time" pattern the user explicitly called out.
  if (b && profile.totalDialsPerDay >= b.totalDialsPerDay.p75 && profile.talkSecPerDial > 0 && profile.talkSecPerDial <= b.talkSecPerDial.p25) {
    flags.push({
      kind: "speed_skipping",
      severity: profile.talkSecPerDial < 30 ? "high" : "medium",
      label: "Speed-skipping",
      detail: `Top-quartile dials (${profile.totalDialsPerDay.toFixed(0)}/day) but bottom-quartile talk time per dial (${profile.talkSecPerDial.toFixed(0)}s vs cohort p25 ${b.talkSecPerDial.p25.toFixed(0)}s). Calls likely getting hung up on or skipped after voicemail without leaving messages.`,
    });
  }

  // 2. OVER-DWELL — low dials, high talk-per-dial
  if (b && profile.totalDialsPerDay <= b.totalDialsPerDay.p25 && profile.talkSecPerDial >= b.talkSecPerDial.p75) {
    flags.push({
      kind: "over_dwell",
      severity: "medium",
      label: "Over-dwelling on calls",
      detail: `Bottom-quartile dial volume (${profile.totalDialsPerDay.toFixed(0)}/day) with top-quartile talk per dial (${profile.talkSecPerDial.toFixed(0)}s). Could be trapped in long unproductive calls or spending too long on prospecting/notes between calls.`,
    });
  }

  // 3. POOL OVER-RELIANCE — pool dials > production dials by a lot
  //    A healthy day is mostly inbound (production) with pool as supplement.
  if (profile.poolDialsPerDay > 0 && profile.dialsPerDay > 0 && profile.poolDialsPerDay > profile.dialsPerDay * 1.5) {
    flags.push({
      kind: "pool_over_reliance",
      severity: profile.poolDialsPerDay > profile.dialsPerDay * 3 ? "high" : "medium",
      label: "Pool over-reliance",
      detail: `Pool dials (${profile.poolDialsPerDay.toFixed(0)}/day) outweigh production dials (${profile.dialsPerDay.toFixed(0)}/day) by >1.5×. Either ignoring inbound queue or compensating for missed inbound time with pool runs.`,
    });
  }

  // 4. POOL IGNORING — zero pool activity AND below-cohort presentations
  //    Pool is supplemental but expected. Skipping it entirely is a flag.
  if (profile.poolDialsPerDay === 0 && profile.daysActive >= 5) {
    flags.push({
      kind: "pool_ignoring",
      severity: "low",
      label: "No pool activity",
      detail: `Zero pool dials across ${profile.daysActive} active days. Pool provides supplemental opportunity AND tomorrow's follow-up pipeline — not touching it leaves money on the table.`,
    });
  }

  // 5. SELF-ASSIGN GAP — pool answered calls but assign rate < 30%
  if (profile.poolDialsPerDay > 0 && profile.contactRate > 0 && profile.selfAssignRate < 30) {
    flags.push({
      kind: "self_assign_gap",
      severity: profile.selfAssignRate < 15 ? "high" : "medium",
      label: "Pool discipline gap",
      detail: `Self-assign rate ${profile.selfAssignRate.toFixed(0)}% (target ≥30%). Answered pool contacts are recycling back into the rotation instead of being claimed — eats team capacity.`,
    });
  }

  // 6. PRESENTATION DROUGHT — lots of self-assigns but few long calls
  if (profile.selfAssignRate >= 30 && profile.poolPresentationRate > 0 && profile.poolPresentationRate < 12) {
    flags.push({
      kind: "presentation_drought",
      severity: "medium",
      label: "Pool presentation drought",
      detail: `Self-assigning leads (${profile.selfAssignRate.toFixed(0)}%) but only ${profile.poolPresentationRate.toFixed(0)}% turn into 15+ min presentations (target ≥20%). Quality of qualifying conversations is weak.`,
    });
  }

  // 7. COHORT LAGGING — overall engagement bottom quartile of cohort
  if (b && profile.engagementScore <= b.engagementScore.p25 && (baseline?.agentCount ?? 0) >= 3) {
    flags.push({
      kind: "cohort_lagging",
      severity: profile.engagementScore < b.engagementScore.p25 * 0.7 ? "high" : "medium",
      label: "Lagging cohort",
      detail: `Engagement score ${profile.engagementScore} vs ${profile.cohort} cohort p25 ${b.engagementScore.p25.toFixed(0)} (median ${b.engagementScore.p50.toFixed(0)}). Activity intensity is below their tenure peers.`,
    });
  }

  // 8. COHORT OVERPERFORMING — top quartile of cohort. Useful for spotting
  //    rising stars in early cohorts (someone in "Ramping" who's already at
  //    veteran-level engagement).
  if (b && profile.engagementScore >= b.engagementScore.p75 && (baseline?.agentCount ?? 0) >= 3) {
    flags.push({
      kind: "cohort_overperforming",
      severity: "low",
      label: "Outperforming cohort",
      detail: `Engagement score ${profile.engagementScore} vs ${profile.cohort} cohort p75 ${b.engagementScore.p75.toFixed(0)}. Activity intensity is above their tenure peers — promote this pattern.`,
    });
  }

  return flags;
}

/**
 * Convenience: build full profiles + baselines + anomalies for the whole org.
 */
export function buildOrgActivityAnalysis(
  roster: AgentRosterEntry[],
  prod: DailyScrapeRow[],
  pool: PoolRow[],
  funnel: FunnelRow[],
): {
  profiles: AgentActivityProfile[];
  baselines: Map<TenureCohort, CohortBaseline>;
  anomaliesByAgent: Map<string, ActivityAnomaly[]>;
} {
  const raw = aggregateActivityRaw(roster, prod, pool, funnel);
  const profiles = raw.map(buildProfile);
  const baselines = buildCohortBaselines(profiles);
  const anomaliesByAgent = new Map<string, ActivityAnomaly[]>();
  for (const p of profiles) {
    anomaliesByAgent.set(p.name, detectAnomalies(p, baselines.get(p.cohort)));
  }
  return { profiles, baselines, anomaliesByAgent };
}

// ---- Display helpers ----

export function formatMetric(key: ProfileMetricKey, value: number): string {
  switch (key) {
    case "dialsPerDay":
    case "poolDialsPerDay":
    case "totalDialsPerDay":
      return value.toFixed(0);
    case "talkMinPerDay":
      return value.toFixed(0) + " min";
    case "conversationsPerDay":
    case "presentationsPerDay":
    case "salesPerDay":
      return value.toFixed(1);
    case "premiumPerDay":
      return "$" + value.toFixed(0);
    case "talkSecPerDial":
      return value.toFixed(0) + "s";
    case "poolEfficiency":
      return value.toFixed(2) + " min/dial";
    case "contactRate":
    case "selfAssignRate":
    case "poolPresentationRate":
      return value.toFixed(1) + "%";
    case "engagementScore":
      return value.toFixed(0);
  }
}

export function metricLabel(key: ProfileMetricKey): string {
  switch (key) {
    case "dialsPerDay": return "Prod Dials/day";
    case "poolDialsPerDay": return "Pool Dials/day";
    case "totalDialsPerDay": return "Total Dials/day";
    case "talkMinPerDay": return "Talk Min/day";
    case "conversationsPerDay": return "Conv/day";
    case "presentationsPerDay": return "Pres/day";
    case "talkSecPerDial": return "Sec/Dial";
    case "poolEfficiency": return "Pool Eff";
    case "contactRate": return "Pool CR";
    case "selfAssignRate": return "Assign %";
    case "poolPresentationRate": return "Pres %";
    case "salesPerDay": return "Sales/day";
    case "premiumPerDay": return "Prem/day";
    case "engagementScore": return "Engage";
  }
}

/**
 * Higher = better for most metrics, but a few are inverse (e.g. talkSecPerDial
 * is "bad if too low" but also "bad if too high" — handled at the call site).
 */
export function isHigherBetter(key: ProfileMetricKey): boolean {
  switch (key) {
    case "talkSecPerDial":
    case "poolEfficiency":
      return false; // ambiguous — inspected by anomaly logic
    default:
      return true;
  }
}
