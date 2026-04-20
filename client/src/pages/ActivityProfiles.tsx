import { useMemo, useState } from "react";
import { useActivityProfiles } from "@/hooks/useActivityProfiles";
import { AgentDrillDown } from "@/components/AgentDrillDown";
import { LiveCohortPulse } from "@/components/LiveCohortPulse";
import { MetricLabel } from "@/components/MetricLabel";
import { computeTenure, cohortBadgeClasses, type TenureCohort } from "@/lib/tenure";
import {
  formatMetric,
  metricLabel,
  type ActivityAnomaly,
  type AgentActivityProfile,
  type ProfileMetricKey,
} from "@/lib/activityProfile";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  RefreshCw,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

type SortKey =
  | "name"
  | "cohort"
  | "engagementScore"
  | "totalDialsPerDay"
  | "talkMinPerDay"
  | "talkSecPerDial"
  | "poolDialsPerDay"
  | "selfAssignRate"
  | "presentationsPerDay"
  | "anomalyScore";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const COHORT_ORDER: TenureCohort[] = [
  "New Hire",
  "Ramping",
  "Developing",
  "Established",
  "Veteran",
  "Unknown",
];

const SEVERITY_WEIGHT: Record<ActivityAnomaly["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function anomalyScore(anomalies: ActivityAnomaly[] | undefined): number {
  if (!anomalies) return 0;
  // Outperforming flags don't add coaching urgency, so we exclude them.
  return anomalies
    .filter((a) => a.kind !== "cohort_overperforming")
    .reduce((sum, a) => sum + SEVERITY_WEIGHT[a.severity], 0);
}

function compareDeltaToCohort(
  profile: AgentActivityProfile,
  baselines: ReturnType<typeof useActivityProfiles>["baselines"],
  key: ProfileMetricKey,
): { delta: number; pct: number; direction: "above" | "below" | "match" } {
  const baseline = baselines.get(profile.cohort);
  const median = baseline?.metrics[key]?.p50;
  if (!baseline || median == null) {
    return { delta: 0, pct: 0, direction: "match" };
  }
  const value = profile[key];
  const delta = value - median;
  const pct = median !== 0 ? (delta / Math.abs(median)) * 100 : 0;
  if (Math.abs(pct) < 5) return { delta, pct, direction: "match" };
  return { delta, pct, direction: pct > 0 ? "above" : "below" };
}

