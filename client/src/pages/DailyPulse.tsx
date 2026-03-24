// ============================================================
// Daily Pulse Report — Command Center
// T3: Sort by Talk Time DESC | T2: Sort by Total Premium DESC | T1: Sort by Total Premium DESC
// ============================================================

import { useState, useMemo, useCallback } from "react";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { AgentDrillDown } from "@/components/AgentDrillDown";
import { SiteSummary } from "@/components/SiteSummary";
import { getPaceColor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Download, Calendar, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { exportDailyPulse } from "@/lib/exportExcel";
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
      case "talkTime": return a.talkTimeMin ?? 0;
      case "sales": return a.salesToday;
      case "premium": return a.premiumToday;
      case "totalPremium": return a.totalPremium;
      case "bonus": return a.bonusSales ?? 0;
      case "mtdSales": return a.mtdSales ?? 0;
      case "mtdPace": return a.mtdPace ?? 0;
      case "mtdROLI": return a.mtdROLI ?? 0;
      case "leads": return (a.obLeads ?? 0) + (a.ibCalls ?? 0);
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

function T3Table({ onAgentClick }: { onAgentClick?: (agent: DailyPulseAgent) => void }) {
  const { dailyT3, workingDaysCompleted } = useData();
  const { sort, toggle } = useSort("talkTime");
  const sorted = useMemo(() => sortAgents(dailyT3, sort), [dailyT3, sort]);

  const totalPremium = dailyT3.reduce((s, a) => s + a.premiumToday, 0);
  const totalSales = dailyT3.reduce((s, a) => s + a.salesToday, 0);
  const totalLeads = dailyT3.reduce((s, a) => s + (a.obLeads ?? 0), 0);
  const avgTalkTime = dailyT3.length
    ? dailyT3.reduce((s, a) => s + (a.talkTimeMin ?? 0), 0) / dailyT3.length
    : 0;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Sales" value={totalSales} color="green" />
        <MetricCard label="CR" value={formatCR(totalSales, totalLeads)} color="yellow" />
        <MetricCard label="Avg Talk Time" value={`${avgTalkTime.toFixed(0)} min`} />
        <MetricCard label="Day" value={`${workingDaysCompleted} of Window`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <SortHeader label="Agent" sortKey="name" current={sort} onToggle={toggle} align="left" />
              <SortHeader label="Site" sortKey="site" current={sort} onToggle={toggle} align="left" />
              <SortHeader label="Leads" sortKey="obLeads" current={sort} onToggle={toggle} />
              <SortHeader label="Dials" sortKey="dials" current={sort} onToggle={toggle} />
              <SortHeader label="Talk Time" sortKey="talkTime" current={sort} onToggle={toggle} />
              <SortHeader label="Sales" sortKey="sales" current={sort} onToggle={toggle} />
              <SortHeader label="CR" sortKey="cr" current={sort} onToggle={toggle} />
              <SortHeader label="Premium" sortKey="premium" current={sort} onToggle={toggle} />
              <SortHeader label="MTD Sales" sortKey="mtdSales" current={sort} onToggle={toggle} />
              <SortHeader label="MTD Pace" sortKey="mtdPace" current={sort} onToggle={toggle} />
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
                  <button onClick={() => onAgentClick?.(agent)} className="hover:text-blue-400 hover:underline transition-colors text-left">{agent.name}</button>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{agent.site}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obLeads ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.dials ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.talkTimeMin ?? 0} min</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.salesToday}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={agent.salesToday} leads={agent.obLeads ?? 0} /></td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.premiumToday)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.mtdSales ?? 0}</td>
                <td className="px-3 py-2.5 text-right">
                  <PaceIndicator pace={agent.mtdPace ?? 0} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function T2Table({ onAgentClick }: { onAgentClick?: (agent: DailyPulseAgent) => void }) {
  const { dailyT2 } = useData();
  const { sort, toggle } = useSort("totalPremium");
  const sorted = useMemo(() => sortAgents(dailyT2, sort), [dailyT2, sort]);

  const totalPremium = dailyT2.reduce((s, a) => s + a.totalPremium, 0);
  const totalSales = dailyT2.reduce((s, a) => s + a.salesToday, 0);
  const totalIB = dailyT2.reduce((s, a) => s + (a.ibCalls ?? 0), 0);
  const totalIBSales = dailyT2.reduce((s, a) => s + (a.ibSales ?? 0), 0);
  const totalOB = dailyT2.reduce((s, a) => s + (a.obLeads ?? 0), 0);
  const totalOBSales = dailyT2.reduce((s, a) => s + (a.obSales ?? 0), 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Sales" value={totalSales} color="green" />
        <MetricCard label="IB CR" value={formatCR(totalIBSales, totalIB)} color="yellow" />
        <MetricCard label="OB CR" value={formatCR(totalOBSales, totalOB)} color="yellow" />
        <MetricCard label="Agents" value={dailyT2.length} />
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
              <SortHeader label="Premium" sortKey="totalPremium" current={sort} onToggle={toggle} />
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
                  <button onClick={() => onAgentClick?.(agent)} className="hover:text-blue-400 hover:underline transition-colors text-left">{agent.name}</button>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{agent.site}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.ibCalls ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.ibSales ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={agent.ibSales ?? 0} leads={agent.ibCalls ?? 0} /></td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obLeads ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obSales ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={agent.obSales ?? 0} leads={agent.obLeads ?? 0} /></td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{formatCurrency(agent.totalPremium)}</td>
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
        </table>
      </div>
    </div>
  );
}

