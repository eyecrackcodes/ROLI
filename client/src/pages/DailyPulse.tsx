// ============================================================
// Daily Pulse Report — Command Center
// T3: Sort by Talk Time DESC | T2: Sort by Total Premium DESC | T1: Sort by Total Premium DESC
// ============================================================

import { useState } from "react";
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
import { Download, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { exportDailyPulse } from "@/lib/exportExcel";
import type { Tier, DailyPulseAgent } from "@/lib/types";

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
  const sorted = [...dailyT3].sort((a, b) => (b.talkTimeMin ?? 0) - (a.talkTimeMin ?? 0));

  const totalPremium = sorted.reduce((s, a) => s + a.premiumToday, 0);
  const totalSales = sorted.reduce((s, a) => s + a.salesToday, 0);
  const avgTalkTime = sorted.length
    ? sorted.reduce((s, a) => s + (a.talkTimeMin ?? 0), 0) / sorted.length
    : 0;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Sales" value={totalSales} color="green" />
        <MetricCard label="Avg Talk Time" value={`${avgTalkTime.toFixed(0)} min`} />
        <MetricCard label="Day" value={`${workingDaysCompleted} of Window`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Site</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Leads</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Dials</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Talk Time</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Sales</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">MTD Sales</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">MTD Pace</th>
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
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obLeads ?? 25}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.dials ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.talkTimeMin ?? 0} min</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.salesToday}</td>
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
  const sorted = [...dailyT2].sort((a, b) => b.totalPremium - a.totalPremium);

  const totalPremium = sorted.reduce((s, a) => s + a.totalPremium, 0);
  const totalSales = sorted.reduce((s, a) => s + a.salesToday, 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Sales" value={totalSales} color="green" />
        <MetricCard label="Agents" value={sorted.length} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Site</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">IB Calls</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">IB Sales</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">OB Leads</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">OB Sales</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">MTD ROLI</th>
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
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obLeads ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obSales ?? 0}</td>
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
  const sorted = [...dailyT1].sort((a, b) => b.totalPremium - a.totalPremium);

  const totalPremium = sorted.reduce((s, a) => s + a.totalPremium, 0);
  const totalSales = sorted.reduce((s, a) => s + a.salesToday, 0);

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Sales" value={totalSales} color="green" />
        <MetricCard label="Agents" value={sorted.length} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Site</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">IB Calls</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Sales</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Bonus</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Total</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">MTD ROLI</th>
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
    const d = new Date(data.selectedDate);
    d.setDate(d.getDate() + direction);
    // Skip weekends
    if (d.getDay() === 0) d.setDate(d.getDate() + direction);
    if (d.getDay() === 6) d.setDate(d.getDate() + direction);
    data.setSelectedDate(d.toISOString().slice(0, 10));
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
