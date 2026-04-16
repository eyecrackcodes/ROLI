// ============================================================
// Daily Pulse Report — Command Center
// T3: Sort by Talk Time DESC | T2: Sort by Total Premium DESC | T1: Sort by Total Premium DESC
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { AgentDrillDown } from "@/components/AgentDrillDown";

import { getPaceColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Download, Calendar, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, ToggleLeft, ToggleRight, CalendarRange, Zap, Eye } from "lucide-react";
import { toast } from "sonner";
import { exportDailyPulse, fetchAndExportPulse, SORT_LABELS, type SortKey, type ExportOptions } from "@/lib/exportExcel";
import type { Tier, DailyPulseAgent } from "@/lib/types";

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

function sortAgents(agents: DailyPulseAgent[], sort: SortState): DailyPulseAgent[] {
  const getValue = (a: DailyPulseAgent): number => {
    switch (sort.key) {
      case "name": return 0;
      case "site": return 0;
      case "ibCalls": return a.ibCalls ?? 0;
      case "ibSales": return a.ibSales ?? 0;
      case "ibCR": return (a.ibCalls ?? 0) > 0 ? ((a.ibSales ?? 0) / (a.ibCalls ?? 1)) * 100 : 0;
      case "obLeads": return a.obLeads ?? 0;
      case "obSales": return a.obSales ?? 0;
      case "obCR": return (a.obLeads ?? 0) > 0 ? ((a.obSales ?? 0) / (a.obLeads ?? 1)) * 100 : 0;
      case "dials": return a.dials ?? 0;
      case "poolPct": return (a.dials ?? 0) > 0 && a.pool ? Math.min((a.pool.callsMade / (a.dials ?? 1)) * 100, 100) : 0;
      case "talkTime": return a.talkTimeMin ?? 0;
      case "sales": return a.salesToday;
      case "premium": return a.premiumToday;
      case "totalPremium": return a.totalPremium;
      case "bonus": return a.bonusSales ?? 0;
      case "mtdSales": return a.mtdSales ?? 0;
      case "mtdPace": return a.mtdPace ?? 0;
      case "mtdROLI": return a.mtdROLI ?? 0;
      case "leads": return (a.obLeads ?? 0) + (a.ibCalls ?? 0);
      case "contacts": return a.funnel?.contactsMade ?? 0;
      case "conversations": return a.funnel?.conversations ?? 0;
      case "presentations": return a.funnel?.presentations ?? 0;
      case "cr": {
        const leads = (a.ibCalls ?? 0) + (a.obLeads ?? 0);
        return leads > 0 ? (a.salesToday / leads) * 100 : 0;
      }
      default: return 0;
    }
  };

  const getStr = (a: DailyPulseAgent): string => {
    if (sort.key === "name") return a.name;
    if (sort.key === "site") return a.site;
    return "";
  };

  return [...agents].sort((a, b) => {
    if (sort.key === "name" || sort.key === "site") {
      const cmp = getStr(a).localeCompare(getStr(b));
      return sort.dir === "asc" ? cmp : -cmp;
    }
    const va = getValue(a), vb = getValue(b);
    return sort.dir === "asc" ? va - vb : vb - va;
  });
}

function formatCR(sales: number, leads: number): string {
  if (leads === 0) return "--";
  return ((sales / leads) * 100).toFixed(1) + "%";
}

function CRBadge({ sales, leads }: { sales: number; leads: number }) {
  if (leads === 0) return <span className="text-muted-foreground">--</span>;
  const cr = (sales / leads) * 100;
  return (
    <span className={cn(
      "font-bold",
      cr >= 10 ? "text-emerald-400" : cr >= 5 ? "text-amber-400" : "text-red-400"
    )}>
      {cr.toFixed(1)}%
    </span>
  );
}

function formatCurrency(val: number) {
  return "$" + val.toLocaleString();
}

