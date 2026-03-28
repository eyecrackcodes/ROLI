import { useState, useEffect, useCallback } from "react";
import { useAgentTrends, type IntradayPoint } from "@/hooks/useAgentTrends";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { TrendLineChart, TrendBarChart, DeltaBadge, Sparkline } from "@/components/TrendChart";
import { MetricCard } from "@/components/MetricCard";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
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

const HOUR_LABELS: Record<number, string> = {
  6: "6AM", 7: "7AM", 8: "8AM", 9: "9AM", 10: "10AM", 11: "11AM",
  12: "12PM", 13: "1PM", 14: "2PM", 15: "3PM", 16: "4PM", 17: "5PM",
  18: "6PM", 19: "7PM", 20: "8PM",
};

function IntradayTab({ agentName }: { agentName: string }) {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [intraday, setIntraday] = useState<IntradayPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !agentName) return;
    (async () => {
      const { data } = await supabase
        .from("intraday_snapshots")
        .select("scrape_date")
        .eq("agent_name", agentName)
        .order("scrape_date", { ascending: false });
      const dates = [...new Set((data ?? []).map((r: { scrape_date: string }) => r.scrape_date))];
      setAvailableDates(dates);
      if (dates.length > 0 && !selectedDate) setSelectedDate(dates[0]);
    })();
  }, [agentName]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchIntraday = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName || !selectedDate) return;
    setLoading(true);
    const { data } = await supabase
      .from("intraday_snapshots")
      .select("scrape_hour, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes, pool_dials, pool_talk_minutes")
      .eq("agent_name", agentName)
      .eq("scrape_date", selectedDate)
      .order("scrape_hour", { ascending: true });

    const rows = (data ?? []) as Array<{ scrape_hour: number; ib_sales: number; ob_sales: number; custom_sales: number; ib_premium: number; ob_premium: number; custom_premium: number; total_dials: number; talk_time_minutes: number; pool_dials: number; pool_talk_minutes: number }>;
    const points: IntradayPoint[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sales = r.ib_sales + r.ob_sales + r.custom_sales;
      const premium = r.ib_premium + r.ob_premium + r.custom_premium;
      const pDials = r.pool_dials ?? 0;
      const pTalk = r.pool_talk_minutes ?? 0;
      const prevSales = i > 0 ? rows[i-1].ib_sales + rows[i-1].ob_sales + rows[i-1].custom_sales : 0;
      const prevPremium = i > 0 ? rows[i-1].ib_premium + rows[i-1].ob_premium + rows[i-1].custom_premium : 0;
      const prevDials = i > 0 ? rows[i-1].total_dials : 0;
      const prevPoolDials = i > 0 ? (rows[i-1].pool_dials ?? 0) : 0;
      points.push({
        hour: r.scrape_hour,
        hourLabel: HOUR_LABELS[r.scrape_hour] ?? `${r.scrape_hour}:00`,
        sales, premium,
        dials: r.total_dials,
        talkTime: r.talk_time_minutes,
        ibSales: r.ib_sales,
        obSales: r.ob_sales,
        deltaSales: sales - prevSales,
        deltaPremium: premium - prevPremium,
        deltaDials: r.total_dials - prevDials,
        poolDials: pDials,
        poolTalk: pTalk,
        deltaPoolDials: pDials - prevPoolDials,
      });
    }
    setIntraday(points);
    setLoading(false);
  }, [agentName, selectedDate]);

  useEffect(() => { fetchIntraday(); }, [fetchIntraday]);

  const navDate = (dir: -1 | 1) => {
    const idx = availableDates.indexOf(selectedDate);
    const next = idx - dir;
    if (next >= 0 && next < availableDates.length) setSelectedDate(availableDates[next]);
  };

  if (loading) return <p className="text-sm font-mono text-muted-foreground animate-pulse p-8 text-center">Loading...</p>;

  const latest = intraday.length > 0 ? intraday[intraday.length - 1] : null;

  return (
    <div className="space-y-4">
      {/* Date picker for intraday */}
      <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Snapshot Date</span>
        <button onClick={() => navDate(-1)} disabled={availableDates.indexOf(selectedDate) >= availableDates.length - 1} className="p-1 rounded hover:bg-accent text-muted-foreground disabled:opacity-30">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="font-mono text-xs bg-background border border-border rounded px-2 py-1 text-foreground"
        >
          {availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={() => navDate(1)} disabled={availableDates.indexOf(selectedDate) <= 0} className="p-1 rounded hover:bg-accent text-muted-foreground disabled:opacity-30">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
        <div className="flex-1" />
        <span className="text-[10px] font-mono text-muted-foreground">{intraday.length} snapshot{intraday.length !== 1 ? "s" : ""} | {availableDates.length} day{availableDates.length !== 1 ? "s" : ""} available</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Latest Sales" value={latest?.sales ?? 0} color="green" />
        <MetricCard label="Latest Premium" value={latest ? formatCurrency(latest.premium) : "$0"} color="blue" />
        <MetricCard label="Snapshots" value={intraday.length} subtext={`on ${selectedDate}`} />
        <MetricCard label="Latest Dials" value={latest?.dials ?? 0} />
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Intraday Progression — Sales & Premium
        </h3>
        <p className="text-[10px] font-mono text-muted-foreground mb-3">Cumulative production tracked across each scrape snapshot</p>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={intraday} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="salesGradTrends" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
            <XAxis dataKey="hourLabel" tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#94a3b8" }} stroke="#334155" tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #334155", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#e2e8f0" }}
              labelStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
              itemStyle={{ color: "#e2e8f0" }}
              formatter={(value: number, name: string) => {
                if (name.includes("Premium")) return ["$" + value.toLocaleString(), name];
                return [value, name];
              }}
            />
            <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#94a3b8", paddingTop: 8 }} />
            <Line type="monotone" dataKey="sales" name="Sales" stroke="#34d399" yAxisId="left" strokeWidth={3} dot={{ r: 5, fill: "#34d399", strokeWidth: 2, stroke: "#0f172a" }} activeDot={{ r: 7 }} />
            <Line type="monotone" dataKey="premium" name="Premium ($)" stroke="#60a5fa" yAxisId="right" strokeWidth={2.5} dot={{ r: 4, fill: "#60a5fa", strokeWidth: 2, stroke: "#0f172a" }} strokeDasharray="6 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Intraday Effort — Dials & Talk Time
        </h3>
        <p className="text-[10px] font-mono text-muted-foreground mb-3">Effort metrics tracked across each scrape snapshot</p>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={intraday} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
            <XAxis dataKey="hourLabel" tick={{ fontSize: 11, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#cbd5e1" }} stroke="#334155" tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #334155", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11, color: "#e2e8f0" }}
              labelStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
              itemStyle={{ color: "#e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 10, color: "#94a3b8", paddingTop: 8 }} />
            <Line type="monotone" dataKey="dials" name="Dials" stroke="#a78bfa" strokeWidth={3} dot={{ r: 5, fill: "#a78bfa", strokeWidth: 2, stroke: "#0f172a" }} activeDot={{ r: 7 }} />
            <Line type="monotone" dataKey="talkTime" name="Talk Time (min)" stroke="#fbbf24" strokeWidth={2.5} dot={{ r: 4, fill: "#fbbf24", strokeWidth: 2, stroke: "#0f172a" }} />
            {intraday.some(p => p.poolDials > 0) && (
              <Line type="monotone" dataKey="poolDials" name="Pool Dials" stroke="#22d3ee" strokeWidth={2} dot={{ r: 4, fill: "#22d3ee", strokeWidth: 2, stroke: "#0f172a" }} strokeDasharray="4 2" />
            )}
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
