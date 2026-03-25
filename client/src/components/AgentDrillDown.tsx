import { useMemo, useState, useEffect, useCallback } from "react";
import { useAgentTrends, type IntradayPoint } from "@/hooks/useAgentTrends";
import { useData } from "@/contexts/DataContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { TrendLineChart, TrendBarChart, Sparkline, DeltaBadge } from "@/components/TrendChart";
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { calcLeadCost, calcROLI } from "@/lib/types";
import type { Tier } from "@/lib/types";

interface AgentDrillDownProps {
  agentName: string | null;
  tier?: string;
  site?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmt(val: number) {
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="p-2.5 bg-card rounded-md border border-border">
      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">{label}</span>
      <span className={cn("text-lg font-mono font-bold", color ?? "text-foreground")}>{value}</span>
      {sub && <span className="text-[9px] font-mono text-muted-foreground block">{sub}</span>}
    </div>
  );
}

function ChannelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-border/50 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-mono text-foreground w-8 tabular-nums">{value}</span>
    </div>
  );
}

const ID_HOUR_LABELS: Record<number, string> = {
  6: "6AM", 7: "7AM", 8: "8AM", 9: "9AM", 10: "10AM", 11: "11AM",
  12: "12PM", 13: "1PM", 14: "2PM", 15: "3PM", 16: "4PM", 17: "5PM",
  18: "6PM", 19: "7PM", 20: "8PM",
};

