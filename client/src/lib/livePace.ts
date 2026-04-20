/**
 * Live pace math — projects intraday cumulative metrics to an end-of-day
 * estimate using the org pace curve, then compares the projection to the
 * agent's tenure-cohort baseline.
 *
 * Why intraday snapshots × cohort baselines?
 *   The 30-day baseline tells us what an agent's tenure peers DO on a typical
 *   full day. Intraday tells us where this agent IS right now. Combining them
 *   answers the coaching-floor question: "should I be worried about Carlson
 *   right now, or is he just having a normal-paced morning?"
 *
 * Projection model: divide the cumulative-so-far by the pace-curve fraction
 * for the current hour. This is naive (assumes the rest of the day will
 * behave at the same average rate), but it's intentionally simple and
 * conservative — coaching decisions should be made on the trend, not the
 * decimal point.
 */

import { UNIFIED_PACE_CURVE } from "./unifiedTargets";
import type { CohortBaseline, ProfileMetricKey } from "./activityProfile";

/** Business-hours-clamped Central-time hour (9 AM – 5 PM). */
export function getCentralHour(now: Date = new Date()): number {
  const central = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return central.getHours();
}

/**
 * Pace-curve fraction for a given Central-time hour.
 *   - Before 9 AM  → 0   (no projection possible)
 *   - 9 AM – 4 PM  → curve value from UNIFIED_PACE_CURVE
 *   - After 4 PM   → 1   (treat as full-day actual)
 */
export function paceFraction(hour: number): number {
  if (hour < 9) return 0;
  if (hour >= 17) return 1;
  return UNIFIED_PACE_CURVE[hour] ?? 0;
}

/**
 * Project a cumulative value to an end-of-day estimate.
 * Returns 0 before business hours and the raw value after them.
 */
export function projectFullDay(cumulative: number, hour: number): number {
  const frac = paceFraction(hour);
  if (frac <= 0) return 0;
  if (frac >= 1) return cumulative;
  return cumulative / frac;
}

export type PaceStatus = "great" | "on_pace" | "watch" | "behind" | "no_data";

/**
 * Compare a projected end-of-day value to a cohort baseline.
 *
 * Buckets (relative to median):
 *   ≥ p75       → great        (top quartile of cohort)
 *   ≥ p50 × 0.9 → on_pace      (within 10% of median, includes p50→p75)
 *   ≥ p25       → watch        (between p25 and 90% of median)
 *   < p25       → behind
 *
 * Anything with median = 0 (cohort has no signal) returns no_data.
 */
export function bucketAgainstCohort(
  projected: number,
  baseline: { p25: number; p50: number; p75: number } | undefined,
): PaceStatus {
  if (!baseline || baseline.p50 <= 0) return "no_data";
  if (projected >= baseline.p75) return "great";
  if (projected >= baseline.p50 * 0.9) return "on_pace";
  if (projected >= baseline.p25) return "watch";
  return "behind";
}

export interface LiveMetricStatus {
  metric: ProfileMetricKey;
  /** Cumulative value so far today (raw, not projected). */
  cumulative: number;
  /** Projected end-of-day at current pace. */
  projected: number;
  /** Cohort median for this metric (the comparison anchor). */
  cohortMedian: number;
  /**
   * Percent vs cohort median (-100 to ∞). 0 = on median, +25 = 25% above,
   * -50 = half the median pace.
   */
  pctVsMedian: number;
  status: PaceStatus;
}

/**
 * Per-agent intraday rollup from one or more `intraday_snapshots` rows
 * (we use the latest per-agent row as the cumulative-so-far).
 */
export interface AgentIntradayCumulative {
  agentName: string;
  hour: number;
  totalDials: number;
  talkMin: number;
  poolDials: number;
  poolLongCalls: number;
  poolSelfAssigned: number;
}

const LIVE_METRICS: ProfileMetricKey[] = [
  "totalDialsPerDay",
  "talkMinPerDay",
  "poolDialsPerDay",
  "presentationsPerDay",
];

/**
 * Map a cohort metric key to the cumulative value that should feed its
 * projection. Returns null if the metric isn't intraday-available.
 */
function getCumulativeForMetric(
  cum: AgentIntradayCumulative,
  metric: ProfileMetricKey,
): number | null {
  switch (metric) {
    case "totalDialsPerDay":
      return cum.totalDials;
    case "talkMinPerDay":
      return cum.talkMin;
    case "poolDialsPerDay":
      return cum.poolDials;
    case "presentationsPerDay":
      // Intraday source is pool long calls (≥15 min). Production-side
      // presentations come from agent_performance_daily and may lag.
      return cum.poolLongCalls;
    default:
      return null;
  }
}

