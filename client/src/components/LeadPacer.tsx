// ============================================================
// Lead Pacer — intraday view of how the team is tracking against
// the unified 7 inbound leads/day target.
//
// Why this exists:
//   The 8am huddle needs a single answer to "are we on pace to take
//   our leads today?". This component reads the latest hourly
//   intraday_snapshot row per agent, compares actual ib_leads_delivered
//   to the expected pace curve, projects EOD, and surfaces any agent
//   who appears absent (no snapshot row, or 0 cumulative activity past
//   10am CST) so leadership can chase coverage early instead of finding
//   out at 5pm.
// ============================================================

import { useMemo, useState } from "react";
import { useIntradayPace, type AgentPaceStatus } from "@/hooks/useIntradayPace";
import { MetricCard } from "@/components/MetricCard";
import { cn } from "@/lib/utils";
import { Activity, AlertCircle, RefreshCw, ChevronDown, ChevronRight, UserX, MoonStar } from "lucide-react";
import { UNIFIED_INTRADAY_TARGETS } from "@/lib/unifiedTargets";

const DAILY_TARGET = UNIFIED_INTRADAY_TARGETS.IB_LEADS;

function hourLabel(h: number): string {
  if (!h) return "—";
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display} ${suffix}`;
}

function pctLabel(pct: number): string {
  if (!isFinite(pct)) return "0%";
  return `${Math.round(pct)}%`;
}

/** Color-coding by pace deficit on IB leads specifically. */
function paceTone(pct: number, presence: AgentPaceStatus["presence"]) {
  if (presence !== "active") return { text: "text-muted-foreground", bg: "bg-muted/30", bar: "bg-muted-foreground/30" };
  if (pct >= 100) return { text: "text-emerald-400", bg: "bg-emerald-500/10", bar: "bg-emerald-500" };
  if (pct >= 80) return { text: "text-amber-400", bg: "bg-amber-500/10", bar: "bg-amber-500" };
  return { text: "text-red-400", bg: "bg-red-500/10", bar: "bg-red-500" };
}

interface LeadPacerProps {
  /** Pass to replay an older day. Defaults to today (live mode). */
  scrapeDate?: string;
  /** Renders nothing if there is no intraday data for the date. */
  hideWhenEmpty?: boolean;
}

export function LeadPacer({ scrapeDate, hideWhenEmpty = true }: LeadPacerProps) {
  const { agents, summary, loading, refresh } = useIntradayPace(scrapeDate);
  const [showOnPace, setShowOnPace] = useState(false);

  const { needsAttention, onPaceList, idleList, notStartedList, latestHour } = useMemo(() => {
    // Buckets the pacer cares about, ranked by urgency.
    const needsAttention: AgentPaceStatus[] = [];
    const onPaceList: AgentPaceStatus[] = [];
    const idleList: AgentPaceStatus[] = [];
    const notStartedList: AgentPaceStatus[] = [];
    let latestHour = 0;

    for (const a of agents) {
      latestHour = Math.max(latestHour, a.hour);
      if (a.presence === "not_started") notStartedList.push(a);
      else if (a.presence === "idle") idleList.push(a);
      else if (a.metrics.ibLeads.pct < 100) needsAttention.push(a);
      else onPaceList.push(a);
    }

    // needsAttention: most-behind first (lowest pct).
    needsAttention.sort((a, b) => a.metrics.ibLeads.pct - b.metrics.ibLeads.pct);
    // onPaceList: most-ahead first (highest projected EOD).
    onPaceList.sort((a, b) => b.metrics.ibLeads.projected - a.metrics.ibLeads.projected);

    return { needsAttention, onPaceList, idleList, notStartedList, latestHour };
  }, [agents]);

  const hasIntradayData = agents.some(a => a.presence !== "not_started");
  if (hideWhenEmpty && !hasIntradayData && !loading) return null;

  // Org-level rate vs target. Use ibLeadsActiveAgents so absentees don't drag
  // the average down — that would conflate "team is slow" with "Steve called out".
  const activeTargetTotal = summary.ibLeadsActiveAgents * DAILY_TARGET;
  const orgPct = summary.ibLeadsExpected > 0
    ? (summary.ibLeadsActual / summary.ibLeadsExpected) * 100
    : 0;
  const orgColor: "green" | "amber" | "red" = orgPct >= 100 ? "green" : orgPct >= 80 ? "amber" : "red";
  const projectedDelta = summary.ibLeadsProjected - activeTargetTotal;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-border/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Activity className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">Lead Pacer</h3>
            <p className="text-[10px] font-mono text-muted-foreground">
              Target {DAILY_TARGET} IB leads/agent · {scrapeDate ? <span className="text-amber-400">Replay {scrapeDate}</span> : <>Live · {hourLabel(latestHour || summary.currentHour)} CST</>}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Org-level summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-card/60">
        <MetricCard
          label="Leads taken now"
          value={summary.ibLeadsActual}
          color={orgColor}
          subtext={`Expected ${summary.ibLeadsExpected} by ${hourLabel(latestHour || summary.currentHour)} · ${pctLabel(orgPct)}`}
          tooltip="Cumulative IB leads delivered across active agents up to the latest snapshot, vs. what the pace curve says we should be at by this hour."
        />
        <MetricCard
          label="Projected EOD"
          value={summary.ibLeadsProjected}
          color={projectedDelta >= 0 ? "green" : projectedDelta >= -10 ? "amber" : "red"}
          subtext={
            activeTargetTotal > 0
              ? `Target ${activeTargetTotal} (${projectedDelta >= 0 ? "+" : ""}${projectedDelta})`
              : "Target — no active agents yet"
          }
          tooltip="Naive end-of-day projection: actual divided by the % of the production day that has elapsed (per the pace curve). Active agents only."
        />
        <MetricCard
          label="On pace"
          value={`${summary.onPace}/${summary.ibLeadsActiveAgents}`}
          color={summary.onPace === summary.ibLeadsActiveAgents && summary.ibLeadsActiveAgents > 0 ? "green" : "amber"}
          subtext={`${summary.behind} behind · ${summary.critical} critical`}
        />
        <MetricCard
          label="Coverage"
          value={`${summary.ibLeadsActiveAgents}/${summary.totalAgents}`}
          color={summary.idle + summary.notStarted === 0 ? "green" : "red"}
          subtext={
            summary.idle + summary.notStarted === 0
              ? "All hands on deck"
              : `${summary.notStarted} not started · ${summary.idle} idle`
          }
          tooltip="Active = has logged any dial / talk-time / lead today. Not started = no snapshot row at all (likely absent). Idle = present but zero cumulative activity past 10am."
        />
      </div>

      {/* Absence callouts — surfaced before pace because absence is a coverage problem, not a perf one. */}
      {(notStartedList.length > 0 || idleList.length > 0) && (
        <div className="px-4 pb-3 space-y-2">
          {notStartedList.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-red-500/5 border border-red-500/20">
              <UserX className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <div className="text-xs font-mono">
                <div className="text-red-400 font-bold uppercase tracking-widest text-[10px]">
                  Not started ({notStartedList.length})
                </div>
                <div className="text-foreground mt-0.5">
                  {notStartedList.map(a => a.name).join(" · ")}
                </div>
              </div>
            </div>
          )}
          {idleList.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/20">
              <MoonStar className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs font-mono">
                <div className="text-amber-400 font-bold uppercase tracking-widest text-[10px]">
                  Idle past 10 AM ({idleList.length})
                </div>
                <div className="text-foreground mt-0.5">
                  {idleList.map(a => a.name).join(" · ")}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Behind / Needs attention list */}
      {needsAttention.length > 0 && (
        <div className="border-t border-border/40">
          <div className="px-4 py-2 bg-card/40 flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Behind pace ({needsAttention.length})
            </span>
          </div>
          <PacerRows rows={needsAttention} />
        </div>
      )}

      {/* On-pace toggle — collapsed by default, the team doesn't need them in their face. */}
      {onPaceList.length > 0 && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setShowOnPace(v => !v)}
            className="w-full px-4 py-2 bg-card/40 flex items-center gap-2 hover:bg-accent/30 transition-colors"
          >
            {showOnPace ? <ChevronDown className="h-3.5 w-3.5 text-emerald-400" /> : <ChevronRight className="h-3.5 w-3.5 text-emerald-400" />}
            <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              On pace ({onPaceList.length})
            </span>
          </button>
          {showOnPace && <PacerRows rows={onPaceList} />}
        </div>
      )}

      {/* Edge case: every active agent is on pace, no behind list to render. */}
      {needsAttention.length === 0 && onPaceList.length === 0 && hasIntradayData && (
        <div className="px-4 py-6 text-center text-xs font-mono text-muted-foreground">
          No active agents yet — waiting for the first hourly snapshot.
        </div>
      )}
    </div>
  );
}

function PacerRows({ rows }: { rows: AgentPaceStatus[] }) {
  return (
    <div className="divide-y divide-border/40">
      {rows.map(a => {
        const ib = a.metrics.ibLeads;
        const tone = paceTone(ib.pct, a.presence);
        // Cap the bar at 150% so an outlier doesn't visually crush everyone else.
        const barPct = Math.min(ib.pct, 150);
        return (
          <div key={a.name} className="px-4 py-2.5 grid grid-cols-12 gap-3 items-center">
            {/* Name + site */}
            <div className="col-span-4 sm:col-span-3 min-w-0">
              <div className="font-semibold text-sm text-foreground truncate">{a.name}</div>
              <div className="text-[10px] font-mono text-muted-foreground">{a.site} · {hourLabel(a.hour)}</div>
            </div>

            {/* Actual vs expected */}
            <div className="col-span-3 sm:col-span-2 text-right">
              <div className={cn("text-lg font-mono font-bold tabular-nums leading-none", tone.text)}>
                {ib.actual}
                <span className="text-muted-foreground/50 text-xs">/{ib.expected}</span>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{pctLabel(ib.pct)} pace</div>
            </div>

            {/* Pace bar */}
            <div className="col-span-3 sm:col-span-4">
              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                <div className={cn("h-full transition-all", tone.bar)} style={{ width: `${barPct}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] font-mono text-muted-foreground">0</span>
                <span className="text-[10px] font-mono text-muted-foreground">target {DAILY_TARGET}</span>
              </div>
            </div>

            {/* Projected EOD */}
            <div className="col-span-2 sm:col-span-3 text-right">
              <div className={cn(
                "text-sm font-mono font-bold tabular-nums",
                ib.projected >= DAILY_TARGET ? "text-emerald-400" : ib.projected >= DAILY_TARGET * 0.8 ? "text-amber-400" : "text-red-400"
              )}>
                ~{ib.projected}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">EOD proj</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
