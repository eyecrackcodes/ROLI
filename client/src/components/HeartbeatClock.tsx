import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Activity, Sparkles, Sunrise, Sunset, Clock, Flame, Coffee, TrendingUp, TrendingDown,
} from "lucide-react";
import {
  HEARTBEAT_HOURS,
  type HeartbeatData,
  type HeartbeatHourCell,
} from "@/hooks/useIntradayHeartbeat";

/* -----------------------------------------------------------------------------
 * HeartbeatClock — polar SVG visualization of one workday's intraday rhythm.
 *
 * Three concentric data layers (outermost → innermost):
 *   1. Dial Heat Ring   — wedge fill intensity = dials per hour (slate→red).
 *   2. Sales Glow Ring  — wedge fill opacity   = sales per hour (gold pulse).
 *   3. Pace Sweep Arc   — single arc whose length = cumulative dials %, color
 *                         tinted by gap to UNIFIED_PACE_CURVE expectation.
 *
 * Center scoreboard shows totals + pace verdict + first-sale hour.
 * Hovering a wedge pops a small data card. Hottest sale hour pulses.
 *
 * All numbers come from `intraday_snapshots` deltas — pure CRM ground truth.
 * -------------------------------------------------------------------------- */

const VIEW = 600;
const CX = VIEW / 2;
const CY = VIEW / 2;

// Concentric ring radii.
const R_TICKS_OUTER = 286;   // hour labels live here
const R_DIAL_OUTER  = 270;
const R_DIAL_INNER  = 210;
const R_SALES_OUTER = 200;
const R_SALES_INNER = 150;
const R_PACE_OUTER  = 138;
const R_PACE_INNER  = 122;
const R_CENTER      = 110;   // background disc behind scoreboard

// 9 wedges, each occupying 40° of the 360° face. Tiny visual gap = 2°.
const WEDGES = HEARTBEAT_HOURS.length; // 9
const WEDGE_SPAN = 360 / WEDGES;       // 40°
const WEDGE_GAP = 2;                   // pixels of angular padding per side

const fmtHour = (h: number) => {
  if (h === 12) return "12p";
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
};
const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString();

/** Convert "hours past 9am" into SVG-space degrees, where 0° points east and we
 *  start at 12 o'clock (north = -90°) going clockwise. */
function hourToAngle(hour: number, offset = 0): number {
  return -90 + (hour - HEARTBEAT_HOURS[0]) * WEDGE_SPAN + offset;
}

