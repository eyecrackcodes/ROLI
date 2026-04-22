// ============================================================
// RpaPacer — intraday view of how the team is tracking against the
// 300 RPA min/day unified target.
//
// Why this exists, in one sentence:
//   The 8am huddle and the 2pm check-in need a single answer to
//   "are we on the floor enough today?" — RPA = queue + inbound talk
//   + outbound talk + dial overhead. See docs/sops/Agent-Activity-SOP.md.
//
// Visual / UX is intentionally a near-mirror of LeadPacer so the team
// reads them with the same mental model — only the unit changes (leads
// → minutes) and the components hover-out as a tooltip per row.
// ============================================================

import { useMemo, useState } from "react";
import { useIntradayRpaPace, type AgentRpaStatus, type RpaPresence } from "@/hooks/useIntradayRpaPace";
import { MetricCard } from "@/components/MetricCard";
import { cn } from "@/lib/utils";
import { Clock, AlertCircle, RefreshCw, ChevronDown, ChevronRight, UserX, MoonStar, AlertTriangle } from "lucide-react";
import { UNIFIED_INTRADAY_TARGETS } from "@/lib/unifiedTargets";

const DAILY_TARGET = UNIFIED_INTRADAY_TARGETS.RPA_MINUTES;

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

function fmtMin(m: number): string {
  if (m < 60) return `${Math.round(m)}m`;
  const hrs = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem === 0 ? `${hrs}h` : `${hrs}h ${rem}m`;
}

function paceTone(pct: number, presence: RpaPresence) {
  if (presence !== "active") return { text: "text-muted-foreground", bg: "bg-muted/30", bar: "bg-muted-foreground/30" };
  if (pct >= 100) return { text: "text-emerald-400", bg: "bg-emerald-500/10", bar: "bg-emerald-500" };
  if (pct >= 80) return { text: "text-amber-400", bg: "bg-amber-500/10", bar: "bg-amber-500" };
  return { text: "text-red-400", bg: "bg-red-500/10", bar: "bg-red-500" };
}

interface RpaPacerProps {
  /** Pass to replay an older day. Defaults to today (live mode). */
  scrapeDate?: string;
  /** Renders nothing if there is no intraday data for the date. */
  hideWhenEmpty?: boolean;
}

export function RpaPacer({ scrapeDate, hideWhenEmpty = true }: RpaPacerProps) {
  const { agents, summary, loading, refresh } = useIntradayRpaPace(scrapeDate);
  const [showOnPace, setShowOnPace] = useState(false);

  const { needsAttention, onPaceList, idleList, notStartedList, latestHour } = useMemo(() => {
    const needsAttention: AgentRpaStatus[] = [];
    const onPaceList: AgentRpaStatus[] = [];
    const idleList: AgentRpaStatus[] = [];
    const notStartedList: AgentRpaStatus[] = [];
    let latestHour = 0;

    for (const a of agents) {
      latestHour = Math.max(latestHour, a.hour);
      if (a.presence === "not_started") notStartedList.push(a);
      else if (a.presence === "idle") idleList.push(a);
      else if (a.metrics.rpa.pct < 100) needsAttention.push(a);
      else onPaceList.push(a);
    }

    needsAttention.sort((a, b) => a.metrics.rpa.pct - b.metrics.rpa.pct);
    onPaceList.sort((a, b) => b.metrics.rpa.projected - a.metrics.rpa.projected);

    return { needsAttention, onPaceList, idleList, notStartedList, latestHour };
  }, [agents]);

  const hasIntradayData = agents.some((a) => a.presence !== "not_started");
  if (hideWhenEmpty && !hasIntradayData && !loading) return null;

  const orgPct = summary.totalExpected > 0
    ? (summary.totalActual / summary.totalExpected) * 100
    : 0;
  const orgColor: "green" | "amber" | "red" = orgPct >= 100 ? "green" : orgPct >= 80 ? "amber" : "red";
  const projectedDelta = summary.totalProjected - summary.totalTarget;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-border/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <Clock className="h-4 w-4 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground tracking-tight">RPA Pacer</h3>
            <p className="text-[10px] font-mono text-muted-foreground">
              Target {DAILY_TARGET} min/agent · {scrapeDate ? <span className="text-amber-400">Replay {scrapeDate}</span> : <>Live · {hourLabel(latestHour || summary.currentHour)} CST</>}
              {summary.awaitingIcd > 0 && (
                <>
                  {" · "}
                  <span className="text-amber-400" title="Inbound queue + talk haven't landed for these agents this hour. RPA totals will catch up after the next ICD scrape.">
                    {summary.awaitingIcd} awaiting ICD
                  </span>
                </>
              )}
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
          label="RPA min now"
          value={fmtMin(summary.totalActual)}
          color={orgColor}
          subtext={`Expected ${fmtMin(summary.totalExpected)} by ${hourLabel(latestHour || summary.currentHour)} · ${pctLabel(orgPct)}`}
          tooltip="Cumulative RPA minutes across active agents up to the latest snapshot, vs. the pace curve. RPA = queue + inbound talk + outbound talk + dial overhead."
        />
        <MetricCard
          label="Projected EOD"
          value={fmtMin(summary.totalProjected)}
          color={projectedDelta >= 0 ? "green" : projectedDelta >= -summary.totalTarget * 0.1 ? "amber" : "red"}
          subtext={
            summary.totalTarget > 0
              ? `Target ${fmtMin(summary.totalTarget)} (${projectedDelta >= 0 ? "+" : ""}${fmtMin(Math.abs(projectedDelta)) === "0m" ? "0m" : (projectedDelta >= 0 ? "+" : "-") + fmtMin(Math.abs(projectedDelta))})`
              : "Target — no active agents yet"
          }
          tooltip="Naive end-of-day projection: actual / % of production day elapsed (per pace curve). Active agents only."
        />
        <MetricCard
          label="On pace"
          value={`${summary.onPace}/${summary.activeAgents}`}
          color={summary.onPace === summary.activeAgents && summary.activeAgents > 0 ? "green" : "amber"}
          subtext={`${summary.behind} behind · ${summary.critical} critical`}
        />
        <MetricCard
          label="Coverage"
          value={`${summary.activeAgents}/${summary.totalAgents}`}
          color={summary.idle + summary.notStarted === 0 ? "green" : "red"}
          subtext={
            summary.idle + summary.notStarted === 0
              ? "All hands on deck"
              : `${summary.notStarted} not started · ${summary.idle} idle`
          }
          tooltip="Active = has logged any dial / talk-time / queue / lead today. Not started = no snapshot row at all (likely absent). Idle = present but zero cumulative activity past 10am."
        />
      </div>

      {/* Absence callouts (same pattern as LeadPacer). */}
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
                  {notStartedList.map((a) => a.name).join(" · ")}
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
                  {idleList.map((a) => a.name).join(" · ")}
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
          <RpaRows rows={needsAttention} />
        </div>
      )}

      {/* On-pace toggle — collapsed by default. */}
      {onPaceList.length > 0 && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setShowOnPace((v) => !v)}
            className="w-full px-4 py-2 bg-card/40 flex items-center gap-2 hover:bg-accent/30 transition-colors"
          >
            {showOnPace ? <ChevronDown className="h-3.5 w-3.5 text-emerald-400" /> : <ChevronRight className="h-3.5 w-3.5 text-emerald-400" />}
            <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              On pace ({onPaceList.length})
            </span>
          </button>
          {showOnPace && <RpaRows rows={onPaceList} />}
        </div>
      )}

      {needsAttention.length === 0 && onPaceList.length === 0 && hasIntradayData && (
        <div className="px-4 py-6 text-center text-xs font-mono text-muted-foreground">
          No active agents yet — waiting for the first hourly snapshot.
        </div>
      )}
    </div>
  );
}

