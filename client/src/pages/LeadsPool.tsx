import { useState, useMemo, useCallback } from "react";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, CheckCircle2, XCircle, Users, Phone, Clock, Target, Calendar, CalendarRange, ChevronLeft, ChevronRight, Zap, Shield, ShieldCheck, ShieldX, Activity, RefreshCw } from "lucide-react";
import { useIntradayPace } from "@/hooks/useIntradayPace";
import type { AgentPaceStatus, PaceMetric } from "@/hooks/useIntradayPace";
import { T3_INTRADAY_TARGETS, BUSINESS_HOURS } from "@/lib/t3Targets";
import type { DailyPulseAgent, PoolMetrics, PoolInventorySnapshot } from "@/lib/types";
import type { PipelineAgent } from "@/lib/pipelineIntelligence";
import { T3_POOL_KPI } from "@/lib/t3Targets";
import type { GateStatus, ScorecardGate } from "@/lib/t3Targets";

type SortDir = "asc" | "desc";
interface SortState { key: string; dir: SortDir }

function useSort(defaultKey: string, defaultDir: SortDir = "desc") {
  const [sort, setSort] = useState<SortState>({ key: defaultKey, dir: defaultDir });
  const toggle = useCallback((key: string) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });
  }, []);
  return { sort, toggle };
}

function SortHeader({ label, sortKey, current, onToggle, align = "right" }: {
  label: string; sortKey: string; current: SortState; onToggle: (k: string) => void; align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors",
        align === "right" && "text-right"
      )}
      onClick={() => onToggle(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (current.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </th>
  );
}

interface PoolAgent {
  name: string;
  site: string;
  tier: string;
  pool: PoolMetrics;
}

function getPoolAgents(agents: DailyPulseAgent[]): PoolAgent[] {
  return agents
    .filter((a) => a.pool && a.pool.callsMade > 0)
    .map((a) => ({ name: a.name, site: a.site, tier: a.tier, pool: a.pool! }));
}

function sortPoolAgents(agents: PoolAgent[], sort: SortState): PoolAgent[] {
  const getValue = (a: PoolAgent): number => {
    switch (sort.key) {
      case "callsMade": return a.pool.callsMade;
      case "talkTime": return a.pool.talkTimeMin;
      case "sales": return a.pool.salesMade;
      case "premium": return a.pool.premium;
      case "selfAssigned": return a.pool.selfAssignedLeads;
      case "answered": return a.pool.answeredCalls;
      case "longCalls": return a.pool.longCalls;
      case "contactRate": return a.pool.contactRate;
      case "assignRate": return a.pool.assignRate;
      case "presRate": return a.pool.selfAssignedLeads > 0 ? (a.pool.longCalls / a.pool.selfAssignedLeads) * 100 : 0;
      default: return 0;
    }
  };

  return [...agents].sort((a, b) => {
    if (sort.key === "name") {
      const cmp = a.name.localeCompare(b.name);
      return sort.dir === "asc" ? cmp : -cmp;
    }
    const va = getValue(a), vb = getValue(b);
    return sort.dir === "asc" ? va - vb : vb - va;
  });
}

const ASSIGN_RATE_TARGET = 65;

interface AgentScorecard {
  name: string;
  site: string;
  gates: ScorecardGate[];
  gatesPassed: number;
  compliant: boolean;
  pool: PoolMetrics;
}

function buildT3Scorecards(agents: PoolAgent[], pipelineAgents: PipelineAgent[]): AgentScorecard[] {
  const pipeMap = new Map(pipelineAgents.map(a => [a.name, a]));

  return agents
    .filter((a) => a.tier === "T3")
    .map((a) => {
      const p = a.pool;
      const pipe = pipeMap.get(a.name);
      const regDials = pipe?.totalDials ?? 0;
      const regTalk = pipe?.talkTimeMin ?? 0;
      const combinedDials = regDials + p.callsMade;
      const combinedTalk = regTalk + p.talkTimeMin;
      const poolPct = combinedDials > 0 ? (p.callsMade / combinedDials) * 100 : 0;
      const pastDue = pipe?.pastDue ?? 0;
      const callQueue = pipe?.callQueue ?? 0;

      const combinedDialGate: ScorecardGate = {
        label: "Volume",
        target: `≥ ${T3_POOL_KPI.MIN_COMBINED_DIALS}`,
        actual: combinedDials,
        status: combinedDials >= T3_POOL_KPI.MIN_COMBINED_DIALS ? "pass" : "fail",
      };

      const poolPctGate: ScorecardGate = {
        label: "Pool %",
        target: `${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}%`,
        actual: combinedDials > 0 ? `${poolPct.toFixed(0)}%` : "--",
        status: combinedDials === 0 ? "na"
          : poolPct >= T3_POOL_KPI.MIN_POOL_PCT && poolPct <= T3_POOL_KPI.MAX_POOL_PCT ? "pass" : "fail",
      };

      const longCallGate: ScorecardGate = {
        label: "Long Calls",
        target: `≥ ${T3_POOL_KPI.MIN_LONG_CALLS}`,
        actual: p.longCalls,
        status: p.longCalls >= T3_POOL_KPI.MIN_LONG_CALLS ? "pass" : "fail",
      };

      const talkTimeGate: ScorecardGate = {
        label: "Talk Time",
        target: `≥ ${T3_POOL_KPI.MIN_TALK_TIME}m`,
        actual: `${Math.round(combinedTalk)}m`,
        status: combinedTalk >= T3_POOL_KPI.MIN_TALK_TIME ? "pass" : "fail",
      };

      const assignRateGate: ScorecardGate = {
        label: "Assign %",
        target: `≥ ${T3_POOL_KPI.MIN_ASSIGN_RATE}%`,
        actual: p.answeredCalls > 0 ? `${p.assignRate.toFixed(0)}%` : "--",
        status: p.answeredCalls === 0 ? "na" : p.assignRate >= T3_POOL_KPI.MIN_ASSIGN_RATE ? "pass" : "fail",
      };

      const pastDueGate: ScorecardGate = {
        label: "Past Due",
        target: "0",
        actual: pastDue,
        status: pipe == null ? "na" : pastDue <= T3_POOL_KPI.MAX_PAST_DUE ? "pass" : "fail",
      };

      const queueGate: ScorecardGate = {
        label: "Queue",
        target: `≤ ${T3_POOL_KPI.MAX_QUEUE}`,
        actual: callQueue,
        status: pipe == null ? "na" : callQueue <= T3_POOL_KPI.MAX_QUEUE ? "pass" : "fail",
      };

      const gates = [combinedDialGate, poolPctGate, longCallGate, talkTimeGate, assignRateGate, pastDueGate, queueGate];
      const gatesPassed = gates.filter((g) => g.status === "pass").length;

      return {
        name: a.name,
        site: a.site,
        gates,
        gatesPassed,
        compliant: gatesPassed >= T3_POOL_KPI.GATES_TO_PASS,
        pool: p,
      };
    })
    .sort((a, b) => b.gatesPassed - a.gatesPassed || b.pool.callsMade - a.pool.callsMade);
}

function GateBadge({ status }: { status: GateStatus }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === "fail") return <XCircle className="h-4 w-4 text-red-400" />;
  return <span className="text-muted-foreground text-xs">--</span>;
}