function PaceIndicator({ pace }: { pace: number }) {
  const color = getPaceColor(pace);
  const bg =
    color === "green"
      ? "bg-emerald-400"
      : color === "yellow"
      ? "bg-amber-400"
      : "bg-red-400";
  const text =
    color === "green"
      ? "text-emerald-400"
      : color === "yellow"
      ? "text-amber-400"
      : "text-red-400";

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-sm tabular-nums", text)}>
      <span className={cn("h-2 w-2 rounded-full", bg)} />
      {pace.toFixed(2)}
    </span>
  );
}

function PoolBadge({ pool }: { pool?: DailyPulseAgent["pool"] }) {
  if (!pool || pool.callsMade === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 ml-1.5 shrink-0"
      title={`Pool: ${pool.callsMade} calls, ${pool.selfAssignedLeads} assigned, ${pool.longCalls} long calls`}
    >
      <Users className="h-2.5 w-2.5" />
      {pool.callsMade}
    </span>
  );
}

function PoolOriginTag({ agent }: { agent: DailyPulseAgent }) {
  const hasSale = agent.salesToday > 0;
  const hasPoolActivity = agent.pool && agent.pool.callsMade > 0;
  const poolMissingCredit = agent.pool ? agent.pool.salesMade === 0 : true;
  if (!hasSale || !hasPoolActivity || !poolMissingCredit) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 ml-1 shrink-0 cursor-help"
      title="Sale not credited in pool report — likely a follow-up close from a self-assigned pool lead. Reconciliation will attribute it to the original assignment date."
    >
      POOL
    </span>
  );
}

