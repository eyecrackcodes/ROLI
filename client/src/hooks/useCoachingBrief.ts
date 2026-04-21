import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured, supabaseQav, isQavConfigured } from "@/lib/supabase";
import {
  deriveCoachingThemes,
  computePeerBenchmarks,
} from "@/lib/conversationIntelligence";
import type {
  CoachingTheme,
  CoachingAction,
  ConversationRow,
  AgentCoachingBrief,
  CoachingDigestRow,
} from "@/lib/conversationIntelligence";

interface AgentIdMap {
  id: string;
  name: string;
  site: string;
  adp_work_email: string | null;
}

function getMonday(d: Date): string {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

// Raw QAvOne row shape
interface QavConversationRow {
  attention_uuid: string;
  agent_email: string | null;
  agent_name: string | null;
  call_date: string | null;
  duration_sec: number | null;
  ai_overall_score: number | string | null;
  ai_scorecard_data: {
    title?: string;
    items?: Array<{
      title: string;
      score: number | null;
      max?: number;
      status?: string;
      description?: string;
    }>;
    summary?: { summaryText?: string; averageScore?: number };
  } | null;
  title: string | null;
  imported_at: string;
}

function normalizeScore(score: number, max: number): number {
  if (max <= 0) return score;
  return Math.round((score / max) * 100);
}

function transformQavRow(row: QavConversationRow, agentId: string): ConversationRow {
  const breakdown: Record<string, number> = {};
  const items = row.ai_scorecard_data?.items ?? [];
  for (const item of items) {
    if (item.score == null) continue;
    if (item.score === 0 && item.status === "CALCULATED" && item.description?.toLowerCase().includes("n/a")) continue;
    const key = (item.title || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    breakdown[key] = normalizeScore(item.score, item.max ?? 5);
  }

  const totalScore = row.ai_overall_score != null ? parseFloat(String(row.ai_overall_score)) : null;

  return {
    attention_uuid: row.attention_uuid,
    agent_id: agentId,
    call_date: row.call_date?.slice(0, 10) ?? "",
    call_started_at: row.call_date ?? "",
    duration_seconds: Math.round(row.duration_sec ?? 0),
    call_label: null,
    outcome: null,
    scorecard_name: row.ai_scorecard_data?.title ?? null,
    scorecard_total_score: totalScore,
    scorecard_breakdown: Object.keys(breakdown).length > 0 ? breakdown : null,
    talk_ratio: null,
    longest_monologue_sec: null,
    sentiment_overall: null,
    first_objection_type: null,
    first_objection_at_seconds: null,
    recovered_after_objection: null,
    clip_url: `https://app.attention.tech/conversations/${row.attention_uuid}`,
    transcript_summary: row.ai_scorecard_data?.summary?.summaryText ?? null,
    ai_themes: null,
  };
}

const MIN_CALL_DURATION = 120;

// ---- Single-agent coaching brief ----

export function useCoachingBrief(agentName: string | null): AgentCoachingBrief | null {
  const [brief, setBrief] = useState<AgentCoachingBrief | null>(null);

  const fetchBrief = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName) {
      setBrief(null);
      return;
    }

    try {
      const { data: agentRow } = await supabase
        .from("agents")
        .select("id, name, adp_work_email")
        .eq("name", agentName)
        .single();

      if (!agentRow) { setBrief(null); return; }

      const agentId = agentRow.id;
      const agentEmail = agentRow.adp_work_email;
      const now = new Date();
      const weekStart = getMonday(now);

      const priorMonday = new Date(now);
      priorMonday.setUTCDate(priorMonday.getUTCDate() - 7);
      const priorWeekStart = getMonday(priorMonday);

      // Fetch recent calls from QAvOne by email
      let recentCalls: ConversationRow[] = [];
      if (isQavConfigured && agentEmail) {
        const { data: qavRows } = await supabaseQav
          .from("attention_conversations")
          .select("attention_uuid, agent_email, agent_name, call_date, duration_sec, ai_overall_score, ai_scorecard_data, title, imported_at")
          .eq("agent_email", agentEmail)
          .gte("call_date", priorWeekStart)
          .gte("duration_sec", MIN_CALL_DURATION)
          .not("ai_overall_score", "is", null)
          .order("call_date", { ascending: false })
          .limit(30);

        recentCalls = (qavRows ?? []).map((r: QavConversationRow) => transformQavRow(r, agentId));
      }

      // Derive themes client-side from the scorecard data
      const themes = deriveCoachingThemes(recentCalls, agentId, weekStart, null);

      const mappedThemes: CoachingTheme[] = themes.map((t, i) => ({
        id: `derived-${i}`,
        ...t,
        agentName,
        computedAt: new Date().toISOString(),
      }));

      // Coaching actions still come from ROLI (manager-written data)
      const { data: actionsData } = await supabase
        .from("coaching_actions")
        .select("*")
        .eq("agent_id", agentId)
        .order("assigned_at", { ascending: false })
        .limit(10);

      const scorecardScores = recentCalls
        .filter(c => c.scorecard_total_score !== null)
        .map(c => c.scorecard_total_score!);
      const avgScorecard = scorecardScores.length > 0
        ? Math.round(scorecardScores.reduce((s, v) => s + v, 0) / scorecardScores.length)
        : null;

      const talkRatios = recentCalls
        .filter(c => c.talk_ratio !== null)
        .map(c => c.talk_ratio!);
      const avgTalkRatio = talkRatios.length > 0
        ? Math.round(talkRatios.reduce((s, v) => s + v, 0) / talkRatios.length * 100) / 100
        : null;

      const actions: CoachingAction[] = (actionsData ?? []).map((a: Record<string, unknown>) => ({
        id: a.id as string,
        themeId: a.theme_id as string,
        agentId: a.agent_id as string,
        status: a.status as CoachingAction["status"],
        assignedTo: a.assigned_to as string | null,
        managerNotes: a.manager_notes as string | null,
        outcomeObserved: a.outcome_observed as string | null,
        assignedAt: a.assigned_at as string,
        completedAt: a.completed_at as string | null,
      }));

      setBrief({
        agentId,
        agentName,
        weekStartDate: weekStart,
        themes: mappedThemes,
        recentCalls,
        avgScorecardScore: avgScorecard,
        avgTalkRatio,
        totalCallsAnalyzed: recentCalls.length,
        actions,
      });
    } catch {
      setBrief(null);
    }
  }, [agentName]);

  useEffect(() => { void fetchBrief(); }, [fetchBrief]);

  return brief;
}

