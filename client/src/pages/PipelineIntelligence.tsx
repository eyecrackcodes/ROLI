import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { AgentDrillDown } from "@/components/AgentDrillDown";
import { ActionCenter } from "@/components/ActionCenter";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ArrowUpDown, ArrowUp, ArrowDown, Calendar, ChevronLeft, ChevronRight,
  Zap, AlertTriangle, Shield, TrendingUp, TrendingDown, Minus,
  DollarSign, UserCheck, UserX,
  ChevronDown, ChevronUp, Download, Activity, BookOpen, Eye,
  Crosshair,
} from "lucide-react";
import { toast } from "sonner";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { exportPipelineIntelligence } from "@/lib/exportExcel";
import type { PipelineAgent, BehavioralFlag, HealthGrade } from "@/lib/pipelineIntelligence";
import {
  buildPipelineSummary, FLAG_META, getGradeColor, getGradeBg, getHealthColor,
} from "@/lib/pipelineIntelligence";

type SortDir = "asc" | "desc";
interface SortState { key: string; dir: SortDir }

// Simplified pipeline model: Actionable Leads = Past Dues + Untouched (new) leads.
// These are the two CRM buckets the agent sees and must act on now. Active call
// queue is shown for context but not penalised — the cadence engine works it.

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

function DeltaChip({ value }: { value: number }) {
  if (value === 0) return <span className="inline-flex items-center gap-0.5 text-muted-foreground/50 text-[10px]"><Minus className="h-2.5 w-2.5" />0</span>;
  const isGood = value < 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-bold tabular-nums text-[10px]", isGood ? "text-emerald-400" : "text-red-400")}>
      {isGood ? <TrendingDown className="h-2.5 w-2.5" /> : <TrendingUp className="h-2.5 w-2.5" />}
      {value > 0 ? "+" : ""}{value}
    </span>
  );
}

interface PipelineSnapshotRow {
  scrape_date: string;
  agent_name: string;
  tier: string;
  past_due_follow_ups: number | null;
  new_leads: number | null;
  call_queue_count: number | null;
  todays_follow_ups: number | null;
}

interface DaySummary {
  date: string;
  pastDue: number;
  newLeads: number;
  callQueue: number;
  actionable: number;  // pastDue + newLeads
  agents: number;
}

function actionableFromSnapshot(r: PipelineSnapshotRow): number {
  const pd = r.past_due_follow_ups ?? 0;
  const nl = r.new_leads ?? 0;
  return pd + nl;
}

function usePipelineHistory(selectedDate: string) {
  const [history, setHistory] = useState<PipelineSnapshotRow[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("pipeline_compliance_daily")
        .select("scrape_date, agent_name, tier, past_due_follow_ups, new_leads, call_queue_count, todays_follow_ups")
        .lte("scrape_date", selectedDate)
        .order("scrape_date", { ascending: true });

      if (cancelled) return;
      const rows = (data ?? []) as PipelineSnapshotRow[];
      const uniqueDates = [...new Set(rows.map(r => r.scrape_date))].sort();
      setHistory(rows);
      setDates(uniqueDates);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedDate]);

  return { history, dates, loading };
}

