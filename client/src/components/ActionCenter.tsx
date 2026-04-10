import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/components/MetricCard";
import { AgentDrillDown } from "@/components/AgentDrillDown";
import {
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Crosshair,
} from "lucide-react";
import {
  getActionLabel,
  getActionColor,
  getSeverityColor,
  type AgentRecommendation,
  type ActionSeverity,
  type ActionType,
} from "@/lib/actionRecommender";
import { useActionCenter } from "@/hooks/useActionCenter";

type SortDir = "asc" | "desc";
interface SortState {
  key: string;
  dir: SortDir;
}

function SortHeader({
  label,
  sortKey,
  current,
  onToggle,
  align = "right",
}: {
  label: string;
  sortKey: string;
  current: SortState;
  onToggle: (k: string) => void;
  align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors",
        align === "right" && "text-right",
      )}
      onClick={() => onToggle(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          current.dir === "desc" ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

function ActionBadge({ action }: { action: ActionType }) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded text-[10px] font-mono font-bold border whitespace-nowrap",
        getActionColor(action),
      )}
    >
      {getActionLabel(action)}
    </span>
  );
}

function SeverityDot({ severity }: { severity: ActionSeverity }) {
  const color =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warning"
        ? "bg-amber-500"
        : "bg-emerald-500";
  return <span className={cn("inline-block w-2 h-2 rounded-full", color)} />;
}

function TierBadge({ tier }: { tier: string }) {
  const color =
    tier === "T1"
      ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
      : tier === "T2"
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
        : "bg-amber-500/10 text-amber-400 border-amber-500/30";
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold border",
        color,
      )}
    >
      {tier}
    </span>
  );
}

interface ActionCenterProps {
  overrideDate?: string;
}

