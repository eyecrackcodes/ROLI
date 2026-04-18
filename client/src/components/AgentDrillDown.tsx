import { useMemo, useState, useEffect, useCallback } from "react";
import { useAgentTrends, type IntradayPoint } from "@/hooks/useAgentTrends";
import { useData } from "@/contexts/DataContext";
import SalesFunnel from "@/components/SalesFunnel";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  TrendLineChart,
  TrendBarChart,
  Sparkline,
  DeltaBadge,
} from "@/components/TrendChart";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { calcLeadCost, calcROLI } from "@/lib/types";
import type { Tier, FunnelMetrics } from "@/lib/types";
import type { PipelineAgent } from "@/lib/pipelineIntelligence";
import { FLAG_META, getGradeColor, getGradeBg } from "@/lib/pipelineIntelligence";

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

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="p-2.5 bg-card rounded-md border border-border">
      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">
        {label}
      </span>
      <span
        className={cn(
          "text-lg font-mono font-bold",
          color ?? "text-foreground"
        )}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[9px] font-mono text-muted-foreground block">
          {sub}
        </span>
      )}
    </div>
  );
}

function ChannelBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right shrink-0">
        {label}
      </span>
      <div className="flex-1 h-3 bg-border/50 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-mono text-foreground w-8 tabular-nums">
        {value}
      </span>
    </div>
  );
}

const ID_HOUR_LABELS: Record<number, string> = {
  6: "6AM",
  7: "7AM",
  8: "8AM",
  9: "9AM",
  10: "10AM",
  11: "11AM",
  12: "12PM",
  13: "1PM",
  14: "2PM",
  15: "3PM",
  16: "4PM",
  17: "5PM",
  18: "6PM",
  19: "7PM",
  20: "8PM",
};

