import { useMemo, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Star, Lightbulb, Activity, ArrowUpRight,
  ChevronRight, Users, Target,
} from "lucide-react";
import {
  QUADRANT_META,
  type CoachingQuadrantData,
  type AgentTrack,
  type QuadrantId,
} from "@/hooks/useCoachingQuadrant";

/* -----------------------------------------------------------------------------
 * CoachingQuadrant — 2D map of every active agent on Skill (close rate) ×
 * Effort (talk minutes/day) with momentum trails so you can SEE direction
 * of travel over the last 30 days.
 *
 * Each agent renders as:
 *   - A faint dot at their T-30 position (where they were a month ago)
 *   - A slightly stronger dot at T-14
 *   - A near-solid dot at T-7
 *   - A bright filled dot at the trailing-7-day position with their name
 *   - A connecting curve from T-30 → T-7 (the "trajectory")
 *
 * Quadrant backdrops are colored by coaching prescription. Floor median lines
 * carve the chart into the four quadrants, computed from this very roster
 * over the trailing 7 days.
 *
 * Side panel ranks the biggest CLIMBERS (improving) and SLIDERS (declining)
 * by a directional momentum score, plus quadrant TRANSITIONS (someone who
 * moved between quadrants this week — those are real coaching events).
 * -------------------------------------------------------------------------- */

const VIEW_W = 760;
const VIEW_H = 480;
const PAD_L = 60;
const PAD_R = 24;
const PAD_T = 32;
const PAD_B = 44;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

const fmtPct = (n: number) => (n * 100).toFixed(1) + "%";
const fmtMin = (n: number) => Math.round(n) + "m";

interface CoachingQuadrantProps {
  data: CoachingQuadrantData;
}

