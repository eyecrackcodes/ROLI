import { useMemo } from "react";
import { useActivityProfiles } from "@/hooks/useActivityProfiles";
import { useLivePace } from "@/hooks/useLivePace";
import {
  formatMetric,
  metricLabel,
  type ActivityAnomaly,
  type ProfileMetricKey,
} from "@/lib/activityProfile";
import { statusColor, statusLabel } from "@/lib/livePace";
import { cohortBadgeClasses } from "@/lib/tenure";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, TrendingDown, TrendingUp, Zap } from "lucide-react";

interface ActivityProfileSectionProps {
  agentName: string;
  windowDays?: number;
}

const METRICS_TO_SHOW: ProfileMetricKey[] = [
  "totalDialsPerDay",
  "talkMinPerDay",
  "talkSecPerDial",
  "poolDialsPerDay",
  "selfAssignRate",
  "presentationsPerDay",
  "engagementScore",
];

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

export function ActivityProfileSection({
  agentName,
  windowDays = 30,
}: ActivityProfileSectionProps) {
  const { profiles, baselines, anomaliesByAgent, windowStart, windowEnd, loading } =
    useActivityProfiles(windowDays);
  const { agents: liveAgents, hour: liveHour } = useLivePace(windowDays);

  const profile = useMemo(
    () => profiles.find((p) => p.name === agentName),
    [profiles, agentName],
  );

  const baseline = profile ? baselines.get(profile.cohort) : undefined;
  const anomalies = anomaliesByAgent.get(agentName) ?? [];
  const liveSummary = useMemo(
    () => liveAgents.find((a) => a.agentName === agentName),
    [liveAgents, agentName],
  );
  const positive = anomalies.filter((a) => a.kind === "cohort_overperforming");
  const issues = anomalies.filter((a) => a.kind !== "cohort_overperforming");

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-md p-4">
        <p className="text-xs font-mono text-muted-foreground animate-pulse">
          Loading activity profile...
        </p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-card border border-border rounded-md p-4">
        <p className="text-xs font-mono text-muted-foreground">
          No activity profile available for {agentName}.
        </p>
      </div>
    );
  }

  if (profile.daysActive === 0) {
    return (
      <div className="bg-card border border-border rounded-md p-4">
        <p className="text-xs font-mono text-muted-foreground">
          No activity recorded in the last {windowDays} days ({windowStart} → {windowEnd}).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Zap className="h-3.5 w-3.5" />
          Activity Profile vs {profile.cohort} cohort ({baseline?.agentCount ?? 0} agents)
        </h3>
        <span className="text-[10px] font-mono text-muted-foreground">
          {windowDays}d · {profile.daysActive} active days
        </span>
      </div>

      {/* Live pace strip — today's projected EOD vs cohort median */}
      {liveSummary && liveHour >= 9 && (
        <div className="bg-card border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-emerald-400" />
              Live Pace · {formatLiveHour(liveHour)}
            </h4>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border",
                statusColor(liveSummary.overall),
              )}
            >
              {statusLabel(liveSummary.overall)}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {liveSummary.metrics.map((m) => (
              <div
                key={m.metric}
                className={cn(
                  "px-2 py-1.5 rounded border",
                  statusColor(m.status),
                )}
                title={`Cumulative so far: ${m.cumulative.toFixed(1)} | Projected EOD: ${m.projected.toFixed(1)} | Cohort median (full day): ${m.cohortMedian.toFixed(1)}`}
              >
                <div className="text-[9px] font-mono uppercase tracking-widest opacity-80">
                  {metricLabel(m.metric)}
                </div>
                <div className="text-sm font-mono font-bold leading-tight">
                  {m.cumulative.toFixed(0)}
                  <span className="text-[10px] font-normal opacity-70 ml-1">
                    →{m.projected.toFixed(0)}
                  </span>
                </div>
                <div className="text-[10px] font-mono">
                  {m.pctVsMedian > 0 ? "+" : ""}
                  {m.pctVsMedian.toFixed(0)}% vs med
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metric grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {METRICS_TO_SHOW.map((key) => {
          const value = profile[key];
          const median = baseline?.metrics[key]?.p50 ?? 0;
          const delta = median !== 0 ? ((value - median) / Math.abs(median)) * 100 : 0;
          const direction =
            Math.abs(delta) < 5 ? "match" : delta > 0 ? "above" : "below";
          // talkSecPerDial is ambiguous (too low = bad, too high = bad too).
          const isAmbiguous = key === "talkSecPerDial" || key === "poolEfficiency";
          const color =
            direction === "match" || isAmbiguous
              ? "text-muted-foreground"
              : direction === "above"
                ? "text-emerald-400"
                : "text-red-400";
          return (
            <div
              key={key}
              className="p-2.5 bg-card rounded-md border border-border"
              title={`${profile.name}: ${formatMetric(key, value)} | ${profile.cohort} median: ${formatMetric(key, median)}`}
            >
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                {metricLabel(key)}
              </div>
              <div className="text-base font-mono font-bold text-foreground">
                {formatMetric(key, value)}
              </div>
              <div className={cn("text-[9px] font-mono mt-0.5 flex items-center gap-1", color)}>
                {direction === "above" && <TrendingUp className="h-2.5 w-2.5" />}
                {direction === "below" && <TrendingDown className="h-2.5 w-2.5" />}
                <span>
                  {direction === "match" ? "≈" : (delta > 0 ? "+" : "")}
                  {direction === "match" ? "median" : `${delta.toFixed(0)}%`}
                </span>
              </div>
              <div className="text-[8px] font-mono text-muted-foreground/60 mt-0.5">
                med {formatMetric(key, median)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Anomaly callouts */}
      {(issues.length > 0 || positive.length > 0) && (
        <div className="bg-card border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            Pattern Anomalies ({issues.length + positive.length})
          </div>
          <div className="space-y-1.5">
            {issues.map((a, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 inline-flex items-center gap-1",
                    severityClasses(a.severity),
                  )}
                >
                  {KIND_ICON[a.kind]} {a.label}
                </span>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  {a.detail}
                </span>
              </div>
            ))}
            {positive.map((a, idx) => (
              <div key={"pos-" + idx} className="flex items-start gap-2">
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 inline-flex items-center gap-1",
                    "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                  )}
                >
                  {KIND_ICON[a.kind]} {a.label}
                </span>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  {a.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No anomalies — clean bill of health */}
      {issues.length === 0 && positive.length === 0 && (
        <div className="bg-card border border-border rounded-md p-3 text-center">
          <p className="text-[11px] font-mono text-muted-foreground">
            ✓ No activity anomalies vs {profile.cohort} cohort baseline
          </p>
        </div>
      )}
    </div>
  );
}

function formatLiveHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12} ${ampm} CST`;
}
