import { useState, useMemo, useCallback } from "react";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { AgentDrillDown } from "@/components/AgentDrillDown";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ArrowUpDown, ArrowUp, ArrowDown, Calendar, ChevronLeft, ChevronRight,
  Zap, AlertTriangle, Shield, TrendingUp, DollarSign, UserCheck, UserX,
  ChevronDown, ChevronUp, Download,
} from "lucide-react";
import { toast } from "sonner";
import { exportPipelineIntelligence } from "@/lib/exportExcel";
import type { PipelineAgent, BehavioralFlag, HealthGrade } from "@/lib/pipelineIntelligence";
import {
  buildPipelineSummary, FLAG_META, getGradeColor, getGradeBg, getHealthColor,
} from "@/lib/pipelineIntelligence";

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

function fmt(val: number) {
  return "$" + Math.round(val).toLocaleString();
}

function HealthScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
    : score >= 60 ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
    : score >= 40 ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
    : "text-red-400 bg-red-500/10 border-red-500/30";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-mono font-bold border tabular-nums", color)}>
      {score}
    </span>
  );
}

function GradeBadge({ grade }: { grade: HealthGrade }) {
  return (
    <span className={cn("px-2 py-0.5 rounded text-[11px] font-mono font-bold border", getGradeBg(grade), getGradeColor(grade))}>
      {grade}
    </span>
  );
}

function FlagPill({ flag }: { flag: BehavioralFlag }) {
  const meta = FLAG_META[flag];
  const color = meta.severity === "critical"
    ? "bg-red-500/10 text-red-400 border-red-500/30"
    : meta.severity === "warning"
    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-mono font-medium border whitespace-nowrap", color)}>
      {meta.label}
    </span>
  );
}

function ScoreBar({ label, score, max = 25 }: { label: string; score: number; max?: number }) {
  const pct = Math.min((score / max) * 100, 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : pct >= 40 ? "bg-blue-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono text-muted-foreground w-20 text-right shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-border/50 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-foreground w-6 tabular-nums text-right">{Math.round(score)}</span>
    </div>
  );
}