export function CoachingQuadrant({ data }: CoachingQuadrantProps) {
  const { agents, medianCloseRate, medianTalkPerDay, axisMaxX, axisMaxY, loading, error, anchorDate } = data;
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  // SVG-space coordinate transformers — clamp so tracks stay inside the plot.
  const scaleX = (cr: number) => PAD_L + (Math.max(0, Math.min(cr, axisMaxX)) / axisMaxX) * PLOT_W;
  const scaleY = (talk: number) => PAD_T + PLOT_H - (Math.max(0, Math.min(talk, axisMaxY)) / axisMaxY) * PLOT_H;

  // Median dividers in SVG space.
  const medX = scaleX(medianCloseRate);
  const medY = scaleY(medianTalkPerDay);

  // Movers analysis — directional momentum score normalized to axis range.
  const { climbers, sliders, transitions } = useMemo(() => {
    const scored = agents.map((a) => ({
      track: a,
      score: (a.momentum.dx / Math.max(0.001, axisMaxX)) + (a.momentum.dy / Math.max(1, axisMaxY)),
    }));
    const climbers = [...scored].sort((a, b) => b.score - a.score).slice(0, 3).filter((s) => s.score > 0.02);
    const sliders  = [...scored].sort((a, b) => a.score - b.score).slice(0, 3).filter((s) => s.score < -0.02);
    const transitions = agents.filter((a) => a.movedQuadrant);
    return { climbers, sliders, transitions };
  }, [agents, axisMaxX, axisMaxY]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-12 text-center">
        <Activity className="h-6 w-6 text-muted-foreground mx-auto animate-pulse" />
        <p className="text-xs font-mono text-muted-foreground mt-2">Mapping the floor…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-xs font-mono text-red-400">Quadrant error: {error}</p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/30 p-6 text-center">
        <p className="text-xs font-mono text-muted-foreground">
          No active agents had production in the trailing 7 days for {anchorDate}.
        </p>
      </div>
    );
  }

  // Quadrant backdrop rectangles — drawn in SVG space, behind everything.
  const quadrantRects: Array<{ id: QuadrantId; x: number; y: number; w: number; h: number }> = [
    { id: "stars",    x: medX,            y: PAD_T,           w: PAD_L + PLOT_W - medX, h: medY - PAD_T },
    { id: "grinders", x: PAD_L,           y: PAD_T,           w: medX - PAD_L,           h: medY - PAD_T },
    { id: "talents",  x: medX,            y: medY,            w: PAD_L + PLOT_W - medX, h: PAD_T + PLOT_H - medY },
    { id: "atRisk",   x: PAD_L,           y: medY,            w: medX - PAD_L,           h: PAD_T + PLOT_H - medY },
  ];

  return (
    <div className="rounded-lg border border-border bg-gradient-to-br from-card to-card/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Target className="h-3 w-3" />
            Coaching Map · 30-day momentum · anchored at {anchorDate}
          </div>
          <h3 className="text-sm font-mono font-bold text-foreground mt-0.5">
            Where everyone is — and which way they're going
          </h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          {(["stars", "grinders", "talents", "atRisk"] as QuadrantId[]).map((q) => {
            const meta = QUADRANT_META[q];
            return (
              <span key={q} className="flex items-center gap-1 text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: meta.hex }} />
                <span className={meta.textClass}>{meta.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-4 items-start">
        {/* Quadrant chart ----------------------------------------------- */}
        <div className="relative">
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto">
            {/* Quadrant backdrop tints */}
            {quadrantRects.map((r) => (
              <rect key={r.id} x={r.x} y={r.y} width={Math.max(0, r.w)} height={Math.max(0, r.h)}
                fill={QUADRANT_META[r.id].hex} fillOpacity={0.05} />
            ))}

            {/* Quadrant labels in each corner */}
            {quadrantRects.map((r) => {
              const meta = QUADRANT_META[r.id];
              const cx = r.x + r.w / 2;
              const cy = r.y + Math.min(20, r.h / 2);
              if (r.w < 80 || r.h < 30) return null;
              return (
                <text key={`lbl-${r.id}`}
                  x={cx} y={cy + 4}
                  textAnchor="middle"
                  fontSize={11} fontFamily="monospace" fontWeight={700}
                  fill={meta.hex} fillOpacity={0.55}
                  pointerEvents="none">
                  {meta.label.toUpperCase()}
                </text>
              );
            })}

            {/* Median dividers */}
            <line x1={medX} y1={PAD_T} x2={medX} y2={PAD_T + PLOT_H}
                  stroke="rgba(148,163,184,0.35)" strokeWidth={1} strokeDasharray="3 3" />
            <line x1={PAD_L} y1={medY} x2={PAD_L + PLOT_W} y2={medY}
                  stroke="rgba(148,163,184,0.35)" strokeWidth={1} strokeDasharray="3 3" />

            {/* Axes */}
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + PLOT_H} stroke="rgba(148,163,184,0.4)" />
            <line x1={PAD_L} y1={PAD_T + PLOT_H} x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H} stroke="rgba(148,163,184,0.4)" />

            {/* X tick labels (close rate) */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const v = frac * axisMaxX;
              return (
                <g key={`x-${frac}`}>
                  <line x1={scaleX(v)} y1={PAD_T + PLOT_H} x2={scaleX(v)} y2={PAD_T + PLOT_H + 4}
                        stroke="rgba(148,163,184,0.4)" />
                  <text x={scaleX(v)} y={PAD_T + PLOT_H + 16}
                        textAnchor="middle" fontSize={10} fontFamily="monospace"
                        className="fill-muted-foreground">
                    {fmtPct(v)}
                  </text>
                </g>
              );
            })}

            {/* Y tick labels (talk min/day) */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const v = frac * axisMaxY;
              return (
                <g key={`y-${frac}`}>
                  <line x1={PAD_L - 4} y1={scaleY(v)} x2={PAD_L} y2={scaleY(v)}
                        stroke="rgba(148,163,184,0.4)" />
                  <text x={PAD_L - 8} y={scaleY(v) + 3}
                        textAnchor="end" fontSize={10} fontFamily="monospace"
                        className="fill-muted-foreground">
                    {fmtMin(v)}
                  </text>
                </g>
              );
            })}

            {/* Axis labels */}
            <text x={PAD_L + PLOT_W / 2} y={VIEW_H - 6}
                  textAnchor="middle" fontSize={11} fontFamily="monospace" fontWeight={600}
                  className="fill-foreground">
              SKILL → close rate (sales / leads)
            </text>
            <text x={14} y={PAD_T + PLOT_H / 2}
                  textAnchor="middle" fontSize={11} fontFamily="monospace" fontWeight={600}
                  className="fill-foreground"
                  transform={`rotate(-90, 14, ${PAD_T + PLOT_H / 2})`}>
              EFFORT → talk minutes per day
            </text>

            {/* Median value chips */}
            <g pointerEvents="none">
              <rect x={medX + 4} y={PAD_T + 4} rx={3} ry={3} width={86} height={16}
                    fill="rgba(15,23,42,0.85)" stroke="rgba(148,163,184,0.3)" />
              <text x={medX + 47} y={PAD_T + 15} textAnchor="middle" fontSize={9}
                    fontFamily="monospace" className="fill-muted-foreground">
                median CR {fmtPct(medianCloseRate)}
              </text>
              <rect x={PAD_L + PLOT_W - 102} y={medY - 20} rx={3} ry={3} width={98} height={16}
                    fill="rgba(15,23,42,0.85)" stroke="rgba(148,163,184,0.3)" />
              <text x={PAD_L + PLOT_W - 53} y={medY - 9} textAnchor="middle" fontSize={9}
                    fontFamily="monospace" className="fill-muted-foreground">
                median talk {fmtMin(medianTalkPerDay)}
              </text>
            </g>

            {/* Per-agent trails + dots ---------------------------------- */}
            {agents.map((a, i) => {
              const meta = QUADRANT_META[a.quadrant];
              const isHover = hoveredAgent === a.name;
              const dimOthers = hoveredAgent && !isHover;

              const p30 = { x: scaleX(a.windows[30].closeRate), y: scaleY(a.windows[30].talkMinutesPerDay) };
              const p14 = { x: scaleX(a.windows[14].closeRate), y: scaleY(a.windows[14].talkMinutesPerDay) };
              const p7  = { x: scaleX(a.windows[7].closeRate),  y: scaleY(a.windows[7].talkMinutesPerDay) };

              return (
                <g key={a.name} opacity={dimOthers ? 0.18 : 1}
                   style={{ transition: "opacity 150ms" }}
                   onMouseEnter={() => setHoveredAgent(a.name)}
                   onMouseLeave={() => setHoveredAgent(null)}>
                  {/* Trail line T30 → T14 → T7 */}
                  <polyline
                    points={`${p30.x},${p30.y} ${p14.x},${p14.y} ${p7.x},${p7.y}`}
                    fill="none"
                    stroke={meta.hex}
                    strokeOpacity={isHover ? 0.9 : 0.35}
                    strokeWidth={isHover ? 2 : 1.2}
                  />
                  {/* T30 ghost */}
                  <circle cx={p30.x} cy={p30.y} r={3} fill={meta.hex} fillOpacity={0.18} />
                  {/* T14 ghost */}
                  <circle cx={p14.x} cy={p14.y} r={3.5} fill={meta.hex} fillOpacity={0.35} />
                  {/* T7 — main dot */}
                  <motion.circle
                    cx={p7.x} cy={p7.y} r={isHover ? 8 : 6}
                    fill={meta.hex} fillOpacity={0.9}
                    stroke="white" strokeOpacity={0.7}
                    strokeWidth={isHover ? 2 : 1}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: i * 0.02, type: "spring", stiffness: 220, damping: 18 }}
                  />
                  {/* Quadrant transition flag */}
                  {a.movedQuadrant && (
                    <circle cx={p7.x + 8} cy={p7.y - 8} r={3}
                            fill="#fff" stroke={meta.hex} strokeWidth={1} />
                  )}
                  {/* Name label */}
                  <text
                    x={p7.x + 10} y={p7.y + 4}
                    fontSize={isHover ? 12 : 10}
                    fontFamily="monospace"
                    fontWeight={isHover ? 700 : 500}
                    className="fill-foreground"
                    pointerEvents="none">
                    {a.name.split(" ").slice(0, 2).join(" ")}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Hover detail card */}
          {hoveredAgent && (() => {
            const a = agents.find((x) => x.name === hoveredAgent);
            if (!a) return null;
            const meta = QUADRANT_META[a.quadrant];
            const prevMeta = QUADRANT_META[a.prevQuadrant];
            return (
              <div className="absolute top-2 left-2 bg-popover border border-border rounded-md shadow-lg px-3 py-2 font-mono text-[10px] z-10 pointer-events-none">
                <div className="font-bold text-foreground text-xs mb-1">{a.name}</div>
                <div className="flex items-center gap-1 mb-1">
                  <span className={cn("font-bold", meta.textClass)}>{meta.label}</span>
                  {a.movedQuadrant && (
                    <>
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground line-through">{prevMeta.label}</span>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span>CR (7d):</span>  <span className="text-foreground tabular-nums">{fmtPct(a.windows[7].closeRate)}</span>
                  <span>CR (30d):</span> <span className="text-foreground tabular-nums">{fmtPct(a.windows[30].closeRate)}</span>
                  <span>Talk/day (7d):</span>  <span className="text-foreground tabular-nums">{fmtMin(a.windows[7].talkMinutesPerDay)}</span>
                  <span>Talk/day (30d):</span> <span className="text-foreground tabular-nums">{fmtMin(a.windows[30].talkMinutesPerDay)}</span>
                  <span>Sales (7d):</span>  <span className="text-foreground tabular-nums">{a.windows[7].sales}</span>
                  <span>Premium (7d):</span> <span className="text-amber-400 tabular-nums">${Math.round(a.windows[7].premium).toLocaleString()}</span>
                </div>
                <div className="mt-1 pt-1 border-t border-border/60">
                  <span className="text-muted-foreground">Momentum:</span>{" "}
                  <span className={cn("tabular-nums",
                    a.momentum.dx > 0 ? "text-emerald-400" : a.momentum.dx < 0 ? "text-red-400" : "text-muted-foreground")}>
                    {a.momentum.dx >= 0 ? "+" : ""}{(a.momentum.dx * 100).toFixed(1)}pp CR
                  </span>{" "}/{" "}
                  <span className={cn("tabular-nums",
                    a.momentum.dy > 0 ? "text-emerald-400" : a.momentum.dy < 0 ? "text-red-400" : "text-muted-foreground")}>
                    {a.momentum.dy >= 0 ? "+" : ""}{Math.round(a.momentum.dy)}m talk
                  </span>
                </div>
                <div className="text-[9px] mt-1 text-muted-foreground/80">→ click dot to drill in</div>
              </div>
            );
          })()}

          {/* Click overlay layer — separate so the labels above can be pointer-event:none */}
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full h-auto absolute inset-0 pointer-events-none">
            {agents.map((a) => {
              const x = scaleX(a.windows[7].closeRate);
              const y = scaleY(a.windows[7].talkMinutesPerDay);
              return (
                <Link key={a.name} href={`/agent-profile/${encodeURIComponent(a.name)}`}>
                  <a style={{ pointerEvents: "auto" }}>
                    <circle cx={x} cy={y} r={12} fill="transparent"
                            onMouseEnter={() => setHoveredAgent(a.name)}
                            onMouseLeave={() => setHoveredAgent(null)} />
                  </a>
                </Link>
              );
            })}
          </svg>
        </div>

        {/* Side panels: prescriptions + movers + transitions ----------- */}
        <div className="space-y-3">
          {/* Quadrant prescriptions */}
          <div className="rounded-md border border-border/60 bg-card/30 p-2.5 space-y-1.5">
            <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
              <Lightbulb className="h-3 w-3" />
              Coaching prescription by quadrant
            </div>
            {(["stars", "grinders", "talents", "atRisk"] as QuadrantId[]).map((q) => {
              const meta = QUADRANT_META[q];
              const count = agents.filter((a) => a.quadrant === q).length;
              return (
                <div key={q} className={cn("rounded p-1.5 border border-transparent flex items-start gap-1.5", meta.bgClass)}>
                  <span className={cn("text-[10px] font-mono font-bold", meta.textClass)}>
                    {meta.label} ({count})
                  </span>
                  <span className="text-[9px] font-mono text-muted-foreground flex-1">
                    {meta.prescription}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Climbers */}
          <MoverList
            title="Climbers (last 7d)"
            icon={<TrendingUp className="h-3 w-3 text-emerald-400" />}
            tone="emerald"
            entries={climbers.map((c) => ({ track: c.track, score: c.score }))}
            emptyText="No standout climbers this week."
          />

          {/* Sliders */}
          <MoverList
            title="Sliders (last 7d)"
            icon={<TrendingDown className="h-3 w-3 text-red-400" />}
            tone="red"
            entries={sliders.map((s) => ({ track: s.track, score: s.score }))}
            emptyText="No agents sliding meaningfully — clean week."
          />

          {/* Quadrant transitions */}
          {transitions.length > 0 && (
            <div className="rounded-md border border-border/60 bg-card/30 p-2.5 space-y-1.5">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3" />
                Quadrant transitions ({transitions.length})
              </div>
              {transitions.slice(0, 5).map((t) => {
                const fromMeta = QUADRANT_META[t.prevQuadrant];
                const toMeta = QUADRANT_META[t.quadrant];
                const isUpgrade = upgradeRank(t.quadrant) > upgradeRank(t.prevQuadrant);
                return (
                  <Link key={t.name} href={`/agent-profile/${encodeURIComponent(t.name)}`}>
                    <a className="flex items-center gap-1.5 text-[10px] font-mono hover:bg-accent rounded px-1 py-0.5">
                      <span className="text-foreground flex-1 truncate">{t.name}</span>
                      <span className={fromMeta.textClass}>{fromMeta.label}</span>
                      <ChevronRight className={cn("h-3 w-3", isUpgrade ? "text-emerald-400" : "text-red-400")} />
                      <span className={toMeta.textClass}>{toMeta.label}</span>
                    </a>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="text-[9px] font-mono text-muted-foreground italic px-1 leading-snug">
            Trail = where each agent was 30/14/7 days ago, ending at their bright dot today.
            Floor medians are computed from this very roster, so quadrants describe relative performance.
          </div>
        </div>
      </div>

      {/* Tally strip at the bottom: ratio of stars to at-risk */}
      <div className="flex items-center gap-3 pt-2 border-t border-border/60 text-[10px] font-mono">
        <Users className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">Floor mix:</span>
        {(["stars", "grinders", "talents", "atRisk"] as QuadrantId[]).map((q) => {
          const meta = QUADRANT_META[q];
          const count = agents.filter((a) => a.quadrant === q).length;
          return (
            <span key={q} className={cn("flex items-center gap-1", meta.textClass)}>
              {q === "stars" && <Star className="h-2.5 w-2.5" />}
              {meta.label}: <span className="tabular-nums font-bold">{count}</span>
            </span>
          );
        })}
        <span className="text-muted-foreground ml-auto">
          {agents.length} agents · trailing 7d / 30d
        </span>
      </div>
    </div>
  );
}

/** Higher = "better" quadrant for the upgrade/downgrade arrow color. */
function upgradeRank(q: QuadrantId): number {
  return q === "stars" ? 4 : q === "grinders" ? 3 : q === "talents" ? 2 : 1;
}

interface MoverListProps {
  title: string;
  icon: React.ReactNode;
  tone: "emerald" | "red";
  entries: Array<{ track: AgentTrack; score: number }>;
  emptyText: string;
}

function MoverList({ title, icon, tone, entries, emptyText }: MoverListProps) {
  const borderClass = tone === "emerald" ? "border-emerald-500/20" : "border-red-500/20";
  const bgClass     = tone === "emerald" ? "bg-emerald-500/5" : "bg-red-500/5";
  const valueClass  = tone === "emerald" ? "text-emerald-400" : "text-red-400";

  return (
    <div className={cn("rounded-md border p-2.5 space-y-1.5", borderClass, bgClass)}>
      <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
        {icon} {title}
      </div>
      {entries.length === 0 ? (
        <div className="text-[10px] font-mono text-muted-foreground italic">{emptyText}</div>
      ) : entries.map((e) => {
        const dx = e.track.momentum.dx * 100;
        const dy = e.track.momentum.dy;
        return (
          <Link key={e.track.name} href={`/agent-profile/${encodeURIComponent(e.track.name)}`}>
            <a className="flex items-center gap-2 text-[10px] font-mono hover:bg-accent rounded px-1 py-0.5">
              <span className="text-foreground flex-1 truncate">{e.track.name}</span>
              <span className={cn("tabular-nums", valueClass)}>
                {dx >= 0 ? "+" : ""}{dx.toFixed(1)}pp
              </span>
              <span className="text-muted-foreground tabular-nums">/</span>
              <span className={cn("tabular-nums", valueClass)}>
                {dy >= 0 ? "+" : ""}{Math.round(dy)}m
              </span>
            </a>
          </Link>
        );
      })}
    </div>
  );
}
