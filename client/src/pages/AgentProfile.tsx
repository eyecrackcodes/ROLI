import { useState, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useAgentProfile } from "@/hooks/useAgentProfile";
import type { ProfileDay, CoachingSignal } from "@/hooks/useAgentProfile";
import { MetricCard } from "@/components/MetricCard";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { T3_POOL_KPI } from "@/lib/t3Targets";
import { FLAG_META } from "@/lib/pipelineIntelligence";
import type { BehavioralFlag } from "@/lib/pipelineIntelligence";
import {
  ArrowLeft, Printer, CheckCircle2, XCircle, Minus,
  TrendingUp, TrendingDown, Shield, ShieldCheck, ShieldX,
  Target, Lightbulb, AlertTriangle, ThumbsUp,
  Calendar, CalendarRange, Users, DollarSign, BarChart3, CalendarClock,
} from "lucide-react";

function today() { return new Date().toISOString().slice(0, 10); }

function fmt(v: number) { return "$" + Math.round(v).toLocaleString(); }

function GateIcon({ status }: { status: "pass" | "fail" | "na" }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-red-400" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function FlagPill({ flag }: { flag: BehavioralFlag }) {
  const meta = FLAG_META[flag];
  const color = meta.severity === "critical"
    ? "bg-red-500/10 text-red-400 border-red-500/30"
    : meta.severity === "warning"
    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-mono font-medium border whitespace-nowrap", color)}>
      {meta.label}
    </span>
  );
}

function TrendIcon({ trend }: { trend: "growing" | "shrinking" | "stable" }) {
  if (trend === "shrinking") return <TrendingDown className="h-3 w-3 text-emerald-400" />;
  if (trend === "growing") return <TrendingUp className="h-3 w-3 text-red-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function SignalCard({ signal }: { signal: CoachingSignal }) {
  const colorMap = {
    positive: "bg-emerald-500/5 border-emerald-500/20 text-emerald-400",
    warning: "bg-amber-500/5 border-amber-500/20 text-amber-400",
    critical: "bg-red-500/5 border-red-500/20 text-red-400",
    info: "bg-blue-500/5 border-blue-500/20 text-blue-400",
  };
  const c = colorMap[signal.severity];
  return (
    <div className={cn("border rounded p-2", c.split(" ").slice(0, 2).join(" "))}>
      <div className={cn("text-[11px] font-mono font-bold", c.split(" ")[2])}>{signal.label}</div>
      <div className="text-[10px] font-mono text-muted-foreground">{signal.detail}</div>
    </div>
  );
}

// ---- Section 1: Header ----

