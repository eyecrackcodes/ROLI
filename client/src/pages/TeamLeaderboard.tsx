import { useState, useMemo } from "react";
import { useTeamPerformance, type TeamSummary, type TeamAgentStats } from "@/hooks/useTeamPerformance";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Trophy, TrendingUp, TrendingDown, Users, DollarSign, Target, Award, Activity, AlertTriangle, ShieldCheck } from "lucide-react";

function fmt(v: number) { return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

function RoliBadge({ roli }: { roli: number }) {
  const pct = (roli * 100).toFixed(0);
  const color = roli >= 1.5 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
    : roli >= 0.5 ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
    : roli >= 0 ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
    : "text-red-400 bg-red-500/10 border-red-500/30";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border tabular-nums", color)}>
      {pct}%
    </span>
  );
}

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="h-4 w-4 text-yellow-400" />;
  if (rank === 2) return <Trophy className="h-4 w-4 text-gray-300" />;
  if (rank === 3) return <Trophy className="h-4 w-4 text-amber-700" />;
  return <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-4 text-center">{rank}</span>;
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={cn(
      "px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border",
      tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
      tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
      "bg-amber-500/10 text-amber-400 border-amber-500/30"
    )}>
      {tier}
    </span>
  );
}

function HealthBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground/40 text-[10px]">—</span>;
  const color = score >= 70 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
    : score >= 40 ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
    : "text-red-400 bg-red-500/10 border-red-500/30";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border tabular-nums", color)}>
      {score}
    </span>
  );
}

function AgentRow({ agent, isTop, isBottom }: { agent: TeamAgentStats; isTop: boolean; isBottom: boolean }) {
  return (
    <tr className="border-b border-border/30 hover:bg-accent/20 transition-colors">
      <td className="px-3 py-2 font-mono text-sm">
        <div className="flex items-center gap-2">
          {isTop && <Award className="h-3 w-3 text-emerald-400" title="Top performer" />}
          {isBottom && <TrendingDown className="h-3 w-3 text-red-400" title="Bottom performer" />}
          <span className={cn(isTop && "text-emerald-400", isBottom && "text-red-400")}>{agent.name}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-center"><TierBadge tier={agent.tier} /></td>
      <td className="px-3 py-2 font-mono text-xs text-center text-muted-foreground">{agent.site}</td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">{agent.totalSales}</td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">{fmt(agent.totalPremium)}</td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">{fmt(agent.profit)}</td>
      <td className="px-3 py-2 text-right"><RoliBadge roli={agent.roli} /></td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">{agent.closeRate.toFixed(1)}%</td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums text-muted-foreground">{agent.daysActive}</td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums text-muted-foreground">{agent.avgDailySales.toFixed(1)}</td>
      <td className="px-3 py-2 text-right"><HealthBadge score={agent.healthScore} /></td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">{agent.pastDue > 0 ? <span className="text-red-400">{agent.pastDue}</span> : <span className="text-muted-foreground/40">0</span>}</td>
      <td className="px-3 py-2 font-mono text-xs text-right tabular-nums">{agent.followUpCompliance.toFixed(0)}%</td>
    </tr>
  );
}

