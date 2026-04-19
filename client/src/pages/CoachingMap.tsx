// ============================================================
// Coaching Map — dedicated page for the Skill × Effort quadrant
// ============================================================
//
// Lives at /coaching. Anchored on the same selectedDate as the rest of the
// app (so flipping dates in the date picker keeps everyone in sync), but
// gets its own breathing room rather than being squeezed at the top of
// Daily Pulse where labels were colliding.
//
// The chart itself lives in `components/CoachingQuadrant.tsx` and is fed by
// `hooks/useCoachingQuadrant.ts`. This page is just the chrome around it:
// page header, anchor date controls, and a brief "how to read this" panel.

import { useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight, Zap, Target, BookOpen } from "lucide-react";
import { useData } from "@/contexts/DataContext";
import { useCoachingQuadrant, QUADRANT_META, type QuadrantId } from "@/hooks/useCoachingQuadrant";
import { CoachingQuadrant } from "@/components/CoachingQuadrant";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function CoachingMap() {
  const data = useData();
  const { selectedDate, availableDates } = data;

  // The quadrant is anchored on the page's selected date. Defaults to today's
  // date from DataContext so it stays in sync with Daily Pulse / Pipeline.
  const quadrant = useCoachingQuadrant(selectedDate);

  const navToDate = (dir: number) => {
    const idx = availableDates.indexOf(selectedDate);
    const nextIdx = idx - dir;
    if (nextIdx >= 0 && nextIdx < availableDates.length) {
      data.setSelectedDate(availableDates[nextIdx]);
    }
  };

  const latestDate = availableDates.length > 0 ? availableDates[0] : null;
  const isOnLatest = selectedDate === latestDate;

  // Quick floor-mix tally for the page header.
  const mix = useMemo(() => {
    const counts: Record<QuadrantId, number> = { stars: 0, grinders: 0, talents: 0, atRisk: 0 };
    for (const a of quadrant.agents) counts[a.quadrant]++;
    return counts;
  }, [quadrant.agents]);

  return (
    <div className="space-y-6">
      {/* Page header ---------------------------------------------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Target className="h-4 w-4 text-blue-400" />
            Coaching Map
          </h1>
          <p className="text-xs font-mono text-muted-foreground">
            Where every agent stands on Skill × Effort, and which way they're trending — anchored at <strong className="text-foreground">{selectedDate}</strong>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navToDate(-1)}
            disabled={availableDates.indexOf(selectedDate) >= availableDates.length - 1}
            className="p-1 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
            aria-label="Previous day"
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
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isOnLatest && latestDate && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => data.setSelectedDate(latestDate)}
              className="h-7 px-2 text-[10px] font-mono bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20"
            >
              <Zap className="h-3 w-3 mr-1" /> Latest
            </Button>
          )}
        </div>
      </div>

      {/* Floor-mix scoreboard ------------------------------------------ */}
      {quadrant.agents.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(["stars", "grinders", "talents", "atRisk"] as QuadrantId[]).map((q) => {
            const meta = QUADRANT_META[q];
            const count = mix[q];
            const total = quadrant.agents.length || 1;
            const pct = (count / total) * 100;
            return (
              <div
                key={q}
                className={cn("rounded-lg border p-3 transition-all", meta.bgClass)}
                style={{ borderColor: `${meta.hex}30` }}
              >
                <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  {meta.label}
                </div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className={cn("text-2xl font-mono font-bold tabular-nums", meta.textClass)}>
                    {count}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                    {pct.toFixed(0)}% of floor
                  </span>
                </div>
                <div className="text-[9px] font-mono text-muted-foreground mt-1 leading-snug">
                  {meta.prescription}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* The quadrant itself ------------------------------------------- */}
      <CoachingQuadrant data={quadrant} />

      {/* How-to-read footer -------------------------------------------- */}
      <div className="rounded-md border border-border/60 bg-card/30 p-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5 mb-2">
          <BookOpen className="h-3 w-3" />
          How to read this
        </div>
        <div className="grid sm:grid-cols-3 gap-3 text-[11px] font-mono text-muted-foreground leading-relaxed">
          <div>
            <strong className="text-foreground block mb-0.5">The axes</strong>
            <span>X = SKILL (close rate), Y = EFFORT (talk minutes per day). Median lines split the floor — they're computed from this very roster, so quadrants describe relative position, not absolute targets.</span>
          </div>
          <div>
            <strong className="text-foreground block mb-0.5">The trails</strong>
            <span>Each agent's trail shows where they were 30 → 14 → 7 days ago, ending at their bright dot today. A long trail means the agent moved a lot. The direction tells you whether to celebrate or intervene.</span>
          </div>
          <div>
            <strong className="text-foreground block mb-0.5">The labels</strong>
            <span>Only Climbers, Sliders, and quadrant Transitions are labeled by default — the people you actually need to act on. Hover any dot or sidebar name to surface a label and a stats card. Toggle "Show all labels" if you want everything visible.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