function RpaRows({ rows }: { rows: AgentRpaStatus[] }) {
  return (
    <div className="divide-y divide-border/40">
      {rows.map((a) => {
        const m = a.metrics.rpa;
        const tone = paceTone(m.pct, a.presence);
        const barPct = Math.min(m.pct, 150);
        const componentTooltip =
          `Components (cumulative min):\n` +
          `· Queue: ${m.components.queue}\n` +
          `· Inbound talk: ${m.components.inboundTalk}\n` +
          `· Outbound talk: ${m.components.outboundTalk}\n` +
          `· Dial overhead: ${m.components.dialOverhead}`;
        return (
          <div key={a.name} className="px-4 py-2.5 grid grid-cols-12 gap-3 items-center">
            <div className="col-span-4 sm:col-span-3 min-w-0">
              <div className="font-semibold text-sm text-foreground truncate flex items-center gap-1.5">
                {a.name}
                {!a.hasIcdData && (
                  <span title="Inbound queue/talk hasn't landed yet for this agent. RPA total will jump when ICD scrape posts.">
                    <AlertTriangle className="h-3 w-3 text-amber-400/70 shrink-0" />
                  </span>
                )}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">{a.site} · {hourLabel(a.hour)}</div>
            </div>

            <div className="col-span-3 sm:col-span-2 text-right" title={componentTooltip}>
              <div className={cn("text-lg font-mono font-bold tabular-nums leading-none", tone.text)}>
                {fmtMin(m.actual)}
                <span className="text-muted-foreground/50 text-xs">/{fmtMin(m.expected)}</span>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{pctLabel(m.pct)} pace</div>
            </div>

            <div className="col-span-3 sm:col-span-4">
              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                <div className={cn("h-full transition-all", tone.bar)} style={{ width: `${barPct}%` }} />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] font-mono text-muted-foreground">0</span>
                <span className="text-[10px] font-mono text-muted-foreground">target {fmtMin(DAILY_TARGET)}</span>
              </div>
            </div>

            <div className="col-span-2 sm:col-span-3 text-right">
              <div className={cn(
                "text-sm font-mono font-bold tabular-nums",
                m.projected >= DAILY_TARGET ? "text-emerald-400" : m.projected >= DAILY_TARGET * 0.8 ? "text-amber-400" : "text-red-400",
              )}>
                ~{fmtMin(m.projected)}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">EOD proj</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