export function ActionCenter({ overrideDate }: ActionCenterProps) {
  const {
    recommendations,
    criticalAgents,
    warningAgents,
    onTrackAgents,
    summary,
    loading,
    lastRefresh,
    refresh,
  } = useActionCenter(overrideDate);

  const [sort, setSort] = useState<SortState>({ key: "severity", dir: "asc" });
  const [tierFilter, setTierFilter] = useState("ALL");
  const [siteFilter, setSiteFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [drillAgent, setDrillAgent] = useState<{
    name: string;
    tier: string;
    site: string;
  } | null>(null);

  const toggle = useCallback((key: string) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
  }, []);

  const allSites = useMemo(() => {
    const sites = new Set<string>();
    for (const r of recommendations) sites.add(r.site);
    return Array.from(sites).sort();
  }, [recommendations]);

  const allActions = useMemo(() => {
    const actions = new Set<ActionType>();
    for (const r of recommendations) actions.add(r.action);
    return Array.from(actions);
  }, [recommendations]);

  const filtered = useMemo(() => {
    let agents = [...recommendations];
    if (tierFilter !== "ALL") agents = agents.filter((a) => a.tier === tierFilter);
    if (siteFilter !== "ALL") agents = agents.filter((a) => a.site === siteFilter);
    if (actionFilter !== "ALL") agents = agents.filter((a) => a.action === actionFilter);
    return agents;
  }, [recommendations, tierFilter, siteFilter, actionFilter]);

  const sorted = useMemo(() => {
    const severityRank: Record<ActionSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return [...filtered].sort((a, b) => {
      if (sort.key === "severity") {
        const diff = severityRank[a.severity] - severityRank[b.severity];
        return sort.dir === "asc" ? diff : -diff;
      }
      if (sort.key === "name") {
        return sort.dir === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      if (sort.key === "weeklyCR") {
        const av = a.metrics.weeklyCR ?? -1;
        const bv = b.metrics.weeklyCR ?? -1;
        return sort.dir === "desc" ? bv - av : av - bv;
      }
      if (sort.key === "pastDue") {
        const av = a.metrics.pastDue ?? -1;
        const bv = b.metrics.pastDue ?? -1;
        return sort.dir === "desc" ? bv - av : av - bv;
      }
      if (sort.key === "pipelineSize") {
        const av = a.metrics.pipelineSize ?? -1;
        const bv = b.metrics.pipelineSize ?? -1;
        return sort.dir === "desc" ? bv - av : av - bv;
      }
      if (sort.key === "poolDials") {
        return sort.dir === "desc"
          ? b.metrics.poolDials - a.metrics.poolDials
          : a.metrics.poolDials - b.metrics.poolDials;
      }
      if (sort.key === "todaysDials") {
        return sort.dir === "desc"
          ? b.metrics.todaysDials - a.metrics.todaysDials
          : a.metrics.todaysDials - b.metrics.todaysDials;
      }
      return 0;
    });
  }, [filtered, sort]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm font-mono text-muted-foreground animate-pulse">
          Loading action center...
        </p>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Crosshair className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-mono text-muted-foreground">
          No agent data available for recommendations
        </p>
        <p className="text-xs font-mono text-muted-foreground/60">
          Ensure the production and pipeline scrapers have run today
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Need Attention"
          value={summary.critical}
          subtext="Critical — immediate action required"
          color="red"
          tooltip="Agents with past due > 3, overloaded pipelines, or sustained low close rates that require immediate manager intervention."
        />
        <MetricCard
          label="Warnings"
          value={summary.warning}
          subtext="Needs monitoring or adjustment"
          color="amber"
          tooltip="Agents with minor pipeline issues, low close rate trends, or missing pool activity that should be addressed during the day."
        />
        <MetricCard
          label="On Track"
          value={summary.onTrack}
          subtext="Meeting expectations"
          color="green"
          tooltip="Agents whose weekly close rate, pipeline health, and activity are within acceptable ranges."
        />
        <MetricCard
          label="Agents Tracked"
          value={summary.totalAgents}
          subtext={`Last refresh: ${lastRefresh.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
          color="default"
        />
      </div>

      {/* Critical alerts panel */}
      {criticalAgents.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-red-400">
              Needs Immediate Attention ({criticalAgents.length})
            </span>
          </div>
          <div className="space-y-2">
            {criticalAgents.map((a) => (
              <div
                key={a.name}
                className="flex items-start gap-3 bg-card/50 border border-border/50 rounded p-3"
              >
                <SeverityDot severity="critical" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ActionBadge action={a.action} />
                    <Link
                      href={`/agent-profile/${encodeURIComponent(a.name)}`}
                      className="text-sm font-mono font-medium text-foreground hover:text-blue-400 transition-colors"
                    >
                      {a.name}
                    </Link>
                    <TierBadge tier={a.tier} />
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {a.site}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-muted-foreground">
                    {a.metrics.weeklyCR !== null && (
                      <span>Weekly CR: {a.metrics.weeklyCR.toFixed(0)}%</span>
                    )}
                    {a.metrics.pastDue !== null && (
                      <span>Past Due: {a.metrics.pastDue}</span>
                    )}
                    {a.tier === "T3" && a.metrics.callQueue !== null ? (
                      <span>Queue: {a.metrics.callQueue}</span>
                    ) : (
                      a.metrics.pipelineSize !== null && (
                        <span>Pipeline: {a.metrics.pipelineSize}</span>
                      )
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground/80 mt-1 italic">
                    {a.reason}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setDrillAgent({ name: a.name, tier: a.tier, site: a.site })
                  }
                  className="text-muted-foreground/40 hover:text-blue-400 transition-colors shrink-0"
                  title="Quick view"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warning highlights */}
      {warningAgents.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400">
              Warnings ({warningAgents.length})
            </span>
          </div>
          <div className="space-y-2">
            {warningAgents.slice(0, 8).map((a) => (
              <div
                key={a.name}
                className="flex items-start gap-3 bg-card/50 border border-border/50 rounded p-3"
              >
                <SeverityDot severity="warning" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <ActionBadge action={a.action} />
                    <Link
                      href={`/agent-profile/${encodeURIComponent(a.name)}`}
                      className="text-sm font-mono font-medium text-foreground hover:text-blue-400 transition-colors"
                    >
                      {a.name}
                    </Link>
                    <TierBadge tier={a.tier} />
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {a.site}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground/80 mt-1 italic">
                    {a.reason}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setDrillAgent({ name: a.name, tier: a.tier, site: a.site })
                  }
                  className="text-muted-foreground/40 hover:text-blue-400 transition-colors shrink-0"
                  title="Quick view"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            ))}
            {warningAgents.length > 8 && (
              <p className="text-[10px] font-mono text-muted-foreground/50 pl-5">
                ...and {warningAgents.length - 8} more warnings
              </p>
            )}
          </div>
        </div>
      )}

      {/* On Track summary */}
      {onTrackAgents.length > 0 && criticalAgents.length === 0 && warningAgents.length === 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              All {onTrackAgents.length} agents on track
            </span>
          </div>
        </div>
      )}

      {/* Filters + refresh */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            Tier:
          </span>
          {["ALL", "T1", "T2", "T3"].map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors",
                tierFilter === t
                  ? "bg-blue-500/20 text-blue-400 border-blue-500/40"
                  : "bg-card text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {allSites.length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
              Site:
            </span>
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="text-[10px] font-mono bg-card border border-border rounded px-2 py-1 text-foreground"
            >
              <option value="ALL">All Sites</option>
              {allSites.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
            Action:
          </span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="text-[10px] font-mono bg-card border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="ALL">All Actions</option>
            {allActions.map((a) => (
              <option key={a} value={a}>
                {getActionLabel(a)} (
                {recommendations.filter((r) => r.action === a).length})
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={refresh}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-card border border-border text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh data"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>

        <span className="text-[10px] font-mono text-muted-foreground">
          {sorted.length} of {recommendations.length} agents
        </span>
      </div>

      {/* Full agent table */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-[12px] font-mono">
          <thead className="bg-card sticky top-0 z-10">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-6" />
              <SortHeader
                label="Agent"
                sortKey="name"
                current={sort}
                onToggle={toggle}
                align="left"
              />
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Tier
              </th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-left">
                Action
              </th>
              <SortHeader
                label="Severity"
                sortKey="severity"
                current={sort}
                onToggle={toggle}
              />
              <SortHeader
                label="Weekly CR"
                sortKey="weeklyCR"
                current={sort}
                onToggle={toggle}
              />
              <SortHeader
                label="Past Due"
                sortKey="pastDue"
                current={sort}
                onToggle={toggle}
              />
              <SortHeader
                label="Pipeline"
                sortKey="pipelineSize"
                current={sort}
                onToggle={toggle}
              />
              <SortHeader
                label="Pool Dials"
                sortKey="poolDials"
                current={sort}
                onToggle={toggle}
              />
              <SortHeader
                label="Today Dials"
                sortKey="todaysDials"
                current={sort}
                onToggle={toggle}
              />
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-left">
                Recommendation
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent) => (
              <tr
                key={agent.name}
                className={cn(
                  "border-b border-border/30 hover:bg-card/60 transition-colors",
                  agent.severity === "critical" && "bg-red-500/[0.03]",
                  agent.severity === "warning" && "bg-amber-500/[0.03]",
                )}
              >
                <td className="px-2 py-2 text-center">
                  <SeverityDot severity={agent.severity} />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/agent-profile/${encodeURIComponent(agent.name)}`}
                    className="text-sm font-mono font-medium text-foreground hover:text-blue-400 transition-colors"
                  >
                    {agent.name}
                  </Link>
                  <button
                    onClick={() =>
                      setDrillAgent({
                        name: agent.name,
                        tier: agent.tier,
                        site: agent.site,
                      })
                    }
                    className="ml-1 text-muted-foreground/40 hover:text-blue-400 transition-colors print:hidden"
                    title="Quick view"
                  >
                    <Eye className="h-3 w-3 inline" />
                  </button>
                </td>
                <td className="px-3 py-2">
                  <TierBadge tier={agent.tier} />
                </td>
                <td className="px-3 py-2">
                  <ActionBadge action={agent.action} />
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={cn(
                      "text-[10px] font-mono font-bold uppercase",
                      getSeverityColor(agent.severity),
                    )}
                  >
                    {agent.severity}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {agent.metrics.weeklyCR !== null
                    ? `${agent.metrics.weeklyCR.toFixed(0)}%`
                    : "--"}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    (agent.metrics.pastDue ?? 0) > 0 && "text-red-400 font-bold",
                  )}
                >
                  {agent.metrics.pastDue ?? "--"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {agent.metrics.pipelineSize ?? "--"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {agent.metrics.poolDials || "--"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {agent.metrics.todaysDials || "--"}
                </td>
                <td className="px-3 py-2 text-left">
                  <span className="text-[10px] text-muted-foreground/80 italic line-clamp-2">
                    {agent.reason}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