function TeamCard({ team, expanded, onToggle }: { team: TeamSummary; expanded: boolean; onToggle: () => void }) {
  const profitColor = team.totalProfit > 0 ? "text-emerald-400" : "text-red-400";
  const roliTrend = team.teamROLI >= 1.0;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <RankMedal rank={team.rank} />
            {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground truncate">{team.manager}</span>
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                <Users className="h-3 w-3 inline mr-0.5" />{team.agentCount}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">ROLI</div>
              <div className="flex items-center gap-1 justify-end">
                {roliTrend ? <TrendingUp className="h-3 w-3 text-emerald-400" /> : <TrendingDown className="h-3 w-3 text-amber-400" />}
                <RoliBadge roli={team.teamROLI} />
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Health</div>
              <div className="flex items-center gap-1 justify-end">
                <HealthBadge score={team.pipelineAgentCount > 0 ? Math.round(team.avgHealthScore) : null} />
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Premium</div>
              <div className="font-mono text-xs tabular-nums">{fmt(team.totalPremium)}</div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Profit</div>
              <div className={cn("font-mono text-xs tabular-nums", profitColor)}>{fmt(team.totalProfit)}</div>
            </div>
            <div className="text-right hidden md:block">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Sales</div>
              <div className="font-mono text-xs tabular-nums">{team.totalSales}</div>
            </div>
            <div className="text-right hidden md:block">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Past Due</div>
              <div className={cn("font-mono text-xs tabular-nums", team.totalPastDue > 20 ? "text-red-400" : "text-muted-foreground")}>{team.totalPastDue}</div>
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 px-4 py-3 bg-card/50 border-b border-border/50">
            <Stat icon={<DollarSign className="h-3 w-3" />} label="Lead Cost" value={fmt(team.totalLeadCost)} />
            <Stat icon={<Target className="h-3 w-3" />} label="Avg Agent ROLI" value={`${(team.avgAgentROLI * 100).toFixed(0)}%`} />
            <Stat icon={<Award className="h-3 w-3 text-emerald-400" />} label="Top" value={team.topPerformer} />
            <Stat icon={<TrendingDown className="h-3 w-3 text-red-400" />} label="Bottom" value={team.bottomPerformer} />
            <Stat icon={<Activity className="h-3 w-3 text-blue-400" />} label="Pipeline Health" value={team.pipelineAgentCount > 0 ? `${team.avgHealthScore.toFixed(0)}/100` : "—"} />
            <Stat icon={<AlertTriangle className="h-3 w-3 text-amber-400" />} label="Past Due" value={team.totalPastDue.toLocaleString()} />
            <Stat icon={<ShieldCheck className="h-3 w-3 text-emerald-400" />} label="F/U Compliance" value={team.pipelineAgentCount > 0 ? `${team.avgFollowUpCompliance.toFixed(0)}%` : "—"} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Agent</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-center">Tier</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-center">Site</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Sales</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Profit</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">ROLI</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">CR%</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Days</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Avg/Day</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Health</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Past Due</th>
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">F/U%</th>
                </tr>
              </thead>
              <tbody>
                {team.agents.map((agent, i) => (
                  <AgentRow
                    key={agent.name}
                    agent={agent}
                    isTop={i === 0}
                    isBottom={i === team.agents.length - 1 && team.agents.length > 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-xs font-mono text-foreground truncate max-w-[120px]">{value}</div>
      </div>
    </div>
  );
}

export default function TeamLeaderboard() {
  const { teams, loading, windowName, startDate, endDate } = useTeamPerformance();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"roli" | "premium" | "profit" | "sales" | "pipeline">("roli");

  const sorted = useMemo(() => {
    const copy = [...teams];
    switch (sortBy) {
      case "roli": copy.sort((a, b) => b.teamROLI - a.teamROLI); break;
      case "premium": copy.sort((a, b) => b.totalPremium - a.totalPremium); break;
      case "profit": copy.sort((a, b) => b.totalProfit - a.totalProfit); break;
      case "sales": copy.sort((a, b) => b.totalSales - a.totalSales); break;
      case "pipeline": copy.sort((a, b) => b.avgHealthScore - a.avgHealthScore); break;
    }
    copy.forEach((t, i) => { t.rank = i + 1; });
    return copy;
  }, [teams, sortBy]);

  const toggleExpand = (manager: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(manager)) next.delete(manager); else next.add(manager);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(teams.map((t) => t.manager)));
  const collapseAll = () => setExpanded(new Set());

  const totalAgents = teams.reduce((s, t) => s + t.agentCount, 0);
  const totalPremium = teams.reduce((s, t) => s + t.totalPremium, 0);
  const totalProfit = teams.reduce((s, t) => s + t.totalProfit, 0);
  const totalLeadCost = teams.reduce((s, t) => s + t.totalLeadCost, 0);
  const overallROLI = totalLeadCost > 0 ? totalProfit / totalLeadCost : 0;
  const teamsWithPipeline = teams.filter((t) => t.pipelineAgentCount > 0);
  const orgAvgHealth = teamsWithPipeline.length > 0
    ? teamsWithPipeline.reduce((s, t) => s + t.avgHealthScore, 0) / teamsWithPipeline.length
    : 0;
  const orgTotalPastDue = teams.reduce((s, t) => s + t.totalPastDue, 0);
  const orgAvgFUCompliance = teamsWithPipeline.length > 0
    ? teamsWithPipeline.reduce((s, t) => s + t.avgFollowUpCompliance, 0) / teamsWithPipeline.length
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Team Leaderboard</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Manager stack rank by team ROLI — {windowName || "No active window"}
          {startDate && endDate && <span className="text-muted-foreground/60 ml-2">({startDate} to {endDate})</span>}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Teams</div>
          <div className="text-lg font-bold font-mono tabular-nums">{teams.length}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{totalAgents} agents</div>
        </div>
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Org ROLI</div>
          <div className="text-lg font-bold font-mono tabular-nums"><RoliBadge roli={overallROLI} /></div>
          <div className="text-[10px] font-mono text-muted-foreground">All teams combined</div>
        </div>
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Total Premium</div>
          <div className="text-lg font-bold font-mono tabular-nums">{fmt(totalPremium)}</div>
        </div>
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Total Profit</div>
          <div className={cn("text-lg font-bold font-mono tabular-nums", totalProfit > 0 ? "text-emerald-400" : "text-red-400")}>{fmt(totalProfit)}</div>
        </div>
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Lead Investment</div>
          <div className="text-lg font-bold font-mono tabular-nums text-muted-foreground">{fmt(totalLeadCost)}</div>
        </div>
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" />Pipeline Health</div>
          <div className="text-lg font-bold font-mono tabular-nums"><HealthBadge score={teamsWithPipeline.length > 0 ? Math.round(orgAvgHealth) : null} /></div>
          <div className="text-[10px] font-mono text-muted-foreground">Org average</div>
        </div>
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Past Due</div>
          <div className={cn("text-lg font-bold font-mono tabular-nums", orgTotalPastDue > 50 ? "text-red-400" : "text-foreground")}>{orgTotalPastDue.toLocaleString()}</div>
          <div className="text-[10px] font-mono text-muted-foreground">All teams</div>
        </div>
        <div className="bg-card border border-border rounded-md px-3 py-2.5">
          <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3 w-3" />F/U Compliance</div>
          <div className={cn("text-lg font-bold font-mono tabular-nums", orgAvgFUCompliance >= 80 ? "text-emerald-400" : orgAvgFUCompliance >= 50 ? "text-amber-400" : "text-red-400")}>{orgAvgFUCompliance.toFixed(0)}%</div>
          <div className="text-[10px] font-mono text-muted-foreground">Org average</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Rank by:</span>
          {(["roli", "pipeline", "premium", "profit", "sales"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={cn(
                "text-[10px] font-mono px-2 py-1 rounded border transition-colors",
                sortBy === key
                  ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              )}
            >
              {key.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={expandAll} className="text-[10px] font-mono text-blue-400 hover:text-blue-300">Expand All</button>
          <span className="text-muted-foreground/30">|</span>
          <button onClick={collapseAll} className="text-[10px] font-mono text-blue-400 hover:text-blue-300">Collapse All</button>
        </div>
      </div>

      {/* Team cards */}
      {loading ? (
        <div className="border border-dashed border-border rounded-md p-12 flex items-center justify-center bg-card/30">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading team data...</p>
        </div>
      ) : sorted.length > 0 ? (
        <div className="space-y-3">
          {sorted.map((team) => (
            <TeamCard
              key={team.manager}
              team={team}
              expanded={expanded.has(team.manager)}
              onToggle={() => toggleExpand(team.manager)}
            />
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-3 bg-card/30">
          <Users className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-mono text-muted-foreground text-center">
            No team data available. Ensure agents have managers assigned and an active evaluation window exists.
          </p>
        </div>
      )}
    </div>
  );
}