function UnifiedTable({ agents, onAgentClick }: {
  agents: DailyPulseAgent[];
  onAgentClick?: (agent: DailyPulseAgent) => void;
}) {
  const { sort, toggle } = useSort("totalPremium");

  const sorted = useMemo(() => sortAgents(agents, sort), [agents, sort]);
  const hasFunnel = agents.some(a => a.funnel && a.funnel.dials > 0);
  const hasPool = agents.some(a => a.pool && a.pool.callsMade > 0);

  const totalPremium = agents.reduce((s, a) => s + a.totalPremium, 0);
  const totalSales = agents.reduce((s, a) => s + a.salesToday, 0);
  const totalIB = agents.reduce((s, a) => s + (a.ibCalls ?? 0), 0);
  const totalIBSales = agents.reduce((s, a) => s + (a.ibSales ?? 0), 0);
  const totalOB = agents.reduce((s, a) => s + (a.obLeads ?? 0), 0);
  const totalOBSales = agents.reduce((s, a) => s + (a.obSales ?? 0), 0);
  const totalPoolSales = agents.reduce((s, a) => s + (a.pool?.salesMade ?? 0), 0);
  const totalPoolAssigned = agents.reduce((s, a) => s + (a.pool?.selfAssignedLeads ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary metrics */}
      <div className={cn("grid grid-cols-2 gap-3", hasPool ? "sm:grid-cols-6" : "sm:grid-cols-5")}>
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Sales" value={totalSales} color="green" />
        <MetricCard label="IB CR" value={formatCR(totalIBSales, totalIB)} color="yellow" />
        <MetricCard label="OB CR" value={formatCR(totalOBSales, totalOB)} color="yellow" />
        {hasPool && (
          <MetricCard
            label="Pool CR"
            value={totalPoolAssigned > 0 ? `${((totalPoolSales / totalPoolAssigned) * 100).toFixed(1)}%` : "--"}
            color={totalPoolAssigned > 0 && (totalPoolSales / totalPoolAssigned) >= 0.10 ? "green" : totalPoolSales > 0 ? "amber" : "default"}
            subtext={`${totalPoolSales} sales / ${totalPoolAssigned} assigned`}
          />
        )}
        <MetricCard label="Agents" value={agents.length} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <SortHeader label="Agent" sortKey="name" current={sort} onToggle={toggle} align="left" />
              <SortHeader label="Site" sortKey="site" current={sort} onToggle={toggle} align="left" />
              <SortHeader label="IB Calls" sortKey="ibCalls" current={sort} onToggle={toggle} />
              <SortHeader label="IB Sales" sortKey="ibSales" current={sort} onToggle={toggle} />
              <SortHeader label="IB CR" sortKey="ibCR" current={sort} onToggle={toggle} />
              <SortHeader label="OB Leads" sortKey="obLeads" current={sort} onToggle={toggle} />
              <SortHeader label="OB Sales" sortKey="obSales" current={sort} onToggle={toggle} />
              <SortHeader label="OB CR" sortKey="obCR" current={sort} onToggle={toggle} />
              {hasPool && <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-cyan-400/70 text-right">Pool Sales</th>}
              {hasPool && <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-cyan-400/70 text-right">Pool CR</th>}
              {hasFunnel && <SortHeader label="Contacts" sortKey="contacts" current={sort} onToggle={toggle} />}
              {hasFunnel && <SortHeader label="Convos" sortKey="conversations" current={sort} onToggle={toggle} />}
              {hasFunnel && <SortHeader label="Pres" sortKey="presentations" current={sort} onToggle={toggle} />}
              <SortHeader label="Premium" sortKey="totalPremium" current={sort} onToggle={toggle} />
              <SortHeader label="Bonus" sortKey="bonus" current={sort} onToggle={toggle} />
              <SortHeader label="MTD ROLI" sortKey="mtdROLI" current={sort} onToggle={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent, i) => (
              <tr
                key={agent.name}
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/30",
                  i % 2 === 0 ? "bg-transparent" : "bg-card/30"
                )}
              >
                <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-3 py-2.5 font-semibold text-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Link href={`/agent-profile/${encodeURIComponent(agent.name)}`} className="hover:text-blue-400 hover:underline transition-colors text-left">{agent.name}</Link>
                    <button onClick={(e) => { e.stopPropagation(); onAgentClick?.(agent); }} className="text-muted-foreground/40 hover:text-blue-400 transition-colors print:hidden" title="Quick view"><Eye className="h-3 w-3" /></button>
                    <PoolBadge pool={agent.pool} />
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{agent.site}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.ibCalls ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.ibSales ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={agent.ibSales ?? 0} leads={agent.ibCalls ?? 0} /></td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obLeads ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  <span className="inline-flex items-center justify-end">{agent.obSales ?? 0}<PoolOriginTag agent={agent} /></span>
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={agent.obSales ?? 0} leads={agent.obLeads ?? 0} /></td>
                {hasPool && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-cyan-400">{agent.pool?.salesMade ? agent.pool.salesMade : <span className="text-muted-foreground/40">--</span>}</td>}
                {hasPool && <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={agent.pool?.salesMade ?? 0} leads={agent.pool?.selfAssignedLeads ?? 0} /></td>}
                {hasFunnel && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-orange-400">{agent.funnel?.contactsMade ?? <span className="text-muted-foreground/40">--</span>}</td>}
                {hasFunnel && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-orange-400">{agent.funnel?.conversations ?? <span className="text-muted-foreground/40">--</span>}</td>}
                {hasFunnel && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-orange-400">{agent.funnel?.presentations ?? <span className="text-muted-foreground/40">--</span>}</td>}
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{formatCurrency(agent.totalPremium)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  {(agent.bonusSales ?? 0) > 0 ? (
                    <span className="text-purple-400">
                      {agent.bonusSales} <span className="text-[10px] text-purple-400/70">/ {formatCurrency(agent.bonusPremium ?? 0)}</span>
                    </span>
                  ) : <span className="text-muted-foreground">--</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                  <span className={cn(
                    (agent.mtdROLI ?? 0) >= 1.5 ? "text-emerald-400" :
                    (agent.mtdROLI ?? 0) >= 0.75 ? "text-amber-400" : "text-red-400"
                  )}>
                    {(agent.mtdROLI ?? 0).toFixed(2)}x
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-card/60 font-bold text-foreground">
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-xs uppercase tracking-widest text-muted-foreground">Total ({agents.length})</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 font-mono text-right tabular-nums">{totalIB}</td>
              <td className="px-3 py-2.5 font-mono text-right tabular-nums text-emerald-400">{totalIBSales}</td>
              <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={totalIBSales} leads={totalIB} /></td>
              <td className="px-3 py-2.5 font-mono text-right tabular-nums">{totalOB}</td>
              <td className="px-3 py-2.5 font-mono text-right tabular-nums text-emerald-400">{totalOBSales}</td>
              <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={totalOBSales} leads={totalOB} /></td>
              {hasPool && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-cyan-400">{totalPoolSales || "--"}</td>}
              {hasPool && <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={totalPoolSales} leads={totalPoolAssigned} /></td>}
              {hasFunnel && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-orange-400">{agents.reduce((s, a) => s + (a.funnel?.contactsMade ?? 0), 0)}</td>}
              {hasFunnel && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-orange-400">{agents.reduce((s, a) => s + (a.funnel?.conversations ?? 0), 0)}</td>}
              {hasFunnel && <td className="px-3 py-2.5 font-mono text-right tabular-nums text-orange-400">{agents.reduce((s, a) => s + (a.funnel?.presentations ?? 0), 0)}</td>}
              <td className="px-3 py-2.5 font-mono text-right tabular-nums text-blue-400">{formatCurrency(totalPremium)}</td>
              {(() => {
                const totalBonusSales = agents.reduce((s, a) => s + (a.bonusSales ?? 0), 0);
                const totalBonusPrem = agents.reduce((s, a) => s + (a.bonusPremium ?? 0), 0);
                return <td className="px-3 py-2.5 font-mono text-right tabular-nums text-purple-400">{totalBonusSales > 0 ? `${totalBonusSales} / ${formatCurrency(totalBonusPrem)}` : "--"}</td>;
              })()}
              <td className="px-3 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function ExportDialog({
  open,
  onOpenChange,
  onExport,
  availableDates,
  currentDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onExport: (opts: ExportOptions) => void;
  availableDates: string[];
  currentDate: string;
}) {
  const [tiers, setTiers] = useState<Tier[]>(["T1", "T2", "T3"]);
  const [sortBy, setSortBy] = useState<SortKey>("totalPremium");
  const [startDate, setStartDate] = useState(currentDate);
  const [endDate, setEndDate] = useState(currentDate);
  const [dailyBreakdown, setDailyBreakdown] = useState(false);
  const isRange = startDate !== endDate;

  const toggleTier = (tier: Tier) => {
    setTiers((prev) => prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest">
            Export Daily Pulse
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block mb-1.5">Date Range</span>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="font-mono text-xs bg-background flex-1"
                max={availableDates[0]}
                min={availableDates[availableDates.length - 1]}
              />
              <span className="text-xs font-mono text-muted-foreground">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="font-mono text-xs bg-background flex-1"
                max={availableDates[0]}
                min={startDate}
              />
            </div>
            {isRange && (
              <span className="text-[10px] font-mono text-blue-400 mt-1 block">
                Range mode: data will be aggregated across {Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1} days
              </span>
            )}
          </div>

          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block mb-1.5">Tiers</span>
            <div className="flex gap-2">
              {(["T1", "T2", "T3"] as Tier[]).map((tier) => (
                <Button
                  key={tier}
                  variant={tiers.includes(tier) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleTier(tier)}
                  className={cn(
                    "font-mono text-xs",
                    tiers.includes(tier) && (
                      tier === "T1" ? "bg-blue-600 hover:bg-blue-700" :
                      tier === "T2" ? "bg-emerald-600 hover:bg-emerald-700" :
                      "bg-amber-600 hover:bg-amber-700"
                    )
                  )}
                >
                  {tier} — {tier === "T1" ? "Inbound" : tier === "T2" ? "Hybrid" : "Outbound"}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block mb-1.5">Sort By</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="w-full font-mono text-xs bg-background border border-border rounded-md px-3 py-2 text-foreground"
            >
              {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label} (DESC)</option>
              ))}
            </select>
          </div>

          {isRange && (
            <div className="flex items-center gap-3 py-1">
              <Switch checked={dailyBreakdown} onCheckedChange={setDailyBreakdown} className="scale-75" />
              <div>
                <span className="text-xs font-mono text-foreground">Daily Breakdown</span>
                <span className="text-[10px] font-mono text-muted-foreground block">One sheet per day instead of aggregated totals</span>
              </div>
            </div>
          )}

          <div className="bg-card/50 border border-border rounded-md p-2.5 text-[10px] font-mono text-muted-foreground space-y-0.5">
            <p>Each tier exports to its own sheet with conversion metrics (Close Rate, IB CR%, OB CR%).</p>
            <p>Pool activity columns auto-included when pool data exists.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono text-sm">
            CANCEL
          </Button>
          <Button
            onClick={() => { onExport({ tiers, sortBy, startDate, endDate, dailyBreakdown: isRange && dailyBreakdown }); onOpenChange(false); }}
            disabled={tiers.length === 0 || !startDate || !endDate}
            className="font-mono text-sm bg-emerald-600 hover:bg-emerald-700 gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            EXPORT XLSX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DailyPulse() {
  const data = useData();
  const [showExport, setShowExport] = useState(false);
  const [drillAgent, setDrillAgent] = useState<DailyPulseAgent | null>(null);
  const allAgents = useMemo(() => [...data.dailyT1, ...data.dailyT2, ...data.dailyT3], [data.dailyT1, data.dailyT2, data.dailyT3]);

  const hasData = data.dailyT1.length > 0 || data.dailyT2.length > 0 || data.dailyT3.length > 0;

  const handleAgentClick = (agent: DailyPulseAgent) => setDrillAgent(agent);

  const latestDate = data.availableDates.length > 0 ? data.availableDates[0] : null;
  const oldestDate = data.availableDates.length > 0 ? data.availableDates[data.availableDates.length - 1] : null;
  const windowName = data.activeWindow ? (data.activeWindow as { name?: string }).name ?? "Current" : "Current";

  const navToDate = (direction: -1 | 1) => {
    if (data.availableDates.length === 0) return;
    const currentIdx = data.availableDates.indexOf(data.selectedDate);
    if (currentIdx === -1) {
      data.setSelectedDate(data.availableDates[0]);
      return;
    }
    const nextIdx = currentIdx - direction;
    if (nextIdx >= 0 && nextIdx < data.availableDates.length) {
      data.setSelectedDate(data.availableDates[nextIdx]);
    }
  };

  const jumpToLatest = () => {
    if (latestDate) data.setSelectedDate(latestDate);
  };

  const jumpToToday = () => {
    const central = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    data.setSelectedDate(central);
  };

  const isOnLatest = data.selectedDate === latestDate;
  const isWithinWindow = data.selectedDate >= data.windowStart && data.selectedDate <= data.windowEnd;

  const handleExport = async (opts: ExportOptions) => {
    try {
      const isSingleDay = opts.startDate === opts.endDate;
      const matchesCurrentView = isSingleDay && opts.startDate === data.selectedDate;

      if (matchesCurrentView) {
        await exportDailyPulse(data.dailyT1, data.dailyT2, data.dailyT3, opts);
      } else {
        await fetchAndExportPulse(opts);
      }
      toast.success("Export complete");
    } catch {
      toast.error("Export failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Daily Pulse Report</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            {data.isRangeMode
              ? `Aggregated view — ${data.dateRange.start} to ${data.dateRange.end}`
              : "End-of-day effort tracking and momentum indicators"
            }
          </p>
        </div>
        <Button
          onClick={() => setShowExport(true)}
          variant="outline"
          className="font-mono text-xs gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          EXPORT
        </Button>
      </div>

      {/* Smart date navigation */}
      <div className="bg-card border border-border rounded-md p-3 space-y-3">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <button
            onClick={() => data.setIsRangeMode(!data.isRangeMode)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-mono font-bold uppercase tracking-widest transition-colors border",
              data.isRangeMode
                ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            )}
          >
            {data.isRangeMode ? <CalendarRange className="h-3.5 w-3.5" /> : <Calendar className="h-3.5 w-3.5" />}
            {data.isRangeMode ? "Range" : "Single Day"}
          </button>

          <div className="h-5 w-px bg-border" />

          {data.isRangeMode ? (
            /* Range mode controls */
            <div className="flex items-center gap-2 flex-1">
              <Input
                type="date"
                value={data.dateRange.start}
                onChange={(e) => data.setDateRange({ ...data.dateRange, start: e.target.value })}
                className="font-mono bg-background w-36 text-center text-xs h-8"
              />
              <span className="text-xs font-mono text-muted-foreground">to</span>
              <Input
                type="date"
                value={data.dateRange.end}
                onChange={(e) => data.setDateRange({ ...data.dateRange, end: e.target.value })}
                className="font-mono bg-background w-36 text-center text-xs h-8"
              />
              {data.activeWindow && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => data.setDateRange({ start: data.windowStart, end: latestDate ?? data.windowEnd })}
                  className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-foreground"
                >
                  FULL WINDOW
                </Button>
              )}
              {oldestDate && latestDate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => data.setDateRange({ start: oldestDate, end: latestDate })}
                  className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-foreground"
                >
                  ALL DATA
                </Button>
              )}
            </div>
          ) : (
            /* Single day controls */
            <div className="flex items-center gap-1 flex-1">
              <button
                onClick={() => navToDate(-1)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                title="Previous date with data"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <Input
                type="date"
                value={data.selectedDate}
                onChange={(e) => data.setSelectedDate(e.target.value)}
                className="font-mono bg-background w-40 text-center text-xs h-8"
              />
              <button
                onClick={() => navToDate(1)}
                className="p-1 rounded hover:bg-accent text-muted-foreground"
                title="Next date with data"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <div className="h-5 w-px bg-border mx-1" />

              <Button
                variant="ghost"
                size="sm"
                onClick={jumpToToday}
                className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-foreground"
              >
                TODAY
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={jumpToLatest}
                disabled={isOnLatest}
                className={cn(
                  "font-mono text-[10px] h-7 px-2 gap-1",
                  isOnLatest ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Zap className="h-3 w-3" />
                LATEST
              </Button>
            </div>
          )}

          <div className="flex-1" />

          {/* Window + data info */}
          <div className="text-[10px] font-mono text-muted-foreground text-right shrink-0">
            <div className={cn(isWithinWindow ? "text-emerald-400" : "text-amber-400")}>
              {windowName} Window
            </div>
            <div>
              Data: {oldestDate ?? "none"} — {latestDate ?? "none"}
              {data.availableDates.length > 0 && ` (${data.availableDates.length} days)`}
            </div>
          </div>
        </div>

        {/* Smart fallback banner */}
        {!data.isRangeMode && !hasData && !data.loading && latestDate && data.selectedDate !== latestDate && (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20">
            <span className="text-xs font-mono text-amber-400">
              No data for {data.selectedDate}.
            </span>
            <button
              onClick={jumpToLatest}
              className="text-xs font-mono font-bold text-amber-300 hover:text-amber-200 underline"
            >
              Jump to latest ({latestDate})
            </button>
          </div>
        )}
      </div>

      {data.loading ? (
        <div className="border border-dashed border-border rounded-md p-12 flex items-center justify-center bg-card/30">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading data...</p>
        </div>
      ) : hasData ? (
        <UnifiedTable agents={allAgents} onAgentClick={handleAgentClick} />
      ) : (
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-3 bg-card/30">
          <div className="text-4xl font-mono text-muted-foreground/20">---</div>
          <p className="text-sm font-mono text-muted-foreground text-center">
            No data for <strong className="text-foreground">{data.isRangeMode ? `${data.dateRange.start} to ${data.dateRange.end}` : data.selectedDate}</strong>.
          </p>
          {latestDate && (
            <button
              onClick={jumpToLatest}
              className="text-sm font-mono text-blue-400 hover:text-blue-300 underline"
            >
              Jump to latest data ({latestDate})
            </button>
          )}
        </div>
      )}

      <ExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        onExport={handleExport}
        availableDates={data.availableDates}
        currentDate={data.selectedDate}
      />

      <AgentDrillDown
        agentName={drillAgent?.name ?? null}
        tier={drillAgent?.tier}
        site={drillAgent?.site}
        open={!!drillAgent}
        onOpenChange={(open) => !open && setDrillAgent(null)}
      />
    </div>
  );
}