function PoolScorecard({ agents, pipelineAgents }: { agents: PoolAgent[]; pipelineAgents: PipelineAgent[] }) {
  const scorecards = useMemo(() => buildT3Scorecards(agents, pipelineAgents), [agents, pipelineAgents]);
  const t3Count = agents.filter((a) => a.tier === "T3").length;

  if (t3Count === 0) return null;

  const compliantCount = scorecards.filter((s) => s.compliant).length;
  const compliancePct = t3Count > 0 ? ((compliantCount / t3Count) * 100).toFixed(0) : "0";

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-blue-400" />
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            T3 Pool Compliance
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            {compliantCount}/{t3Count} compliant
          </span>
          <span className={cn(
            "text-sm font-mono font-bold tabular-nums",
            Number(compliancePct) >= 80 ? "text-emerald-400" : Number(compliancePct) >= 50 ? "text-amber-400" : "text-red-400"
          )}>
            {compliancePct}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-border/50 border-b border-border">
        {[
          { label: "Volume", desc: `≥ ${T3_POOL_KPI.MIN_COMBINED_DIALS} combined` },
          { label: "Pool %", desc: `${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}% of total` },
          { label: "Long Calls", desc: `≥ ${T3_POOL_KPI.MIN_LONG_CALLS} (15+ min)` },
          { label: "Talk Time", desc: `≥ ${T3_POOL_KPI.MIN_TALK_TIME} min total` },
          { label: "Assign %", desc: `≥ ${T3_POOL_KPI.MIN_ASSIGN_RATE}% of answered` },
          { label: "Past Due", desc: "0 — appointments first" },
          { label: "Queue", desc: `≤ ${T3_POOL_KPI.MAX_QUEUE} leads` },
        ].map((gate) => (
          <div key={gate.label} className="bg-card px-3 py-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">{gate.label}</span>
            <span className="text-[10px] font-mono text-blue-400">{gate.desc}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50">
              <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Agent</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Volume</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Pool %</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Long Calls</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Talk Time</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Assign %</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Past Due</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Queue</th>
              <th className="px-3 py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {scorecards.map((sc, i) => (
              <tr
                key={sc.name}
                className={cn(
                  "border-b border-border/30 transition-colors hover:bg-accent/30",
                  i % 2 === 0 ? "bg-transparent" : "bg-card/30",
                  sc.compliant ? "bg-emerald-500/[0.03]" : "bg-red-500/[0.03]"
                )}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Link href={`/agent-profile/${encodeURIComponent(sc.name)}`} className="font-semibold text-foreground hover:text-blue-400 transition-colors">{sc.name}</Link>
                  </div>
                </td>
                {sc.gates.map((gate) => (
                  <td key={gate.label} className="px-3 py-2.5 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <GateBadge status={gate.status} />
                      <span className={cn(
                        "text-xs font-mono tabular-nums",
                        gate.status === "pass" ? "text-emerald-400" : gate.status === "fail" ? "text-red-400" : "text-muted-foreground"
                      )}>
                        {gate.actual}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    {sc.compliant ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-0.5">
                        <ShieldCheck className="h-3 w-3" />
                        {sc.gatesPassed}/{T3_POOL_KPI.TOTAL_GATES}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-widest text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-0.5">
                        <ShieldX className="h-3 w-3" />
                        {sc.gatesPassed}/{T3_POOL_KPI.TOTAL_GATES}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {scorecards.length === 0 && (
        <div className="px-4 py-6 text-center">
          <p className="text-xs font-mono text-muted-foreground">No T3 agents with pool activity</p>
        </div>
      )}
    </div>
  );
}

function AssignmentRateBadge({ rate }: { rate: number }) {
  if (rate === 0) return <span className="text-muted-foreground">--</span>;
  const isGood = rate >= ASSIGN_RATE_TARGET;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 font-bold",
      isGood ? "text-emerald-400" : rate >= 45 ? "text-amber-400" : "text-red-400"
    )}>
      {rate.toFixed(0)}%
      {isGood ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
    </span>
  );
}

function ContactRateBadge({ rate }: { rate: number }) {
  return (
    <span className={cn(
      "font-bold",
      rate >= 60 ? "text-emerald-400" : rate >= 40 ? "text-amber-400" : "text-red-400"
    )}>
      {rate.toFixed(0)}%
    </span>
  );
}

function PoolInventoryPanel({ inventory }: { inventory: PoolInventorySnapshot[] }) {
  const totalLeads = inventory.reduce((s, inv) => s + inv.totalLeads, 0);

  if (inventory.length === 0) {
    return (
      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <Users className="h-3.5 w-3.5" />
          Pool Inventory
        </h3>
        <p className="text-sm font-mono text-muted-foreground">No inventory data available</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-md p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Users className="h-3.5 w-3.5" />
          Pool Inventory — Contactable Leads
        </h3>
        <span className="text-lg font-mono font-bold text-blue-400 tabular-nums">{totalLeads}</span>
      </div>
      <div className="space-y-2">
        {inventory.map((inv) => {
          const pct = totalLeads > 0 ? (inv.totalLeads / totalLeads) * 100 : 0;
          return (
            <div key={inv.status} className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted-foreground w-40 truncate">{inv.status}</span>
              <div className="flex-1 h-2 bg-background rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    inv.status.includes("New") ? "bg-blue-500" : "bg-amber-500/70"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm font-mono font-bold tabular-nums w-12 text-right">{inv.totalLeads}</span>
              <span className="text-[10px] font-mono text-muted-foreground w-10 text-right">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PresentationRateBadge({ longCalls, selfAssigned }: { longCalls: number; selfAssigned: number }) {
  if (selfAssigned === 0) return <span className="text-muted-foreground">--</span>;
  const rate = (longCalls / selfAssigned) * 100;
  return (
    <span className={cn(
      "font-bold",
      rate >= 20 ? "text-emerald-400" : rate >= 12 ? "text-amber-400" : "text-red-400"
    )}>
      {rate.toFixed(0)}%
    </span>
  );
}

function PoolAgentTable({ agents, assignTarget }: { agents: PoolAgent[]; assignTarget: number }) {
  const { sort, toggle } = useSort("callsMade");
  const sorted = useMemo(() => sortPoolAgents(agents, sort), [agents, sort]);

  const totals = useMemo(() => ({
    callsMade: agents.reduce((s, a) => s + a.pool.callsMade, 0),
    talkTime: agents.reduce((s, a) => s + a.pool.talkTimeMin, 0),
    sales: agents.reduce((s, a) => s + a.pool.salesMade, 0),
    premium: agents.reduce((s, a) => s + a.pool.premium, 0),
    selfAssigned: agents.reduce((s, a) => s + a.pool.selfAssignedLeads, 0),
    answered: agents.reduce((s, a) => s + a.pool.answeredCalls, 0),
    longCalls: agents.reduce((s, a) => s + a.pool.longCalls, 0),
  }), [agents]);

  const totalContactRate = totals.callsMade > 0 ? (totals.answered / totals.callsMade) * 100 : 0;
  const totalAssignRate = totals.answered > 0 ? (totals.selfAssigned / totals.answered) * 100 : 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
            <SortHeader label="Agent" sortKey="name" current={sort} onToggle={toggle} align="left" />
            <SortHeader label="Dials" sortKey="callsMade" current={sort} onToggle={toggle} />
            <SortHeader label="Talk Time" sortKey="talkTime" current={sort} onToggle={toggle} />
            <SortHeader label="Answered" sortKey="answered" current={sort} onToggle={toggle} />
            <SortHeader label="Contact %" sortKey="contactRate" current={sort} onToggle={toggle} />
            <SortHeader label="Long Calls" sortKey="longCalls" current={sort} onToggle={toggle} />
            <SortHeader label="Self Assigned" sortKey="selfAssigned" current={sort} onToggle={toggle} />
            <SortHeader label="Assign %" sortKey="assignRate" current={sort} onToggle={toggle} />
            <SortHeader label="Pres %" sortKey="presRate" current={sort} onToggle={toggle} />
            <SortHeader label="Sales" sortKey="sales" current={sort} onToggle={toggle} />
            <SortHeader label="Premium" sortKey="premium" current={sort} onToggle={toggle} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent, i) => {
            const effectiveTarget = agent.tier === "T3" ? T3_POOL_KPI.MIN_ASSIGN_RATE : assignTarget;
            const belowTarget = agent.pool.assignRate < effectiveTarget && agent.pool.answeredCalls > 0;
            return (
              <tr
                key={agent.name}
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/30",
                  i % 2 === 0 ? "bg-transparent" : "bg-card/30",
                  belowTarget && "bg-red-500/5"
                )}
              >
                <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-3 py-2.5 font-semibold text-foreground">
                  <div className="flex items-center gap-2">
                    <Link href={`/agent-profile/${encodeURIComponent(agent.name)}`} className="hover:text-blue-400 transition-colors">
                      {agent.name}
                    </Link>
                    <span className={cn(
                      "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                      agent.tier === "T3" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                    )}>
                      {agent.tier}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">
                  {agent.pool.callsMade}
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.pool.talkTimeMin} min</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.pool.answeredCalls}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  <ContactRateBadge rate={agent.pool.contactRate} />
                </td>
                <td className={cn(
                  "px-3 py-2.5 font-mono text-right tabular-nums",
                  agent.tier === "T3" && agent.pool.longCalls < T3_POOL_KPI.MIN_LONG_CALLS ? "text-red-400" : undefined
                )}>
                  {agent.pool.longCalls}
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  {agent.pool.selfAssignedLeads}
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  <AssignmentRateBadge rate={agent.pool.assignRate} />
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  <PresentationRateBadge longCalls={agent.pool.longCalls} selfAssigned={agent.pool.selfAssignedLeads} />
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.pool.salesMade}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  {agent.pool.premium > 0 ? `$${agent.pool.premium.toLocaleString()}` : <span className="text-muted-foreground">$0</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-card/60 font-bold text-foreground">
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground">Total</td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums">{totals.callsMade}</td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums">{totals.talkTime} min</td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums">{totals.answered}</td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums">
              <ContactRateBadge rate={totalContactRate} />
            </td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums">{totals.longCalls}</td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums text-blue-400">{totals.selfAssigned}</td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums">
              <AssignmentRateBadge rate={totals.answered > 0 ? totalAssignRate : 0} />
            </td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums">
              <PresentationRateBadge longCalls={totals.longCalls} selfAssigned={totals.selfAssigned} />
            </td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums text-emerald-400">{totals.sales}</td>
            <td className="px-3 py-2.5 font-mono text-right tabular-nums text-blue-400">
              ${totals.premium.toLocaleString()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PaceBar({ metric, label }: { metric: PaceMetric; label: string }) {
  const pct = Math.min(metric.pct, 120);
  const color = metric.behind ? "bg-red-500" : pct >= 100 ? "bg-emerald-500" : "bg-blue-500";
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[9px] font-mono">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("tabular-nums font-bold", metric.behind ? "text-red-400" : "text-foreground")}>
          {metric.actual}/{metric.expected}
        </span>
      </div>
      <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function PaceTracker() {
  const [paceDate, setPaceDate] = useState<string | undefined>(undefined);
  const { behindAgents, summary, loading, lastRefresh, refresh, agents } = useIntradayPace(paceDate);
  const isHistorical = !!paceDate;

  if (!isHistorical && !summary.isBusinessHours && behindAgents.length === 0) return null;
  if (summary.totalAgents === 0 && !loading) return null;

  const hourLabel = (h: number) => {
    const suffix = h >= 12 ? "PM" : "AM";
    const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${display}${suffix}`;
  };

  return (
    <div className="bg-card border border-border rounded-md overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            T3 Intraday Pace
          </h3>
          {isHistorical
            ? <span className="text-[10px] font-mono text-amber-400">Replay: {paceDate}</span>
            : <span className="text-[10px] font-mono text-muted-foreground/60">{hourLabel(summary.currentHour)} CST</span>}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-emerald-400">{summary.onPace} on pace</span>
            <span className="text-muted-foreground">·</span>
            {summary.behind > 0 && <span className="text-amber-400">{summary.behind} behind</span>}
            {summary.critical > 0 && <><span className="text-muted-foreground">·</span><span className="text-red-400">{summary.critical} critical</span></>}
            {summary.behind === 0 && summary.critical === 0 && <span className="text-emerald-400">all clear</span>}
          </div>
          <Input type="date" value={paceDate ?? ""} onChange={e => setPaceDate(e.target.value || undefined)}
            className="h-6 w-auto text-[10px] font-mono border bg-card px-1.5" title="Replay a past day" />
          {isHistorical && (
            <button onClick={() => setPaceDate(undefined)} className="text-[10px] font-mono text-blue-400 hover:text-blue-300">Live</button>
          )}
          <button onClick={refresh} className="text-muted-foreground/40 hover:text-foreground transition-colors" title="Refresh pace data">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {(isHistorical ? agents : behindAgents).length > 0 && (
        <div className="p-4 space-y-3">
          {(isHistorical ? agents : behindAgents).map(agent => (
            <div key={agent.name} className={cn(
              "border rounded-md p-3",
              agent.status === "critical" ? "border-red-500/30 bg-red-500/5"
                : agent.status === "behind" ? "border-amber-500/30 bg-amber-500/5"
                : "border-emerald-500/20 bg-emerald-500/5"
            )}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Link href={`/agent-profile/${encodeURIComponent(agent.name)}`} className="text-sm font-mono font-medium text-foreground hover:text-blue-400 transition-colors">
                    {agent.name}
                  </Link>
                  <span className="text-[9px] font-mono text-muted-foreground">{agent.site}</span>
                  {agent.status === "critical" ? (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-red-500/10 text-red-400 border border-red-500/30">CRITICAL</span>
                  ) : agent.status === "behind" ? (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">BEHIND</span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">ON PACE</span>
                  )}
                </div>
                <span className="text-[9px] font-mono text-muted-foreground/60">
                  as of {hourLabel(agent.hour)}{agent.behindMetrics.length > 0 ? ` · behind on ${agent.behindMetrics.join(", ")}` : ""}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <PaceBar metric={agent.metrics.combinedDials} label="Combined Dials" />
                <PaceBar metric={agent.metrics.talkTime} label="Talk Time (min)" />
                <PaceBar metric={agent.metrics.longCalls} label="Long Calls" />
                <PaceBar metric={agent.metrics.poolDials} label="Pool Dials" />
              </div>
            </div>
          ))}
        </div>
      )}

      {agents.length === 0 && !loading && (
        <div className="px-4 py-3 text-center">
          <p className="text-[11px] font-mono text-muted-foreground">{isHistorical ? `No intraday data for ${paceDate}` : "No intraday data for today"}</p>
        </div>
      )}
      {!isHistorical && behindAgents.length === 0 && agents.length > 0 && !loading && (
        <div className="px-4 py-3 text-center">
          <p className="text-[11px] font-mono text-emerald-400">All T3 agents on pace — no alerts</p>
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-border/50 text-[9px] font-mono text-muted-foreground/40 text-right">
        Last refresh: {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · auto-refreshes every 5 min
      </div>
    </div>
  );
}

function VelocityMetrics({ agents, inventory }: { agents: PoolAgent[]; inventory: PoolInventorySnapshot[] }) {
  const totalPoolLeads = inventory.reduce((s, inv) => s + inv.totalLeads, 0);
  const totalCallsMade = agents.reduce((s, a) => s + a.pool.callsMade, 0);
  const totalLongCalls = agents.reduce((s, a) => s + a.pool.longCalls, 0);
  const totalSelfAssigned = agents.reduce((s, a) => s + a.pool.selfAssignedLeads, 0);
  const totalAnswered = agents.reduce((s, a) => s + a.pool.answeredCalls, 0);
  const totalPoolSales = agents.reduce((s, a) => s + a.pool.salesMade, 0);
  const totalPoolPremium = agents.reduce((s, a) => s + a.pool.premium, 0);

  const poolVelocity = totalPoolLeads > 0 ? ((totalCallsMade / totalPoolLeads) * 100).toFixed(0) : "--";
  const avgCallsPerAgent = agents.length > 0 ? (totalCallsMade / agents.length).toFixed(0) : "--";
  const assignRate = totalAnswered > 0 ? ((totalSelfAssigned / totalAnswered) * 100).toFixed(1) : "--";
  const contactRate = totalCallsMade > 0 ? ((totalAnswered / totalCallsMade) * 100).toFixed(0) : "--";
  const poolCR = totalSelfAssigned > 0 ? ((totalPoolSales / totalSelfAssigned) * 100).toFixed(1) : "--";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <MetricCard
        label="Active Agents"
        value={agents.length}
        subtext="Working the pool"
        tooltip="Count of agents who made at least 1 call in the leads pool today."
      />
      <MetricCard
        label="Total Calls"
        value={totalCallsMade}
        color="blue"
        subtext={`${avgCallsPerAgent} avg/agent`}
        tooltip="Total dials made into the shared leads pool across all agents. Avg/agent = total calls ÷ active agents."
      />
      <MetricCard
        label="Contact Rate"
        value={`${contactRate}%`}
        color={Number(contactRate) >= 50 ? "green" : Number(contactRate) >= 30 ? "amber" : "red"}
        subtext={`${totalAnswered} answered`}
        tooltip="Answered calls ÷ total calls × 100. Measures what % of pool dials actually reached a person. Green ≥ 50%, amber ≥ 30%, red < 30%."
      />
      <MetricCard
        label="Assign Rate"
        value={`${assignRate}%`}
        color={Number(assignRate) >= ASSIGN_RATE_TARGET ? "green" : Number(assignRate) >= 45 ? "amber" : "red"}
        subtext={`${totalSelfAssigned} assigned / ${totalAnswered} answered`}
        tooltip={`Self-assigned leads ÷ answered calls × 100. Agents should self-assign ALL answered contacts (including DNC/not interested) to remove them from rotation. Target: ≥ ${ASSIGN_RATE_TARGET}%.`}
      />
      <MetricCard
        label="Pool Close Rate"
        value={`${poolCR}%`}
        color={Number(poolCR) >= 8 ? "green" : Number(poolCR) >= 4 ? "amber" : "red"}
        subtext={`${totalPoolSales} sales / ${totalSelfAssigned} assigned · $${totalPoolPremium.toLocaleString()}`}
        tooltip="Pool sales ÷ self-assigned leads × 100. Conversion rate on leads agents took ownership of from the pool. Green ≥ 8%, amber ≥ 4%, red < 4%."
      />
      <MetricCard
        label="Pool Velocity"
        value={`${poolVelocity}%`}
        color="blue"
        subtext={totalPoolLeads > 0 ? `${totalPoolLeads} contactable leads` : "No inventory data"}
        tooltip="Total calls made ÷ contactable leads in pool × 100. Measures how aggressively the team is working through the available pool inventory. Higher = faster burn-through of available leads."
      />
    </div>
  );
}

export default function LeadsPool() {
  const data = useData();
  const { dailyT1, dailyT2, dailyT3, poolInventory, pipelineAgents, selectedDate, loading, isRangeMode, dateRange, availableDates } = data;

  const allAgents = useMemo(() => [...dailyT1, ...dailyT2, ...dailyT3], [dailyT1, dailyT2, dailyT3]);
  const poolAgents = useMemo(() => getPoolAgents(allAgents), [allAgents]);
  const hasPoolData = poolAgents.length > 0;

  const latestDate = availableDates.length > 0 ? availableDates[0] : null;
  const oldestDate = availableDates.length > 0 ? availableDates[availableDates.length - 1] : null;
  const isOnLatest = selectedDate === latestDate;

  const navToDate = (direction: -1 | 1) => {
    if (availableDates.length === 0) return;
    const currentIdx = availableDates.indexOf(selectedDate);
    if (currentIdx === -1) {
      data.setSelectedDate(availableDates[0]);
      return;
    }
    const nextIdx = currentIdx - direction;
    if (nextIdx >= 0 && nextIdx < availableDates.length) {
      data.setSelectedDate(availableDates[nextIdx]);
    }
  };

  const dateLabel = isRangeMode
    ? `${dateRange.start} to ${dateRange.end}`
    : selectedDate;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Leads Pool</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            {isRangeMode
              ? `Aggregated pool activity — ${dateRange.start} to ${dateRange.end}`
              : "Shared lead pool activity, assignment tracking, and inventory"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => data.setIsRangeMode(!isRangeMode)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono font-bold uppercase tracking-widest transition-colors border",
              isRangeMode
                ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            )}
          >
            {isRangeMode ? <CalendarRange className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
            {isRangeMode ? "Range" : "Single Day"}
          </button>

          <div className="h-5 w-px bg-border" />

          {isRangeMode ? (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={dateRange.start}
                onChange={(e) => data.setDateRange({ ...dateRange, start: e.target.value })}
                className="font-mono bg-background w-36 text-center text-xs h-8"
              />
              <span className="text-xs font-mono text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateRange.end}
                onChange={(e) => data.setDateRange({ ...dateRange, end: e.target.value })}
                className="font-mono bg-background w-36 text-center text-xs h-8"
              />
              {data.activeWindow && (
                <button
                  onClick={() => data.setDateRange({ start: data.windowStart, end: latestDate ?? data.windowEnd })}
                  className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-accent transition-colors"
                >
                  WINDOW
                </button>
              )}
              {oldestDate && latestDate && (
                <button
                  onClick={() => data.setDateRange({ start: oldestDate, end: latestDate })}
                  className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-accent transition-colors"
                >
                  ALL DATA
                </button>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={() => navToDate(-1)}
                disabled={selectedDate === availableDates[availableDates.length - 1]}
                className="p-1.5 rounded hover:bg-accent disabled:opacity-20 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => data.setSelectedDate(e.target.value)}
                  className="font-mono bg-transparent border-0 w-36 text-center text-xs h-6 p-0"
                />
              </div>
              <button
                onClick={() => navToDate(1)}
                disabled={isOnLatest}
                className="p-1.5 rounded hover:bg-accent disabled:opacity-20 transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              {!isOnLatest && latestDate && (
                <button
                  onClick={() => data.setSelectedDate(latestDate)}
                  className="ml-1 text-[10px] font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                >
                  <Zap className="h-3 w-3" /> Latest
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="border border-dashed border-border rounded-md p-12 flex items-center justify-center bg-card/30">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading pool data...</p>
        </div>
      ) : hasPoolData ? (
        <>
          <VelocityMetrics agents={poolAgents} inventory={poolInventory} />

          <PaceTracker />

          <PoolScorecard agents={poolAgents} pipelineAgents={pipelineAgents} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PoolInventoryPanel inventory={poolInventory} />
            </div>
            <div className="space-y-3">
              <div className="bg-card border border-border rounded-md p-4">
                <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                  <Target className="h-3.5 w-3.5" />
                  T3 Pool KPI Targets
                </h3>
                <div className="space-y-2.5">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60 block">Pool + Pipeline</span>
                  {[
                    { label: "Combined Dials", value: `≥ ${T3_POOL_KPI.MIN_COMBINED_DIALS}`, unit: "/day" },
                    { label: "Pool Ratio", value: `${T3_POOL_KPI.MIN_POOL_PCT}-${T3_POOL_KPI.MAX_POOL_PCT}%`, unit: " of total" },
                    { label: "Long Calls", value: `≥ ${T3_POOL_KPI.MIN_LONG_CALLS}`, unit: " (15+ min)" },
                    { label: "Talk Time", value: `≥ ${T3_POOL_KPI.MIN_TALK_TIME}`, unit: " min total" },
                    { label: "Assign Rate", value: `≥ ${T3_POOL_KPI.MIN_ASSIGN_RATE}%`, unit: " of answered" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="flex items-baseline justify-between">
                      <span className="text-xs font-mono text-muted-foreground">{kpi.label}</span>
                      <span className="text-sm font-mono font-bold text-blue-400 tabular-nums">
                        {kpi.value}<span className="text-[10px] font-normal text-muted-foreground">{kpi.unit}</span>
                      </span>
                    </div>
                  ))}
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60 block pt-2">Pipeline Discipline</span>
                  {[
                    { label: "Past Due", value: "0", unit: " — appointments first" },
                    { label: "Queue Size", value: `≤ ${T3_POOL_KPI.MAX_QUEUE}`, unit: " leads" },
                    { label: "Queue Cadence", value: "6 attempts", unit: " then withdraw" },
                  ].map((kpi) => (
                    <div key={kpi.label} className="flex items-baseline justify-between">
                      <span className="text-xs font-mono text-muted-foreground">{kpi.label}</span>
                      <span className="text-sm font-mono font-bold text-amber-400 tabular-nums">
                        {kpi.value}<span className="text-[10px] font-normal text-muted-foreground">{kpi.unit}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-border/50">
                  <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                    Pass <span className="text-foreground font-bold">{T3_POOL_KPI.GATES_TO_PASS}/{T3_POOL_KPI.TOTAL_GATES}</span> gates to be compliant.
                    Follow-ups are appointments (task-date driven). Queue leads get 6 attempts max via the dialer, then withdraw.
                  </p>
                </div>
              </div>

              {poolAgents.length > 0 && (
                <div className="bg-card border border-border rounded-md p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5" />
                    Top Dialers
                  </h3>
                  <div className="space-y-2">
                    {[...poolAgents]
                      .sort((a, b) => b.pool.callsMade - a.pool.callsMade)
                      .slice(0, 5)
                      .map((a, i) => (
                        <div key={a.name} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground w-4">{i + 1}.</span>
                          <span className="text-sm font-medium flex-1 truncate">{a.name}</span>
                          <span className="text-sm font-mono font-bold tabular-nums">{a.pool.callsMade}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {poolAgents.some((a) => a.pool.answeredCalls > 0 && a.pool.assignRate < T3_POOL_KPI.MIN_ASSIGN_RATE && a.tier === "T3") && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-md p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-red-400 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Below Assign Target (T3)
                  </h3>
                  <div className="space-y-2">
                    {poolAgents
                      .filter((a) => a.tier === "T3" && a.pool.answeredCalls > 0 && a.pool.assignRate < T3_POOL_KPI.MIN_ASSIGN_RATE)
                      .sort((a, b) => a.pool.assignRate - b.pool.assignRate)
                      .map((a) => (
                        <div key={a.name} className="flex items-center gap-2">
                          <span className="text-sm font-medium flex-1 truncate">{a.name}</span>
                          <span className="text-xs font-mono text-muted-foreground">{a.pool.selfAssignedLeads}/{a.pool.answeredCalls} ans</span>
                          <span className={cn(
                            "text-sm font-mono font-bold tabular-nums",
                            a.pool.assignRate < 20 ? "text-red-400" : "text-amber-400"
                          )}>
                            {a.pool.assignRate.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-md p-1">
            <div className="px-3 py-3 border-b border-border">
              <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                Agent Pool Activity
              </h3>
            </div>
            <PoolAgentTable agents={poolAgents} assignTarget={T3_POOL_KPI.MIN_ASSIGN_RATE} />
          </div>

        </>
      ) : (
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-3 bg-card/30">
          <Users className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-mono text-muted-foreground text-center">
            No leads pool activity for <strong className="text-foreground">{dateLabel}</strong>.
          </p>
          <p className="text-xs font-mono text-muted-foreground text-center max-w-md">
            Pool data is captured from the CRM Leads Pool Report. Activity will appear here once agents begin working the shared lead pool.
          </p>
        </div>
      )}
    </div>
  );
}