function AgentExpandRow({ agent, onDrillDown }: { agent: PipelineAgent; onDrillDown: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className="border-b border-border/30 hover:bg-card/60 transition-colors">
        <td className="px-3 py-2">
          <button onClick={() => setExpanded(!expanded)} className="mr-1 text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />}
          </button>
          <button onClick={onDrillDown} className="text-sm font-mono font-medium text-foreground hover:text-blue-400 transition-colors">
            {agent.name}
          </button>
        </td>
        <td className="px-3 py-2">
          <span className={cn(
            "px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold border",
            agent.tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
              : agent.tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/10 text-amber-400 border-amber-500/30"
          )}>{agent.tier}</span>
        </td>
        <td className="px-3 py-2 text-right"><HealthScoreBadge score={agent.healthScore} /></td>
        <td className="px-3 py-2 text-right"><GradeBadge grade={agent.healthGrade} /></td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {agent.flags.map(f => <FlagPill key={f} flag={f} />)}
          </div>
        </td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.pastDue}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.callQueue}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.totalStale}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.totalDials + agent.poolDials}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.totalSales}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{fmt(agent.totalPremium)}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-red-400">{fmt(agent.revenueAtRisk)}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-emerald-400">{fmt(agent.projectedRecovery)}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">
          {agent.wasteRatio > 0 ? agent.wasteRatio.toFixed(0) + "%" : "--"}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/30 bg-card/30">
          <td colSpan={14} className="px-6 py-3">
            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Sub-Scores</span>
                <ScoreBar label="Follow-Up" score={agent.followUpDiscipline} />
                <ScoreBar label="Freshness" score={agent.pipelineFreshness} />
                <ScoreBar label="Work Rate" score={agent.workRate} />
                <ScoreBar label="Conversion" score={agent.conversionEfficiency} />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Pipeline Detail</span>
                <div className="text-[11px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">New Leads</span><span>{agent.newLeads}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Call Queue</span><span>{agent.callQueue}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Past Due</span><span className={agent.pastDue > 10 ? "text-red-400" : ""}>{agent.pastDue}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Today's F/U</span><span>{agent.todaysFollowUps}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Post-Sale</span><span>{agent.postSaleLeads}</span></div>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Production</span>
                <div className="text-[11px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Reg Dials</span><span>{agent.totalDials}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Pool Dials</span><span className="text-cyan-400">{agent.poolDials}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Talk Time</span><span>{Math.round(agent.talkTimeMin)}m</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">IB Sales</span><span>{agent.ibSales}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">OB Sales</span><span>{agent.obSales}</span></div>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Revenue Impact</span>
                <div className="text-[11px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total Stale</span><span className="text-amber-400">{agent.totalStale}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Rev at Risk</span><span className="text-red-400">{fmt(agent.revenueAtRisk)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Proj. Recovery</span><span className="text-emerald-400">{fmt(agent.projectedRecovery)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Waste Ratio</span><span>{agent.wasteRatio.toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">F/U Compliance</span><span>{agent.followUpCompliance.toFixed(0)}%</span></div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PipelineIntelligence() {
  const data = useData();
  const { pipelineAgents, pipelineLoading, selectedDate, availableDates } = data;
  const { sort, toggle } = useSort("healthScore");
  const [drillAgent, setDrillAgent] = useState<{ name: string; tier: string; site: string } | null>(null);
  const [tierFilter, setTierFilter] = useState<string>("ALL");
  const [flagFilter, setFlagFilter] = useState<string>("ALL");
  const [insightsOpen, setInsightsOpen] = useState(true);

  const summary = useMemo(() => buildPipelineSummary(pipelineAgents), [pipelineAgents]);

  const filtered = useMemo(() => {
    let agents = [...pipelineAgents];
    if (tierFilter !== "ALL") agents = agents.filter(a => a.tier === tierFilter);
    if (flagFilter !== "ALL") {
      if (flagFilter === "NONE") agents = agents.filter(a => a.flags.filter(f => FLAG_META[f].severity !== "positive").length === 0);
      else agents = agents.filter(a => a.flags.includes(flagFilter as BehavioralFlag));
    }
    return agents;
  }, [pipelineAgents, tierFilter, flagFilter]);

  const sorted = useMemo(() => {
    const key = sort.key as keyof PipelineAgent;
    return [...filtered].sort((a, b) => {
      const av = a[key] as number;
      const bv = b[key] as number;
      return sort.dir === "desc" ? bv - av : av - bv;
    });
  }, [filtered, sort]);

  const navToDate = (dir: -1 | 1) => {
    const idx = availableDates.indexOf(selectedDate);
    const nextIdx = idx - dir;
    if (nextIdx >= 0 && nextIdx < availableDates.length) {
      data.setSelectedDate(availableDates[nextIdx]);
    }
  };

  const latestDate = availableDates.length > 0 ? availableDates[0] : null;
  const isOnLatest = selectedDate === latestDate;

  const allFlagTypes = useMemo(() => {
    const flagSet = new Set<BehavioralFlag>();
    for (const a of pipelineAgents) for (const f of a.flags) flagSet.add(f);
    return Array.from(flagSet);
  }, [pipelineAgents]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Pipeline Intelligence</h1>
          <p className="text-xs font-mono text-muted-foreground">
            Combined production + pipeline compliance analysis
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navToDate(-1)}
            disabled={availableDates.indexOf(selectedDate) >= availableDates.length - 1}
            className="p-1 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-md px-2 py-1">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => data.setSelectedDate(e.target.value)}
              className="h-6 w-auto border-0 bg-transparent text-xs font-mono p-0 focus-visible:ring-0"
            />
          </div>
          <button
            onClick={() => navToDate(1)}
            disabled={availableDates.indexOf(selectedDate) <= 0}
            className="p-1 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isOnLatest && latestDate && (
            <button
              onClick={() => data.setSelectedDate(latestDate)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-blue-400 text-[10px] font-mono hover:bg-blue-500/20"
            >
              <Zap className="h-3 w-3" /> Latest
            </button>
          )}
          {pipelineAgents.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono gap-1"
              onClick={async () => {
                try {
                  await exportPipelineIntelligence(pipelineAgents, selectedDate);
                  toast.success("Pipeline report exported");
                } catch { toast.error("Export failed"); }
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          )}
        </div>
      </div>

      {pipelineLoading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading pipeline data...</p>
        </div>
      ) : pipelineAgents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Shield className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-mono text-muted-foreground">No pipeline compliance data for {selectedDate}</p>
          <p className="text-xs font-mono text-muted-foreground/60">Run the Pipeline Compliance scraper to populate data</p>
        </div>
      ) : (
        <>
          {/* Executive Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Org Pipeline Health"
              value={summary.avgHealthScore}
              subtext={`${summary.agentCount} agents scored`}
              color={getHealthColor(summary.avgHealthScore)}
            />
            <MetricCard
              label="Total Revenue at Risk"
              value={fmt(summary.totalRevenueAtRisk)}
              subtext="Stale pipeline value"
              color="red"
            />
            <MetricCard
              label="Projected Recovery"
              value={fmt(summary.totalProjectedRecovery)}
              subtext="Est. @ 12% stale conversion"
              color="green"
            />
            <MetricCard
              label="Follow-up Compliance"
              value={summary.orgFollowUpCompliance.toFixed(0) + "%"}
              subtext="Org-wide discipline"
              color={summary.orgFollowUpCompliance >= 70 ? "green" : summary.orgFollowUpCompliance >= 50 ? "amber" : "red"}
            />
          </div>

          {/* Grade Distribution Bar */}
          <div className="bg-card border border-border rounded-md p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Grade Distribution</span>
              <div className="flex gap-4 text-[11px] font-mono">
                {(["A", "B", "C", "D", "F"] as HealthGrade[]).map(g => (
                  <span key={g} className={cn("tabular-nums", getGradeColor(g))}>
                    {g}: {summary.gradeDistribution[g]}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
              {(["A", "B", "C", "D", "F"] as HealthGrade[]).map(g => {
                const pct = summary.agentCount > 0 ? (summary.gradeDistribution[g] / summary.agentCount) * 100 : 0;
                if (pct === 0) return null;
                const bg = g === "A" ? "bg-emerald-500" : g === "B" ? "bg-blue-500" : g === "C" ? "bg-amber-500" : g === "D" ? "bg-orange-500" : "bg-red-500";
                return <div key={g} className={cn("h-full transition-all", bg)} style={{ width: `${pct}%` }} />;
              })}
            </div>
          </div>

          {/* Insights & Alerts Panel (collapsible) */}
          <div className="bg-card border border-border rounded-md">
            <button
              onClick={() => setInsightsOpen(!insightsOpen)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Insights & Alerts
                </span>
                {!insightsOpen && (
                  <span className="text-[10px] font-mono text-amber-400">
                    {pipelineAgents.reduce((s, a) => s + a.flags.filter(f => FLAG_META[f].severity !== "positive").length, 0)} flags detected
                  </span>
                )}
              </div>
              {insightsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {insightsOpen && (
              <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Behavioral Flags Summary */}
                <div className="space-y-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <UserX className="h-3 w-3" /> Behavioral Flags
                  </span>
                  {allFlagTypes.filter(f => FLAG_META[f].severity !== "positive").length === 0 ? (
                    <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                      <UserCheck className="h-3.5 w-3.5" /> No concerning behaviors detected
                    </div>
                  ) : (
                    allFlagTypes.filter(f => FLAG_META[f].severity !== "positive").map(flag => (
                      <div key={flag} className="flex items-start gap-2">
                        <FlagPill flag={flag} />
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {summary.flagCounts[flag].join(", ")}
                        </span>
                      </div>
                    ))
                  )}
                  {summary.flagCounts.HIGH_PERFORMER.length > 0 && (
                    <div className="flex items-start gap-2 pt-1 border-t border-border/30">
                      <FlagPill flag="HIGH_PERFORMER" />
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {summary.flagCounts.HIGH_PERFORMER.join(", ")}
                      </span>
                    </div>
                  )}
                </div>

                {/* Top Revenue at Risk */}
                <div className="space-y-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <DollarSign className="h-3 w-3" /> Top Revenue at Risk
                  </span>
                  {summary.topRiskAgents.map((a, i) => (
                    <div key={a.name} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-muted-foreground">
                        <span className="text-foreground/40 mr-1">{i + 1}.</span> {a.name}
                      </span>
                      <span className="text-red-400 tabular-nums">{fmt(a.revenueAtRisk)}</span>
                    </div>
                  ))}
                </div>

                {/* Top Recovery Potential */}
                <div className="space-y-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> Top Projected Recovery
                  </span>
                  {summary.topRecoveryAgents.map((a, i) => (
                    <div key={a.name} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-muted-foreground">
                        <span className="text-foreground/40 mr-1">{i + 1}.</span> {a.name}
                      </span>
                      <span className="text-emerald-400 tabular-nums">{fmt(a.projectedRecovery)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Tier:</span>
              {["ALL", "T1", "T2", "T3"].map(t => (
                <button
                  key={t}
                  onClick={() => setTierFilter(t)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors",
                    tierFilter === t
                      ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                      : "bg-card text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Flag:</span>
              <select
                value={flagFilter}
                onChange={(e) => setFlagFilter(e.target.value)}
                className="text-[10px] font-mono bg-card border border-border rounded px-2 py-1 text-foreground"
              >
                <option value="ALL">All Agents</option>
                <option value="NONE">No Flags</option>
                {allFlagTypes.map(f => (
                  <option key={f} value={f}>{FLAG_META[f].label} ({summary.flagCounts[f].length})</option>
                ))}
              </select>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">
              {sorted.length} of {pipelineAgents.length} agents
            </span>
          </div>

          {/* Agent Pipeline Table */}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-[12px] font-mono">
              <thead className="bg-card sticky top-0 z-10">
                <tr className="border-b border-border">
                  <SortHeader label="Agent" sortKey="name" current={sort} onToggle={toggle} align="left" />
                  <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Tier</th>
                  <SortHeader label="Health" sortKey="healthScore" current={sort} onToggle={toggle} />
                  <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Grade</th>
                  <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Flags</th>
                  <SortHeader label="Past Due" sortKey="pastDue" current={sort} onToggle={toggle} />
                  <SortHeader label="Queue" sortKey="callQueue" current={sort} onToggle={toggle} />
                  <SortHeader label="Stale" sortKey="totalStale" current={sort} onToggle={toggle} />
                  <SortHeader label="Dials" sortKey="totalDials" current={sort} onToggle={toggle} />
                  <SortHeader label="Sales" sortKey="totalSales" current={sort} onToggle={toggle} />
                  <SortHeader label="Premium" sortKey="totalPremium" current={sort} onToggle={toggle} />
                  <SortHeader label="Rev Risk" sortKey="revenueAtRisk" current={sort} onToggle={toggle} />
                  <SortHeader label="Proj. Recovery" sortKey="projectedRecovery" current={sort} onToggle={toggle} />
                  <SortHeader label="Waste" sortKey="wasteRatio" current={sort} onToggle={toggle} />
                </tr>
              </thead>
              <tbody>
                {sorted.map(agent => (
                  <AgentExpandRow
                    key={agent.name}
                    agent={agent}
                    onDrillDown={() => setDrillAgent({ name: agent.name, tier: agent.tier, site: agent.site })}
                  />
                ))}
              </tbody>
              <tfoot className="bg-card border-t border-border sticky bottom-0">
                <tr className="font-bold text-foreground">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right"><HealthScoreBadge score={summary.avgHealthScore} /></td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.pastDue, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.callQueue, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.totalStale, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.totalDials + a.poolDials, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.totalSales, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(sorted.reduce((s, a) => s + a.totalPremium, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-400">{fmt(sorted.reduce((s, a) => s + a.revenueAtRisk, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{fmt(sorted.reduce((s, a) => s + a.projectedRecovery, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(() => {
                      const totPrem = sorted.reduce((s, a) => s + a.totalPremium, 0);
                      const totRisk = sorted.reduce((s, a) => s + a.revenueAtRisk, 0);
                      return (totPrem + totRisk) > 0 ? (totRisk / (totPrem + totRisk) * 100).toFixed(0) + "%" : "--";
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {drillAgent && (
        <AgentDrillDown
          agentName={drillAgent.name}
          tier={drillAgent.tier}
          site={drillAgent.site}
          open={!!drillAgent}
          onOpenChange={(open) => !open && setDrillAgent(null)}
        />
      )}
    </div>
  );
}
