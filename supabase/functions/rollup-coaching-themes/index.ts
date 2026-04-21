import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Theme detection thresholds (mirrors client/src/lib/conversationIntelligence.ts)
const MIN_EVIDENCE_CALLS = 3;
const MAX_THEMES_PER_AGENT = 3;
const PRESENTATION_MIN_DURATION = 900;

type ThemeKey =
  | "skipped_discovery" | "no_next_step" | "premium_not_anchored"
  | "talk_too_much_in_close" | "price_stall" | "flat_sentiment"
  | "discovery_quality_gap" | "objection_blind_spot";

interface ThemeMeta {
  label: string;
  tier: number;
  coachingAction: string;
}

const THEME_META: Record<ThemeKey, ThemeMeta> = {
  skipped_discovery:      { label: "Skipping Discovery",         tier: 1, coachingAction: "Role-play the first 3 minutes: needs, dependents, income before anything else" },
  no_next_step:           { label: "No Next Step Set",           tier: 1, coachingAction: "Before hanging up, always confirm: date, time, and what you'll review together" },
  premium_not_anchored:   { label: "Premium Not Anchored",       tier: 1, coachingAction: "Anchor a monthly range before the prospect can object" },
  talk_too_much_in_close: { label: "Over-Talking the Close",     tier: 2, coachingAction: "After presenting the premium, stop. Count to 5 silently." },
  price_stall:            { label: "Price Objection Stall",      tier: 2, coachingAction: "Drill the 3-step reframe: acknowledge, isolate, reframe as daily cost" },
  flat_sentiment:         { label: "Flat Energy / Rapport",      tier: 2, coachingAction: "Warm up with a 30-second personal question before pivoting to business" },
  discovery_quality_gap:  { label: "Discovery Quality Below Peers", tier: 3, coachingAction: "Shadow a top performer's discovery calls" },
  objection_blind_spot:   { label: "Objection Blind Spot",       tier: 3, coachingAction: "Identify your weak objection type and practice the counter script 10x" },
};

interface ConvRow {
  attention_uuid: string;
  agent_id: string;
  duration_seconds: number;
  call_label: string | null;
  outcome: string | null;
  scorecard_total_score: number | null;
  scorecard_breakdown: Record<string, number> | null;
  talk_ratio: number | null;
  sentiment_overall: number | null;
  first_objection_type: string | null;
  recovered_after_objection: boolean | null;
}

interface DetectedTheme {
  key: ThemeKey;
  severity: "low" | "med" | "high";
  evidenceUuids: string[];
  agentValue: number;
  benchmarkValue: number | null;
}

