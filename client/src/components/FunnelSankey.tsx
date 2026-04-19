import { useMemo, useState } from "react";
import { ResponsiveContainer, Sankey, Tooltip, Layer, Rectangle } from "recharts";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  ArrowRight, AlertTriangle, Sparkles, TrendingUp, Activity,
} from "lucide-react";
import type { FunnelDecomposition, FunnelLeak } from "@/hooks/useFunnelDecomposition";

/* -----------------------------------------------------------------------------
 * FunnelSankey — Personal Funnel Forensics for one agent over a date range.
 *
 * Renders three things stacked:
 *   1. Headline "biggest leak" callout with weekly $ at stake.
 *   2. Sankey diagram of the actual flow Dials → Contact → Conv|Pres → Sale,
 *      with explicit "lost" sinks at each stage so the leakage is visible.
 *   3. Per-stage diagnosis cards. Each card has a what-if slider that lets a
 *      coach drag the agent's rate up to the floor avg (or beyond) and
 *      instantly see the projected weekly revenue lift.
 * -------------------------------------------------------------------------- */

const fmtMoney = (n: number) => "$" + Math.round(Math.max(0, n)).toLocaleString();
const fmtPct = (n: number) => (n * 100).toFixed(1) + "%";

/** Brand-aligned color per node kind for the Sankey nodes & ribbons. */
const KIND_COLOR: Record<"stage" | "win" | "lost", string> = {
  stage: "#0ea5e9",  // sky-500 — neutral pipeline movement
  win:   "#10b981",  // emerald-500 — sale
  lost:  "#ef4444",  // red-500 — leak
};

/**
 * Recharts Sankey custom node renderer with color-by-kind.
 *
 * Recharts injects all positional + payload props at render time via cloneElement,
 * so this is intentionally a permissive `any`-style signature.
 */