/** Polar → cartesian for SVG (Y axis points down). */
function polar(r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** Annular sector (donut wedge) SVG path. Angles in degrees. */
function annularSectorPath(r1: number, r2: number, startDeg: number, endDeg: number): string {
  const [p1x, p1y] = polar(r2, startDeg);
  const [p2x, p2y] = polar(r2, endDeg);
  const [p3x, p3y] = polar(r1, endDeg);
  const [p4x, p4y] = polar(r1, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M${p1x},${p1y} A${r2},${r2} 0 ${largeArc} 1 ${p2x},${p2y} L${p3x},${p3y} A${r1},${r1} 0 ${largeArc} 0 ${p4x},${p4y} Z`;
}

/** Plain arc (single line, no fill). */
function arcPath(r: number, startDeg: number, endDeg: number): string {
  const [p1x, p1y] = polar(r, startDeg);
  const [p2x, p2y] = polar(r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M${p1x},${p1y} A${r},${r} 0 ${largeArc} 1 ${p2x},${p2y}`;
}

/** Map dial intensity 0..1 → HSL heat color (slate-blue → amber → red). */
function heatColor(intensity: number): string {
  // Hue: 220 (cold blue) → 0 (red), Saturation rises with intensity.
  const t = Math.max(0, Math.min(1, intensity));
  const hue = 220 - t * 220; // 220→0
  const sat = 30 + t * 60;   // 30→90
  const light = 35 + t * 15; // 35→50
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

interface HoverInfo { cell: HeartbeatHourCell; x: number; y: number }

interface HeartbeatClockProps {
  data: HeartbeatData;
  /** Optional title override. */
  title?: string;
}

export function HeartbeatClock({ data, title }: HeartbeatClockProps) {
  const { cells, summary, scope, scrapeDate, isAggregate, loading, error } = data;
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Normalize dial volumes for heat coloring — peak hour saturates red.
  const peakDials = useMemo(() => Math.max(1, ...cells.map((c) => c.dials)), [cells]);
  const peakSales = useMemo(() => Math.max(1, ...cells.map((c) => c.sales)), [cells]);

  // Where the pace sweep currently ends — last hour with any data.
  const lastDataIdx = useMemo(() => {
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i].hasData) return i;
    return -1;
  }, [cells]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card/50 p-12 text-center">
        <Activity className="h-6 w-6 text-muted-foreground mx-auto animate-pulse" />
        <p className="text-xs font-mono text-muted-foreground mt-2">Reading the floor's pulse…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <p className="text-xs font-mono text-red-400">Heartbeat error: {error}</p>
      </div>
    );
  }

  const hasAnyData = lastDataIdx >= 0;

  // Tints used in the center scoreboard.
  const verdictTint = summary.paceVerdict === "ahead"
    ? "text-emerald-400"
    : summary.paceVerdict === "behind"
    ? "text-red-400"
    : summary.paceVerdict === "on_pace"
    ? "text-sky-400"
    : "text-muted-foreground";
  const verdictLabel = summary.paceVerdict === "ahead"   ? "AHEAD OF PACE"
                    : summary.paceVerdict === "behind"  ? "BEHIND PACE"
                    : summary.paceVerdict === "on_pace" ? "ON PACE"
                    : "NO DATA YET";
  const VerdictIcon = summary.paceVerdict === "behind" ? TrendingDown
                    : summary.paceVerdict === "ahead"  ? TrendingUp
                    : Clock;

  // Pace sweep color follows verdict.
  const paceColor = summary.paceVerdict === "ahead"   ? "#10b981"
                  : summary.paceVerdict === "behind"  ? "#ef4444"
                  : summary.paceVerdict === "on_pace" ? "#0ea5e9"
                  : "#475569";

  return (
    <div className="rounded-lg border border-border bg-gradient-to-b from-card to-card/40 p-4 space-y-3">
      {/* Header --------------------------------------------------------------- */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Intraday Heartbeat · {scrapeDate}
          </div>
          <h3 className="text-sm font-mono font-bold text-foreground mt-0.5">
            {title ?? scope}{" "}
            {isAggregate && summary.agentCount > 0 && (
              <span className="text-muted-foreground font-normal">
                · {summary.agentCount} agents
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: heatColor(0.85) }} />
            Dial heat
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <Sparkles className="h-3 w-3 text-amber-400" />
            Sale glow
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="inline-block w-3 h-[2px]" style={{ borderTop: "1px dashed currentColor" }} />
            Expected
          </span>
        </div>
      </div>

      {/* Clock ---------------------------------------------------------------- */}
      <div className="grid md:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="relative">
          <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-auto max-h-[520px]">
            <defs>
              <radialGradient id="heartbeat-center" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="hsl(220 30% 12%)" />
                <stop offset="100%" stopColor="hsl(220 30% 7%)" />
              </radialGradient>
              <radialGradient id="heartbeat-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(245, 158, 11, 0.55)" />
                <stop offset="100%" stopColor="rgba(245, 158, 11, 0)" />
              </radialGradient>
            </defs>

            {/* Background concentric guides */}
            <circle cx={CX} cy={CY} r={R_DIAL_OUTER} fill="none" stroke="rgba(148,163,184,0.10)" />
            <circle cx={CX} cy={CY} r={R_DIAL_INNER} fill="none" stroke="rgba(148,163,184,0.10)" />
            <circle cx={CX} cy={CY} r={R_SALES_INNER} fill="none" stroke="rgba(148,163,184,0.10)" />

            {/* Hour wedges --------------------------------------------------- */}
            {cells.map((cell, i) => {
              const startA = hourToAngle(cell.hour, WEDGE_GAP);
              const endA   = hourToAngle(cell.hour, WEDGE_SPAN - WEDGE_GAP);
              const dialIntensity = cell.dials / peakDials;
              const saleIntensity = cell.sales / peakSales;
              const isHottestSale = cell.sales > 0 && i === cells.indexOf(cells.find((c) => c.sales === peakSales)!);
              const isCurrent = i === lastDataIdx;

              return (
                <g key={cell.hour}>
                  {/* Dial heat wedge */}
                  <motion.path
                    d={annularSectorPath(R_DIAL_INNER, R_DIAL_OUTER, startA, endA)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: cell.hasData ? 1 : 0.18 }}
                    transition={{ delay: i * 0.06, duration: 0.4 }}
                    fill={cell.hasData ? heatColor(dialIntensity) : "rgba(71,85,105,0.25)"}
                    stroke={isCurrent ? "rgba(255,255,255,0.5)" : "transparent"}
                    strokeWidth={1.5}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget.ownerSVGElement?.getBoundingClientRect());
                      const cur = (e as unknown as React.MouseEvent).currentTarget as SVGPathElement;
                      const bbox = cur.getBoundingClientRect();
                      const x = bbox.left + bbox.width / 2 - (rect?.left ?? 0);
                      const y = bbox.top - (rect?.top ?? 0);
                      setHover({ cell, x, y });
                    }}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: "pointer" }}
                  />

                  {/* Sales glow wedge — pulses on the hottest sale hour */}
                  <motion.path
                    d={annularSectorPath(R_SALES_INNER, R_SALES_OUTER, startA, endA)}
                    initial={{ opacity: 0 }}
                    animate={isHottestSale
                      ? { opacity: [0.4 + saleIntensity * 0.6, 0.85, 0.4 + saleIntensity * 0.6] }
                      : { opacity: cell.sales > 0 ? 0.25 + saleIntensity * 0.6 : 0.05 }}
                    transition={isHottestSale
                      ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
                      : { delay: i * 0.06 + 0.2, duration: 0.5 }}
                    fill={cell.sales > 0 ? "#f59e0b" : "rgba(71,85,105,0.4)"}
                    pointerEvents="none"
                  />
                </g>
              );
            })}

            {/* Expected-pace dashed reference circle */}
            <circle
              cx={CX} cy={CY} r={(R_PACE_OUTER + R_PACE_INNER) / 2}
              fill="none" stroke="rgba(148,163,184,0.6)"
              strokeWidth={1} strokeDasharray="4 4"
              pointerEvents="none"
            />

            {/* Pace sweep arc — shows agent's actual cumulative dial coverage,
                colored by verdict so an "ahead" arc visibly leans green. */}
            {hasAnyData && (
              <motion.path
                d={arcPath(
                  (R_PACE_OUTER + R_PACE_INNER) / 2,
                  hourToAngle(HEARTBEAT_HOURS[0], 0),
                  hourToAngle(HEARTBEAT_HOURS[lastDataIdx], WEDGE_SPAN),
                )}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                fill="none" stroke={paceColor} strokeWidth={6}
                strokeLinecap="round"
                pointerEvents="none"
              />
            )}

            {/* Per-hour expected ticks (small dashes outside the dial ring) */}
            {HEARTBEAT_HOURS.map((h) => {
              const angle = hourToAngle(h, WEDGE_SPAN / 2);
              const [x1, y1] = polar(R_DIAL_OUTER + 8, angle);
              const [x2, y2] = polar(R_DIAL_OUTER + 14, angle);
              const [tx, ty] = polar(R_TICKS_OUTER + 6, angle);
              return (
                <g key={`tick-${h}`} pointerEvents="none">
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(148,163,184,0.6)" strokeWidth={1.5} />
                  <text
                    x={tx} y={ty}
                    fontSize={12} fontFamily="monospace"
                    textAnchor="middle" dominantBaseline="middle"
                    className="fill-muted-foreground"
                  >
                    {fmtHour(h)}
                  </text>
                </g>
              );
            })}

            {/* Center disc + glow + scoreboard ------------------------------ */}
            <circle cx={CX} cy={CY} r={R_CENTER} fill="url(#heartbeat-center)" />
            {summary.totalSales > 0 && (
              <circle cx={CX} cy={CY} r={R_CENTER + 18} fill="url(#heartbeat-glow)" pointerEvents="none" />
            )}

            {/* Scoreboard text — kept fully inside the disc */}
            <text x={CX} y={CY - 38} fontSize={11} fontFamily="monospace"
                  textAnchor="middle" className="fill-muted-foreground"
                  style={{ letterSpacing: "0.18em" }}>
              {isAggregate ? "FLOOR" : "AGENT"}
            </text>
            <text x={CX} y={CY - 8} fontSize={36} fontWeight={700} fontFamily="monospace"
                  textAnchor="middle" className="fill-foreground">
              {summary.totalSales}
            </text>
            <text x={CX} y={CY + 12} fontSize={11} fontFamily="monospace"
                  textAnchor="middle" className="fill-muted-foreground">
              SALES
            </text>
            <text x={CX} y={CY + 32} fontSize={13} fontFamily="monospace" fontWeight={600}
                  textAnchor="middle" className="fill-amber-400">
              {fmtMoney(summary.totalPremium)}
            </text>
            <text x={CX} y={CY + 50} fontSize={10} fontFamily="monospace"
                  textAnchor="middle" className="fill-muted-foreground">
              {summary.totalDials.toLocaleString()} dials
            </text>
          </svg>

          {/* Hover tooltip ----------------------------------------------- */}
          {hover && (
            <div
              className="absolute pointer-events-none bg-popover border border-border rounded-md shadow-lg px-2.5 py-1.5 font-mono text-[10px] z-10"
              style={{
                left: `${(hover.x / VIEW) * 100}%`,
                top: `${(hover.y / VIEW) * 100}%`,
                transform: "translate(-50%, -110%)",
              }}
            >
              <div className="font-bold text-foreground">{fmtHour(hover.cell.hour)}</div>
              <div className="text-muted-foreground">Dials: <span className="text-foreground tabular-nums">{hover.cell.dials}</span></div>
              <div className="text-muted-foreground">Talk: <span className="text-foreground tabular-nums">{Math.round(hover.cell.talkMinutes)}m</span></div>
              <div className="text-muted-foreground">Sales: <span className="text-amber-400 tabular-nums">{hover.cell.sales}</span></div>
              {hover.cell.premium > 0 && (
                <div className="text-muted-foreground">Premium: <span className="text-amber-400 tabular-nums">{fmtMoney(hover.cell.premium)}</span></div>
              )}
              <div className="text-muted-foreground">Pool dials: <span className="text-foreground tabular-nums">{hover.cell.poolDials}</span></div>
              <div className="text-muted-foreground border-t border-border mt-1 pt-1">
                Pace gap:{" "}
                <span className={cn("tabular-nums",
                  hover.cell.paceGap > 0.05 ? "text-emerald-400"
                  : hover.cell.paceGap < -0.10 ? "text-red-400"
                  : "text-sky-400")}>
                  {(hover.cell.paceGap * 100 >= 0 ? "+" : "")}{(hover.cell.paceGap * 100).toFixed(1)}pp
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Side panel: insights ----------------------------------------- */}
        <div className="space-y-2">
          <div className={cn("rounded-md border p-3 flex items-center gap-3",
            summary.paceVerdict === "behind" ? "border-red-500/30 bg-red-500/5"
            : summary.paceVerdict === "ahead" ? "border-emerald-500/30 bg-emerald-500/5"
            : summary.paceVerdict === "on_pace" ? "border-sky-500/30 bg-sky-500/5"
            : "border-border bg-card/30")}>
            <VerdictIcon className={cn("h-5 w-5", verdictTint)} />
            <div className="flex-1">
              <div className={cn("text-xs font-mono font-bold", verdictTint)}>{verdictLabel}</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                Cumulative dials {summary.paceVsCurve >= 0 ? "+" : ""}{(summary.paceVsCurve * 100).toFixed(1)}pp vs curve
              </div>
            </div>
          </div>

          <Insight icon={<Sunrise className="h-3.5 w-3.5 text-amber-400" />}
            label="First sale" value={Number.isNaN(summary.firstSaleHour)
              ? "—" : `${fmtHour(summary.firstSaleHour)}`}
            sub={Number.isNaN(summary.firstSaleHour)
              ? "no sales yet today"
              : summary.firstSaleHour <= 10 ? "fast starter" : summary.firstSaleHour >= 14 ? "late starter" : "typical start"} />

          <Insight icon={<Flame className="h-3.5 w-3.5 text-red-400" />}
            label="Hottest hour"
            value={Number.isNaN(summary.hottestSaleHour) ? "—" : fmtHour(summary.hottestSaleHour)}
            sub={Number.isNaN(summary.hottestSaleHour) ? "" : `${cells.find((c) => c.hour === summary.hottestSaleHour)?.sales ?? 0} sales / ${fmtMoney(cells.find((c) => c.hour === summary.hottestSaleHour)?.premium ?? 0)}`} />

          <Insight icon={<Clock className="h-3.5 w-3.5 text-sky-400" />}
            label="Busiest dialing"
            value={Number.isNaN(summary.busiestDialHour) ? "—" : fmtHour(summary.busiestDialHour)}
            sub={Number.isNaN(summary.busiestDialHour) ? "" : `${cells.find((c) => c.hour === summary.busiestDialHour)?.dials ?? 0} dials in that hour`} />

          {/* Lunch dip detector — checks 12pm + 1pm as a window */}
          {(() => {
            const noon = cells.find((c) => c.hour === 12);
            const one  = cells.find((c) => c.hour === 13);
            const adjacent = cells.filter((c) => [11, 14].includes(c.hour));
            const lunchAvg = ((noon?.dials ?? 0) + (one?.dials ?? 0)) / 2;
            const otherAvg = adjacent.length > 0
              ? adjacent.reduce((s, c) => s + c.dials, 0) / adjacent.length
              : 0;
            const dipPct = otherAvg > 0 ? Math.max(0, 1 - lunchAvg / otherAvg) : 0;
            return (
              <Insight icon={<Coffee className="h-3.5 w-3.5 text-orange-400" />}
                label="Lunch dip"
                value={dipPct > 0 ? `−${(dipPct * 100).toFixed(0)}%` : "none"}
                sub={dipPct > 0.4 ? "deep mid-day silence"
                   : dipPct > 0.15 ? "modest slowdown"
                   : "no measurable dip"} />
            );
          })()}

          {/* End-of-day surge detector — last 2 hours vs first 2 working hours */}
          {(() => {
            const opening = cells.filter((c) => [10, 11].includes(c.hour))
              .reduce((s, c) => s + c.dials, 0) / 2;
            const closing = cells.filter((c) => [15, 16].includes(c.hour))
              .reduce((s, c) => s + c.dials, 0) / 2;
            const surge = opening > 0 ? closing / opening - 1 : 0;
            return (
              <Insight icon={<Sunset className="h-3.5 w-3.5 text-purple-400" />}
                label="EOD surge"
                value={surge > 0 ? `+${(surge * 100).toFixed(0)}%` : surge < 0 ? `${(surge * 100).toFixed(0)}%` : "—"}
                sub={surge > 0.25 ? "strong push to close"
                   : surge < -0.20 ? "fading into the close"
                   : "steady through close"} />
            );
          })()}

          {!hasAnyData && (
            <div className="text-[10px] font-mono text-muted-foreground italic">
              No intraday rows have landed for {scrapeDate} yet. The hourly scrape may not have run, or the day hasn't started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Insight({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-card/30 p-2">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-sm font-mono font-bold text-foreground tabular-nums">{value}</div>
        {sub && <div className="text-[10px] font-mono text-muted-foreground truncate">{sub}</div>}
      </div>
    </div>
  );
}
