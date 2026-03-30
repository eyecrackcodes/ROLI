import { useState, useMemo, useCallback } from "react";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, CheckCircle2, Users, Phone, Clock, Target, Calendar, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import type { DailyPulseAgent, PoolMetrics, PoolInventorySnapshot } from "@/lib/types";

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
            <SortHeader label="Calls Made" sortKey="callsMade" current={sort} onToggle={toggle} />
            <SortHeader label="Talk Time" sortKey="talkTime" current={sort} onToggle={toggle} />
            <SortHeader label="Answered" sortKey="answered" current={sort} onToggle={toggle} />
            <SortHeader label="Contact Rate" sortKey="contactRate" current={sort} onToggle={toggle} />
            <SortHeader label="Long Calls" sortKey="longCalls" current={sort} onToggle={toggle} />
            <SortHeader label="Self Assigned" sortKey="selfAssigned" current={sort} onToggle={toggle} />
            <SortHeader label="Assign Rate" sortKey="assignRate" current={sort} onToggle={toggle} />
            <SortHeader label="Sales" sortKey="sales" current={sort} onToggle={toggle} />
            <SortHeader label="Premium" sortKey="premium" current={sort} onToggle={toggle} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent, i) => {
            const belowTarget = agent.pool.assignRate < assignTarget && agent.pool.answeredCalls > 0;
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
                    {agent.name}
                    <span className={cn(
                      "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                      agent.tier === "T3" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                    )}>
                      {agent.tier}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.pool.callsMade}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.pool.talkTimeMin} min</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.pool.answeredCalls}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  <ContactRateBadge rate={agent.pool.contactRate} />
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.pool.longCalls}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.pool.selfAssignedLeads}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  <AssignmentRateBadge rate={agent.pool.assignRate} />
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
      />
      <MetricCard
        label="Total Calls"
        value={totalCallsMade}
        color="blue"
        subtext={`${avgCallsPerAgent} avg/agent`}
      />
      <MetricCard
        label="Contact Rate"
        value={`${contactRate}%`}
        color={Number(contactRate) >= 50 ? "green" : Number(contactRate) >= 30 ? "amber" : "red"}
        subtext={`${totalAnswered} answered`}
      />
      <MetricCard
        label="Assign Rate"
        value={`${assignRate}%`}
        color={Number(assignRate) >= ASSIGN_RATE_TARGET ? "green" : Number(assignRate) >= 45 ? "amber" : "red"}
        subtext={`${totalSelfAssigned} assigned / ${totalAnswered} answered`}
      />
      <MetricCard
        label="Pool Close Rate"
        value={`${poolCR}%`}
        color={Number(poolCR) >= 8 ? "green" : Number(poolCR) >= 4 ? "amber" : "red"}
        subtext={`${totalPoolSales} sales / ${totalSelfAssigned} assigned · $${totalPoolPremium.toLocaleString()}`}
      />
      <MetricCard
        label="Pool Velocity"
        value={`${poolVelocity}%`}
        color="blue"
        subtext={totalPoolLeads > 0 ? `${totalPoolLeads} contactable leads` : "No inventory data"}
      />
    </div>
  );
}

export default function LeadsPool() {
  const data = useData();
  const { dailyT1, dailyT2, dailyT3, poolInventory, selectedDate, loading, isRangeMode, dateRange, availableDates } = data;

  const allAgents = useMemo(() => [...dailyT1, ...dailyT2, ...dailyT3], [dailyT1, dailyT2, dailyT3]);
  const poolAgents = useMemo(() => getPoolAgents(allAgents), [allAgents]);
  const hasPoolData = poolAgents.length > 0;

  const latestDate = availableDates.length > 0 ? availableDates[0] : null;
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
            Shared lead pool activity, assignment tracking, and inventory
          </p>
        </div>
        <div className="flex items-center gap-1.5">
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
        </div>
      </div>

      {loading ? (
        <div className="border border-dashed border-border rounded-md p-12 flex items-center justify-center bg-card/30">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading pool data...</p>
        </div>
      ) : hasPoolData ? (
        <>
          <VelocityMetrics agents={poolAgents} inventory={poolInventory} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PoolInventoryPanel inventory={poolInventory} />
            </div>
            <div className="space-y-3">
              <div className="bg-card border border-border rounded-md p-4">
                <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                  <Target className="h-3.5 w-3.5" />
                  Assignment Target
                </h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-mono font-bold text-emerald-400">{ASSIGN_RATE_TARGET}%</span>
                  <span className="text-xs font-mono text-muted-foreground">of answered calls should result in self-assignment</span>
                </div>
                <p className="text-[11px] font-mono text-muted-foreground mt-3 leading-relaxed">
                  Every pool lead is unassigned. When an agent answers and reaches
                  someone, they should self-assign regardless of outcome — including
                  not interested or DNC — to remove the lead from pool rotation.
                  Low assign rates mean leads keep getting recycled unnecessarily.
                </p>
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

              {poolAgents.some((a) => a.pool.answeredCalls > 0 && a.pool.assignRate < ASSIGN_RATE_TARGET) && (
                <div className="bg-red-500/5 border border-red-500/20 rounded-md p-4">
                  <h3 className="text-xs font-mono uppercase tracking-widest text-red-400 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Below Assignment Target
                  </h3>
                  <div className="space-y-2">
                    {poolAgents
                      .filter((a) => a.pool.answeredCalls > 0 && a.pool.assignRate < ASSIGN_RATE_TARGET)
                      .sort((a, b) => a.pool.assignRate - b.pool.assignRate)
                      .map((a) => (
                        <div key={a.name} className="flex items-center gap-2">
                          <span className="text-sm font-medium flex-1 truncate">{a.name}</span>
                          <span className="text-xs font-mono text-muted-foreground">{a.pool.selfAssignedLeads}/{a.pool.answeredCalls} answered</span>
                          <span className={cn(
                            "text-sm font-mono font-bold tabular-nums",
                            a.pool.assignRate < 45 ? "text-red-400" : "text-amber-400"
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
            <PoolAgentTable agents={poolAgents} assignTarget={ASSIGN_RATE_TARGET} />
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