function ProfileHeader({
  name, tier, site, manager, startDate, endDate, isRange, flags, onPrint,
  onStartChange, onEndChange, onToggleRange,
}: {
  name: string; tier: string; site: string; manager: string | null;
  startDate: string; endDate: string; isRange: boolean;
  flags: BehavioralFlag[];
  onPrint: () => void;
  onStartChange: (v: string) => void; onEndChange: (v: string) => void;
  onToggleRange: () => void;
}) {
  return (
    <div className="print:mb-2">
      {/* Print-only header */}
      <div className="hidden print:block mb-3 border-b border-border pb-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">{name}</h1>
            <p className="text-[10px] font-mono text-muted-foreground">{tier} · {site}{manager ? ` · Manager: ${manager}` : ""}</p>
          </div>
          <div className="text-right text-[10px] font-mono text-muted-foreground">
            <div>{isRange ? `${startDate} — ${endDate}` : startDate}</div>
            <div>Generated {new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        </div>
        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {flags.map(f => <FlagPill key={f} flag={f} />)}
          </div>
        )}
      </div>

      {/* Screen header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 print:hidden">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Link href="/leads-pool" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-xl font-bold text-foreground">{name}</h1>
            <span className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
              site === "RMT" ? "bg-violet-500/10 text-violet-400 border-violet-500/30"
                : site === "CLT" || site === "CHA" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-blue-500/10 text-blue-400 border-blue-500/30"
            )}>{site}</span>
            <span className="text-[10px] font-mono text-muted-foreground/60">{tier}</span>
          </div>
          {manager && <p className="text-xs font-mono text-muted-foreground">Manager: {manager}</p>}
          {flags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {flags.map(f => <FlagPill key={f} flag={f} />)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onToggleRange} className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono font-bold uppercase tracking-widest transition-colors border",
            isRange
              ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
              : "bg-card text-muted-foreground border-border hover:text-foreground"
          )}>
            {isRange ? <CalendarRange className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
            {isRange ? "Range" : "Single Day"}
          </button>
          <div className="h-5 w-px bg-border" />
          {isRange ? (
            <>
              <Input type="date" value={startDate} onChange={e => onStartChange(e.target.value)}
                className="h-7 w-auto text-xs font-mono border bg-card" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={endDate} onChange={e => onEndChange(e.target.value)}
                className="h-7 w-auto text-xs font-mono border bg-card" />
            </>
          ) : (
            <Input type="date" value={startDate} onChange={e => { onStartChange(e.target.value); onEndChange(e.target.value); }}
              className="h-7 w-auto text-xs font-mono border bg-card" />
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs font-mono gap-1" onClick={onPrint}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Section 2: Compliance Scorecard ----

function ComplianceScorecard({ days }: { days: ProfileDay[] }) {
  const latest = days[days.length - 1];
  if (!latest) return null;
  const avgGatesPassed = days.reduce((s, d) => s + d.gatesPassed, 0) / days.length;
  const compliantDays = days.filter(d => d.compliant).length;

  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-4 print:break-inside-avoid">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" /> 7-Gate Compliance {days.length === 1 ? `(${latest.date})` : `(Latest: ${latest.date})`}
        </h2>
        <div className="flex items-center gap-2">
          {latest.compliant
            ? <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-0.5"><ShieldCheck className="h-3 w-3" />{latest.gatesPassed}/{T3_POOL_KPI.TOTAL_GATES}</span>
            : <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-0.5"><ShieldX className="h-3 w-3" />{latest.gatesPassed}/{T3_POOL_KPI.TOTAL_GATES}</span>}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {latest.gates.map(g => (
          <div key={g.label} className={cn(
            "border rounded-md p-2 text-center",
            g.status === "pass" ? "border-emerald-500/30 bg-emerald-500/5"
              : g.status === "fail" ? "border-red-500/30 bg-red-500/5"
              : "border-border bg-card"
          )}>
            <GateIcon status={g.status} />
            <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mt-1">{g.label}</div>
            <div className={cn("text-sm font-mono font-bold tabular-nums mt-0.5",
              g.status === "pass" ? "text-emerald-400" : g.status === "fail" ? "text-red-400" : "text-muted-foreground"
            )}>{g.actual}</div>
            <div className="text-[8px] font-mono text-muted-foreground/60">{g.target}</div>
          </div>
        ))}
      </div>
      {days.length > 1 && (
        <div>
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Daily History — avg {avgGatesPassed.toFixed(1)} gates · {compliantDays}/{days.length} compliant
          </div>
          <div className="overflow-x-auto">
            <table className="text-[10px] font-mono">
              <thead>
                <tr>
                  <th className="px-1 py-0.5 text-left text-muted-foreground/60">Date</th>
                  {latest.gates.map(g => (
                    <th key={g.label} className="px-1 py-0.5 text-center text-muted-foreground/60 w-8">{g.label.slice(0, 3)}</th>
                  ))}
                  <th className="px-1 py-0.5 text-center text-muted-foreground/60">Pass</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map(d => (
                  <tr key={d.date} className="border-t border-border/20">
                    <td className="px-1 py-0.5 text-muted-foreground">{d.date.slice(5)}</td>
                    {d.gates.map((g, i) => (
                      <td key={i} className="px-1 py-0.5 text-center">
                        <span className={cn("inline-block w-3 h-3 rounded-sm",
                          g.status === "pass" ? "bg-emerald-500/60" : g.status === "fail" ? "bg-red-500/40" : "bg-border/50"
                        )} />
                      </td>
                    ))}
                    <td className={cn("px-1 py-0.5 text-center font-bold", d.compliant ? "text-emerald-400" : "text-red-400")}>{d.gatesPassed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Section 3: Activity Balance ----

function ActivityBalance({ summary }: { summary: NonNullable<ReturnType<typeof useAgentProfile>["summary"]> }) {
  const poolPct = summary.avgPoolPct;
  const inTarget = poolPct >= T3_POOL_KPI.MIN_POOL_PCT && poolPct <= T3_POOL_KPI.MAX_POOL_PCT;

  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-4 print:break-inside-avoid">
      <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <Target className="h-3.5 w-3.5" /> Activity Balance
      </h2>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-muted-foreground">Pipeline {(100 - poolPct).toFixed(0)}%</span>
          <span className={cn("font-bold", inTarget ? "text-emerald-400" : "text-amber-400")}>Pool {poolPct.toFixed(0)}%</span>
        </div>
        <div className="relative h-4 bg-border/30 rounded-full overflow-hidden">
          <div className="absolute h-full bg-emerald-500/10 border-x border-emerald-500/30"
            style={{ left: `${100 - T3_POOL_KPI.MAX_POOL_PCT}%`, width: `${T3_POOL_KPI.MAX_POOL_PCT - T3_POOL_KPI.MIN_POOL_PCT}%` }} />
          <div className="absolute left-0 h-full bg-blue-500/40 rounded-l-full" style={{ width: `${100 - poolPct}%` }} />
          <div className={cn("absolute right-0 h-full rounded-r-full", inTarget ? "bg-emerald-500/40" : "bg-amber-500/40")} style={{ width: `${poolPct}%` }} />
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/50 text-center">Target band: {T3_POOL_KPI.MIN_POOL_PCT}–{T3_POOL_KPI.MAX_POOL_PCT}% pool</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Combined Dials/Day" value={Math.round(summary.avgCombinedDials)}
          color={summary.avgCombinedDials >= T3_POOL_KPI.MIN_COMBINED_DIALS ? "green" : "red"} subtext={`${summary.totalCombinedDials} total`} />
        <MetricCard label="Pool % Avg" value={`${poolPct.toFixed(0)}%`} color={inTarget ? "green" : "amber"}
          subtext={`${summary.totalPoolDials} pool / ${summary.totalRegDials} reg`} />
        <MetricCard label="Talk Time/Day" value={`${Math.round(summary.avgTalkTime)}m`}
          color={summary.avgTalkTime >= T3_POOL_KPI.MIN_TALK_TIME ? "green" : "red"} subtext={`${Math.round(summary.totalCombinedTalk)} min total`} />
        <MetricCard label="Long Calls/Day" value={summary.avgLongCalls.toFixed(1)}
          color={summary.avgLongCalls >= T3_POOL_KPI.MIN_LONG_CALLS ? "green" : "red"} subtext={`${summary.totalPoolLongCalls} total`} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Avg Queue" value={Math.round(summary.avgCallQueue)}
          color={summary.avgCallQueue <= T3_POOL_KPI.MAX_QUEUE ? "green" : "amber"}
          subtext={<span className="inline-flex items-center gap-1"><TrendIcon trend={summary.queueTrend} /> {summary.queueTrend}</span>} />
        <MetricCard label="Avg Past Due" value={Math.round(summary.avgPastDue)}
          color={summary.avgPastDue === 0 ? "green" : summary.avgPastDue <= 5 ? "amber" : "red"}
          subtext={<span className="inline-flex items-center gap-1"><TrendIcon trend={summary.pastDueTrend} /> {summary.pastDueTrend}</span>} />
        <MetricCard label="Assign Rate" value={`${summary.avgAssignRate.toFixed(0)}%`}
          color={summary.avgAssignRate >= T3_POOL_KPI.MIN_ASSIGN_RATE ? "green" : "red"}
          subtext={`${summary.totalPoolAssigned} / ${summary.totalPoolAnswered} answered`} />
        <MetricCard label="Compliance" value={`${summary.complianceRate.toFixed(0)}%`}
          color={summary.complianceRate >= 80 ? "green" : summary.complianceRate >= 50 ? "amber" : "red"}
          subtext={`${summary.compliantDays}/${summary.days} days`} />
      </div>
    </div>
  );
}

// ---- Section 4: Production + Daily Table ----

function ProductionSummary({ days, summary }: { days: ProfileDay[]; summary: NonNullable<ReturnType<typeof useAgentProfile>["summary"]> }) {
  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-4 print:break-inside-avoid">
      <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Production Summary</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Total Sales" value={summary.totalSales} color={summary.totalSales > 0 ? "green" : "red"} subtext={`${summary.avgSalesPerDay.toFixed(1)}/day`} />
        <MetricCard label="Total Premium" value={fmt(summary.totalPremium)} color="blue" subtext={`${fmt(summary.avgPremiumPerDay)}/day`} />
        <MetricCard label="Close Rate" value={`${summary.closeRate.toFixed(1)}%`} color={summary.closeRate >= 8 ? "green" : summary.closeRate >= 4 ? "amber" : "red"} />
        <MetricCard label="Pool Close Rate" value={`${summary.poolCloseRate.toFixed(1)}%`} color={summary.poolCloseRate >= 8 ? "green" : summary.poolCloseRate >= 4 ? "amber" : "red"} />
        <MetricCard label="IB Sales" value={summary.totalIbSales} subtext="Inbound" />
        <MetricCard label="OB + Pool" value={summary.totalObSales + summary.totalPoolSales} subtext={`${summary.totalObSales} OB · ${summary.totalPoolSales} pool`} />
      </div>
      {days.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead><tr className="border-b border-border text-muted-foreground">
              <th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-right">Reg</th><th className="px-2 py-1 text-right">Pool</th>
              <th className="px-2 py-1 text-right">Pool%</th><th className="px-2 py-1 text-right">Talk</th><th className="px-2 py-1 text-right">Long</th>
              <th className="px-2 py-1 text-right">Sales</th><th className="px-2 py-1 text-right">Prem</th>
              <th className="px-2 py-1 text-right">PD</th><th className="px-2 py-1 text-right">Queue</th><th className="px-2 py-1 text-center">Gates</th>
            </tr></thead>
            <tbody>
              {[...days].reverse().map(d => (
                <tr key={d.date} className="border-b border-border/20 hover:bg-accent/20">
                  <td className="px-2 py-1 font-medium">{d.date}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.regDials}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-cyan-400">{d.poolDials}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums",
                    d.poolPct >= T3_POOL_KPI.MIN_POOL_PCT && d.poolPct <= T3_POOL_KPI.MAX_POOL_PCT ? "text-emerald-400" : "text-amber-400"
                  )}>{d.combinedDials > 0 ? `${d.poolPct.toFixed(0)}%` : "--"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{Math.round(d.combinedTalk)}m</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums",
                    d.poolLongCalls >= T3_POOL_KPI.MIN_LONG_CALLS ? "text-emerald-400" : d.poolLongCalls > 0 ? "" : "text-muted-foreground"
                  )}>{d.poolLongCalls}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums font-bold", d.combinedSales > 0 ? "text-emerald-400" : "")}>{d.combinedSales}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.combinedPremium > 0 ? fmt(d.combinedPremium) : "--"}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums", (d.pastDue ?? 0) > 0 ? "text-red-400" : "text-emerald-400")}>{d.pastDue ?? "--"}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums", (d.callQueue ?? 0) > T3_POOL_KPI.MAX_QUEUE ? "text-amber-400" : "")}>{d.callQueue ?? "--"}</td>
                  <td className="px-2 py-1 text-center">
                    {d.compliant ? <span className="text-emerald-400 font-bold">{d.gatesPassed}/{T3_POOL_KPI.TOTAL_GATES}</span>
                      : <span className="text-red-400">{d.gatesPassed}/{T3_POOL_KPI.TOTAL_GATES}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {days.length > 1 && (
              <tfoot><tr className="border-t-2 border-border font-bold">
                <td className="px-2 py-1">AVG</td>
                <td className="px-2 py-1 text-right tabular-nums">{Math.round(summary.totalRegDials / summary.days)}</td>
                <td className="px-2 py-1 text-right tabular-nums text-cyan-400">{Math.round(summary.totalPoolDials / summary.days)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{summary.avgPoolPct.toFixed(0)}%</td>
                <td className="px-2 py-1 text-right tabular-nums">{Math.round(summary.avgTalkTime)}m</td>
                <td className="px-2 py-1 text-right tabular-nums">{summary.avgLongCalls.toFixed(1)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{summary.avgSalesPerDay.toFixed(1)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{fmt(summary.avgPremiumPerDay)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Math.round(summary.avgPastDue)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Math.round(summary.avgCallQueue)}</td>
                <td className="px-2 py-1 text-center">{(days.reduce((s, d) => s + d.gatesPassed, 0) / days.length).toFixed(1)}</td>
              </tr></tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Section 5: Pipeline Health ----

function PipelineHealth({ days, summary }: { days: ProfileDay[]; summary: NonNullable<ReturnType<typeof useAgentProfile>["summary"]> }) {
  const pipelineDays = days.filter(d => d.pastDue != null || d.callQueue != null);
  if (pipelineDays.length === 0) return null;
  const latest = pipelineDays[pipelineDays.length - 1];
  const fuCompliance = (latest.pastDue != null && latest.todaysFollowUps != null)
    ? ((latest.pastDue + latest.todaysFollowUps) > 0 ? (1 - latest.pastDue / (latest.pastDue + latest.todaysFollowUps)) * 100 : 100) : null;

  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-4 print:break-inside-avoid">
      <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Pipeline State {pipelineDays.length === 1 ? `(${latest.date})` : `(Latest: ${latest.date})`}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Past Due" value={latest.pastDue ?? 0} color={(latest.pastDue ?? 0) === 0 ? "green" : "red"}
          subtext={<span className="inline-flex items-center gap-1"><TrendIcon trend={summary.pastDueTrend} /> {summary.pastDueTrend}</span>} />
        <MetricCard label="Call Queue" value={latest.callQueue ?? 0} color={(latest.callQueue ?? 0) <= T3_POOL_KPI.MAX_QUEUE ? "green" : "amber"}
          subtext={<span className="inline-flex items-center gap-1"><TrendIcon trend={summary.queueTrend} /> {summary.queueTrend}</span>} />
        <MetricCard label="Today's F/U" value={latest.todaysFollowUps ?? 0} subtext="Scheduled appointments" />
        <MetricCard label="F/U Compliance" value={fuCompliance != null ? `${fuCompliance.toFixed(0)}%` : "--"}
          color={fuCompliance != null ? (fuCompliance >= 80 ? "green" : fuCompliance >= 50 ? "amber" : "red") : "default"} />
      </div>
      {pipelineDays.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead><tr className="border-b border-border text-muted-foreground">
              <th className="px-2 py-1 text-left">Date</th><th className="px-2 py-1 text-right">Past Due</th>
              <th className="px-2 py-1 text-right">Queue</th><th className="px-2 py-1 text-right">New Leads</th>
              <th className="px-2 py-1 text-right">F/U</th><th className="px-2 py-1 text-right">Post-Sale</th>
            </tr></thead>
            <tbody>
              {[...pipelineDays].reverse().map((d, i, arr) => {
                const prev = i < arr.length - 1 ? arr[i + 1] : null;
                const pdDelta = prev && d.pastDue != null && prev.pastDue != null ? d.pastDue - prev.pastDue : null;
                const qDelta = prev && d.callQueue != null && prev.callQueue != null ? d.callQueue - prev.callQueue : null;
                return (
                  <tr key={d.date} className="border-b border-border/20">
                    <td className="px-2 py-1 font-medium">{d.date}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      <span className={(d.pastDue ?? 0) > 0 ? "text-red-400" : "text-emerald-400"}>{d.pastDue ?? "--"}</span>
                      {pdDelta != null && pdDelta !== 0 && <span className={cn("ml-1 text-[9px]", pdDelta < 0 ? "text-emerald-400" : "text-red-400")}>{pdDelta > 0 ? "+" : ""}{pdDelta}</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {d.callQueue ?? "--"}
                      {qDelta != null && qDelta !== 0 && <span className={cn("ml-1 text-[9px]", qDelta < 0 ? "text-emerald-400" : "text-red-400")}>{qDelta > 0 ? "+" : ""}{qDelta}</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{d.newLeads ?? "--"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{d.todaysFollowUps ?? "--"}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{d.postSaleLeads ?? "--"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Section 6: Coaching Summary (restructured) ----

function CoachingSummary({ signals, tier }: { signals: CoachingSignal[]; tier: string }) {
  const benchmarks = signals.filter(s => s.type === "benchmark");
  const revenue = signals.filter(s => s.type === "revenue");
  const callouts = signals.filter(s => s.type === "callout");
  const projections = signals.filter(s => s.type === "projection");
  const strengths = signals.filter(s => s.type === "strength");
  const improvements = signals.filter(s => s.type === "improvement");
  const actions = signals.filter(s => s.type === "action");

  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-4 print:break-inside-avoid">
      <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
        <Lightbulb className="h-3.5 w-3.5" /> Coaching Insights
      </h2>

      {/* Performance vs Peers */}
      {benchmarks.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-purple-400 flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Performance vs {tier} Peers
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {benchmarks.map((s, i) => <SignalCard key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Revenue Opportunity */}
      {revenue.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-blue-400 flex items-center gap-1.5">
            <DollarSign className="h-3 w-3" /> Revenue Opportunity
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {revenue.map((s, i) => <SignalCard key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Monthly Projection */}
      {projections.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
            <CalendarClock className="h-3 w-3" /> Monthly Projection
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {projections.map((s, i) => <SignalCard key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Daily Call-Outs */}
      {callouts.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
            <BarChart3 className="h-3 w-3" /> Daily Call-Outs
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {callouts.map((s, i) => <SignalCard key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Strengths & Improvements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
            <ThumbsUp className="h-3 w-3" /> Strengths ({strengths.length})
          </h3>
          {strengths.length === 0
            ? <p className="text-[11px] font-mono text-muted-foreground/50">No notable strengths detected</p>
            : strengths.map((s, i) => <SignalCard key={i} signal={s} />)}
        </div>
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> Areas for Improvement ({improvements.length})
          </h3>
          {improvements.length === 0
            ? <p className="text-[11px] font-mono text-muted-foreground/50">No concerns detected</p>
            : improvements.map((s, i) => <SignalCard key={i} signal={s} />)}
        </div>
      </div>

      {/* Suggested Actions */}
      {actions.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <h3 className="text-[10px] font-mono uppercase tracking-widest text-blue-400">Suggested Actions</h3>
          {actions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 bg-blue-500/5 border border-blue-500/20 rounded p-2">
              <Target className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] font-mono font-bold text-blue-400">{s.label}</div>
                <div className="text-[10px] font-mono text-muted-foreground">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main Page ----

export default function AgentProfile() {
  const [, params] = useRoute("/agent-profile/:name");
  const agentName = params?.name ? decodeURIComponent(params.name) : null;

  const [isRange, setIsRange] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const handleToggleRange = () => {
    if (!isRange) {
      const d = new Date(startDate);
      d.setDate(d.getDate() - 7);
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
      setStartDate(d.toISOString().slice(0, 10));
    } else {
      setStartDate(endDate);
    }
    setIsRange(!isRange);
  };

  const { agent, days, summary, coaching, flags, loading } = useAgentProfile(agentName, startDate, endDate);

  if (!agentName) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm font-mono text-muted-foreground">No agent specified</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 print:space-y-2 max-w-[1200px] mx-auto print:max-w-full print:px-0">
      <ProfileHeader
        name={agentName} tier={agent?.tier ?? "T3"} site={agent?.site ?? "--"} manager={agent?.manager ?? null}
        startDate={startDate} endDate={endDate} isRange={isRange} flags={flags}
        onPrint={() => window.print()} onStartChange={setStartDate} onEndChange={setEndDate} onToggleRange={handleToggleRange}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading agent profile...</p>
        </div>
      ) : days.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Shield className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-mono text-muted-foreground">No data for {agentName} in this date range</p>
        </div>
      ) : summary ? (
        <>
          <ComplianceScorecard days={days} />
          <ActivityBalance summary={summary} />
          <ProductionSummary days={days} summary={summary} />
          <PipelineHealth days={days} summary={summary} />
          <CoachingSummary signals={coaching} tier={agent?.tier ?? "T3"} />
        </>
      ) : null}
    </div>
  );
}