export interface AgentLiveSummary {
  agentName: string;
  cohort: string;
  hour: number;
  metrics: LiveMetricStatus[];
  /** Worst status across all metrics — drives the row color. */
  overall: PaceStatus;
  /** Number of metrics in "behind" or "watch". */
  flaggedCount: number;
}

/**
 * Build a per-agent live pace summary by overlaying intraday cumulative on
 * cohort baselines. Returns null if the agent has no intraday row yet today
 * (treated as not-started rather than "behind").
 */
export function buildAgentLiveSummary(
  cum: AgentIntradayCumulative,
  cohort: string,
  baseline: CohortBaseline | undefined,
): AgentLiveSummary | null {
  if (!baseline) return null;
  const metrics: LiveMetricStatus[] = [];
  for (const key of LIVE_METRICS) {
    const cumValue = getCumulativeForMetric(cum, key);
    if (cumValue == null) continue;
    const projected = projectFullDay(cumValue, cum.hour);
    const b = baseline.metrics[key];
    const status = bucketAgainstCohort(projected, b);
    metrics.push({
      metric: key,
      cumulative: cumValue,
      projected,
      cohortMedian: b?.p50 ?? 0,
      pctVsMedian: b && b.p50 > 0 ? ((projected - b.p50) / b.p50) * 100 : 0,
      status,
    });
  }

  // Overall status = worst non-"no_data" status. If everything is no_data,
  // overall is no_data too. Order: behind > watch > on_pace > great > no_data.
  const order: Record<PaceStatus, number> = {
    behind: 4,
    watch: 3,
    on_pace: 2,
    great: 1,
    no_data: 0,
  };
  let overall: PaceStatus = "no_data";
  let flaggedCount = 0;
  for (const m of metrics) {
    if (order[m.status] > order[overall]) overall = m.status;
    if (m.status === "behind" || m.status === "watch") flaggedCount += 1;
  }

  return {
    agentName: cum.agentName,
    cohort,
    hour: cum.hour,
    metrics,
    overall,
    flaggedCount,
  };
}

export interface OrgLivePulse {
  hour: number;
  paceFraction: number;
  agentCount: number;
  great: number;
  onPace: number;
  watch: number;
  behind: number;
  noData: number;
  /**
   * "Headline" — the most important takeaway in one sentence.
   * Either celebrates org-wide health or names the deepest concern.
   */
  headline: string;
}

export function summarizeOrgPulse(summaries: AgentLiveSummary[], hour: number): OrgLivePulse {
  let great = 0;
  let onPace = 0;
  let watch = 0;
  let behind = 0;
  let noData = 0;
  for (const s of summaries) {
    switch (s.overall) {
      case "great":
        great += 1;
        break;
      case "on_pace":
        onPace += 1;
        break;
      case "watch":
        watch += 1;
        break;
      case "behind":
        behind += 1;
        break;
      default:
        noData += 1;
    }
  }
  const total = summaries.length;
  const frac = paceFraction(hour);
  let headline: string;
  if (total === 0) {
    headline = "No live agent data yet today.";
  } else if (frac <= 0) {
    headline = "Floor opens at 9 AM CST — no pace data yet.";
  } else if (behind === 0 && watch <= Math.max(1, Math.floor(total * 0.1))) {
    headline = `${great + onPace}/${total} agents on pace at ${formatHour(hour)} — clean morning.`;
  } else if (behind >= Math.max(2, Math.floor(total * 0.2))) {
    headline = `${behind} agents behind cohort pace at ${formatHour(hour)} — investigate floor blockers.`;
  } else {
    headline = `${behind} behind, ${watch} on watch at ${formatHour(hour)} — coach the laggers.`;
  }
  return {
    hour,
    paceFraction: frac,
    agentCount: total,
    great,
    onPace,
    watch,
    behind,
    noData,
    headline,
  };
}

function formatHour(hour: number): string {
  if (hour <= 0) return "—";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "a" : "p"}`;
}

export function statusColor(status: PaceStatus): string {
  switch (status) {
    case "great":
      return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    case "on_pace":
      return "text-sky-400 border-sky-500/30 bg-sky-500/10";
    case "watch":
      return "text-amber-400 border-amber-500/30 bg-amber-500/10";
    case "behind":
      return "text-red-400 border-red-500/30 bg-red-500/10";
    case "no_data":
      return "text-muted-foreground border-border bg-card";
  }
}

export function statusLabel(status: PaceStatus): string {
  switch (status) {
    case "great":
      return "Great";
    case "on_pace":
      return "On pace";
    case "watch":
      return "Watch";
    case "behind":
      return "Behind";
    case "no_data":
      return "No data";
  }
}
