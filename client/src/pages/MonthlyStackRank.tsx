// ============================================================
// Monthly Stack Rank Report — Command Center
// All tiers sorted by ROLI DESC with status badges
// ============================================================

import { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { AgentDrillDown } from "@/components/AgentDrillDown";
import { MonthlyAgent, AgentStatus, GATE_THRESHOLDS } from "@/lib/types";
import type { Tier } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { exportMonthlyStackRank } from "@/lib/exportExcel";

function formatCurrency(val: number) {
  return "$" + val.toLocaleString();
}

function assignT3Status(agents: MonthlyAgent[]): (MonthlyAgent & { status: AgentStatus })[] {
  const sorted = [...agents].sort((a, b) => b.roli - a.roli);
  return sorted.map((a, i) => ({
    ...a,
    status: i < 5 && a.closeRate >= GATE_THRESHOLDS.MIN_CR_FOR_PROMOTION
      ? "PROMOTE"
      : a.closeRate < GATE_THRESHOLDS.MIN_CR_FOR_PROMOTION
      ? "EXIT RISK"
      : "HOLD",
  }));
}

function assignT2Status(agents: MonthlyAgent[]): (MonthlyAgent & { status: AgentStatus })[] {
  const sorted = [...agents].sort((a, b) => b.roli - a.roli);
  const len = sorted.length;
  return sorted.map((a, i) => ({
    ...a,
    status: i === 0
      ? "ELIGIBLE T1"
      : i >= len - 5
      ? "DEMOTE"
      : "HOLD",
  }));
}

function assignT1Status(agents: MonthlyAgent[]): (MonthlyAgent & { status: AgentStatus })[] {
  const sorted = [...agents].sort((a, b) => b.roli - a.roli);
  const len = sorted.length;
  return sorted.map((a, i) => ({
    ...a,
    status: i >= len - 3 ? "AT RISK" : "HOLD",
  }));
}

function T3StackRank({ onAgentClick }: { onAgentClick?: (agent: MonthlyAgent) => void }) {
  const { monthlyT3, windowStart, windowEnd, workingDays } = useData();
  const agents = assignT3Status(monthlyT3);

  const totalPremium = agents.reduce((s, a) => s + a.totalPremium, 0);
  const totalProfit = agents.reduce((s, a) => s + a.profit, 0);
  const avgROLI = agents.length ? agents.reduce((s, a) => s + a.roli, 0) / agents.length : 0;
  const promoCount = agents.filter((a) => a.status === "PROMOTE").length;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <MetricCard label="Window" value={`${windowStart} → ${windowEnd}`} subtext={`${workingDays} working days`} />
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Profit" value={formatCurrency(totalProfit)} color="green" />
        <MetricCard label="Avg ROLI" value={`${avgROLI.toFixed(2)}x`} />
        <MetricCard label="Promotions" value={promoCount} color="green" subtext="of 5 max" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Leads</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Sales</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">CR%</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Lead Cost</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Profit</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">ROLI</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => (
              <tr
                key={agent.name}
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/30",
                  agent.status === "PROMOTE" && "bg-emerald-500/5",
                  agent.status === "EXIT RISK" && "bg-red-500/5"
                )}
              >
                <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums font-bold">{i + 1}</td>
                <td className="px-3 py-2.5 font-semibold text-foreground">
                  <button onClick={() => onAgentClick?.(agent)} className="hover:text-blue-400 hover:underline transition-colors text-left">{agent.name}</button>
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.leadsDelivered}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.sales}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.closeRate.toFixed(1)}%</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.leadCost)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.totalPremium)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.profit)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.roli.toFixed(2)}x</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={agent.status} pulse={agent.status === "PROMOTE"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function T2StackRank({ onAgentClick }: { onAgentClick?: (agent: MonthlyAgent) => void }) {
  const { monthlyT2, windowStart, windowEnd, workingDays } = useData();
  const agents = assignT2Status(monthlyT2);

  const totalPremium = agents.reduce((s, a) => s + a.totalPremium, 0);
  const totalProfit = agents.reduce((s, a) => s + a.profit, 0);
  const avgROLI = agents.length ? agents.reduce((s, a) => s + a.roli, 0) / agents.length : 0;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Window" value={`${windowStart} → ${windowEnd}`} subtext={`${workingDays} working days`} />
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Profit" value={formatCurrency(totalProfit)} color="green" />
        <MetricCard label="Avg ROLI" value={`${avgROLI.toFixed(2)}x`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">IB CR</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">OB CR</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Lead Cost</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Profit</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">ROLI</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => (
              <tr
                key={agent.name}
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/30",
                  agent.status === "ELIGIBLE T1" && "bg-emerald-500/5",
                  agent.status === "DEMOTE" && "bg-red-500/5"
                )}
              >
                <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums font-bold">{i + 1}</td>
                <td className="px-3 py-2.5 font-semibold text-foreground">
                  <button onClick={() => onAgentClick?.(agent)} className="hover:text-blue-400 hover:underline transition-colors text-left">{agent.name}</button>
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.ibCR ?? 0}%</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.obCR ?? 0}%</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.leadCost)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.totalPremium)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.profit)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.roli.toFixed(2)}x</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={agent.status} pulse={agent.status === "DEMOTE"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function T1StackRank({ onAgentClick }: { onAgentClick?: (agent: MonthlyAgent) => void }) {
  const { monthlyT1, windowStart, windowEnd, workingDays } = useData();
  const agents = assignT1Status(monthlyT1);

  const totalPremium = agents.reduce((s, a) => s + a.totalPremium, 0);
  const totalProfit = agents.reduce((s, a) => s + a.profit, 0);
  const avgROLI = agents.length ? agents.reduce((s, a) => s + a.roli, 0) / agents.length : 0;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <MetricCard label="Window" value={`${windowStart} → ${windowEnd}`} subtext={`${workingDays} working days`} />
        <MetricCard label="Total Premium" value={formatCurrency(totalPremium)} color="blue" />
        <MetricCard label="Total Profit" value={formatCurrency(totalProfit)} color="green" />
        <MetricCard label="Avg ROLI" value={`${avgROLI.toFixed(2)}x`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">IB Calls</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Sales</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">CR%</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Lead Cost</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Profit</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">ROLI</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, i) => (
              <tr
                key={agent.name}
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/30",
                  agent.status === "AT RISK" && "bg-amber-500/5"
                )}
              >
                <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums font-bold">{i + 1}</td>
                <td className="px-3 py-2.5 font-semibold text-foreground">
                  <button onClick={() => onAgentClick?.(agent)} className="hover:text-blue-400 hover:underline transition-colors text-left">{agent.name}</button>
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.ibCalls ?? 0}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.sales}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.closeRate.toFixed(1)}%</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.leadCost)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.totalPremium)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.profit)}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.roli.toFixed(2)}x</td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={agent.status} pulse={agent.status === "AT RISK"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MonthlyStackRank() {
  const { monthlyT1, monthlyT2, monthlyT3, windowStart, windowEnd } = useData();
  const [drillAgent, setDrillAgent] = useState<MonthlyAgent | null>(null);

  const handleAgentClick = (agent: MonthlyAgent) => setDrillAgent(agent);

  const handleExport = async () => {
    const windowName = `${windowStart} to ${windowEnd}`;
    try {
      await exportMonthlyStackRank(
        assignT1Status(monthlyT1),
        assignT2Status(monthlyT2),
        assignT3Status(monthlyT3),
        windowName
      );
    } catch {
      toast.error("Export failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Monthly Stack Rank</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            Evaluation window performance — sorted by ROLI (descending)
          </p>
        </div>
        <Button
          onClick={handleExport}
          variant="outline"
          className="font-mono text-xs gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          EXPORT
        </Button>
      </div>

      <Tabs defaultValue="t3" className="w-full">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="t3" className="font-mono text-xs data-[state=active]:bg-accent">
            TIER 3 — PROMOTION POOL
          </TabsTrigger>
          <TabsTrigger value="t2" className="font-mono text-xs data-[state=active]:bg-accent">
            TIER 2 — PROVING GROUND
          </TabsTrigger>
          <TabsTrigger value="t1" className="font-mono text-xs data-[state=active]:bg-accent">
            TIER 1 — ELITE POOL
          </TabsTrigger>
        </TabsList>
        <TabsContent value="t3" className="mt-4">
          <T3StackRank onAgentClick={handleAgentClick} />
        </TabsContent>
        <TabsContent value="t2" className="mt-4">
          <T2StackRank onAgentClick={handleAgentClick} />
        </TabsContent>
        <TabsContent value="t1" className="mt-4">
          <T1StackRank onAgentClick={handleAgentClick} />
        </TabsContent>
      </Tabs>

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