function SankeyNode(props: any) {
  const { x, y, width, height, payload, containerWidth } = props;
  const kind = (payload?.kind as "stage" | "win" | "lost") ?? "stage";
  const color = KIND_COLOR[kind];
  const isOnRight = x + width > containerWidth - 90;
  return (
    <Layer>
      <Rectangle
        x={x} y={y} width={width} height={height}
        fill={color} fillOpacity={0.85}
      />
      <text
        x={isOnRight ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={isOnRight ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={11}
        className="font-mono fill-foreground"
      >
        {payload?.name}
      </text>
    </Layer>
  );
}

/** Recharts Sankey custom link renderer with color-by-kind. */
function SankeyLink(props: any) {
  const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, payload } = props;
  const kind = payload?.kind as "flow" | "win" | "lost" | undefined;
  const color = kind === "win" ? KIND_COLOR.win
              : kind === "lost" ? KIND_COLOR.lost
              : KIND_COLOR.stage;
  const opacity = kind === "lost" ? 0.28 : kind === "win" ? 0.55 : 0.40;
  return (
    <path
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeOpacity={opacity}
      strokeWidth={Math.max(1, linkWidth)}
    />
  );
}

interface LeakCardProps {
  leak: FunnelLeak;
  rank: number; // 1 = biggest leak
  /** Width of the floor "ceiling" used to bound the slider (1.5× floor). */
  ceiling?: number;
}

function LeakCard({ leak, rank, ceiling }: LeakCardProps) {
  const { agentRate, floorRate, weeklyDollarsAtStake, label, blurb, upstreamVolume, windowDays } = leak;
  const sliderCap = Math.max(0.01, ceiling ?? Math.max(floorRate * 1.5, agentRate));
  const [hypotheticalRate, setHypotheticalRate] = useState<number>(Math.max(agentRate, floorRate));

  // Marginal weekly dollars vs the agent's current state at the slider position.
  const liftRate = Math.max(0, hypotheticalRate - agentRate);
  // Approximate downstream multiplier — for the contact/engagement stages we
  // multiply by the leak's own definition (already baked into weeklyDollarsAtStake
  // when the slider is at floorRate). For finer granularity at arbitrary slider
  // positions, scale linearly between agent and floor: at floorRate we equal the
  // computed weeklyDollarsAtStake.
  const baselineLift = Math.max(0, floorRate - agentRate);
  const projectedLift = baselineLift > 0
    ? weeklyDollarsAtStake * (liftRate / baselineLift)
    : 0;

  const gapPp = (floorRate - agentRate) * 100;
  const isAhead = agentRate >= floorRate;

  // Color tier by leak severity
  const severity = rank === 1 ? "critical" : rank === 2 ? "warning" : "info";
  const sevClass = severity === "critical"
    ? "border-red-500/40 bg-red-500/5"
    : severity === "warning"
    ? "border-amber-500/40 bg-amber-500/5"
    : "border-sky-500/30 bg-sky-500/5";

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", isAhead ? "border-emerald-500/30 bg-emerald-500/5" : sevClass)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">#{rank}</span>
            <h4 className="font-mono text-sm font-bold text-foreground">{label}</h4>
            {isAhead && <Sparkles className="h-3 w-3 text-emerald-400" />}
          </div>
          <p className="text-[10px] text-muted-foreground font-mono leading-tight mt-0.5">{blurb}</p>
        </div>
        <div className="text-right shrink-0">
          <div className={cn("font-mono text-base font-bold tabular-nums",
            isAhead ? "text-emerald-400" : "text-foreground")}>
            {fmtPct(agentRate)}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground tabular-nums">
            floor {fmtPct(floorRate)}
          </div>
        </div>
      </div>

      {!isAhead && (
        <div className="flex items-center justify-between text-[11px] font-mono">
          <span className="text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            <span>{gapPp.toFixed(1)}pp below floor</span>
          </span>
          <span className="text-amber-400 font-bold tabular-nums">
            {fmtMoney(weeklyDollarsAtStake)} / wk at stake
          </span>
        </div>
      )}

      {/* What-if slider: drag the rate to see projected weekly lift. */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-muted-foreground">What if rate = {fmtPct(hypotheticalRate)}</span>
          <span className={cn("tabular-nums font-bold",
            projectedLift > 0 ? "text-emerald-400" : "text-muted-foreground")}>
            {projectedLift > 0 ? "+" : ""}{fmtMoney(projectedLift)} / wk
          </span>
        </div>
        <Slider
          value={[hypotheticalRate * 1000]}
          onValueChange={(v) => setHypotheticalRate((v[0] ?? 0) / 1000)}
          min={0}
          max={Math.round(sliderCap * 1000)}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground/70">
          <span>0%</span>
          <span className="text-muted-foreground">
            agent {fmtPct(agentRate)} · floor {fmtPct(floorRate)} · vol {Math.round(upstreamVolume).toLocaleString()} ({windowDays}d)
          </span>
          <span>{fmtPct(sliderCap)}</span>
        </div>
      </div>
    </div>
  );
}

interface FunnelSankeyProps {
  decomposition: FunnelDecomposition;
}

export function FunnelSankey({ decomposition }: FunnelSankeyProps) {
  const { agent, floor, leaks, sankey, hasData, loading, error, windowDays } = decomposition;

  // Rank leaks by weekly $ at stake; the biggest one becomes the headline.
  const rankedLeaks = useMemo(() => {
    return [...leaks].sort((a, b) => b.weeklyDollarsAtStake - a.weeklyDollarsAtStake);
  }, [leaks]);
  const headlineLeak = rankedLeaks[0];

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-6 text-center">
        <Activity className="h-5 w-5 text-muted-foreground mx-auto animate-pulse" />
        <p className="text-xs font-mono text-muted-foreground mt-2">Loading funnel data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-xs font-mono text-red-400">Funnel error: {error}</p>
      </div>
    );
  }

  if (!hasData || agent.dials === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/30 p-6 text-center">
        <p className="text-xs font-mono text-muted-foreground">
          No funnel activity for this agent in the selected window.
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">
          Try widening the date range, or pick a window where the agent took calls.
        </p>
      </div>
    );
  }

  // Aggregate weekly $ at stake across all leaks (sum of below-floor gaps).
  const totalAtStake = leaks.reduce((s, l) => s + l.weeklyDollarsAtStake, 0);

  // For stage-rate comparability, cap each leak slider at 1.5× floor or 1.0,
  // whichever is smaller — so coaches can't overshoot reality.
  const sliderCeil = (l: FunnelLeak) => Math.min(1, Math.max(l.floorRate * 1.5, l.agentRate * 1.2));

  return (
    <div className="space-y-4">
      {/* Headline strip ------------------------------------------------------- */}
      <div className="rounded-lg border border-amber-500/30 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-red-500/5 p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Biggest leak ({windowDays}-day window)
              </div>
              <div className="text-sm font-mono text-foreground font-bold">
                {headlineLeak?.label ?? "—"}
                {headlineLeak && headlineLeak.weeklyDollarsAtStake > 0 && (
                  <span className="text-muted-foreground font-normal">
                    {" "}— closing the gap to floor unlocks{" "}
                    <span className="text-amber-400 font-bold">
                      {fmtMoney(headlineLeak.weeklyDollarsAtStake)} / week
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Total recoverable
            </div>
            <div className="text-base font-mono font-bold text-amber-400 tabular-nums">
              {fmtMoney(totalAtStake)} / week
            </div>
          </div>
        </div>
      </div>

      {/* Sankey --------------------------------------------------------------- */}
      <div className="rounded-lg border border-border bg-card/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Funnel flow
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: KIND_COLOR.stage }} />Stage</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: KIND_COLOR.win }} />Sale</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: KIND_COLOR.lost }} />Lost</span>
          </div>
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sankey}
              nodePadding={20}
              nodeWidth={12}
              margin={{ top: 8, right: 90, bottom: 8, left: 60 }}
              link={<SankeyLink />}
              node={<SankeyNode />}
            >
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
                formatter={(value: number) => [Math.round(value).toLocaleString(), "Volume"]}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>

        {/* Funnel snapshot row */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3 pt-3 border-t border-border/60">
          {[
            { l: "Dials", v: agent.dials },
            { l: "Contact", v: agent.contactsMade, sub: fmtPct(agent.contactRate) },
            { l: "Conv 2-15m", v: agent.conversations },
            { l: "Pres 15m+", v: agent.presentations },
            { l: "Sales", v: agent.sales, sub: fmtMoney(agent.premium) },
            { l: "Avg Premium", v: Math.round(agent.avgPremiumPerSale), prefix: "$" },
          ].map((s) => (
            <div key={s.l} className="text-center">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                {s.l}
              </div>
              <div className="text-sm font-mono font-bold tabular-nums text-foreground">
                {s.prefix ?? ""}{Math.round(s.v).toLocaleString()}
              </div>
              {s.sub && (
                <div className="text-[9px] font-mono text-muted-foreground tabular-nums">{s.sub}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Leak cards ----------------------------------------------------------- */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <ArrowRight className="h-3 w-3" />
            Leak diagnosis · drag a slider to see projected lift
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            Floor avg = average of all active agents in window
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rankedLeaks.map((leak, i) => (
            <LeakCard key={leak.id} leak={leak} rank={i + 1} ceiling={sliderCeil(leak)} />
          ))}
        </div>
        {floor.dials === 0 && (
          <p className="text-[10px] font-mono text-amber-400 mt-2">
            No floor data in window — leak comparisons need at least one other agent's row.
          </p>
        )}
      </div>
    </div>
  );
}
