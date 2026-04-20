import { useMemo } from "react";
import { Link } from "wouter";
import { useLivePace } from "@/hooks/useLivePace";
import { statusColor, statusLabel, type PaceStatus } from "@/lib/livePace";
import { cn } from "@/lib/utils";
import { Activity, ChevronRight, Zap } from "lucide-react";

const BUCKET_ORDER: PaceStatus[] = ["great", "on_pace", "watch", "behind", "no_data"];

interface LiveCohortPulseProps {
  /** When true, render a single-row strip (no top agent list). */
  compact?: boolean;
  /** Optional limit on number of "behind" agents to spotlight. */
  spotlightLimit?: number;
}

/**
 * Org-wide live pulse: shows how the floor is trending vs cohort baselines
 * RIGHT NOW. Updates whenever Tier 1 realtime fires (which it does on every
 * intraday_snapshots insert).
 *
 * Surfaces:
 *   - Headline ("12/26 agents on pace at 2p — clean morning.")
 *   - Bucket counts (great / on pace / watch / behind / no data)
 *   - Pace-curve fraction at the current hour
 *   - Top "behind" agents with their cohort + worst metric
 */
export function LiveCohortPulse({ compact = false, spotlightLimit = 5 }: LiveCohortPulseProps) {
  const { loading, error, hour, paceFraction, agents, pulse } = useLivePace();

  const counts = useMemo(
    () => ({
      great: pulse.great,
      on_pace: pulse.onPace,
      watch: pulse.watch,
      behind: pulse.behind,
      no_data: pulse.noData,
    }),
    [pulse],
  );

  const spotlight = useMemo(() => {
    return agents
      .filter((a) => a.overall === "behind" || a.overall === "watch")
      .sort((a, b) => {
        // Behind first, then by worst pctVsMedian among their flagged metrics.
        if (a.overall !== b.overall) return a.overall === "behind" ? -1 : 1;
        const aWorst = Math.min(...a.metrics.map((m) => m.pctVsMedian));
        const bWorst = Math.min(...b.metrics.map((m) => m.pctVsMedian));
        return aWorst - bWorst;
      })
      .slice(0, spotlightLimit);
  }, [agents, spotlightLimit]);

  if (loading && agents.length === 0) {
    return (
      <div className="bg-card border border-border rounded-md p-4">
        <p className="text-xs font-mono text-muted-foreground animate-pulse">
          Building live pulse from cohort baselines + intraday snapshots…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-red-500/30 rounded-md p-4">
        <p className="text-xs font-mono text-red-400">
          Live pulse unavailable: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          <div>
            <h3 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Live Cohort Pulse
            </h3>
            <p className="text-sm font-mono text-foreground mt-0.5">
              {pulse.headline}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Pace curve
          </div>
          <div className="text-sm font-mono font-bold text-foreground">
            {hour > 0 ? `${formatHour(hour)}` : "—"}{" "}
            <span className="text-muted-foreground font-normal">
              · {(paceFraction * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Bucket strip */}
      <div className="grid grid-cols-5 gap-2">
        {BUCKET_ORDER.map((bucket) => (
          <div
            key={bucket}
            className={cn(
              "px-2 py-2 rounded-md border text-center",
              statusColor(bucket),
            )}
          >
            <div className="text-base font-mono font-bold leading-none">
              {counts[bucket]}
            </div>
            <div className="text-[9px] font-mono uppercase tracking-widest mt-1 opacity-80">
              {statusLabel(bucket)}
            </div>
          </div>
        ))}
      </div>

      {!compact && spotlight.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Spotlight ({spotlight.length})
            </h4>
            <Link href="/activity">
              <button className="text-[10px] font-mono text-blue-400 hover:text-blue-300 inline-flex items-center gap-0.5">
                full breakdown <ChevronRight className="h-3 w-3" />
              </button>
            </Link>
          </div>
          <div className="space-y-1">
            {spotlight.map((s) => {
              const worstMetric = [...s.metrics].sort(
                (a, b) => a.pctVsMedian - b.pctVsMedian,
              )[0];
              return (
                <div
                  key={s.agentName}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 bg-background/50 rounded border border-border/60"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border shrink-0",
                        statusColor(s.overall),
                      )}
                    >
                      {statusLabel(s.overall)}
                    </span>
                    <span className="text-xs font-mono text-foreground truncate">
                      {s.agentName}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      · {s.cohort}
                    </span>
                  </div>
                  {worstMetric && (
                    <div className="text-[10px] font-mono text-right shrink-0">
                      <span className="text-muted-foreground">
                        {metricShortLabel(worstMetric.metric)}
                      </span>{" "}
                      <span
                        className={cn(
                          worstMetric.pctVsMedian < -25
                            ? "text-red-400"
                            : "text-amber-400",
                        )}
                      >
                        {worstMetric.pctVsMedian > 0 ? "+" : ""}
                        {worstMetric.pctVsMedian.toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!compact && spotlight.length === 0 && pulse.agentCount > 0 && (
        <div className="text-center py-2">
          <p className="text-[11px] font-mono text-muted-foreground inline-flex items-center gap-1.5">
            <Activity className="h-3 w-3 text-emerald-400" />
            Floor on pace — no agents flagged.
          </p>
        </div>
      )}
    </div>
  );
}

function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 || hour === 24 ? "AM" : "PM";
  return `${h12} ${ampm}`;
}

function metricShortLabel(key: string): string {
  switch (key) {
    case "totalDialsPerDay":
      return "Dials";
    case "talkMinPerDay":
      return "Talk";
    case "poolDialsPerDay":
      return "Pool";
    case "presentationsPerDay":
      return "Pres";
    default:
      return key;
  }
}