// ---- All-agents coaching digest for the manager table ----

export function useCoachingDigest(weekStartDate?: string): {
  rows: CoachingDigestRow[];
  loading: boolean;
  error: string | null;
} {
  const [rows, setRows] = useState<CoachingDigestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetWeek = useMemo(() => {
    if (weekStartDate) return weekStartDate;
    return getMonday(new Date());
  }, [weekStartDate]);

  const fetchDigest = useCallback(async () => {
    if (!isSupabaseConfigured || !isQavConfigured) return;
    setLoading(true);
    setError(null);

    try {
      const priorMonday = new Date(targetWeek + "T00:00:00Z");
      priorMonday.setUTCDate(priorMonday.getUTCDate() - 7);
      const priorWeekStart = priorMonday.toISOString().slice(0, 10);

      // Load agents from ROLI
      const { data: agentsData } = await supabase
        .from("agents")
        .select("id, name, site, is_active, terminated_date, adp_work_email");
      const agents = (agentsData ?? []) as AgentIdMap[];
      const emailToAgent = new Map<string, AgentIdMap>();
      for (const a of agents) {
        if (a.adp_work_email) emailToAgent.set(a.adp_work_email.toLowerCase(), a);
      }

      // Load all recent scored conversations from QAvOne
      const { data: qavRows } = await supabaseQav
        .from("attention_conversations")
        .select("attention_uuid, agent_email, agent_name, call_date, duration_sec, ai_overall_score, ai_scorecard_data, title, imported_at")
        .gte("call_date", priorWeekStart)
        .gte("duration_sec", MIN_CALL_DURATION)
        .not("ai_overall_score", "is", null)
        .order("call_date", { ascending: false })
        .limit(2000);

      // Group calls by agent
      const agentCalls = new Map<string, ConversationRow[]>();
      for (const r of (qavRows ?? []) as QavConversationRow[]) {
        if (!r.agent_email) continue;
        const agent = emailToAgent.get(r.agent_email.toLowerCase());
        if (!agent) continue;
        const call = transformQavRow(r, agent.id);
        const existing = agentCalls.get(agent.id) ?? [];
        existing.push(call);
        agentCalls.set(agent.id, existing);
      }

      // All calls flattened for peer benchmarks
      const allCalls: ConversationRow[] = [];
      for (const calls of agentCalls.values()) allCalls.push(...calls);
      const peerBenchmarks = computePeerBenchmarks(allCalls);

      // Coaching actions from ROLI
      const { data: actionsData } = await supabase
        .from("coaching_actions")
        .select("agent_id, status, completed_at")
        .in("status", ["done", "in_progress"])
        .order("completed_at", { ascending: false });

      const lastCoached = new Map<string, string>();
      for (const a of (actionsData ?? []) as Array<{ agent_id: string; completed_at: string | null }>) {
        if (a.completed_at && !lastCoached.has(a.agent_id)) {
          lastCoached.set(a.agent_id, a.completed_at);
        }
      }

      // Derive themes per agent and build digest rows
      const digestRows: CoachingDigestRow[] = [];
      for (const [agentId, calls] of agentCalls) {
        const agent = agents.find(a => a.id === agentId);
        if (!agent) continue;

        const themes = deriveCoachingThemes(calls, agentId, targetWeek, peerBenchmarks);
        if (themes.length === 0) continue;

        const topTheme: CoachingTheme = {
          ...themes[0],
          agentName: agent.name,
        };

        const scores = calls
          .filter(c => c.scorecard_total_score !== null)
          .map(c => c.scorecard_total_score!);
        const avgScore = scores.length > 0
          ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
          : null;

        digestRows.push({
          agentId,
          agentName: agent.name,
          site: agent.site,
          topTheme,
          themeCount: themes.length,
          highSeverityCount: themes.filter(t => t.severity === "high").length,
          lastCoachedAt: lastCoached.get(agentId) ?? null,
          avgScorecardScore: avgScore,
          weekStartDate: targetWeek,
        });
      }

      digestRows.sort((a, b) => {
        if (b.highSeverityCount !== a.highSeverityCount) return b.highSeverityCount - a.highSeverityCount;
        return (a.topTheme?.tier ?? 9) - (b.topTheme?.tier ?? 9);
      });

      setRows(digestRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load coaching digest");
    } finally {
      setLoading(false);
    }
  }, [targetWeek]);

  useEffect(() => { void fetchDigest(); }, [fetchDigest]);

  return { rows, loading, error };
}

// ---- Mutation: mark a theme as coached ----

export async function markThemeCoached(
  themeId: string,
  agentId: string,
  managerNotes?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { success: false, error: "Supabase not configured" };

  const { error } = await supabase.from("coaching_actions").insert({
    theme_id: themeId,
    agent_id: agentId,
    status: "done",
    manager_notes: managerNotes ?? null,
    assigned_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updateCoachingAction(
  actionId: string,
  updates: Partial<{
    status: CoachingAction["status"];
    managerNotes: string;
    outcomeObserved: string;
  }>,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) return { success: false, error: "Supabase not configured" };

  const { error } = await supabase
    .from("coaching_actions")
    .update({
      ...(updates.status && { status: updates.status }),
      ...(updates.managerNotes !== undefined && { manager_notes: updates.managerNotes }),
      ...(updates.outcomeObserved !== undefined && { outcome_observed: updates.outcomeObserved }),
      ...(updates.status === "done" && { completed_at: new Date().toISOString() }),
    })
    .eq("id", actionId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