function PipelineMomentum({ agents, selectedDate }: { agents: PipelineAgent[]; selectedDate: string }) {
  const { history, dates, loading } = usePipelineHistory(selectedDate);

  const { daySummaries, agentDeltas, priorDate } = useMemo(() => {
    type AgentDelta = { name: string; tier: string; site: string; manager: string | null; pastDue: number; pastDueDelta: number; newLeads: number; newLeadsDelta: number; callQueue: number; callQueueDelta: number; actionable: number; actionableDelta: number };
    if (dates.length === 0) return { daySummaries: [] as DaySummary[], agentDeltas: [] as AgentDelta[], priorDate: "" };

    const agentSet = new Set(agents.map(a => a.name));

    const summaries: DaySummary[] = dates.map(d => {
      const dayRows = history.filter(r => r.scrape_date === d && agentSet.has(r.agent_name));
      return {
        date: d,
        pastDue: dayRows.reduce((s, r) => s + (r.past_due_follow_ups ?? 0), 0),
        newLeads: dayRows.reduce((s, r) => s + (r.new_leads ?? 0), 0),
        callQueue: dayRows.reduce((s, r) => s + (r.call_queue_count ?? 0), 0),
        actionable: dayRows.reduce((s, r) => s + actionableFromSnapshot(r), 0),
        agents: dayRows.length,
      };
    });

    const today = dates[dates.length - 1];
    const prior = dates.length >= 2 ? dates[dates.length - 2] : null;

    const deltas: AgentDelta[] = [];

    if (prior) {
      const todayByAgent = new Map<string, PipelineSnapshotRow>();
      const priorByAgent = new Map<string, PipelineSnapshotRow>();
      for (const r of history) {
        if (r.scrape_date === today && agentSet.has(r.agent_name)) todayByAgent.set(r.agent_name, r);
        if (r.scrape_date === prior && agentSet.has(r.agent_name)) priorByAgent.set(r.agent_name, r);
      }

      for (const [name, t] of Array.from(todayByAgent)) {
        const p = priorByAgent.get(name);
        const agent = agents.find(a => a.name === name);
        const pd = t.past_due_follow_ups ?? 0;
        const nl = t.new_leads ?? 0;
        const cq = t.call_queue_count ?? 0;
        const ppd = p ? (p.past_due_follow_ups ?? 0) : pd;
        const pnl = p ? (p.new_leads ?? 0) : nl;
        const pcq = p ? (p.call_queue_count ?? 0) : cq;
        const actNow = actionableFromSnapshot(t);
        const actPrior = p ? actionableFromSnapshot(p) : actNow;
        deltas.push({
          name, tier: t.tier, site: agent?.site ?? "—", manager: agent?.manager ?? null,
          pastDue: pd, pastDueDelta: pd - ppd,
          newLeads: nl, newLeadsDelta: nl - pnl,
          callQueue: cq, callQueueDelta: cq - pcq,
          actionable: actNow, actionableDelta: actNow - actPrior,
        });
      }
    }

    return { daySummaries: summaries, agentDeltas: deltas, priorDate: prior ?? "" };
  }, [history, dates, agents]);

  const teamSummary = useMemo(() => {
    const teams = new Map<string, typeof agentDeltas>();
    for (const d of agentDeltas) {
      const key = d.manager ?? "Unassigned";
      const arr = teams.get(key) ?? [];
      arr.push(d);
      teams.set(key, arr);
    }
    return Array.from(teams).map(([team, members]) => ({
      team,
      count: members.length,
      pastDue: members.reduce((s, d) => s + d.pastDue, 0),
      pastDueDelta: members.reduce((s, d) => s + d.pastDueDelta, 0),
      actionable: members.reduce((s, d) => s + d.actionable, 0),
      actionableDelta: members.reduce((s, d) => s + d.actionableDelta, 0),
    })).sort((a, b) => a.pastDueDelta - b.pastDueDelta);
  }, [agentDeltas]);

  if (loading || dates.length < 2) return null;

  const improving = agentDeltas.filter(d => d.pastDueDelta < 0).sort((a, b) => a.pastDueDelta - b.pastDueDelta);
  const deteriorating = agentDeltas.filter(d => d.pastDueDelta > 0).sort((a, b) => b.pastDueDelta - a.pastDueDelta);
  const actionableDeflators = agentDeltas.filter(d => d.actionableDelta < 0).sort((a, b) => a.actionableDelta - b.actionableDelta);

  const orgTotalDelta = agentDeltas.reduce((s, d) => s + d.pastDueDelta, 0);
  const orgActionableDelta = agentDeltas.reduce((s, d) => s + d.actionableDelta, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2">
          <Activity className="h-3.5 w-3.5" />
          Pipeline Momentum (d/d)
        </h3>
        <span className="text-[9px] font-mono text-muted-foreground/50">
          {selectedDate} vs {priorDate} · {dates.length} snapshots available
        </span>
      </div>

      {/* Org-level delta summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Org Past Due Δ"
          value={<DeltaChip value={orgTotalDelta} />}
          subtext={`${improving.length} improving · ${deteriorating.length} rising`}
          color={orgTotalDelta < 0 ? "green" : orgTotalDelta > 0 ? "red" : "default"}
          tooltip="Net change in total past due follow-ups across all visible agents compared to previous pipeline snapshot."
        />
        <MetricCard
          label="Org Actionable Δ"
          value={<DeltaChip value={orgActionableDelta} />}
          subtext="past dues + untouched"
          color={orgActionableDelta < 0 ? "green" : orgActionableDelta > 0 ? "red" : "default"}
          tooltip="Net change in actionable leads (past dues + untouched) across all visible agents vs the previous snapshot."
        />
        <MetricCard
          label="Deflators"
          value={actionableDeflators.length}
          subtext={`of ${agentDeltas.length} agents shrinking backlog`}
          color={actionableDeflators.length > agentDeltas.length / 2 ? "green" : "amber"}
          tooltip="Agents whose actionable lead count (past dues + untouched) decreased since the last snapshot."
        />
        <MetricCard
          label="Biggest Win"
          value={improving.length > 0 ? improving[0].name.split(" ").pop() ?? "--" : "--"}
          subtext={improving.length > 0 ? `Past due ${improving[0].pastDueDelta} (${improving[0].pastDue} now)` : "No improvements"}
          color="green"
          tooltip="Agent with the largest single-day reduction in past due follow-ups."
        />
      </div>

      {/* Team breakdown */}
      <div className="grid grid-cols-1 gap-4">
        {/* By Team */}
        <div className="bg-card border border-border rounded-md p-4">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">By Team</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {teamSummary.map(t => (
              <div key={t.team} className="flex items-center gap-3">
                <span className="text-xs font-medium w-28 truncate">{t.team}</span>
                <span className="text-[10px] font-mono text-muted-foreground w-16">{t.count} agents</span>
                <div className="flex-1 flex items-center gap-4">
                  <span className="text-[10px] font-mono">Past Due: {t.pastDue} <DeltaChip value={t.pastDueDelta} /></span>
                  <span className="text-[10px] font-mono">Actionable: {t.actionable} <DeltaChip value={t.actionableDelta} /></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Org-wide daily trend */}
      {daySummaries.length > 1 && (
        <div className="bg-card border border-border rounded-md p-4">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">Historical Trend</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase tracking-widest">Date</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest">Agents</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest">Past Due</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest">Δ</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest">Untouched</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest">Call Queue</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest" title="Past dues + Untouched leads — what the agent must work right now.">Actionable</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest">Δ</th>
                </tr>
              </thead>
              <tbody>
                {[...daySummaries].reverse().map((d, i, arr) => {
                  const prev = i < arr.length - 1 ? arr[i + 1] : null;
                  const pdDelta = prev ? d.pastDue - prev.pastDue : 0;
                  const actDelta = prev ? d.actionable - prev.actionable : 0;
                  return (
                    <tr key={d.date} className={cn("border-b border-border/30", d.date === selectedDate ? "bg-blue-500/5" : "")}>
                      <td className="px-3 py-1.5 font-medium">{d.date}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{d.agents}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{d.pastDue}</td>
                      <td className="px-3 py-1.5 text-right">{prev ? <DeltaChip value={pdDelta} /> : <span className="text-muted-foreground/30">--</span>}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{d.newLeads}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{d.callQueue}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold">{d.actionable}</td>
                      <td className="px-3 py-1.5 text-right">{prev ? <DeltaChip value={actDelta} /> : <span className="text-muted-foreground/30">--</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top movers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-emerald-500/20 rounded-md p-4">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 mb-3 flex items-center gap-1.5">
            <TrendingDown className="h-3 w-3" /> Reducing Past Due ({improving.length})
          </h4>
          {improving.length === 0 ? (
            <p className="text-[10px] font-mono text-muted-foreground/50">No agents reduced past due d/d</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {improving.slice(0, 10).map(d => (
                <div key={d.name} className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium flex-1 truncate">{d.name}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">{d.pastDue}</span>
                  <DeltaChip value={d.pastDueDelta} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-red-500/20 rounded-md p-4">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-red-400 mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" /> Rising Past Due ({deteriorating.length})
          </h4>
          {deteriorating.length === 0 ? (
            <p className="text-[10px] font-mono text-muted-foreground/50">No agents with rising past due</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {deteriorating.slice(0, 10).map(d => (
                <div key={d.name} className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium flex-1 truncate">{d.name}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">{d.pastDue}</span>
                  <DeltaChip value={d.pastDueDelta} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-blue-500/20 rounded-md p-4">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-blue-400 mb-3 flex items-center gap-1.5">
            <TrendingDown className="h-3 w-3" /> Backlog Shrinkers ({actionableDeflators.length})
          </h4>
          {actionableDeflators.length === 0 ? (
            <p className="text-[10px] font-mono text-muted-foreground/50">No agents shrunk their actionable backlog</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {actionableDeflators.slice(0, 10).map(d => (
                <div key={d.name} className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium flex-1 truncate">{d.name}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">{d.actionable}</span>
                  <DeltaChip value={d.actionableDelta} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
          <Link href={`/agent-profile/${encodeURIComponent(agent.name)}`} className="text-sm font-mono font-medium text-foreground hover:text-blue-400 transition-colors">
            {agent.name}
          </Link>
          <button onClick={onDrillDown} className="ml-1 text-muted-foreground/40 hover:text-blue-400 transition-colors print:hidden" title="Quick view"><Eye className="h-3 w-3 inline" /></button>
        </td>
        <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
          {agent.site}
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
        <td className="px-3 py-2 text-right">{agent.pastDueDelta != null ? <DeltaChip value={agent.pastDueDelta} /> : <span className="text-muted-foreground/30">--</span>}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.newLeads}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.callQueue}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums font-bold">{agent.actionableLeads}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.totalDials}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{agent.totalSales}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{fmt(agent.totalPremium)}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums text-red-400">{fmt(agent.premiumAtStake)}</td>
        <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">
          {agent.wasteRatio > 0 ? agent.wasteRatio.toFixed(0) + "%" : "--"}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/30 bg-card/30">
          <td colSpan={16} className="px-6 py-3">
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
                  <div className="flex justify-between"><span className="text-muted-foreground">Past Due</span><span className={agent.pastDue > 10 ? "text-red-400 font-bold" : agent.pastDue > 0 ? "text-amber-400" : ""}>{agent.pastDue}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Untouched</span><span className={agent.newLeads > 10 ? "text-amber-400" : ""}>{agent.newLeads}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Actionable</span><span className="font-bold">{agent.actionableLeads}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Call Queue</span><span>{agent.callQueue}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Today's F/U</span><span>{agent.todaysFollowUps}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Post-Sale</span><span>{agent.postSaleLeads}</span></div>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Production</span>
                <div className="text-[11px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total Dials</span><span>{agent.totalDials}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Pool Dials</span><span className="text-cyan-400">{agent.poolDials}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Queue Dials</span><span>{Math.max(0, agent.totalDials - agent.poolDials)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Talk Time</span><span>{Math.round(agent.talkTimeMin)}m</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Inbound Sales</span><span>{agent.ibSales + agent.obSales}</span></div>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">Revenue Impact</span>
                <div className="text-[11px] font-mono space-y-0.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Actionable</span><span className="text-amber-400">{agent.actionableLeads}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Premium @ Stake</span><span className="text-red-400">{fmt(agent.premiumAtStake)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Premium</span>
                    <span>
                      {fmt(agent.avgPremium)}
                      <span className={cn("ml-1 text-[8px]", agent.premiumSource === "agent" ? "text-emerald-500" : "text-muted-foreground/60")}>
                        {agent.premiumSource === "agent" ? "agent" : "tier avg"}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Close Rate</span>
                    <span>
                      {(agent.closeRate * 100).toFixed(1)}%
                      <span className={cn("ml-1 text-[8px]", agent.closeRateSource === "agent" ? "text-emerald-500" : "text-muted-foreground/60")}>
                        {agent.closeRateSource === "agent" ? "agent" : "tier avg"}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Waste Ratio</span><span>{agent.wasteRatio.toFixed(1)}%</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">F/U Compliance</span>
                    <span>
                      {agent.followUpCompliance.toFixed(0)}%
                      {agent.pastDueDelta != null && (
                        <span className={cn("ml-1 text-[9px]", agent.pastDueDelta > 0 ? "text-red-400" : agent.pastDueDelta < 0 ? "text-emerald-400" : "text-muted-foreground")}>
                          {agent.pastDueDelta > 0 ? "+" : ""}{agent.pastDueDelta} d/d
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TermsDefinitions() {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-card border border-border rounded-md">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-blue-400" />
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Terms & Definitions
          </span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-6 text-[11px] font-mono">
          {/* Health Score */}
          <div>
            <h4 className="text-xs font-bold text-foreground mb-2">Pipeline Health Score (0–100)</h4>
            <p className="text-muted-foreground mb-2">
              Composite of four equally-weighted sub-scores (0–25 each). Measures overall pipeline discipline, not just production volume.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-background/50 border border-border/50 rounded p-3 space-y-1">
                <span className="text-emerald-400 font-bold">Follow-Up Discipline (0–25)</span>
                <p className="text-muted-foreground">
                  Ratio of on-time follow-ups vs past-due. Formula: (1 - pastDue / (pastDue + todaysFollowUps)) × 25.
                  Score of 25 means zero past-due items.
                </p>
              </div>
              <div className="bg-background/50 border border-border/50 rounded p-3 space-y-1">
                <span className="text-blue-400 font-bold">Pipeline Freshness (0–25)</span>
                <p className="text-muted-foreground">
                  What share of the agent's visible pipeline is in the active call queue (being worked by cadence) vs the actionable backlog (past dues + untouched). More queue / less actionable = higher score.
                </p>
              </div>
              <div className="bg-background/50 border border-border/50 rounded p-3 space-y-1">
                <span className="text-amber-400 font-bold">Work Rate (0–25)</span>
                <p className="text-muted-foreground">
                  Dial activity (regular + pool) relative to pipeline size (new leads + call queue + past due + today's follow-ups).
                  Capped at 1:1 ratio for full credit.
                </p>
              </div>
              <div className="bg-background/50 border border-border/50 rounded p-3 space-y-1">
                <span className="text-purple-400 font-bold">Conversion Efficiency (0–25)</span>
                <p className="text-muted-foreground">
                  Agent close rate vs segment aggregate (CRM tier rollup or floor), with bonuses/penalties from presentation-to-close and contact-to-close when funnel data exists. Neutral 12.5 when no leads worked.
                </p>
              </div>
            </div>
          </div>

          {/* Grades */}
          <div>
            <h4 className="text-xs font-bold text-foreground mb-2">Health Grades</h4>
            <p className="text-muted-foreground mb-2">
              Grades combine the numeric score with behavioral flags. A high score can be downgraded by concerning behaviors.
            </p>
            <div className="grid grid-cols-5 gap-2">
              {([
                { grade: "A", color: "text-emerald-400 border-emerald-500/30", req: "≥ 85 · zero non-positive flags" },
                { grade: "B", color: "text-blue-400 border-blue-500/30", req: "≥ 70 · ≤ 1 warning · no critical" },
                { grade: "C", color: "text-amber-400 border-amber-500/30", req: "≥ 55 · no critical flags" },
                { grade: "D", color: "text-orange-400 border-orange-500/30", req: "≥ 40 · ≤ 1 critical flag" },
                { grade: "F", color: "text-red-400 border-red-500/30", req: "< 40 or multiple critical flags" },
              ] as const).map(g => (
                <div key={g.grade} className={cn("bg-background/50 border rounded p-2 text-center", g.color)}>
                  <span className="text-lg font-bold block">{g.grade}</span>
                  <span className="text-[9px] text-muted-foreground block mt-1">{g.req}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Behavioral Flags */}
          <div>
            <h4 className="text-xs font-bold text-foreground mb-2">Behavioral Flags</h4>
            <p className="text-muted-foreground mb-2">
              Flags are detected from pipeline patterns and affect grade assignment. Severity determines impact.
            </p>
            <div className="space-y-1.5">
              {([
                { flag: "CHERRY_PICKER" as const, trigger: "New leads > 5 AND past due < 3 AND call queue < 5", sev: "warning" },
                { flag: "PIPELINE_HOARDER" as const, trigger: "Call queue > 2× total dials", sev: "critical" },
                { flag: "FOLLOWUP_AVOIDER" as const, trigger: "Past due > 3× today's follow-ups", sev: "critical" },
                { flag: "POOL_FARMER" as const, trigger: "Pool dials > regular dials AND call queue > 10", sev: "warning" },
                { flag: "DEAD_WEIGHT_CARRIER" as const, trigger: "Premium at stake > 2× total premium sold", sev: "critical" },
                { flag: "QUEUE_BLOAT" as const, trigger: "Call queue > 150 — leads not withdrawn after 6 attempts", sev: "warning" },
                { flag: "HIGH_PERFORMER" as const, trigger: "Health ≥ 80 AND close rate above segment aggregate", sev: "positive" },
              ]).map(f => (
                <div key={f.flag} className="flex items-start gap-3">
                  <FlagPill flag={f.flag} />
                  <span className="text-muted-foreground flex-1">{FLAG_META[f.flag].description}</span>
                  <span className="text-[9px] text-muted-foreground/60 shrink-0">Trigger: {f.trigger}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key Metrics */}
          <div>
            <h4 className="text-xs font-bold text-foreground mb-2">Key Metrics</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
              {[
                ["Past Due", "Follow-up appointments that are past their scheduled callback time. Highest-priority CRM bucket."],
                ["Δ d/d", "Day-over-day change in past due count (negative = improving)"],
                ["Untouched", "Freshly assigned leads that have never been dialed (CRM `new leads`)."],
                ["Call Queue", "Active leads cycling through the dialer cadence. Workload, not backlog."],
                ["Today's F/U", "Follow-up appointments scheduled for today"],
                ["Post-Sale Leads", "Leads in post-sale servicing status"],
                ["Actionable", "Past Due + Untouched. The two buckets the agent must work right now. Replaces the old `Total Stale` composite."],
                ["Premium @ Stake", "Actionable × agent avg premium (else segment / marketing / $700 floor). Theoretical max premium sitting on the shelf."],
                ["Waste Ratio", "Premium at stake / (premium sold + premium at stake) × 100"],
                ["F/U Compliance", "(1 − past due / (past due + today's follow-ups)) × 100"],
                ["Avg Premium", "Agent 30-day rolling (≥ 3 days & 2 sales), else segment aggregate; marketing row improves tier estimate when synced"],
                ["Close Rate", "Agent 30-day rolling (≥ 3 days & 5 leads), else segment aggregate; floor 10% when empty"],
              ].map(([term, def]) => (
                <div key={term} className="flex gap-2">
                  <span className="text-foreground font-medium shrink-0 w-32">{term}</span>
                  <span className="text-muted-foreground">{def}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Unified revenue fallbacks */}
          <div>
            <h4 className="text-xs font-bold text-foreground mb-2">Unified model — revenue & actionable backlog</h4>
            <p className="text-muted-foreground mb-2">
              All agents operate under one unified capacity model. CRM <strong className="text-foreground">tier</strong> is still stored for historical rollups only.
              Pipeline backlog is the honest CRM math: <strong className="text-foreground">Actionable = Past Due + Untouched</strong>. Active call queue is shown as workload context but does not contribute,
              because the cadence engine is working it. When an agent lacks enough 30-day history, premium and close rate fall back to segment aggregates,
              then to <strong className="text-foreground">$700</strong> premium and <strong className="text-foreground">10%</strong> close. When{" "}
              <span className="font-mono text-foreground/90">daily_marketing_summary</span> has a row for the selected date, marketing avg premium improves those estimates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

type PipelineTab = "health" | "actions";

export default function PipelineIntelligence() {
  const data = useData();
  const { pipelineAgents, pipelineLoading, selectedDate, availableDates, marketingSummary } = data;
  const { sort, toggle } = useSort("healthScore");
  const [drillAgent, setDrillAgent] = useState<{ name: string; tier: string; site: string } | null>(null);
  const [flagFilter, _setFlagFilter] = useState<string>("ALL");
  const [teamFilter, _setTeamFilter] = useState<string>("ALL");
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;
  const [activeTab, setActiveTab] = useState<PipelineTab>("health");

  const setFlagFilter = useCallback((v: string) => { _setFlagFilter(v); setPage(0); }, []);
  const setTeamFilter = useCallback((v: string) => { _setTeamFilter(v); setPage(0); }, []);

  const managersForSite = useMemo(() => {
    const mgrs = new Set<string>();
    for (const a of pipelineAgents) {
      if (a.manager) mgrs.add(a.manager);
    }
    return Array.from(mgrs).sort();
  }, [pipelineAgents]);

  const teamFiltered = useMemo(() => {
    let agents = [...pipelineAgents];
    if (teamFilter !== "ALL") {
      if (teamFilter === "UNASSIGNED") agents = agents.filter(a => !a.manager);
      else agents = agents.filter(a => a.manager === teamFilter);
    }
    return agents;
  }, [pipelineAgents, teamFilter]);

  const filtered = useMemo(() => {
    let agents = [...teamFiltered];
    if (flagFilter !== "ALL") {
      if (flagFilter === "NONE") agents = agents.filter(a => a.flags.filter(f => FLAG_META[f].severity !== "positive").length === 0);
      else agents = agents.filter(a => a.flags.includes(flagFilter as BehavioralFlag));
    }
    return agents;
  }, [teamFiltered, flagFilter]);

  const summary = useMemo(() => buildPipelineSummary(filtered), [filtered]);

  const sorted = useMemo(() => {
    const key = sort.key;
    return [...filtered].sort((a, b) => {
      if (key === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sort.dir === "desc" ? -cmp : cmp;
      }
      if (key === "site") {
        const cmp = a.site.localeCompare(b.site);
        return sort.dir === "desc" ? -cmp : cmp;
      }
      const av = a[key as keyof PipelineAgent] as number;
      const bv = b[key as keyof PipelineAgent] as number;
      const na = Number.isFinite(av) ? av : 0;
      const nb = Number.isFinite(bv) ? bv : 0;
      return sort.dir === "desc" ? nb - na : na - nb;
    });
  }, [filtered, sort]);

  useEffect(() => { setPage(0); }, [sort.key, sort.dir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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
    for (const a of teamFiltered) for (const f of a.flags) flagSet.add(f);
    return Array.from(flagSet);
  }, [teamFiltered]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Pipeline Intelligence</h1>
          <p className="text-xs font-mono text-muted-foreground">
            Unified pipeline health with production context — tier labels are historical CRM metadata only
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
          {sorted.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono gap-1"
              onClick={async () => {
                try {
                  await exportPipelineIntelligence(sorted, selectedDate);
                  toast.success("Pipeline report exported");
                } catch { toast.error("Export failed"); }
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          )}
        </div>
      </div>

      {marketingSummary && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-[10px] font-mono text-muted-foreground">
          <span className="font-bold uppercase tracking-wider text-foreground">Org marketing</span>
          {marketingSummary.summary_mode === "rolling_7d_intraday" && marketingSummary.rolling_window && (
            <span className="text-sky-400/90">
              7d avg ({marketingSummary.rolling_window.days}d): {marketingSummary.rolling_window.from} →{" "}
              {marketingSummary.rolling_window.to}
            </span>
          )}
          {marketingSummary.summary_mode !== "rolling_7d_intraday" &&
            marketingSummary.report_date !== selectedDate && (
              <span className="text-amber-400/90">as of {marketingSummary.report_date}</span>
            )}
          <span>
            CPC{" "}
            <span className="tabular-nums text-foreground">${Math.round(marketingSummary.cpc)}</span>
          </span>
          <span>
            Avg prem{" "}
            <span className="tabular-nums text-foreground">${Math.round(marketingSummary.avg_premium).toLocaleString()}</span>
          </span>
          <span>
            ROAS{" "}
            <span className="tabular-nums text-foreground">
              {Number(marketingSummary.roas).toFixed(2)}×
            </span>
          </span>
          <span>
            Daily spend{" "}
            <span className="tabular-nums text-foreground">${Math.round(marketingSummary.total_cost).toLocaleString()}</span>
          </span>
          {marketingSummary.cost_per_sale > 0 && (
            <span>
              Cost / sale{" "}
              <span className="tabular-nums text-foreground">${marketingSummary.cost_per_sale.toLocaleString()}</span>
            </span>
          )}
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        <button
          onClick={() => setActiveTab("health")}
          className={cn(
            "px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest border-b-2 transition-colors -mb-px",
            activeTab === "health"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Shield className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
          Pipeline Health
        </button>
        <button
          onClick={() => setActiveTab("actions")}
          className={cn(
            "px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest border-b-2 transition-colors -mb-px",
            activeTab === "actions"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Crosshair className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
          Action Center
        </button>
      </div>

      {/* Action Center Tab */}
      {activeTab === "actions" && (
        <ActionCenter overrideDate={selectedDate} />
      )}

      {/* Pipeline Health Tab */}
      {activeTab === "health" && (
      <>
      <TermsDefinitions />

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
              label="Total Premium @ Stake"
              value={fmt(summary.totalPremiumAtStake)}
              subtext="(Past Due + Untouched) × avg premium"
              color="red"
            />
            <MetricCard
              label="Total Actionable Leads"
              value={summary.totalActionableLeads.toLocaleString()}
              subtext="Past dues + untouched, org-wide"
              color="amber"
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
                    {filtered.reduce((s, a) => s + a.flags.filter(f => FLAG_META[f].severity !== "positive").length, 0)} flags detected
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

                {/* Top Premium at Stake */}
                <div className="space-y-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <DollarSign className="h-3 w-3" /> Top Premium @ Stake
                  </span>
                  {summary.topRiskAgents.map((a, i) => (
                    <div key={a.name} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-muted-foreground">
                        <span className="text-foreground/40 mr-1">{i + 1}.</span> {a.name}
                      </span>
                      <span className="text-red-400 tabular-nums">{fmt(a.premiumAtStake)}</span>
                    </div>
                  ))}
                </div>

                {/* Top Actionable Backlog */}
                <div className="space-y-2">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Largest Actionable Backlog
                  </span>
                  {[...summary.topRiskAgents].sort((a, b) => b.actionableLeads - a.actionableLeads).map((a, i) => (
                    <div key={a.name} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-muted-foreground">
                        <span className="text-foreground/40 mr-1">{i + 1}.</span> {a.name}
                      </span>
                      <span className="text-amber-400 tabular-nums">{a.actionableLeads}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pipeline Momentum */}
          <PipelineMomentum agents={filtered} selectedDate={selectedDate} />

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {managersForSite.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Team:</span>
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="text-[10px] font-mono bg-card border border-border rounded px-2 py-1 text-foreground"
                >
                  <option value="ALL">All Teams</option>
                  <option value="UNASSIGNED">Unassigned</option>
                  {managersForSite.map(m => (
                    <option key={m} value={m}>
                      {m} ({pipelineAgents.filter(a => a.manager === m).length})
                    </option>
                  ))}
                </select>
              </div>
            )}
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
                  <option key={f} value={f}>
                    {FLAG_META[f].label} ({teamFiltered.filter(a => a.flags.includes(f)).length})
                  </option>
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
                  <SortHeader label="Site" sortKey="site" current={sort} onToggle={toggle} align="left" />
                  <th
                    className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground"
                    title="Historical CRM tier — scoring uses unified floor + marketing averages, not tier thresholds"
                  >
                    Tier
                  </th>
                  <SortHeader label="Health" sortKey="healthScore" current={sort} onToggle={toggle} />
                  <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Grade</th>
                  <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Flags</th>
                  <SortHeader label="Past Due" sortKey="pastDue" current={sort} onToggle={toggle} />
                  <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Δ d/d</th>
                  <SortHeader label="Untouched" sortKey="newLeads" current={sort} onToggle={toggle} />
                  <SortHeader label="Queue" sortKey="callQueue" current={sort} onToggle={toggle} />
                  <SortHeader label="Actionable" sortKey="actionableLeads" current={sort} onToggle={toggle} />
                  <SortHeader label="Dials" sortKey="totalDials" current={sort} onToggle={toggle} />
                  <SortHeader label="Sales" sortKey="totalSales" current={sort} onToggle={toggle} />
                  <SortHeader label="Premium" sortKey="totalPremium" current={sort} onToggle={toggle} />
                  <SortHeader label="Premium @ Stake" sortKey="premiumAtStake" current={sort} onToggle={toggle} />
                  <SortHeader label="Waste" sortKey="wasteRatio" current={sort} onToggle={toggle} />
                </tr>
              </thead>
              <tbody>
                {paged.map(agent => (
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
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right"><HealthScoreBadge score={summary.avgHealthScore} /></td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.pastDue, 0)}</td>
                  <td className="px-3 py-2 text-right"><DeltaChip value={sorted.reduce((s, a) => s + (a.pastDueDelta ?? 0), 0)} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.newLeads, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.callQueue, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">{sorted.reduce((s, a) => s + a.actionableLeads, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.totalDials, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sorted.reduce((s, a) => s + a.totalSales, 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(sorted.reduce((s, a) => s + a.totalPremium, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-400">{fmt(sorted.reduce((s, a) => s + a.premiumAtStake, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(() => {
                      const totPrem = sorted.reduce((s, a) => s + a.totalPremium, 0);
                      const totRisk = sorted.reduce((s, a) => s + a.premiumAtStake, 0);
                      return (totPrem + totRisk) > 0 ? (totRisk / (totPrem + totRisk) * 100).toFixed(0) + "%" : "--";
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-mono text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(0)}
                  disabled={page === 0}
                  className="px-2 py-1 rounded text-[10px] font-mono border border-border hover:bg-accent disabled:opacity-30 transition-colors"
                >
                  First
                </button>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i).map(i => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={cn(
                      "w-7 h-7 rounded text-[10px] font-mono font-bold transition-colors",
                      i === page
                        ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setPage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  className="px-2 py-1 rounded text-[10px] font-mono border border-border hover:bg-accent disabled:opacity-30 transition-colors"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </>
      )}
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