export function AgentDrillDown({
  agentName,
  tier,
  site,
  open,
  onOpenChange,
}: AgentDrillDownProps) {
  const { daily, weekly, pipelineTrends, funnelTrends, deltas, loading } = useAgentTrends(agentName, 14);
  const data = useData();
  const pipelineAgent: PipelineAgent | undefined = useMemo(
    () => agentName ? data.pipelineAgents.find(a => a.name === agentName) : undefined,
    [data.pipelineAgents, agentName]
  );

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
      const dates = Array.from(
        new Set((rows ?? []).map((r: { scrape_date: string }) => r.scrape_date))
      );
      setIdDates(dates);
      if (dates.length > 0) setIdDate(dates[0]);
    })();
  }, [agentName, open]);

  const fetchIdData = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName || !idDate) return;
    const { data: rows } = await supabase
      .from("intraday_snapshots")
      .select(
        "scrape_hour, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, total_dials, talk_time_minutes, pool_dials, pool_talk_minutes"
      )
      .eq("agent_name", agentName)
      .eq("scrape_date", idDate)
      .order("scrape_hour", { ascending: true });
    const raw = (rows ?? []) as Array<{
      scrape_hour: number;
      ib_sales: number;
      ob_sales: number;
      custom_sales: number;
      ib_premium: number;
      ob_premium: number;
      custom_premium: number;
      total_dials: number;
      talk_time_minutes: number;
      pool_dials: number;
      pool_talk_minutes: number;
    }>;
    const pts: IntradayPoint[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const s = r.ib_sales + r.ob_sales + r.custom_sales;
      const p = r.ib_premium + r.ob_premium + r.custom_premium;
      const pDials = r.pool_dials ?? 0;
      const pTalk = r.pool_talk_minutes ?? 0;
      const ps =
        i > 0
          ? raw[i - 1].ib_sales + raw[i - 1].ob_sales + raw[i - 1].custom_sales
          : 0;
      const pp =
        i > 0
          ? raw[i - 1].ib_premium +
            raw[i - 1].ob_premium +
            raw[i - 1].custom_premium
          : 0;
      const pd = i > 0 ? raw[i - 1].total_dials : 0;
      const ppd = i > 0 ? (raw[i - 1].pool_dials ?? 0) : 0;
      pts.push({
        hour: r.scrape_hour,
        hourLabel: ID_HOUR_LABELS[r.scrape_hour] ?? `${r.scrape_hour}:00`,
        sales: s,
        premium: p,
        dials: r.total_dials,
        talkTime: r.talk_time_minutes,
        ibSales: r.ib_sales,
        obSales: r.ob_sales,
        deltaSales: s - ps,
        deltaPremium: p - pp,
        deltaDials: r.total_dials - pd,
        poolDials: pDials,
        poolTalk: pTalk,
        deltaPoolDials: pDials - ppd,
      });
    }
    setIdPoints(pts);
  }, [agentName, idDate]);

  useEffect(() => {
    fetchIdData();
  }, [fetchIdData]);

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
    const totalPoolDials = daily.reduce((s, d) => s + d.poolDials, 0);
    const totalPoolTalk = daily.reduce((s, d) => s + d.poolTalk, 0);
    const totalPoolSA = daily.reduce((s, d) => s + d.poolSelfAssigned, 0);
    const t = (tier ?? "T2") as Tier;
    const leadCost = calcLeadCost(t, totalIBLeads, totalOBLeads);
    const roli = calcROLI(totalPremium, leadCost);
    const totalLeads = totalIBLeads + totalOBLeads;
    const cr =
      totalLeads > 0 ? ((totalIBSales + totalOBSales) / totalLeads) * 100 : 0;
    return {
      totalSales,
      totalPremium,
      leadCost,
      roli,
      cr,
      totalDials,
      totalTalkTime,
      totalPoolDials,
      totalPoolTalk,
      totalPoolSA,
      days: daily.length,
      pace: daily.length > 0 ? totalSales / daily.length : 0,
    };
  }, [daily, tier]);

  const tierPeers = useMemo(() => {
    const allAgents = [...data.dailyT1, ...data.dailyT2, ...data.dailyT3];
    const peers = allAgents
      .filter(a => a.tier === tier)
      .sort((a, b) => b.totalPremium - a.totalPremium);
    const rank = peers.findIndex(a => a.name === agentName) + 1;
    return { rank, total: peers.length };
  }, [data.dailyT1, data.dailyT2, data.dailyT3, tier, agentName]);

  const channelMax = latestDay
    ? Math.max(latestDay.ibSales + latestDay.obSales, latestDay.customSales, 1)
    : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1600px] w-[90vw] max-h-[92vh] overflow-y-auto bg-background border-border p-8">
        <DialogHeader className="pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-bold text-foreground">
              {agentName}
            </DialogTitle>
            {tierPeers.rank > 0 && (
              <span className="text-[10px] font-mono text-muted-foreground bg-card border border-border rounded px-2 py-1">
                Rank{" "}
                <span className="text-foreground font-bold">
                  {tierPeers.rank}
                </span>{" "}
                of {tierPeers.total} in {tier}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {site && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border bg-violet-500/10 text-violet-400 border-violet-500/30">
                {site}
              </span>
            )}
            {tier && (
              <span className="text-[10px] font-mono text-muted-foreground/60">
                {tier}
              </span>
            )}
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm font-mono text-muted-foreground animate-pulse">
              Loading trends...
            </p>
          </div>
        ) : (
          <div className="space-y-6 pt-5">
            {/* Today's Stats */}
            <div>
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Latest Day
              </h3>
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 bg-card rounded-md border border-border">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">
                    Sales
                  </span>
                  <span className="text-lg font-mono font-bold text-emerald-400">
                    {latestDay?.sales ?? 0}
                  </span>
                  <div className="mt-0.5">
                    <DeltaBadge value={deltas.salesVsYesterday} />
                  </div>
                </div>
                <div className="p-2.5 bg-card rounded-md border border-border">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">
                    Premium
                  </span>
                  <span className="text-lg font-mono font-bold text-blue-400">
                    {latestDay ? fmt(latestDay.premium) : "$0"}
                  </span>
                  <div className="mt-0.5">
                    <DeltaBadge
                      value={deltas.premiumVsYesterday}
                      format="currency"
                    />
                  </div>
                </div>
                <StatCard
                  label="CR"
                  value={
                    latestDay ? latestDay.closeRate.toFixed(1) + "%" : "--"
                  }
                  color={
                    latestDay && latestDay.closeRate >= 10
                      ? "text-emerald-400"
                      : latestDay && latestDay.closeRate >= 5
                        ? "text-amber-400"
                        : "text-red-400"
                  }
                />
                <StatCard label="Dials" value={latestDay?.dials ?? 0} />
              </div>
            </div>

            {/* Channel Breakdown — Inbound (incl. legacy ob_* misc-inbound) vs Bonus */}
            {latestDay &&
              (latestDay.ibSales + latestDay.obSales > 0 ||
                latestDay.customSales > 0) && (
                <div>
                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                    Sales by Channel
                  </h3>
                  <div className="p-3 bg-card rounded-md border border-border space-y-2">
                    <ChannelBar
                      label="Inbound"
                      value={latestDay.ibSales + latestDay.obSales}
                      max={channelMax}
                      color="#60a5fa"
                    />
                    <ChannelBar
                      label="Bonus"
                      value={latestDay.customSales}
                      max={channelMax}
                      color="#a78bfa"
                    />
                    <div className="flex gap-3 pt-1 border-t border-border/50 text-[10px] font-mono text-muted-foreground">
                      <span>
                        Inbound Prem:{" "}
                        <span className="text-foreground">
                          {fmt(latestDay.ibPremium + latestDay.obPremium)}
                        </span>
                      </span>
                      <span>
                        Bonus:{" "}
                        <span className="text-foreground">
                          {fmt(latestDay.customPremium)}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )}

            {/* Sales Funnel */}
            {(() => {
              const allAgents = [...data.dailyT1, ...data.dailyT2, ...data.dailyT3];
              const currentAgent = allAgents.find(a => a.name === agentName);
              const funnel = currentAgent?.funnel;
              if (!funnel || funnel.dials === 0) return null;
              return <SalesFunnel funnel={funnel} tier={currentAgent?.tier as Tier | undefined} />;
            })()}

            {/* MTD Summary */}
            {mtd && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  MTD Summary ({mtd.days} days)
                </h3>
                <div className="grid grid-cols-4 gap-2">
                  <StatCard
                    label="Total Sales"
                    value={mtd.totalSales}
                    color="text-emerald-400"
                  />
                  <StatCard
                    label="Total Premium"
                    value={fmt(mtd.totalPremium)}
                    color="text-blue-400"
                  />
                  <StatCard
                    label="Pace"
                    value={mtd.pace.toFixed(2)}
                    sub="sales/day"
                  />
                  <StatCard
                    label="ROLI"
                    value={mtd.roli.toFixed(2) + "x"}
                    color={
                      mtd.roli >= 1.5
                        ? "text-emerald-400"
                        : mtd.roli >= 0.75
                          ? "text-amber-400"
                          : "text-red-400"
                    }
                  />
                  {mtd.totalPoolDials > 0 && (
                    <StatCard
                      label="Pool Dials"
                      value={mtd.totalPoolDials}
                      sub="total pool"
                      color="text-cyan-400"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Effort Metrics */}
            {latestDay && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Effort
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard
                    label="Inbound Leads"
                    value={latestDay.ibLeads + latestDay.obLeads}
                  />
                  <StatCard
                    label="Dials"
                    value={latestDay.dials}
                    sub={latestDay.poolDials > 0 ? `Queue:${Math.max(0, latestDay.dials - latestDay.poolDials)} Pool:${latestDay.poolDials}` : undefined}
                  />
                  <StatCard
                    label="Talk Time"
                    value={`${Math.round(latestDay.talkTime)} min`}
                    sub={latestDay.poolTalk > 0 ? `Queue:${Math.max(0, Math.round(latestDay.talkTime - latestDay.poolTalk))}m Pool:${Math.round(latestDay.poolTalk)}m` : undefined}
                  />
                </div>
              </div>
            )}

            {/* Pipeline Health */}
            {pipelineAgent && (() => {
              const pa = pipelineAgent;
              const scoreColor = (score: number, max: number) => {
                const pct = (score / max) * 100;
                return pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : pct >= 40 ? "bg-blue-500" : "bg-red-500";
              };
              const gradeText = getGradeColor(pa.healthGrade);
              const gradeBg = getGradeBg(pa.healthGrade);

              return (
                <div>
                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-violet-400 mb-2">
                    Pipeline Health
                  </h3>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="p-2.5 bg-card rounded-md border border-border">
                      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Health Score</span>
                      <span className={cn(
                        "text-lg font-mono font-bold",
                        pa.healthScore >= 80 ? "text-emerald-400" : pa.healthScore >= 60 ? "text-amber-400" : pa.healthScore >= 40 ? "text-blue-400" : "text-red-400"
                      )}>{pa.healthScore}</span>
                      <span className="text-[9px] font-mono text-muted-foreground block">of 100</span>
                    </div>
                    <div className={cn("p-2.5 rounded-md border", gradeBg)}>
                      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Grade</span>
                      <span className={cn("text-lg font-mono font-bold", gradeText)}>{pa.healthGrade}</span>
                      <span className="text-[9px] font-mono text-muted-foreground block">
                        {pa.healthGrade === "A" ? "Excellent" : pa.healthGrade === "B" ? "Good" : pa.healthGrade === "C" ? "Fair" : pa.healthGrade === "D" ? "Poor" : "Critical"}
                      </span>
                    </div>
                    <StatCard
                      label="F/U Compliance"
                      value={pa.followUpCompliance.toFixed(0) + "%"}
                      sub={pa.pastDueDelta != null
                        ? `${pa.pastDue} past due (${pa.pastDueDelta > 0 ? "+" : ""}${pa.pastDueDelta} d/d)`
                        : `${pa.pastDue} past due · ${pa.todaysFollowUps} today`}
                      color={pa.followUpCompliance >= 70 ? "text-emerald-400" : pa.followUpCompliance >= 50 ? "text-amber-400" : "text-red-400"}
                    />
                    <StatCard
                      label="Waste Ratio"
                      value={pa.wasteRatio > 0 ? pa.wasteRatio.toFixed(0) + "%" : "--"}
                      sub={`${fmt(pa.premiumAtStake)} @ stake · ${(pa.closeRate * 100).toFixed(1)}% CR (${pa.closeRateSource})`}
                      color={pa.wasteRatio > 50 ? "text-red-400" : pa.wasteRatio > 25 ? "text-amber-400" : "text-emerald-400"}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-card rounded-md border border-border space-y-2">
                      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Sub-Scores</span>
                      {([
                        ["Follow-Up Discipline", pa.followUpDiscipline],
                        ["Pipeline Freshness", pa.pipelineFreshness],
                        ["Work Rate", pa.workRate],
                        ["Conversion Efficiency", pa.conversionEfficiency],
                      ] as [string, number][]).map(([label, score]) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground w-28 text-right shrink-0">{label}</span>
                          <div className="flex-1 h-2.5 bg-border/50 rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all", scoreColor(score, 25))} style={{ width: `${(score / 25) * 100}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-foreground w-6 tabular-nums text-right">{Math.round(score)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="p-3 bg-card rounded-md border border-border">
                      <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block mb-2">Pipeline State</span>
                      <div className="text-[11px] font-mono space-y-1">
                        <div className="flex justify-between"><span className="text-muted-foreground">Past Due</span><span className={pa.pastDue > 10 ? "text-red-400 font-bold" : pa.pastDue > 0 ? "text-amber-400" : ""}>{pa.pastDue}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Untouched</span><span className={pa.newLeads > 10 ? "text-amber-400" : ""}>{pa.newLeads}</span></div>
                        <div className="flex justify-between border-t border-border/30 pt-1 mt-1"><span className="text-muted-foreground font-bold">Actionable</span><span className="font-bold">{pa.actionableLeads}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Call Queue</span><span>{pa.callQueue}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Post-Sale</span><span>{pa.postSaleLeads}</span></div>
                        <div className="flex justify-between border-t border-border/30 pt-1 mt-1">
                          <span className="text-muted-foreground">Premium @ Stake</span>
                          <span className="text-red-400" title={`${pa.actionableLeads} actionable × ${fmt(pa.avgPremium)} avg premium`}>{fmt(pa.premiumAtStake)}</span>
                        </div>
                        <div className="flex justify-between text-[9px] text-muted-foreground/60 pt-0.5">
                          <span>Avg Prem: {fmt(pa.avgPremium)} ({pa.premiumSource})</span>
                          <span>CR: {(pa.closeRate * 100).toFixed(1)}% ({pa.closeRateSource})</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {pa.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {pa.flags.map(flag => {
                        const meta = FLAG_META[flag];
                        const color = meta.severity === "critical"
                          ? "bg-red-500/10 text-red-400 border-red-500/30"
                          : meta.severity === "warning"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                        return (
                          <span key={flag} className={cn("px-2 py-0.5 rounded text-[10px] font-mono border", color)}>
                            {meta.label}: {meta.description}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Pipeline Trends */}
            {pipelineTrends.length > 1 && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-violet-400 mb-2">
                  Pipeline Trends ({pipelineTrends.length} days)
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-card border border-border rounded-md p-3">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block mb-2">
                      Pipeline Composition
                    </span>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={pipelineTrends} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          tickFormatter={(d: string) => d.slice(5)}
                          stroke="#334155" tickLine={false} axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          stroke="#334155" tickLine={false} axisLine={false}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #334155", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 10, color: "#e2e8f0" }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
                        />
                        <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 9 }} />
                        <Bar dataKey="pastDue" name="Past Due" fill="#ef4444" stackId="pipeline" />
                        <Bar dataKey="newLeads" name="Untouched" fill="#22c55e" stackId="pipeline" />
                        <Bar dataKey="callQueue" name="Call Queue" fill="#f59e0b" stackId="pipeline" />
                        <Line type="monotone" dataKey="actionableLeads" name="Actionable" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3, fill: "#a78bfa" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-card border border-border rounded-md p-3">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block mb-2">
                      Revenue Impact
                    </span>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={pipelineTrends} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          tickFormatter={(d: string) => d.slice(5)}
                          stroke="#334155" tickLine={false} axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          stroke="#334155" tickLine={false} axisLine={false}
                          tickFormatter={(v: number) => "$" + (v / 1000).toFixed(0) + "k"}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #334155", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 10, color: "#e2e8f0" }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
                          formatter={(value: number, name: string) => ["$" + Math.round(value).toLocaleString(), name]}
                        />
                        <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 9 }} />
                        <Bar dataKey="premiumAtStake" name="Premium @ Stake" fill="#ef444480" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Funnel Trends */}
            {funnelTrends.length > 1 && (
              <div>
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-orange-400 mb-2">
                  Funnel Trends ({funnelTrends.length} days)
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-card border border-border rounded-md p-3">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block mb-2">
                      Funnel Volumes
                    </span>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={funnelTrends} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          tickFormatter={(d: string) => d.slice(5)}
                          stroke="#334155" tickLine={false} axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          stroke="#334155" tickLine={false} axisLine={false}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #334155", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 10, color: "#e2e8f0" }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
                        />
                        <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 9 }} />
                        <Line type="monotone" dataKey="contactsMade" name="Contacts" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: "#60a5fa" }} />
                        <Line type="monotone" dataKey="conversations" name="Convos" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3, fill: "#22d3ee" }} />
                        <Line type="monotone" dataKey="presentations" name="Pres" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3, fill: "#fbbf24" }} />
                        <Line type="monotone" dataKey="sales" name="Sales" stroke="#34d399" strokeWidth={2} dot={{ r: 3, fill: "#34d399" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="bg-card border border-border rounded-md p-3">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block mb-2">
                      Conversion Rates
                    </span>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={funnelTrends} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          tickFormatter={(d: string) => d.slice(5)}
                          stroke="#334155" tickLine={false} axisLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "#94a3b8" }}
                          stroke="#334155" tickLine={false} axisLine={false}
                          tickFormatter={(v: number) => v.toFixed(0) + "%"}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1a1a2e", border: "1px solid #334155", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 10, color: "#e2e8f0" }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
                          formatter={(value: number, name: string) => [value.toFixed(1) + "%", name]}
                        />
                        <Legend wrapperStyle={{ fontFamily: "JetBrains Mono", fontSize: 9 }} />
                        <Line type="monotone" dataKey="contactPct" name="Contact %" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3, fill: "#60a5fa" }} />
                        <Line type="monotone" dataKey="contactToClosePct" name="Contact→Close %" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3, fill: "#22d3ee" }} />
                        <Line type="monotone" dataKey="conversationToClosePct" name="Convo→Close %" stroke="#fbbf24" strokeWidth={2} dot={{ r: 3, fill: "#fbbf24" }} />
                        <Line type="monotone" dataKey="presentationToClosePct" name="Pres→Close %" stroke="#34d399" strokeWidth={2} dot={{ r: 3, fill: "#34d399" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Leads Pool Activity */}
            {latestDay && latestDay.poolDials > 0 && (() => {
              const hasPoolHistory = daily.some(d => d.poolDials > 0);
              const poolDays = daily.filter(d => d.poolDials > 0);
              const totPoolDials = poolDays.reduce((s, d) => s + d.poolDials, 0);
              const totPoolAnswered = poolDays.reduce((s, d) => s + d.poolAnswered, 0);
              const totPoolLong = poolDays.reduce((s, d) => s + d.poolLongCalls, 0);
              const totPoolSelfAssigned = poolDays.reduce((s, d) => s + d.poolSelfAssigned, 0);
              const avgContactRate = totPoolDials > 0 ? (totPoolAnswered / totPoolDials) * 100 : 0;
              const avgAssignRate = totPoolAnswered > 0
                ? (totPoolSelfAssigned / totPoolAnswered) * 100
                : 0;

              const todayAssignRate = latestDay.poolAnswered > 0 ? (latestDay.poolSelfAssigned / latestDay.poolAnswered) * 100 : 0;
              const ghostAssigns = latestDay.poolSelfAssigned - latestDay.poolLongCalls;
              const isGaming = ghostAssigns > 0;

              const funnelSteps = [
                { label: "Dials", value: latestDay.poolDials, color: "#a78bfa" },
                { label: "Answered", value: latestDay.poolAnswered, color: "#60a5fa" },
                { label: "Long Calls", value: latestDay.poolLongCalls, color: "#fbbf24" },
                { label: "Self-Assigned", value: latestDay.poolSelfAssigned, color: "#34d399" },
              ];
              const funnelMax = Math.max(...funnelSteps.map(s => s.value), 1);

              return (
                <div>
                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-400 mb-2">
                    Leads Pool Activity
                  </h3>
                  <div className="grid grid-cols-5 gap-2 mb-3">
                    <StatCard
                      label="Contact Rate"
                      value={latestDay.poolContactRate.toFixed(0) + "%"}
                      sub={hasPoolHistory ? `${poolDays.length}d avg: ${avgContactRate.toFixed(0)}%` : "answered / dials"}
                      color={latestDay.poolContactRate >= 50 ? "text-emerald-400" : latestDay.poolContactRate >= 30 ? "text-amber-400" : "text-red-400"}
                    />
                    <StatCard
                      label="Assign Rate"
                      value={todayAssignRate.toFixed(0) + "%"}
                      sub={hasPoolHistory ? `${poolDays.length}d avg: ${avgAssignRate.toFixed(0)}%` : "assigned / answered"}
                      color={todayAssignRate >= 65 ? "text-emerald-400" : todayAssignRate >= 45 ? "text-amber-400" : "text-red-400"}
                    />
                    <StatCard
                      label="Self-Assigned"
                      value={latestDay.poolSelfAssigned}
                      sub={isGaming
                        ? `${ghostAssigns} without long call`
                        : hasPoolHistory ? `${totPoolSelfAssigned} total (${poolDays.length}d)` : undefined}
                      color={isGaming ? "text-red-400" : "text-cyan-400"}
                    />
                    <StatCard
                      label="Pool Close Rate"
                      value={latestDay.poolCloseRate > 0 ? latestDay.poolCloseRate.toFixed(1) + "%" : "--"}
                      sub={`${latestDay.poolSales} sale${latestDay.poolSales !== 1 ? "s" : ""} / ${latestDay.poolSelfAssigned} assigned` + (latestDay.poolPremium > 0 ? ` · $${latestDay.poolPremium.toLocaleString()}` : "")}
                      color={latestDay.poolCloseRate >= 8 ? "text-emerald-400" : latestDay.poolCloseRate >= 4 ? "text-amber-400" : latestDay.poolCloseRate > 0 ? "text-red-400" : undefined}
                    />
                    {(() => {
                      const mpa = latestDay.poolAnswered > 0 ? latestDay.poolTalk / latestDay.poolAnswered : 0;
                      const effColor = mpa > 3 ? "text-amber-400" : mpa >= 1 ? "text-emerald-400" : mpa >= 0.5 ? "text-blue-400" : mpa > 0 ? "text-red-400" : undefined;
                      const effLabel = mpa > 3 ? "Long convos — thorough or slow" : mpa >= 1 ? "Healthy workflow" : mpa >= 0.5 ? "Short — quick disqualify?" : mpa > 0 ? "Hanging up on answers" : undefined;
                      const dialYield = latestDay.poolDials > 0 ? (latestDay.poolTalk / latestDay.poolDials).toFixed(1) : "0";
                      return (
                        <StatCard
                          label="Pool Efficiency"
                          value={latestDay.poolAnswered > 0 ? mpa.toFixed(1) + " min/answer" : "--"}
                          sub={effLabel ? `${effLabel} · ${dialYield} min/dial yield` : `${latestDay.poolAnswered} answered → ${Math.round(latestDay.poolTalk)} min`}
                          color={effColor}
                        />
                      );
                    })()}
                    {isGaming && (
                      <div className="p-2.5 bg-red-500/10 rounded-md border border-red-500/30">
                        <span className="text-[9px] font-mono uppercase tracking-widest text-red-400 block">
                          Gaming Flag
                        </span>
                        <span className="text-lg font-mono font-bold text-red-400">
                          {ghostAssigns}
                        </span>
                        <span className="text-[9px] font-mono text-red-400/70 block">
                          assigns without long calls
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-card rounded-md border border-border space-y-2">
                    <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                      Today&apos;s Pool Funnel
                    </span>
                    {funnelSteps.map(step => (
                      <ChannelBar
                        key={step.label}
                        label={step.label.length > 6 ? step.label.slice(0, 6) : step.label}
                        value={step.value}
                        max={funnelMax}
                        color={step.color}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Sparklines */}
            <div>
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Trends (Last {daily.length} Days)
              </h3>
              <div className={cn("grid gap-2", daily.some(d => d.poolDials > 0) ? "grid-cols-6" : "grid-cols-4")}>
                {[
                  { label: "Sales", data: daily.map(d => d.sales), color: "#34d399" },
                  { label: "Premium", data: daily.map(d => d.premium), color: "#60a5fa" },
                  { label: "CR%", data: daily.map(d => d.closeRate), color: "#fbbf24" },
                  { label: "Total Dials", data: daily.map(d => d.dials), color: "#a78bfa" },
                  ...(daily.some(d => d.poolDials > 0)
                    ? [
                        { label: "Contact %", data: daily.map(d => d.poolContactRate), color: "#22d3ee" },
                        { label: "Assign %", data: daily.map(d => d.poolAssignRate), color: "#f472b6" },
                        { label: "Pool CR %", data: daily.map(d => d.poolCloseRate), color: "#34d399" },
                      ]
                    : []),
                ].map(({ label, data: sparkData, color }) => (
                  <div
                    key={label}
                    className="p-2 bg-card rounded border border-border text-center"
                  >
                    <span className="text-[9px] font-mono text-muted-foreground block mb-1">
                      {label}
                    </span>
                    <Sparkline
                      data={sparkData}
                      color={color}
                      width={70}
                      height={20}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Day-by-Day Table */}
            {daily.length > 0 && (() => {
              const hasPoolData = daily.some(d => d.poolDials > 0);
              const totSales = daily.reduce((s, d) => s + d.sales, 0);
              const totPremium = daily.reduce((s, d) => s + d.premium, 0);
              const totDials = daily.reduce((s, d) => s + d.dials, 0);
              const totTalk = daily.reduce((s, d) => s + d.talkTime, 0);
              const totLeads = daily.reduce((s, d) => s + d.ibLeads + d.obLeads, 0);
              const totIBOBSales = daily.reduce((s, d) => s + d.ibSales + d.obSales, 0);
              const avgCR = totLeads > 0 ? (totIBOBSales / totLeads) * 100 : 0;
              const totPoolDials = daily.reduce((s, d) => s + d.poolDials, 0);
              const totPoolTalk = daily.reduce((s, d) => s + d.poolTalk, 0);
              const totPoolSA = daily.reduce((s, d) => s + d.poolSelfAssigned, 0);

              return (
                <div>
                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                    Day-by-Day
                  </h3>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto rounded-md border border-border">
                    <table className="w-full text-[11px] font-mono">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="px-2 py-1.5 text-left">Date</th>
                          <th className="px-2 py-1.5 text-right">Sales</th>
                          <th className="px-2 py-1.5 text-right">Premium</th>
                          <th className="px-2 py-1.5 text-right">CR</th>
                          <th className="px-2 py-1.5 text-right">Dials</th>
                          {hasPoolData && <th className="px-2 py-1.5 text-right text-cyan-400/70">Pool</th>}
                          <th className="px-2 py-1.5 text-right">Talk</th>
                          {hasPoolData && <th className="px-2 py-1.5 text-right text-cyan-400/70">P.Talk</th>}
                          <th className="px-2 py-1.5 text-right">Leads</th>
                          {hasPoolData && <th className="px-2 py-1.5 text-right text-cyan-400/70">Self-A</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {[...daily].reverse().map((d, i) => (
                          <tr
                            key={d.date}
                            className={cn(
                              "border-b border-border/30",
                              i % 2 === 0 ? "bg-transparent" : "bg-card/40"
                            )}
                          >
                            <td className="px-2 py-1.5 text-muted-foreground">{d.date.slice(5)}</td>
                            <td className="px-2 py-1.5 text-right text-foreground font-bold">{d.sales}</td>
                            <td className="px-2 py-1.5 text-right text-foreground">{fmt(d.premium)}</td>
                            <td className="px-2 py-1.5 text-right">
                              <span className={cn(d.closeRate >= 10 ? "text-emerald-400" : d.closeRate >= 5 ? "text-amber-400" : "text-red-400")}>
                                {d.closeRate.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right text-foreground">{d.dials}</td>
                            {hasPoolData && (
                              <td className="px-2 py-1.5 text-right text-cyan-400">{d.poolDials || ""}</td>
                            )}
                            <td className="px-2 py-1.5 text-right text-foreground">{Math.round(d.talkTime)}m</td>
                            {hasPoolData && (
                              <td className="px-2 py-1.5 text-right text-cyan-400">{d.poolTalk ? Math.round(d.poolTalk) + "m" : ""}</td>
                            )}
                            <td className="px-2 py-1.5 text-right text-muted-foreground">{d.ibLeads + d.obLeads}</td>
                            {hasPoolData && (
                              <td className="px-2 py-1.5 text-right text-cyan-400">{d.poolSelfAssigned || ""}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-card border-t border-border">
                        <tr className="text-foreground font-bold">
                          <td className="px-2 py-1.5 text-left">Total</td>
                          <td className="px-2 py-1.5 text-right text-emerald-400">{totSales}</td>
                          <td className="px-2 py-1.5 text-right text-blue-400">{fmt(totPremium)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <span className={cn(avgCR >= 10 ? "text-emerald-400" : avgCR >= 5 ? "text-amber-400" : "text-red-400")}>
                              {avgCR.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right">{totDials}</td>
                          {hasPoolData && <td className="px-2 py-1.5 text-right text-cyan-400">{totPoolDials}</td>}
                          <td className="px-2 py-1.5 text-right">{Math.round(totTalk)}m</td>
                          {hasPoolData && <td className="px-2 py-1.5 text-right text-cyan-400">{Math.round(totPoolTalk)}m</td>}
                          <td className="px-2 py-1.5 text-right">{totLeads}</td>
                          {hasPoolData && <td className="px-2 py-1.5 text-right text-cyan-400">{totPoolSA}</td>}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Charts Grid - 2 columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-md p-3">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Sales & Premium
                </h3>
                <TrendLineChart
                  data={daily}
                  xKey="date"
                  lines={[
                    {
                      key: "sales",
                      color: "#34d399",
                      name: "Sales",
                      yAxisId: "left",
                    },
                    {
                      key: "premium",
                      color: "#60a5fa",
                      name: "Premium",
                      yAxisId: "right",
                    },
                  ]}
                  dualAxis
                  height={280}
                />
              </div>

              <div className="bg-card border border-border rounded-md p-4">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
                  Effort Trend
                </h3>
                <TrendBarChart
                  data={daily}
                  xKey="date"
                  bars={[
                    { key: "dials", color: "#a78bfa", name: "Dials" },
                    {
                      key: "talkTime",
                      color: "#fbbf24",
                      name: "Talk Time (min)",
                    },
                  ]}
                  height={280}
                />
              </div>

              {idDates.length > 0 && (
                <div className="bg-card border border-border rounded-md p-4 lg:col-span-2">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
                      Intraday Progression
                    </h3>
                    <div className="flex-1" />
                    <button
                      onClick={() => navIdDate(-1)}
                      disabled={idDates.indexOf(idDate) >= idDates.length - 1}
                      className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 19l-7-7 7-7"
                        />
                      </svg>
                    </button>
                    <select
                      value={idDate}
                      onChange={e => setIdDate(e.target.value)}
                      className="font-mono text-[10px] bg-background border border-border rounded px-1.5 py-0.5 text-foreground"
                    >
                      {idDates.map(d => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => navIdDate(1)}
                      disabled={idDates.indexOf(idDate) <= 0}
                      className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                    <span className="text-[9px] font-mono text-muted-foreground">
                      {idPoints.length} snapshots
                    </span>
                  </div>
                  {idPoints.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart
                        data={idPoints}
                        margin={{ top: 10, right: 30, left: 10, bottom: 5 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#334155"
                          opacity={0.3}
                        />
                        <XAxis
                          dataKey="hourLabel"
                          tick={{
                            fontSize: 11,
                            fontFamily: "JetBrains Mono",
                            fill: "#cbd5e1",
                          }}
                          stroke="#334155"
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{
                            fontSize: 10,
                            fontFamily: "JetBrains Mono",
                            fill: "#cbd5e1",
                          }}
                          stroke="#334155"
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{
                            fontSize: 10,
                            fontFamily: "JetBrains Mono",
                            fill: "#94a3b8",
                          }}
                          stroke="#334155"
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#1a1a2e",
                            border: "1px solid #334155",
                            borderRadius: 8,
                            fontFamily: "JetBrains Mono",
                            fontSize: 11,
                            color: "#e2e8f0",
                          }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: "bold" }}
                          itemStyle={{ color: "#e2e8f0" }}
                          formatter={(value: number, name: string) => {
                            if (name.includes("Premium"))
                              return ["$" + value.toLocaleString(), name];
                            return [value, name];
                          }}
                        />
                        <Legend
                          wrapperStyle={{
                            fontFamily: "JetBrains Mono",
                            fontSize: 10,
                            color: "#94a3b8",
                            paddingTop: 8,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="sales"
                          name="Sales"
                          stroke="#34d399"
                          yAxisId="left"
                          strokeWidth={3}
                          dot={{
                            r: 5,
                            fill: "#34d399",
                            strokeWidth: 2,
                            stroke: "#0f172a",
                          }}
                          activeDot={{ r: 7 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="premium"
                          name="Premium ($)"
                          stroke="#60a5fa"
                          yAxisId="right"
                          strokeWidth={2.5}
                          dot={{
                            r: 4,
                            fill: "#60a5fa",
                            strokeWidth: 2,
                            stroke: "#0f172a",
                          }}
                          strokeDasharray="6 3"
                        />
                        <Line
                          type="monotone"
                          dataKey="dials"
                          name="Dials"
                          stroke="#a78bfa"
                          yAxisId="left"
                          strokeWidth={1.5}
                          dot={{ r: 3, fill: "#a78bfa" }}
                          opacity={0.6}
                        />
                        {idPoints.some(p => p.poolDials > 0) && (
                          <Line
                            type="monotone"
                            dataKey="poolDials"
                            name="Pool Dials"
                            stroke="#22d3ee"
                            yAxisId="left"
                            strokeWidth={2}
                            dot={{ r: 4, fill: "#22d3ee", strokeWidth: 2, stroke: "#0f172a" }}
                            strokeDasharray="4 2"
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[280px] flex items-center justify-center border border-dashed border-border rounded-md bg-card/30">
                      <p className="text-xs font-mono text-muted-foreground">
                        No snapshots for {idDate}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {weekly.length > 0 && (
                <div className="bg-card border border-border rounded-md p-4">
                  <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
                    Weekly
                  </h3>
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
