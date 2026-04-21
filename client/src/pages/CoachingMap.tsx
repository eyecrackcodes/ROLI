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

import { useMemo, useState, useEffect } from "react";
import { Calendar, ChevronLeft, ChevronRight, Zap, Target, BookOpen } from "lucide-react";
import { useData } from "@/contexts/DataContext";
import { useCoachingQuadrant, QUADRANT_META, type QuadrantId } from "@/hooks/useCoachingQuadrant";
import { CoachingQuadrant, type AgentThemeBadge } from "@/components/CoachingQuadrant";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase, isSupabaseConfigured, supabaseQav, isQavConfigured } from "@/lib/supabase";
import { deriveCoachingThemes } from "@/lib/conversationIntelligence";
import type { ThemeSeverity, ConversationRow } from "@/lib/conversationIntelligence";

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

  // Derive top coaching theme per agent from QAvOne for badge overlay
  const [agentThemes, setAgentThemes] = useState<Map<string, AgentThemeBadge>>(new Map());
  useEffect(() => {
    if (!isSupabaseConfigured || !isQavConfigured) return;
    (async () => {
      try {
        const { data: agents } = await supabase
          .from("agents")
          .select("id, name, adp_work_email");
        if (!agents) return;

        const emailToAgent = new Map<string, { id: string; name: string }>();
        for (const a of agents as Array<{ id: string; name: string; adp_work_email: string | null }>) {
          if (a.adp_work_email) emailToAgent.set(a.adp_work_email.toLowerCase(), a);
        }

        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const since = twoWeeksAgo.toISOString().slice(0, 10);

        const { data: qavRows } = await supabaseQav
          .from("attention_conversations")
          .select("attention_uuid, agent_email, call_date, duration_sec, ai_overall_score, ai_scorecard_data")
          .gte("call_date", since)
          .gte("duration_sec", 120)
          .not("ai_overall_score", "is", null)
          .order("call_date", { ascending: false })
          .limit(2000);

        if (!qavRows || qavRows.length === 0) return;

        // Group by agent and derive themes
        const agentCalls = new Map<string, { name: string; calls: ConversationRow[] }>();
        for (const r of qavRows) {
          if (!r.agent_email) continue;
          const agent = emailToAgent.get(r.agent_email.toLowerCase());
          if (!agent) continue;

          const breakdown: Record<string, number> = {};
          for (const item of r.ai_scorecard_data?.items ?? []) {
            if (item.score == null) continue;
            if (item.score === 0 && item.status === "CALCULATED" && item.description?.toLowerCase().includes("n/a")) continue;
            const key = (item.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
            const max = item.max ?? 5;
            if (key) breakdown[key] = max > 0 ? Math.round((item.score / max) * 100) : item.score;
          }

          const call: ConversationRow = {
            attention_uuid: r.attention_uuid,
            agent_id: agent.id,
            call_date: r.call_date?.slice(0, 10) ?? "",
            call_started_at: r.call_date ?? "",
            duration_seconds: Math.round(r.duration_sec ?? 0),
            call_label: null, outcome: null,
            scorecard_name: r.ai_scorecard_data?.title ?? null,
            scorecard_total_score: r.ai_overall_score ? parseFloat(String(r.ai_overall_score)) : null,
            scorecard_breakdown: Object.keys(breakdown).length > 0 ? breakdown : null,
            talk_ratio: null, longest_monologue_sec: null, sentiment_overall: null,
            first_objection_type: null, first_objection_at_seconds: null, recovered_after_objection: null,
            clip_url: null, transcript_summary: null, ai_themes: null,
          };

          const existing = agentCalls.get(agent.id) ?? { name: agent.name, calls: [] };
          existing.calls.push(call);
          agentCalls.set(agent.id, existing);
        }

        const now = new Date();
        const weekStart = (() => { const d = now.getUTCDay(); const diff = now.getUTCDate() - d + (d === 0 ? -6 : 1); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff)).toISOString().slice(0, 10); })();

        const map = new Map<string, AgentThemeBadge>();
        for (const [agentId, { name, calls }] of agentCalls) {
          const themes = deriveCoachingThemes(calls, agentId, weekStart, null);
          if (themes.length === 0) continue;
          map.set(name, { themeLabel: themes[0].themeLabel, severity: themes[0].severity as ThemeSeverity });
        }
        setAgentThemes(map);
      } catch {
        // Non-critical — map just won't show badges
      }
    })();
  }, [selectedDate]);

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
      <CoachingQuadrant data={quadrant} agentThemes={agentThemes.size > 0 ? agentThemes : undefined} />

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