function getMonday(d: Date): string {
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

function detect(calls: ConvRow[], peerBenchmarks: { topQuartileDiscovery: number | null; objectionRecovery: Record<string, number> }): DetectedTheme[] {
  const themes: DetectedTheme[] = [];
  const presentations = calls.filter(c => c.duration_seconds >= PRESENTATION_MIN_DURATION);
  const closingCalls = calls.filter(c => {
    const label = (c.call_label ?? "").toLowerCase();
    const outcome = (c.outcome ?? "").toLowerCase();
    return label.includes("presentation") || outcome === "sale" || outcome === "lost" || c.duration_seconds >= PRESENTATION_MIN_DURATION;
  });

  // T1: skipped_discovery
  const withSc = presentations.filter(c => c.scorecard_breakdown);
  if (withSc.length >= MIN_EVIDENCE_CALLS) {
    const missed = withSc.filter(c => {
      const d = c.scorecard_breakdown!.discovery ?? c.scorecard_breakdown!.discovery_needs ?? c.scorecard_breakdown!.needs_assessment;
      return d === undefined || d < 50;
    });
    const rate = missed.length / withSc.length;
    if (rate > 0.4) themes.push({ key: "skipped_discovery", severity: rate > 0.6 ? "high" : "med", evidenceUuids: missed.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(rate * 100), benchmarkValue: 20 });
  }

  // T1: no_next_step
  if (presentations.length >= MIN_EVIDENCE_CALLS) {
    const noNext = presentations.filter(c => {
      const bd = c.scorecard_breakdown;
      if (!bd) return false;
      const s = bd.next_step ?? bd.next_step_confirmed ?? bd.callback_set;
      return s !== undefined && s < 50;
    });
    const rate = noNext.length / presentations.length;
    if (rate > 0.3 && noNext.length >= MIN_EVIDENCE_CALLS) themes.push({ key: "no_next_step", severity: rate > 0.5 ? "high" : "med", evidenceUuids: noNext.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(rate * 100), benchmarkValue: 15 });
  }

  // T1: premium_not_anchored
  if (presentations.length >= MIN_EVIDENCE_CALLS) {
    const late = presentations.filter(c => {
      const bd = c.scorecard_breakdown;
      if (!bd) return false;
      const s = bd.premium_anchored ?? bd.premium_before_objection;
      return s !== undefined && s < 50;
    });
    const rate = late.length / presentations.length;
    if (rate > 0.3 && late.length >= MIN_EVIDENCE_CALLS) themes.push({ key: "premium_not_anchored", severity: rate > 0.5 ? "high" : "med", evidenceUuids: late.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(rate * 100), benchmarkValue: 15 });
  }

  // T2: talk_too_much_in_close
  const highTalk = closingCalls.filter(c => c.talk_ratio !== null && c.talk_ratio > 0.65);
  if (highTalk.length >= MIN_EVIDENCE_CALLS && closingCalls.length > 0) {
    const rate = highTalk.length / closingCalls.length;
    if (rate > 0.4) {
      const avg = highTalk.reduce((s, c) => s + (c.talk_ratio ?? 0), 0) / highTalk.length;
      themes.push({ key: "talk_too_much_in_close", severity: avg > 0.75 ? "high" : "med", evidenceUuids: highTalk.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(avg * 100), benchmarkValue: 55 });
    }
  }

  // T2: price_stall
  const priceObj = calls.filter(c => c.first_objection_type && ["cost","price","expensive","afford","budget","money"].includes(c.first_objection_type.toLowerCase()));
  if (priceObj.length >= MIN_EVIDENCE_CALLS) {
    const unrec = priceObj.filter(c => c.recovered_after_objection === false);
    const failRate = unrec.length / priceObj.length;
    if (failRate > 0.5) themes.push({ key: "price_stall", severity: failRate > 0.7 ? "high" : "med", evidenceUuids: unrec.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(failRate * 100), benchmarkValue: 30 });
  }

  // T2: flat_sentiment
  const withSent = calls.filter(c => c.sentiment_overall !== null);
  if (withSent.length >= MIN_EVIDENCE_CALLS) {
    const avg = withSent.reduce((s, c) => s + (c.sentiment_overall ?? 0), 0) / withSent.length;
    if (avg < 0.1) {
      const low = withSent.filter(c => (c.sentiment_overall ?? 0) < 0.1);
      themes.push({ key: "flat_sentiment", severity: avg < 0 ? "high" : "med", evidenceUuids: low.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(avg * 100), benchmarkValue: 25 });
    }
  }

  // T3: discovery_quality_gap
  if (peerBenchmarks.topQuartileDiscovery !== null && withSc.length >= MIN_EVIDENCE_CALLS) {
    const scores = withSc.map(c => c.scorecard_breakdown!.discovery ?? c.scorecard_breakdown!.discovery_needs).filter((s): s is number => s !== undefined);
    if (scores.length >= MIN_EVIDENCE_CALLS) {
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      const gap = peerBenchmarks.topQuartileDiscovery - avg;
      if (gap > 15) themes.push({ key: "discovery_quality_gap", severity: gap > 25 ? "high" : "med", evidenceUuids: withSc.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(avg), benchmarkValue: Math.round(peerBenchmarks.topQuartileDiscovery) });
    }
  }

  // T3: objection_blind_spot
  const objCalls = calls.filter(c => c.first_objection_type);
  const byType = new Map<string, { total: number; recovered: number }>();
  for (const c of objCalls) {
    const t = c.first_objection_type!.toLowerCase();
    const e = byType.get(t) ?? { total: 0, recovered: 0 };
    e.total++;
    if (c.recovered_after_objection) e.recovered++;
    byType.set(t, e);
  }
  for (const [type, stats] of byType) {
    if (stats.total < 3) continue;
    const agentRate = stats.recovered / stats.total;
    const peerRate = peerBenchmarks.objectionRecovery[type] ?? 0.5;
    if (agentRate < 0.2 && peerRate > 0.5) {
      const ev = objCalls.filter(c => c.first_objection_type?.toLowerCase() === type && !c.recovered_after_objection);
      themes.push({ key: "objection_blind_spot", severity: "high", evidenceUuids: ev.slice(0, 5).map(c => c.attention_uuid), agentValue: Math.round(agentRate * 100), benchmarkValue: Math.round(peerRate * 100) });
      break;
    }
  }

  // Sort: tier ASC, severity DESC, cap at 3
  const sevOrd: Record<string, number> = { high: 3, med: 2, low: 1 };
  themes.sort((a, b) => {
    if (THEME_META[a.key].tier !== THEME_META[b.key].tier) return THEME_META[a.key].tier - THEME_META[b.key].tier;
    return sevOrd[b.severity] - sevOrd[a.severity];
  });
  return themes.slice(0, MAX_THEMES_PER_AGENT);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Determine the rolling 7-day window (Mon-Sun) ending on the most recent Sunday
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayOfWeek = today.getUTCDay();
    const lastSunday = new Date(today);
    lastSunday.setUTCDate(today.getUTCDate() - (dayOfWeek === 0 ? 0 : dayOfWeek));
    const lastMonday = new Date(lastSunday);
    lastMonday.setUTCDate(lastSunday.getUTCDate() - 6);

    const weekStart = lastMonday.toISOString().slice(0, 10);
    const weekEnd = lastSunday.toISOString().slice(0, 10);

    // Fetch all conversation_intelligence rows for the week
    const { data: allCalls, error: fetchError } = await supabase
      .from("conversation_intelligence")
      .select("attention_uuid, agent_id, duration_seconds, call_label, outcome, scorecard_total_score, scorecard_breakdown, talk_ratio, sentiment_overall, first_objection_type, recovered_after_objection")
      .gte("call_date", weekStart)
      .lte("call_date", weekEnd);

    if (fetchError) throw fetchError;
    if (!allCalls || allCalls.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No calls in window", weekStart, weekEnd, themesWritten: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Compute peer benchmarks across all agents
    const agentGroups = new Map<string, ConvRow[]>();
    for (const c of allCalls as ConvRow[]) {
      const group = agentGroups.get(c.agent_id) ?? [];
      group.push(c);
      agentGroups.set(c.agent_id, group);
    }

    // Top-quartile discovery score
    const agentDiscoveryAvgs: number[] = [];
    for (const [, calls] of agentGroups) {
      const scores = calls.filter(c => c.scorecard_breakdown).map(c => c.scorecard_breakdown!.discovery ?? c.scorecard_breakdown!.discovery_needs).filter((s): s is number => s !== undefined);
      if (scores.length >= 3) agentDiscoveryAvgs.push(scores.reduce((s, v) => s + v, 0) / scores.length);
    }
    const sortedDisc = agentDiscoveryAvgs.sort((a, b) => a - b);
    const topQuartileDiscovery = sortedDisc.length > 0 ? sortedDisc[Math.min(sortedDisc.length - 1, Math.floor(sortedDisc.length * 0.75))] : null;

    // Objection recovery rates
    const objByType = new Map<string, { total: number; recovered: number }>();
    for (const c of allCalls as ConvRow[]) {
      if (!c.first_objection_type) continue;
      const t = c.first_objection_type.toLowerCase();
      const e = objByType.get(t) ?? { total: 0, recovered: 0 };
      e.total++;
      if (c.recovered_after_objection) e.recovered++;
      objByType.set(t, e);
    }
    const objectionRecovery: Record<string, number> = {};
    for (const [t, s] of objByType) {
      if (s.total >= 5) objectionRecovery[t] = s.recovered / s.total;
    }

    const peerBenchmarks = { topQuartileDiscovery, objectionRecovery };

    // Derive themes per agent and upsert
    let themesWritten = 0;
    for (const [agentId, calls] of agentGroups) {
      const themes = detect(calls, peerBenchmarks);
      if (themes.length === 0) continue;

      const records = themes.map(t => ({
        agent_id: agentId,
        week_start_date: weekStart,
        theme_key: t.key,
        theme_label: THEME_META[t.key].label,
        tier: THEME_META[t.key].tier,
        severity: t.severity,
        evidence_call_uuids: t.evidenceUuids,
        suggested_action: THEME_META[t.key].coachingAction,
        benchmark_value: t.benchmarkValue,
        agent_value: t.agentValue,
        computed_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("coaching_themes_weekly")
        .upsert(records, { onConflict: "agent_id,week_start_date,theme_key" });

      if (!error) themesWritten += records.length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        weekStart,
        weekEnd,
        agentsProcessed: agentGroups.size,
        callsAnalyzed: allCalls.length,
        themesWritten,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
