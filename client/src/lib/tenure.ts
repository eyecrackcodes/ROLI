/**
 * Tenure helpers — derive days/months/years employed from agents.hired_date
 * (sourced from ADP Workforce Now's workerDates.originalHireDate via the
 * dsb-adp-roster-sync workflow).
 *
 * Cohort buckets are calibrated against DSB's observed ramp curve:
 *   - 0-30d:   "New Hire"   — onboarding, training, no real performance signal yet
 *   - 31-90d:  "Ramping"    — should hit baseline contact + close rates by day 90
 *   - 91-180d: "Developing" — expected to be at or near veteran-level metrics
 *   - 181-365d:"Established"— full performance expected
 *   - 365d+:   "Veteran"    — peak performance benchmark cohort
 *
 * NEVER benchmark a New Hire against a Veteran — the ramp curve is real and
 * a cold comparison creates false-positive coaching alerts.
 */

export type TenureCohort = "New Hire" | "Ramping" | "Developing" | "Established" | "Veteran" | "Unknown";

export interface TenureInfo {
  hiredDate: string | null;
  days: number | null;
  months: number | null;
  years: number | null;
  cohort: TenureCohort;
  /** "3 mo", "1.5 yr", "12 days" — for compact UI display */
  label: string;
  /** True when hired_date is null (not yet linked / unknown). */
  unknown: boolean;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function computeTenure(
  hiredDate: string | null | undefined,
  now: Date = new Date(),
): TenureInfo {
  if (!hiredDate) {
    return {
      hiredDate: null,
      days: null,
      months: null,
      years: null,
      cohort: "Unknown",
      label: "—",
      unknown: true,
    };
  }

  const hire = new Date(hiredDate + "T00:00:00Z");
  if (Number.isNaN(hire.getTime())) {
    return {
      hiredDate,
      days: null,
      months: null,
      years: null,
      cohort: "Unknown",
      label: "—",
      unknown: true,
    };
  }

  const days = Math.max(0, Math.floor((now.getTime() - hire.getTime()) / MS_PER_DAY));
  const months = Math.floor(days / 30.44);
  const years = days / 365.25;

  let cohort: TenureCohort;
  if (days <= 30) cohort = "New Hire";
  else if (days <= 90) cohort = "Ramping";
  else if (days <= 180) cohort = "Developing";
  else if (days <= 365) cohort = "Established";
  else cohort = "Veteran";

  let label: string;
  if (days < 14) label = `${days}d`;
  else if (days < 90) label = `${Math.round(days / 7)}w`;
  else if (years < 1) label = `${months}mo`;
  else label = `${years.toFixed(1)}y`;

  return { hiredDate, days, months, years, cohort, label, unknown: false };
}

/**
 * Cohort badge color — shadcn/tailwind class fragments. Matches the existing
 * site/tier badge style in AgentDrillDown.
 */
export function cohortBadgeClasses(cohort: TenureCohort): string {
  switch (cohort) {
    case "New Hire":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "Ramping":
      return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
    case "Developing":
      return "bg-sky-500/10 text-sky-400 border-sky-500/30";
    case "Established":
      return "bg-blue-500/10 text-blue-400 border-blue-500/30";
    case "Veteran":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    default:
      return "bg-muted/10 text-muted-foreground border-border";
  }
}

/**
 * Bucket an array of agents by tenure cohort. Useful for cohort-aware leaderboards
 * and ramp-curve analytics.
 */
export function groupByCohort<T extends { hired_date?: string | null }>(
  agents: T[],
  now: Date = new Date(),
): Map<TenureCohort, T[]> {
  const buckets = new Map<TenureCohort, T[]>();
  for (const a of agents) {
    const t = computeTenure(a.hired_date ?? null, now);
    const existing = buckets.get(t.cohort) ?? [];
    existing.push(a);
    buckets.set(t.cohort, existing);
  }
  return buckets;
}