function T1Table({ onAgentClick }: { onAgentClick?: (agent: DailyPulseAgent) => void }) {
  const { dailyT1 } = useData();
  const { sort, toggle } = useSort("totalPremium");
  const sorted = useMemo(() => sortAgents(dailyT1, sort), [dailyT1, sort]);

  const totalPremium = dailyT1.reduce((s, a) => s + a.totalPremium, 0);
  const totalSales = dailyT1.reduce((s, a) => s + a.salesToday, 0);
  const totalIB = dailyT1.reduce((s, a) => s + (a.ibCalls ?? 0), 0);
  const totalIBSales = dailyT1.reduce((s, a) => s + (a.ibSales ?? 0), 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Sales" value={totalSales} color="green" />
        <MetricCard label="IB CR" value={formatCR(totalIBSales, totalIB)} color="yellow" />
        <MetricCard label="Agents" value={dailyT1.length} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <SortHeader label="Agent" sortKey="name" current={sort} onToggle={toggle} align="left" />
              <SortHeader label="Site" sortKey="site" current={sort} onToggle={toggle} align="left" />
              <SortHeader label="IB Calls" sortKey="ibCalls" current={sort} onToggle={toggle} />
              <SortHeader label="Sales" sortKey="sales" current={sort} onToggle={toggle} />
              <SortHeader label="CR" sortKey="ibCR" current={sort} onToggle={toggle} />
              <SortHeader label="Premium" sortKey="premium" current={sort} onToggle={toggle} />
              <SortHeader label="Bonus" sortKey="bonus" current={sort} onToggle={toggle} />
              <SortHeader label="Total" sortKey="totalPremium" current={sort} onToggle={toggle} />
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
                  <button onClick={() => onAgentClick?.(agent)} className="hover:text-blue-400 hover:underline transition-colors text-left">{agent.name}</button>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{agent.site}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.ibCalls ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.salesToday}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums"><CRBadge sales={agent.ibSales ?? 0} leads={agent.ibCalls ?? 0} /></td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.premiumToday)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.bonusSales ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{formatCurrency(agent.totalPremium)}</td>
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
        </table>
      </div>
    </div>
  );
}

