import { useMemo } from "react";
import { Link } from "wouter";
import { useActionCenter } from "@/hooks/useActionCenter";
import { UNIFIED_CONFIG, UNIFIED_POOL } from "@/lib/unifiedTargets";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/components/MetricCard";
import { RefreshCw } from "lucide-react";
import { getActionLabel } from "@/lib/actionRecommender";

const CFG = UNIFIED_CONFIG;
const POOL = UNIFIED_POOL;

type Status = "pass" | "warn" | "fail";

function status(value: number | null, target: number, direction: "gte" | "lte"): Status {
  if (value === null) return "warn";
  if (direction === "gte") return value >= target ? "pass" : value >= target * 0.8 ? "warn" : "fail";
  return value <= target ? "pass" : value <= target * 1.3 ? "warn" : "fail";
}

const STATUS_STYLE: Record<Status, string> = {
  pass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  warn: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  fail: "text-red-400 bg-red-500/10 border-red-500/20",
};

function StatusDot({ s }: { s: Status }) {
  const color = s === "pass" ? "bg-emerald-400" : s === "warn" ? "bg-amber-400" : "bg-red-400";
  return <span className={cn("inline-block w-2 h-2 rounded-full", color)} />;
}

function GateCell({ value, target, unit, direction = "gte" }: {
  value: number | null;
  target: number;
  unit?: string;
  direction?: "gte" | "lte";
}) {
  const s = status(value, target, direction);
  const display = value !== null ? `${value}${unit || ""}` : "--";
  return (
    <td className={cn("px-3 py-2.5 font-mono text-right tabular-nums text-sm", STATUS_STYLE[s])}>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot s={s} />
        {display}
      </span>
    </td>
  );
}

export default function Scorecard() {
  const { recommendations, summary, loading, refresh } = useActionCenter();

  const agents = useMemo(() => {
    if (!recommendations) return [];
    return [...recommendations].sort((a, b) => {
      const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      const sa = sevOrder[a.severity] ?? 2;
      const sb = sevOrder[b.severity] ?? 2;
      if (sa !== sb) return sa - sb;
      const crA = a.metrics.weeklyCR ?? 999;
      const crB = b.metrics.weeklyCR ?? 999;
      return crA - crB;
    });
  }, [recommendations]);

  const teamCR = useMemo(() => {
    const totalLeads = agents.reduce((s, a) => s + a.metrics.todaysLeads, 0);
    const totalSales = agents.reduce((s, a) => s + a.metrics.todaysSales, 0);
    return totalLeads > 0 ? (totalSales / totalLeads) * 100 : null;
  }, [agents]);

  const passing = agents.filter(a => {
    const cr = a.metrics.weeklyCR ?? 0;
    const pd = a.metrics.pastDue ?? 0;
    const pipe = a.metrics.pipelineSize ?? 0;
    return cr >= CFG.CR_FLOOR && pd === 0 && pipe <= CFG.MAX_PIPELINE;
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold font-mono tracking-tight">AGENT SCORECARD</h1>
          <p className="text-xs font-mono text-muted-foreground mt-0.5">
            {summary?.scrapeDate || "—"} · {agents.length} agents vs floor targets
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded border border-border hover:bg-accent/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          REFRESH
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <MetricCard
          label="Team CR"
          value={teamCR !== null ? `${teamCR.toFixed(1)}%` : "--"}
          color={teamCR !== null && teamCR >= CFG.CR_TARGET ? "green" : teamCR !== null && teamCR >= CFG.CR_FLOOR ? "amber" : "red"}
          subtext={`Floor: ${CFG.CR_FLOOR}% · Target: ${CFG.CR_TARGET}%`}
        />
        <MetricCard
          label="Passing All Gates"
          value={`${passing}/${agents.length}`}
          color={passing === agents.length ? "green" : passing >= agents.length * 0.7 ? "amber" : "red"}
        />
        <MetricCard
          label="Critical"
          value={summary?.critical ?? 0}
          color={(summary?.critical ?? 0) > 0 ? "red" : "default"}
        />
        <MetricCard
          label="Warnings"
          value={summary?.warning ?? 0}
          color={(summary?.warning ?? 0) > 0 ? "amber" : "default"}
        />
        <MetricCard
          label="On Track"
          value={summary?.onTrack ?? 0}
          color="green"
        />
      </div>

      {loading ? (
        <div className="border border-dashed border-border rounded-md p-12 flex items-center justify-center bg-card/30">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading scorecard...</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground w-8">#</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-left">Agent</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right" title={`Floor: ${CFG.CR_FLOOR}% · Target: ${CFG.CR_TARGET}%`}>Week CR</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right" title={`Max: ${CFG.MAX_PIPELINE}`}>Pipeline</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right" title="Target: 0">Past Due</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right" title={`Target: ${POOL.FOLLOWUPS_PER_DAY}/day`}>Pool Assigns</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-right">Today</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground text-left">Next Action</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a, i) => {
                const m = a.metrics;
                const cr = m.weeklyCR !== null ? Math.round(m.weeklyCR * 10) / 10 : null;
                const pipe = m.pipelineSize;
                const pd = m.pastDue ?? 0;
                const poolAssigns = m.poolSelfAssigned ?? 0;
                const label = getActionLabel(a.action);

                return (
                  <tr
                    key={a.name}
                    className={cn(
                      "border-b border-border/50 transition-colors hover:bg-accent/30",
                      i % 2 === 0 ? "bg-transparent" : "bg-card/30"
                    )}
                  >
                    <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums text-xs">{i + 1}</td>
                    <td className="px-3 py-2.5 font-semibold">
                      <Link href={`/agent-profile/${encodeURIComponent(a.name)}`} className="hover:text-blue-400 hover:underline transition-colors">
                        {a.name}
                      </Link>
                    </td>
                    <GateCell value={cr} target={CFG.CR_FLOOR} unit="%" />
                    <GateCell value={pipe} target={CFG.MAX_PIPELINE} direction="lte" />
                    <GateCell value={pd} target={0} direction="lte" />
                    <GateCell value={poolAssigns} target={POOL.FOLLOWUPS_PER_DAY} />
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums text-sm text-muted-foreground">
                      {m.todaysSales > 0 ? (
                        <span className="text-emerald-400">{m.todaysSales}s / {m.todaysLeads}l</span>
                      ) : m.todaysLeads > 0 ? (
                        <span>{m.todaysSales}s / {m.todaysLeads}l</span>
                      ) : (
                        <span className="text-muted-foreground/40">--</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold uppercase",
                        a.severity === "critical" ? "text-red-400 bg-red-500/10 border-red-500/20" :
                        a.severity === "warning" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                        "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                      )}>
                        {label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[10px] font-mono text-muted-foreground/60 space-y-0.5">
        <p>Floor targets: CR {CFG.CR_FLOOR}%+ · Pipeline ≤{CFG.MAX_PIPELINE} · Past due 0 · Pool {POOL.FOLLOWUPS_PER_DAY} assigns/day</p>
        <p>Bonus eligibility: CR {CFG.CR_TARGET}%+ with clean pipeline</p>
      </div>
    </div>
  );
}