export function AgentDrillDown({ agentName, tier, site, open, onOpenChange }: AgentDrillDownProps) {
  const { daily, weekly, deltas, loading } = useAgentTrends(agentName, 14);
  const data = useData();

  const [idDates, setIdDates] = useState<string[]>([]);
  const [idDate, setIdDate] = useState("");
  const [idPoints, setIdPoints] = useState<IntradayPoint[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured || !agentName || !open) return;
    (async () => {
      const { data: rows } = await supabase
        .from("intraday_snapshots")
        .select("scrape_date")
        .eq("agent_name", agentName)
        .order("scrape_date", { ascending: false });
      const dates = Array.from(new Set((rows ?? []).map((r: { scrape_date: string }) => r.scrape_date)));
      setIdDates(dates);
      if (dates.length > 0) setIdDate(dates[0]);
    })();
  }, [agentName, open]);

  const fetchIdData = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName || !idDate) return;
    const { data: rows } = await supabase
      .from("intraday_snapshots")
      .select("scrape_hour, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes")
      .eq("agent_name", agentName)
      .eq("scrape_date", idDate)
      .order("scrape_hour", { ascending: true });
    const raw = (rows ?? []) as Array<{ scrape_hour: number; ib_sales: number; ob_sales: number; custom_sales: number; ib_premium: number; ob_premium: number; custom_premium: number; total_dials: number; talk_time_minutes: number }>;
    const pts: IntradayPoint[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const s = r.ib_sales + r.ob_sales + r.custom_sales;
      const p = r.ib_premium + r.ob_premium + r.custom_premium;
      const ps = i > 0 ? raw[i-1].ib_sales + raw[i-1].ob_sales + raw[i-1].custom_sales : 0;
      const pp = i > 0 ? raw[i-1].ib_premium + raw[i-1].ob_premium + raw[i-1].custom_premium : 0;
      const pd = i > 0 ? raw[i-1].total_dials : 0;
      pts.push({ hour: r.scrape_hour, hourLabel: ID_HOUR_LABELS[r.scrape_hour] ?? `${r.scrape_hour}:00`, sales: s, premium: p, dials: r.total_dials, talkTime: r.talk_time_minutes, ibSales: r.ib_sales, obSales: r.ob_sales, deltaSales: s - ps, deltaPremium: p - pp, deltaDials: r.total_dials - pd });
    }
    setIdPoints(pts);
  }, [agentName, idDate]);

  useEffect(() => { fetchIdData(); }, [fetchIdData]);

  const navIdDate = (dir: -1 | 1) => {
    const idx = idDates.indexOf(idDate);
    const next = idx - dir;
    if (next >= 0 && next < idDates.length) setIdDate(idDates[next]);
  };

  const latestDay = daily.length > 0 ? daily[daily.length - 1] : null;

  const mtd = useMemo(() => {
    if (daily.length === 0) return null;
    const totalSales = daily.reduce((s, d) => s + d.sales, 0);
    const totalPremium = daily.reduce((s, d) => s + d.premium, 0);
    const totalIBLeads = daily.reduce((s, d) => s + d.ibLeads, 0);
    const totalOBLeads = daily.reduce((s, d) => s + d.obLeads, 0);
    const totalIBSales = daily.reduce((s, d) => s + d.ibSales, 0);
    const totalOBSales = daily.reduce((s, d) => s + d.obSales, 0);
    const totalDials = daily.reduce((s, d) => s + d.dials, 0);
    const totalTalkTime = daily.reduce((s, d) => s + d.talkTime, 0);
    const t = (tier ?? "T2") as Tier;
    const leadCost = calcLeadCost(t, totalIBLeads, totalOBLeads);
    const roli = calcROLI(totalPremium, leadCost);
    const totalLeads = totalIBLeads + totalOBLeads;
    const cr = totalLeads > 0 ? ((totalIBSales + totalOBSales) / totalLeads) * 100 : 0;
    return { totalSales, totalPremium, leadCost, roli, cr, totalDials, totalTalkTime, days: daily.length, pace: daily.length > 0 ? totalSales / daily.length : 0 };
  }, [daily, tier]);

  const tierPeers = useMemo(() => {
    const allAgents = [...data.dailyT1, ...data.dailyT2, ...data.dailyT3];
    const peers = allAgents.filter((a) => a.tier === tier).sort((a, b) => b.totalPremium - a.totalPremium);
    const rank = peers.findIndex((a) => a.name === agentName) + 1;
    return { rank, total: peers.length };
  }, [data.dailyT1, data.dailyT2, data.dailyT3, tier, agentName]);

  const channelMax = latestDay ? Math.max(latestDay.ibSales, latestDay.obSales, latestDay.customSales, 1) : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1600px] w-[90vw] max-h-[92vh] overflow-y-auto bg-background border-border p-8">
        <DialogHeader className="pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-bold text-foreground">{agentName}</DialogTitle>
            {tierPeers.rank > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground bg-card border border-border rounded px-2 py-1">
                Rank <span className="text-foreground font-bold">{tierPeers.rank}</span> of {tierPeers.total} in {tier}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {tier && (
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
                tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                "bg-amber-500/10 text-amber-400 border-amber-500/30"
              )}>
                {tier}
              </span>
            )}
            {site && <span className="text-xs font-mono text-muted-foreground">{site}</span>}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading trends...</p>
          </div>
        ) : (
          <div className="space-y-6 pt-5">
            {/* Today's Stats */}
            <div>
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">Latest Day</h3>
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 bg-card rounded-md border border-border">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Sales</span>
                  <span className="text-lg font-mono font-bold text-emerald-400">{latestDay?.sales ?? 0}</span>
                  <div className="mt-0.5"><DeltaBadge value={deltas.salesVsYesterday} /></div>
                </div>
                <div className="p-2.5 bg-card rounded-md border border-border">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Premium</span>
                  <span className="text-lg font-mono font-bold text-blue-400">{latestDay ? fmt(latestDay.premium) : "$0"}</span>
                  <div className="mt-0.5"><DeltaBadge value={deltas.premiumVsYesterday} format="currency" /></div>
                </div>
                <StatCard label="CR" value={latestDay ? latestDay.closeRate.toFixed(1) + "%" : "--"} color={latestDay && latestDay.closeRate >= 10 ? "text-emerald-400" : latestDay && latestDay.closeRate >= 5 ? "text-amber-400" : "text-red-400"} />
                <StatCard label="Dials" value={latestDay?.dials ?? 0} />
              </div>
            </div>

            {/* Channel Breakdown */}
            {latestDay && (latestDay.ibSales > 0 || latestDay.obSales > 0 || latestDay.customSales > 0) && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">Sales by Channel</h3>
                <div className="p-3 bg-card rounded-md border border-border space-y-2">
                  <ChannelBar label="IB" value={latestDay.ibSales} max={channelMax} color="#60a5fa" />
                  <ChannelBar label="OB" value={latestDay.obSales} max={channelMax} color="#34d399" />
                  <ChannelBar label="Bonus" value={latestDay.customSales} max={channelMax} color="#a78bfa" />
                  <div className="flex gap-3 pt-1 border-t border-border/50 text-[10px] font-mono text-muted-foreground">
                    <span>IB Prem: <span className="text-foreground">{fmt(latestDay.ibPremium)}</span></span>
                    <span>OB Prem: <span className="text-foreground">{fmt(latestDay.obPremium)}</span></span>
                    <span>Bonus: <span className="text-foreground">{fmt(latestDay.customPremium)}</span></span>
                  </div>
                </div>
              </div>
            )}

            {/* MTD Summary */}
            {mtd && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  MTD Summary ({mtd.days} days)
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  <StatCard label="Total Sales" value={mtd.totalSales} color="text-emerald-400" />
                  <StatCard label="Total Premium" value={fmt(mtd.totalPremium)} color="text-blue-400" />
                  <StatCard label="Pace" value={mtd.pace.toFixed(2)} sub="sales/day" />
                  <StatCard label="ROLI" value={mtd.roli.toFixed(2) + "x"} color={mtd.roli >= 1.5 ? "text-emerald-400" : mtd.roli >= 0.75 ? "text-amber-400" : "text-red-400"} />
                </div>
              </div>
            )}

            {/* Effort Metrics */}
            {latestDay && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">Effort</h3>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="Leads" value={(latestDay.ibLeads + latestDay.obLeads)} sub={`IB:${latestDay.ibLeads} OB:${latestDay.obLeads}`} />
                  <StatCard label="Dials" value={latestDay.dials} />
                  <StatCard label="Talk Time" value={`${Math.round(latestDay.talkTime)} min`} />
                </div>
              </div>
            )}

            {/* Sparklines */}
            <div>
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Trends (Last {daily.length} Days)
              </h3>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Sales", data: daily.map((d) => d.sales), color: "#34d399" },
                  { label: "Premium", data: daily.map((d) => d.premium), color: "#60a5fa" },
                  { label: "CR%", data: daily.map((d) => d.closeRate), color: "#fbbf24" },
                  { label: "Dials", data: daily.map((d) => d.dials), color: "#a78bfa" },
                ].map(({ label, data: sparkData, color }) => (
                  <div key={label} className="p-2 bg-card rounded border border-border text-center">
                    <span className="text-[9px] font-mono text-muted-foreground block mb-1">{label}</span>
                    <Sparkline data={sparkData} color={color} width={70} height={20} />
                  </div>
                ))}
              </div>
            </div>

            {/* Day-by-Day Table */}
            {daily.length > 0 && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">Day-by-Day</h3>
                <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-[11px] font-mono">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="px-2 py-1.5 text-left">Date</th>
                        <th className="px-2 py-1.5 text-right">Sales</th>
                        <th className="px-2 py-1.5 text-right">Premium</th>
                        <th className="px-2 py-1.5 text-right">CR</th>
                        <th className="px-2 py-1.5 text-right">Dials</th>
                        <th className="px-2 py-1.5 text-right">Talk</th>
                        <th className="px-2 py-1.5 text-right">Leads</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...daily].reverse().map((d, i) => (
                        <tr key={d.date} className={cn("border-b border-border/30", i % 2 === 0 ? "bg-transparent" : "bg-card/40")}>
                          <td className="px-2 py-1.5 text-muted-foreground">{d.date.slice(5)}</td>
                          <td className="px-2 py-1.5 text-right text-foreground font-bold">{d.sales}</td>
                          <td className="px-2 py-1.5 text-right text-foreground">{fmt(d.premium)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <span className={cn(d.closeRate >= 10 ? "text-emerald-400" : d.closeRate >= 5 ? "text-amber-400" : "text-red-400")}>
                              {d.closeRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-foreground">{d.dials}</td>
                          <td className="px-2 py-1.5 text-right text-foreground">{Math.round(d.talkTime)}m</td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">{d.ibLeads + d.obLeads}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Charts Grid - 2 columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-md p-3">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">Sales & Premium</h3>
                <TrendLineChart
                  data={daily}
                  xKey="date"
                  lines={[
                    { key: "sales", color: "#34d399", name: "Sales", yAxisId: "left" },
                    { key: "premium", color: "#60a5fa", name: "Premium", yAxisId: "right" },
                  ]}
                  dualAxis
                  height={280}
                />
              </div>

              <div className="bg-card border border-border rounded-md p-4">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">Effort Trend</h3>
                <TrendBarChart
                  data={daily}
                  xKey="date"
                  bars={[
                    { key: "dials", color: "#a78bfa", name: "Dials" },
                    { key: "talkTime", color: "#fbbf24", name: "Talk Time (min)" },
                  ]}
                  height={280}
                />
              </div>

              {idDates.length > 0 && (
                <div className="bg-card border border-border rounded-md p-4 lg:col-span-2">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Intraday Progression</h3>
                    <div className="flex-1" />
                    <button onClick={() => navIdDate(-1)} disabled={idDates.indexOf(idDate) >= idDates.length - 1} className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <select value={idDate} onChange={(e) => setIdDate(e.target.value)} className="font-mono text-[10px] bg-background border border-border rounded px-1.5 py-0.5 text-foreground">
                      {idDates.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <button onClick={() => navIdDate(1)} disabled={idDates.indexOf(idDate) <= 0} className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                    <span className="text-[9px] font-mono text-muted-foreground">{idPoints.length} snapshots</span>
                  </div>
                  {idPoints.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={idPoints} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
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
                        <Line type="monotone" dataKey="dials" name="Dials" stroke="#a78bfa" yAxisId="left" strokeWidth={1.5} dot={{ r: 3, fill: "#a78bfa" }} opacity={0.6} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[280px] flex items-center justify-center border border-dashed border-border rounded-md bg-card/30">
                      <p className="text-xs font-mono text-muted-foreground">No snapshots for {idDate}</p>
                    </div>
                  )}
                </div>
              )}

              {weekly.length > 0 && (
                <div className="bg-card border border-border rounded-md p-4">
                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">Weekly</h3>
                  <TrendBarChart
                    data={weekly}
                    xKey="weekLabel"
                    bars={[{ key: "sales", color: "#34d399", name: "Sales" }]}
                    height={280}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