function ExportDialog({
  open,
  onOpenChange,
  onExport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onExport: (tiers: Tier[]) => void;
}) {
  const [tiers, setTiers] = useState<Tier[]>(["T1", "T2", "T3"]);

  const toggleTier = (tier: Tier) => {
    setTiers((prev) => prev.includes(tier) ? prev.filter((t) => t !== tier) : [...prev, tier]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest">
            Export Daily Pulse
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-xs font-mono text-muted-foreground">
            Select tiers to include in the export. Each tier gets its own sheet with red-to-green gradient formatting.
          </p>
          <div className="flex gap-2">
            {(["T1", "T2", "T3"] as Tier[]).map((tier) => (
              <Button
                key={tier}
                variant={tiers.includes(tier) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleTier(tier)}
                className={cn(
                  "font-mono text-xs",
                  tiers.includes(tier) && "bg-blue-600 hover:bg-blue-700"
                )}
              >
                {tier}
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="font-mono text-sm">
            CANCEL
          </Button>
          <Button
            onClick={() => { onExport(tiers); onOpenChange(false); }}
            disabled={tiers.length === 0}
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
  const hasData = data.dailyT1.length > 0 || data.dailyT2.length > 0 || data.dailyT3.length > 0;

  const handleAgentClick = (agent: DailyPulseAgent) => setDrillAgent(agent);

  const handleDateNav = (direction: -1 | 1) => {
    const [y, m, dd] = data.selectedDate.split("-").map(Number);
    const d = new Date(y, m - 1, dd);
    d.setDate(d.getDate() + direction);
    if (d.getDay() === 0) d.setDate(d.getDate() + direction);
    if (d.getDay() === 6) d.setDate(d.getDate() + direction);
    data.setSelectedDate(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  };

  const isWithinWindow = data.selectedDate >= data.windowStart && data.selectedDate <= data.windowEnd;

  const handleExport = async (tiers: Tier[]) => {
    try {
      await exportDailyPulse(data.dailyT1, data.dailyT2, data.dailyT3, data.selectedDate, tiers);
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
            End-of-day effort tracking and momentum indicators
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

      {/* Window-aligned date navigation */}
      <div className="flex items-center gap-3 bg-card border border-border rounded-md p-3">
        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
        <button
          onClick={() => handleDateNav(-1)}
          className="p-1 rounded hover:bg-accent text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <Input
          type="date"
          value={data.selectedDate}
          onChange={(e) => data.setSelectedDate(e.target.value)}
          className="font-mono bg-background w-40 text-center"
        />
        <button
          onClick={() => handleDateNav(1)}
          className="p-1 rounded hover:bg-accent text-muted-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="flex-1" />
        <div className="text-[10px] font-mono text-muted-foreground text-right">
          <div className={cn(isWithinWindow ? "text-emerald-400" : "text-amber-400")}>
            {isWithinWindow ? "WITHIN WINDOW" : "OUTSIDE WINDOW"}
          </div>
          <div>{data.windowStart} → {data.windowEnd}</div>
        </div>
      </div>

      {hasData && (
        <SiteSummary agents={[...data.dailyT1, ...data.dailyT2, ...data.dailyT3]} />
      )}

      {data.loading ? (
        <div className="border border-dashed border-border rounded-md p-12 flex items-center justify-center bg-card/30">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading data...</p>
        </div>
      ) : hasData ? (
        <Tabs defaultValue="t3" className="w-full">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="t3" className="font-mono text-xs data-[state=active]:bg-accent">
              TIER 3 — OUTBOUND ({data.dailyT3.length})
            </TabsTrigger>
            <TabsTrigger value="t2" className="font-mono text-xs data-[state=active]:bg-accent">
              TIER 2 — HYBRID ({data.dailyT2.length})
            </TabsTrigger>
            <TabsTrigger value="t1" className="font-mono text-xs data-[state=active]:bg-accent">
              TIER 1 — INBOUND ({data.dailyT1.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="t3" className="mt-4">
            <T3Table onAgentClick={handleAgentClick} />
          </TabsContent>
          <TabsContent value="t2" className="mt-4">
            <T2Table onAgentClick={handleAgentClick} />
          </TabsContent>
          <TabsContent value="t1" className="mt-4">
            <T1Table onAgentClick={handleAgentClick} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-3 bg-card/30">
          <div className="text-4xl font-mono text-muted-foreground/20">---</div>
          <p className="text-sm font-mono text-muted-foreground text-center">
            No data for <strong className="text-foreground">{data.selectedDate}</strong>.
            Use the arrows to navigate to a date with scraped data.
          </p>
        </div>
      )}

      <ExportDialog
        open={showExport}
        onOpenChange={setShowExport}
        onExport={handleExport}
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
