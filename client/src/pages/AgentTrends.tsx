import { useState, useEffect } from "react";
import { useAgentTrends } from "@/hooks/useAgentTrends";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { TrendLineChart, TrendBarChart, DeltaBadge, Sparkline } from "@/components/TrendChart";
import { MetricCard } from "@/components/MetricCard";
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function formatCurrency(val: number) {
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function IntradayTab({ agentName }: { agentName: string }) {
  const { intraday, loading } = useAgentTrends(agentName);

  if (loading) return <p className="text-sm font-mono text-muted-foreground animate-pulse p-8 text-center">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Latest Sales" value={intraday.length > 0 ? intraday[intraday.length - 1].sales : 0} color="green" />
        <MetricCard label="Latest Premium" value={intraday.length > 0 ? formatCurrency(intraday[intraday.length - 1].premium) : "$0"} color="blue" />
        <MetricCard label="Snapshots Today" value={intraday.length} subtext="of 6 max" />
        <MetricCard label="Latest Dials" value={intraday.length > 0 ? intraday[intraday.length - 1].dials : 0} />
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Intraday Progression — Sales & Premium
        </h3>
        <p className="text-[10px] font-mono text-muted-foreground mb-3">Bars = new activity per snapshot | Lines = cumulative running total</p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={intraday} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
            <XAxis dataKey="hourLabel" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#e2e8f0" }}
              labelStyle={{ color: "#e2e8f0" }}
              itemStyle={{ color: "#e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#94a3b8" }} />
            <Bar dataKey="deltaSales" name="New Sales" fill="#34d399" yAxisId="left" radius={[4, 4, 0, 0]} opacity={0.7} />
            <Bar dataKey="deltaPremium" name="New Premium" fill="#60a5fa" yAxisId="right" radius={[4, 4, 0, 0]} opacity={0.5} />
            <Line type="monotone" dataKey="sales" name="Cumul. Sales" stroke="#34d399" yAxisId="left" strokeWidth={2.5} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="premium" name="Cumul. Premium" stroke="#60a5fa" yAxisId="right" strokeWidth={2.5} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Intraday Effort — Dials & Talk Time
        </h3>
        <p className="text-[10px] font-mono text-muted-foreground mb-3">Bars = new activity per snapshot | Lines = cumulative total</p>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={intraday} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
            <XAxis dataKey="hourLabel" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
            <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#e2e8f0" }}
              labelStyle={{ color: "#e2e8f0" }}
              itemStyle={{ color: "#e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#94a3b8" }} />
            <Bar dataKey="deltaDials" name="New Dials" fill="#a78bfa" yAxisId="left" radius={[4, 4, 0, 0]} opacity={0.7} />
            <Line type="monotone" dataKey="dials" name="Cumul. Dials" stroke="#a78bfa" yAxisId="left" strokeWidth={2.5} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="talkTime" name="Cumul. Talk Time" stroke="#fbbf24" yAxisId="left" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DayOverDayTab({ agentName }: { agentName: string }) {
  const { daily, deltas, loading } = useAgentTrends(agentName);

  if (loading) return <p className="text-sm font-mono text-muted-foreground animate-pulse p-8 text-center">Loading...</p>;

  const latestDay = daily.length > 0 ? daily[daily.length - 1] : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Today's Sales"
          value={latestDay?.sales ?? 0}
          color="green"
          subtext={<DeltaBadge value={deltas.salesVsYesterday} />}
        />
        <MetricCard
          label="Today's Premium"
          value={latestDay ? formatCurrency(latestDay.premium) : "$0"}
          color="blue"
          subtext={<DeltaBadge value={deltas.premiumVsYesterday} format="currency" />}
        />
        <MetricCard label="Close Rate" value={latestDay ? `${latestDay.closeRate.toFixed(1)}%` : "0%"} />
        <MetricCard label="Dials" value={latestDay?.dials ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Sales Trend
            </h3>
            <Sparkline data={daily.map((d) => d.sales)} color="#34d399" />
          </div>
          <TrendBarChart
            data={daily.slice(-10)}
            xKey="date"
            bars={[{ key: "sales", color: "#34d399", name: "Sales" }]}
            height={220}
          />
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Premium Trend
            </h3>
            <Sparkline data={daily.map((d) => d.premium)} color="#60a5fa" />
          </div>
          <TrendLineChart
            data={daily.slice(-10)}
            xKey="date"
            lines={[{ key: "premium", color: "#60a5fa", name: "Premium ($)" }]}
            height={220}
          />
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Close Rate %
            </h3>
            <Sparkline data={daily.map((d) => d.closeRate)} color="#fbbf24" />
          </div>
          <TrendLineChart
            data={daily.slice(-10)}
            xKey="date"
            lines={[{ key: "closeRate", color: "#fbbf24", name: "CR %" }]}
            height={220}
          />
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Effort (Dials)
            </h3>
            <Sparkline data={daily.map((d) => d.dials)} color="#a78bfa" />
          </div>
          <TrendBarChart
            data={daily.slice(-10)}
            xKey="date"
            bars={[{ key: "dials", color: "#a78bfa", name: "Dials" }]}
            height={220}
          />
        </div>
      </div>
    </div>
  );
}

function WeekOverWeekTab({ agentName }: { agentName: string }) {
  const { weekly, deltas, loading } = useAgentTrends(agentName);

  if (loading) return <p className="text-sm font-mono text-muted-foreground animate-pulse p-8 text-center">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard
          label="This Week Sales"
          value={weekly.length > 0 ? weekly[weekly.length - 1].sales : 0}
          color="green"
          subtext={<DeltaBadge value={deltas.salesVsLastWeek} />}
        />
        <MetricCard
          label="This Week Premium"
          value={weekly.length > 0 ? formatCurrency(weekly[weekly.length - 1].premium) : "$0"}
          color="blue"
          subtext={<DeltaBadge value={deltas.premiumVsLastWeek} format="currency" />}
        />
        <MetricCard label="Weeks Tracked" value={weekly.length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-md p-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Weekly Sales
          </h3>
          <TrendBarChart
            data={weekly}
            xKey="weekLabel"
            bars={[{ key: "sales", color: "#34d399", name: "Sales" }]}
            height={260}
          />
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Weekly Premium
          </h3>
          <TrendBarChart
            data={weekly}
            xKey="weekLabel"
            bars={[{ key: "premium", color: "#60a5fa", name: "Premium ($)" }]}
            height={260}
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Weekly Close Rate
        </h3>
        <TrendLineChart
          data={weekly}
          xKey="weekLabel"
          lines={[{ key: "avgCloseRate", color: "#fbbf24", name: "Avg CR %" }]}
          height={220}
        />
      </div>
    </div>
  );
}

function MonthOverMonthTab({ agentName }: { agentName: string }) {
  const { windows, loading } = useAgentTrends(agentName);

  if (loading) return <p className="text-sm font-mono text-muted-foreground animate-pulse p-8 text-center">Loading...</p>;

  if (windows.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-3 bg-card/30">
        <p className="text-sm font-mono text-muted-foreground text-center">
          No completed evaluation windows yet. Monthly data will appear after the first window snapshot is computed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-md p-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
            ROLI by Window
          </h3>
          <TrendBarChart
            data={windows}
            xKey="windowName"
            bars={[{ key: "roli", color: "#34d399", name: "ROLI" }]}
            height={260}
          />
        </div>
        <div className="bg-card border border-border rounded-md p-4">
          <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
            Profit by Window
          </h3>
          <TrendBarChart
            data={windows}
            xKey="windowName"
            bars={[{ key: "profit", color: "#60a5fa", name: "Profit ($)" }]}
            height={260}
          />
        </div>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Close Rate & Premium Trajectory
        </h3>
        <TrendLineChart
          data={windows}
          xKey="windowName"
          lines={[
            { key: "closeRate", color: "#fbbf24", name: "CR %", yAxisId: "left" },
            { key: "premium", color: "#60a5fa", name: "Premium ($)", yAxisId: "right" },
          ]}
          dualAxis
          height={280}
        />
      </div>
    </div>
  );
}

export default function AgentTrends() {
  const { agents } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const activeAgents = agents.filter((a) => a.is_active).sort((a, b) => a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name));

  useEffect(() => {
    if (!selectedAgent && activeAgents.length > 0) {
      setSelectedAgent(activeAgents[0].name);
    }
  }, [activeAgents, selectedAgent]);

  const currentAgent = agents.find((a) => a.name === selectedAgent);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Agent Trends</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Performance analytics — intraday, daily, weekly, and monthly
        </p>
      </div>

      {/* Agent Selector */}
      <div className="flex items-center gap-4 bg-card border border-border rounded-md p-3">
        <Select value={selectedAgent ?? ""} onValueChange={setSelectedAgent}>
          <SelectTrigger className="w-64 font-mono bg-background">
            <SelectValue placeholder="Select an agent..." />
          </SelectTrigger>
          <SelectContent>
            {activeAgents.map((a) => (
              <SelectItem key={a.name} value={a.name} className="font-mono">
                <span className={cn(
                  "inline-block w-6 text-[10px] font-bold mr-2",
                  a.tier === "T1" ? "text-blue-400" : a.tier === "T2" ? "text-emerald-400" : "text-amber-400"
                )}>
                  {a.tier}
                </span>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentAgent && (
          <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
            <span className={cn(
              "px-2 py-0.5 rounded-full font-bold border",
              currentAgent.tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
              currentAgent.tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
              "bg-amber-500/10 text-amber-400 border-amber-500/30"
            )}>
              {currentAgent.tier}
            </span>
            <span>{currentAgent.site}</span>
            <span>Vol: {currentAgent.daily_lead_volume}/day</span>
          </div>
        )}
      </div>

      {selectedAgent ? (
        <Tabs defaultValue="dod" className="w-full">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="intraday" className="font-mono text-xs data-[state=active]:bg-accent">
              INTRADAY
            </TabsTrigger>
            <TabsTrigger value="dod" className="font-mono text-xs data-[state=active]:bg-accent">
              DAY / DAY
            </TabsTrigger>
            <TabsTrigger value="wow" className="font-mono text-xs data-[state=active]:bg-accent">
              WEEK / WEEK
            </TabsTrigger>
            <TabsTrigger value="mom" className="font-mono text-xs data-[state=active]:bg-accent">
              MONTH / MONTH
            </TabsTrigger>
          </TabsList>
          <TabsContent value="intraday" className="mt-4">
            <IntradayTab agentName={selectedAgent} />
          </TabsContent>
          <TabsContent value="dod" className="mt-4">
            <DayOverDayTab agentName={selectedAgent} />
          </TabsContent>
          <TabsContent value="wow" className="mt-4">
            <WeekOverWeekTab agentName={selectedAgent} />
          </TabsContent>
          <TabsContent value="mom" className="mt-4">
            <MonthOverMonthTab agentName={selectedAgent} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-3 bg-card/30">
          <p className="text-sm font-mono text-muted-foreground">Select an agent to view trends</p>
        </div>
      )}
    </div>
  );
}