function SortHeader({
  label,
  sortKey,
  current,
  onToggle,
  align = "right",
  metric,
}: {
  label: string;
  sortKey: SortKey;
  current: SortState;
  onToggle: (k: SortKey) => void;
  align?: "left" | "right";
  /** When provided, renders a hover-tooltip explaining the metric. */
  metric?: ProfileMetricKey;
}) {
  const active = current.key === sortKey;
  return (
    <th
      onClick={() => onToggle(sortKey)}
      className={cn(
        "px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors",
        align === "right" && "text-right",
      )}
    >
      <span className={cn("inline-flex items-center gap-1", align === "right" && "justify-end w-full")}>
        {metric ? <MetricLabel metric={metric} label={label} /> : label}
        {active ? (
          current.dir === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

function DeltaCell({
  value,
  formatted,
  delta,
  showDelta,
}: {
  value: number;
  formatted: string;
  delta: { pct: number; direction: "above" | "below" | "match" };
  showDelta: boolean;
}) {
  if (value === 0) {
    return <span className="font-mono text-xs text-muted-foreground/60">—</span>;
  }
  const color =
    delta.direction === "above"
      ? "text-emerald-400"
      : delta.direction === "below"
        ? "text-red-400"
        : "text-muted-foreground";
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="font-mono text-xs text-foreground">{formatted}</span>
      {showDelta && delta.direction !== "match" && (
        <span className={cn("font-mono text-[9px]", color)}>
          {delta.pct > 0 ? "+" : ""}
          {delta.pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

function CohortBadge({ cohort }: { cohort: TenureCohort }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
        cohortBadgeClasses(cohort),
      )}
    >
      {cohort}
    </span>
  );
}

function severityClasses(severity: ActivityAnomaly["severity"]): string {
  switch (severity) {
    case "high":
      return "bg-red-500/10 text-red-400 border-red-500/30";
    case "medium":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "low":
      return "bg-sky-500/10 text-sky-400 border-sky-500/30";
  }
}

const KIND_ICON: Record<ActivityAnomaly["kind"], string> = {
  speed_skipping: "⚡",
  over_dwell: "🐢",
  pool_over_reliance: "💧",
  pool_ignoring: "🚫",
  self_assign_gap: "📋",
  presentation_drought: "🎤",
  cohort_lagging: "📉",
  cohort_overperforming: "🌟",
};

export default function ActivityProfiles() {
  const [windowDays, setWindowDays] = useState<14 | 30 | 60>(30);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sort, setSort] = useState<SortState>({ key: "anomalyScore", dir: "desc" });
  const [cohortFilter, setCohortFilter] = useState<TenureCohort | "All">("All");
  const [drillAgent, setDrillAgent] = useState<{ name: string; cohort: TenureCohort } | null>(null);

  const { profiles, baselines, anomaliesByAgent, windowStart, windowEnd, loading, error } =
    useActivityProfiles(windowDays, refreshKey);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  };

  // Cohort summary cards
  const cohortSummary = useMemo(() => {
    const result: Array<{
      cohort: TenureCohort;
      count: number;
      medianEngagement: number;
      anomaliesHigh: number;
      anomaliesMedium: number;
    }> = [];
    for (const cohort of COHORT_ORDER) {
      const baseline = baselines.get(cohort);
      const cohortProfiles = profiles.filter((p) => p.cohort === cohort);
      if (cohortProfiles.length === 0) continue;
      let high = 0;
      let medium = 0;
      for (const p of cohortProfiles) {
        const flags = anomaliesByAgent.get(p.name) ?? [];
        for (const f of flags) {
          if (f.kind === "cohort_overperforming") continue;
          if (f.severity === "high") high += 1;
          else if (f.severity === "medium") medium += 1;
        }
      }
      result.push({
        cohort,
        count: cohortProfiles.length,
        medianEngagement: baseline?.metrics.engagementScore.p50 ?? 0,
        anomaliesHigh: high,
        anomaliesMedium: medium,
      });
    }
    return result;
  }, [profiles, baselines, anomaliesByAgent]);

  const filteredProfiles = useMemo(() => {
    const filtered =
      cohortFilter === "All"
        ? profiles
        : profiles.filter((p) => p.cohort === cohortFilter);
    const getValue = (p: AgentActivityProfile): number | string => {
      switch (sort.key) {
        case "name":
          return p.name;
        case "cohort":
          return COHORT_ORDER.indexOf(p.cohort);
        case "anomalyScore":
          return anomalyScore(anomaliesByAgent.get(p.name));
        case "engagementScore":
          return p.engagementScore;
        case "totalDialsPerDay":
          return p.totalDialsPerDay;
        case "talkMinPerDay":
          return p.talkMinPerDay;
        case "talkSecPerDial":
          return p.talkSecPerDial;
        case "poolDialsPerDay":
          return p.poolDialsPerDay;
        case "selfAssignRate":
          return p.selfAssignRate;
        case "presentationsPerDay":
          return p.presentationsPerDay;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      const cmp =
        typeof va === "string" && typeof vb === "string"
          ? va.localeCompare(vb)
          : (va as number) - (vb as number);
      return sort.dir === "desc" ? -cmp : cmp;
    });
  }, [profiles, cohortFilter, sort, anomaliesByAgent]);

  // Top anomaly callouts (high-severity only, max 8)
  const topAnomalies = useMemo(() => {
    type Item = {
      name: string;
      cohort: TenureCohort;
      anomalies: ActivityAnomaly[];
      score: number;
    };
    const items: Item[] = [];
    for (const p of profiles) {
      const flags = (anomaliesByAgent.get(p.name) ?? []).filter(
        (a) => a.kind !== "cohort_overperforming",
      );
      if (flags.length === 0) continue;
      items.push({
        name: p.name,
        cohort: p.cohort,
        anomalies: flags,
        score: anomalyScore(flags),
      });
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 8);
  }, [profiles, anomaliesByAgent]);

  // Rising stars (overperforming in earlier cohorts)
  const risingStars = useMemo(() => {
    return profiles
      .filter((p) => {
        const flags = anomaliesByAgent.get(p.name) ?? [];
        return (
          flags.some((a) => a.kind === "cohort_overperforming") &&
          (p.cohort === "Ramping" || p.cohort === "Developing" || p.cohort === "Established")
        );
      })
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 5);
  }, [profiles, anomaliesByAgent]);

  return (
    <div className="p-6 space-y-6 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            Activity Profiles
          </h1>
          <p className="text-xs font-mono text-muted-foreground mt-1">
            Tenure-cohort baselines · {windowStart} → {windowEnd} · {profiles.length} agents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-card border border-border rounded-md overflow-hidden">
            {[14, 30, 60].map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d as 14 | 30 | 60)}
                className={cn(
                  "px-3 py-1.5 text-xs font-mono transition-colors",
                  windowDays === d
                    ? "bg-blue-500/20 text-blue-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-mono bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md text-xs font-mono text-red-400">
          {error}
        </div>
      )}

      {/* Live pulse — today's intraday vs cohort baselines */}
      <LiveCohortPulse spotlightLimit={6} />

      {/* Cohort summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cohortSummary.map((c) => (
          <button
            key={c.cohort}
            onClick={() =>
              setCohortFilter((prev) => (prev === c.cohort ? "All" : c.cohort))
            }
            className={cn(
              "p-3 bg-card border rounded-md text-left transition-colors",
              cohortFilter === c.cohort
                ? "border-blue-500/50 bg-blue-500/5"
                : "border-border hover:border-muted-foreground/30",
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <CohortBadge cohort={c.cohort} />
              <span className="text-xs font-mono text-muted-foreground">
                {c.count}
              </span>
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Median Engage
              </span>
              <span className="text-base font-bold font-mono text-foreground">
                {c.medianEngagement.toFixed(0)}
              </span>
            </div>
            {(c.anomaliesHigh > 0 || c.anomaliesMedium > 0) && (
              <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono">
                {c.anomaliesHigh > 0 && (
                  <span className="text-red-400">{c.anomaliesHigh} high</span>
                )}
                {c.anomaliesMedium > 0 && (
                  <span className="text-amber-400">{c.anomaliesMedium} med</span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Anomaly callouts */}
      {topAnomalies.length > 0 && (
        <div className="bg-card border border-border rounded-md p-4">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Top Activity Anomalies — Coaching Priorities
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {topAnomalies.map((item) => (
              <button
                key={item.name}
                onClick={() => setDrillAgent({ name: item.name, cohort: item.cohort })}
                className="p-3 bg-background border border-border rounded-md text-left hover:border-blue-500/40 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{item.name}</span>
                    <CohortBadge cohort={item.cohort} />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    score {item.score}
                  </span>
                </div>
                <div className="space-y-1">
                  {item.anomalies.slice(0, 3).map((a, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border shrink-0",
                          severityClasses(a.severity),
                        )}
                      >
                        {KIND_ICON[a.kind]} {a.label}
                      </span>
                    </div>
                  ))}
                  {item.anomalies.length > 3 && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      +{item.anomalies.length - 3} more
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Rising stars */}
      {risingStars.length > 0 && (
        <div className="bg-card border border-emerald-500/30 rounded-md p-4">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-400 mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Rising Stars — Outperforming Their Cohort
          </h2>
          <div className="flex flex-wrap gap-2">
            {risingStars.map((p) => (
              <button
                key={p.name}
                onClick={() => setDrillAgent({ name: p.name, cohort: p.cohort })}
                className="px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/30 rounded-md hover:bg-emerald-500/10 transition-colors inline-flex items-center gap-2"
              >
                <span className="text-sm font-bold text-foreground">{p.name}</span>
                <CohortBadge cohort={p.cohort} />
                <span className="text-[10px] font-mono text-emerald-400">
                  engage {p.engagementScore}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main table */}
      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4" />
            Per-Agent Activity ({filteredProfiles.length})
          </h2>
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <Zap className="h-3 w-3" />
            % delta vs cohort median
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-background/50 border-b border-border">
              <tr>
                <SortHeader label="Agent" sortKey="name" current={sort} onToggle={toggleSort} align="left" />
                <SortHeader label="Cohort" sortKey="cohort" current={sort} onToggle={toggleSort} align="left" />
                <SortHeader label="Days" sortKey="cohort" current={sort} onToggle={toggleSort} />
                <SortHeader label="Engage" sortKey="engagementScore" current={sort} onToggle={toggleSort} metric="engagementScore" />
                <SortHeader label="Total Dials/d" sortKey="totalDialsPerDay" current={sort} onToggle={toggleSort} metric="totalDialsPerDay" />
                <SortHeader label="Talk Min/d" sortKey="talkMinPerDay" current={sort} onToggle={toggleSort} metric="talkMinPerDay" />
                <SortHeader label="Sec/Dial" sortKey="talkSecPerDial" current={sort} onToggle={toggleSort} metric="talkSecPerDial" />
                <SortHeader label="Pool Dials/d" sortKey="poolDialsPerDay" current={sort} onToggle={toggleSort} metric="poolDialsPerDay" />
                <SortHeader label="Assign %" sortKey="selfAssignRate" current={sort} onToggle={toggleSort} metric="selfAssignRate" />
                <SortHeader label="Pres/d" sortKey="presentationsPerDay" current={sort} onToggle={toggleSort} metric="presentationsPerDay" />
                <SortHeader label="Flags" sortKey="anomalyScore" current={sort} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-xs font-mono text-muted-foreground">
                    No agents in this cohort.
                  </td>
                </tr>
              )}
              {filteredProfiles.map((p) => {
                const flags = (anomaliesByAgent.get(p.name) ?? []).filter(
                  (a) => a.kind !== "cohort_overperforming",
                );
                const positiveFlags = (anomaliesByAgent.get(p.name) ?? []).filter(
                  (a) => a.kind === "cohort_overperforming",
                );
                return (
                  <tr
                    key={p.name}
                    onClick={() => setDrillAgent({ name: p.name, cohort: p.cohort })}
                    className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 font-mono font-bold text-foreground">
                      {p.name}
                      {p.hiredDate && (
                        <span className="text-[9px] font-mono text-muted-foreground/60 ml-2">
                          {computeTenure(p.hiredDate).label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2"><CohortBadge cohort={p.cohort} /></td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                      {p.daysActive}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={cn(
                        "font-mono text-xs font-bold",
                        p.engagementScore >= 70 ? "text-emerald-400" :
                        p.engagementScore >= 50 ? "text-foreground" :
                        p.engagementScore >= 30 ? "text-amber-400" : "text-red-400",
                      )}>
                        {p.engagementScore}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeltaCell
                        value={p.totalDialsPerDay}
                        formatted={formatMetric("totalDialsPerDay", p.totalDialsPerDay)}
                        delta={compareDeltaToCohort(p, baselines, "totalDialsPerDay")}
                        showDelta
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeltaCell
                        value={p.talkMinPerDay}
                        formatted={formatMetric("talkMinPerDay", p.talkMinPerDay)}
                        delta={compareDeltaToCohort(p, baselines, "talkMinPerDay")}
                        showDelta
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeltaCell
                        value={p.talkSecPerDial}
                        formatted={formatMetric("talkSecPerDial", p.talkSecPerDial)}
                        delta={compareDeltaToCohort(p, baselines, "talkSecPerDial")}
                        showDelta={false}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeltaCell
                        value={p.poolDialsPerDay}
                        formatted={formatMetric("poolDialsPerDay", p.poolDialsPerDay)}
                        delta={compareDeltaToCohort(p, baselines, "poolDialsPerDay")}
                        showDelta
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeltaCell
                        value={p.selfAssignRate}
                        formatted={formatMetric("selfAssignRate", p.selfAssignRate)}
                        delta={compareDeltaToCohort(p, baselines, "selfAssignRate")}
                        showDelta={false}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <DeltaCell
                        value={p.presentationsPerDay}
                        formatted={formatMetric("presentationsPerDay", p.presentationsPerDay)}
                        delta={compareDeltaToCohort(p, baselines, "presentationsPerDay")}
                        showDelta
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 justify-end max-w-[260px] ml-auto">
                        {flags.slice(0, 3).map((a, idx) => (
                          <span
                            key={idx}
                            title={a.detail}
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border whitespace-nowrap",
                              severityClasses(a.severity),
                            )}
                          >
                            {KIND_ICON[a.kind]} {a.label}
                          </span>
                        ))}
                        {flags.length > 3 && (
                          <span className="text-[9px] font-mono text-muted-foreground self-center">
                            +{flags.length - 3}
                          </span>
                        )}
                        {flags.length === 0 && positiveFlags.length === 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground/40">—</span>
                        )}
                        {positiveFlags.map((a, idx) => (
                          <span
                            key={"pos-" + idx}
                            title={a.detail}
                            className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 whitespace-nowrap"
                          >
                            {KIND_ICON[a.kind]} {a.label}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AgentDrillDown
        agentName={drillAgent?.name ?? null}
        open={!!drillAgent}
        onOpenChange={(open) => !open && setDrillAgent(null)}
      />
    </div>
  );
}
