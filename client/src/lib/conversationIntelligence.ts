// ============================================================
// Conversation Intelligence — Theme Derivation Engine
// Mirrors pipelineIntelligence.ts philosophy: small, opinionated,
// brutally compressed output. Max 3 themes per agent per week.
// ============================================================

// ---- Theme definitions ----

export type ThemeTier = 1 | 2 | 3;
export type ThemeSeverity = "low" | "med" | "high";

export type ThemeKey =
  // Tier 1 — Process gaps (binary, easiest to fix)
  | "skipped_discovery"
  | "no_next_step"
  | "premium_not_anchored"
  | "weak_rate_presentation"
  | "weak_needs_analysis"
  | "weak_eligibility"
  // Tier 2 — Behavioral patterns
  | "talk_too_much_in_close"
  | "price_stall"
  | "flat_sentiment"
  // Tier 3 — Strategic (peer benchmark)
  | "discovery_quality_gap"
  | "objection_blind_spot";

export interface ThemeMeta {
  key: ThemeKey;
  label: string;
  tier: ThemeTier;
  description: string;
  coachingAction: string;
}

export const THEME_META: Record<ThemeKey, ThemeMeta> = {
  skipped_discovery: {
    key: "skipped_discovery",
    label: "Skipping Discovery",
    tier: 1,
    description: "Discovery questions missed in a significant portion of presentations",
    coachingAction: "Role-play the first 3 minutes: needs, dependents, income before anything else",
  },
  no_next_step: {
    key: "no_next_step",
    label: "No Next Step Set",
    tier: 1,
    description: "Calls ending without a confirmed callback or application started",
    coachingAction: "Before hanging up, always confirm: date, time, and what you'll review together",
  },
  premium_not_anchored: {
    key: "premium_not_anchored",
    label: "Premium Not Anchored",
    tier: 1,
    description: "Premium discussed after the first objection instead of before",
    coachingAction: "Anchor a monthly range before the prospect can object — 'most families invest $80-120/mo'",
  },
  talk_too_much_in_close: {
    key: "talk_too_much_in_close",
    label: "Over-Talking the Close",
    tier: 2,
    description: "Agent dominates talk time (>65%) on closing-zone calls",
    coachingAction: "After presenting the premium, stop. Count to 5 silently. Let the prospect speak first.",
  },
  price_stall: {
    key: "price_stall",
    label: "Price Objection Stall",
    tier: 2,
    description: "Not recovering after price/cost objections in >50% of cases",
    coachingAction: "Drill the 3-step reframe: acknowledge → isolate → reframe as daily cost",
  },
  flat_sentiment: {
    key: "flat_sentiment",
    label: "Flat Energy / Rapport",
    tier: 2,
    description: "Consistently low emotional engagement across calls",
    coachingAction: "Warm up with a 30-second personal question before pivoting to business",
  },
  discovery_quality_gap: {
    key: "discovery_quality_gap",
    label: "Discovery Quality Below Peers",
    tier: 3,
    description: "Discovery scorecard sub-score trails top-quartile peers by >15 points",
    coachingAction: "Shadow a top performer's discovery calls. Compare your checklist to theirs.",
  },
  objection_blind_spot: {
    key: "objection_blind_spot",
    label: "Objection Blind Spot",
    tier: 3,
    description: "One objection type has <20% recovery vs >50% for peers",
    coachingAction: "Identify your weak objection type and practice the counter script 10x this week",
  },
  weak_rate_presentation: {
    key: "weak_rate_presentation",
    label: "Weak Rate Presentation",
    tier: 1,
    description: "Rate presentation section consistently scores below expectations",
    coachingAction: "Practice the 3-option presentation: always present Good / Better / Best with monthly cost and coverage side by side",
  },
  weak_needs_analysis: {
    key: "weak_needs_analysis",
    label: "Incomplete Needs Analysis",
    tier: 1,
    description: "Needs analysis section (burial/cremation, cost anchoring) consistently weak",
    coachingAction: "Before quoting, always ask: burial or cremation preference, funeral experience, and anchor the coverage amount with cost ranges",
  },
  weak_eligibility: {
    key: "weak_eligibility",
    label: "Skipping Eligibility Questions",
    tier: 1,
    description: "Eligibility qualification consistently incomplete — work status, income, banking not gathered",
    coachingAction: "After DOB, always ask: working/retired/disability, Social Security/pension/salary, and checking/savings/Direct Express",
  },
};

// ---- Raw conversation row from Supabase ----

export interface ConversationRow {
  attention_uuid: string;
  agent_id: string;
  call_date: string;
  call_started_at: string;
  duration_seconds: number;
  call_label: string | null;
  outcome: string | null;
  scorecard_name: string | null;
  scorecard_total_score: number | null;
  scorecard_breakdown: Record<string, number> | null;
  talk_ratio: number | null;
  longest_monologue_sec: number | null;
  sentiment_overall: number | null;
  first_objection_type: string | null;
  first_objection_at_seconds: number | null;
  recovered_after_objection: boolean | null;
  clip_url: string | null;
  transcript_summary: string | null;
  ai_themes: string[] | null;
}

// ---- Weekly coaching theme (pre-aggregated or derived) ----

export interface CoachingTheme {
  id?: string;
  agentId: string;
  agentName?: string;
  weekStartDate: string;
  themeKey: ThemeKey;
  themeLabel: string;
  tier: ThemeTier;
  severity: ThemeSeverity;
  evidenceCallUuids: string[];
  suggestedAction: string;
  benchmarkValue: number | null;
  agentValue: number | null;
  computedAt?: string;
}

// ---- Coaching action (close-the-loop) ----

export type CoachingActionStatus = "open" | "in_progress" | "done" | "dismissed";

export interface CoachingAction {
  id: string;
  themeId: string;
  agentId: string;
  status: CoachingActionStatus;
  assignedTo: string | null;
  managerNotes: string | null;
  outcomeObserved: string | null;
  assignedAt: string;
  completedAt: string | null;
}

// ---- Agent coaching brief (what the UI consumes) ----

export interface AgentCoachingBrief {
  agentId: string;
  agentName: string;
  weekStartDate: string;
  themes: CoachingTheme[];
  recentCalls: ConversationRow[];
  avgScorecardScore: number | null;
  avgTalkRatio: number | null;
  totalCallsAnalyzed: number;
  actions: CoachingAction[];
}

// ---- Digest row (for the manager table) ----

export interface CoachingDigestRow {
  agentId: string;
  agentName: string;
  site: string;
  topTheme: CoachingTheme | null;
  themeCount: number;
  highSeverityCount: number;
  lastCoachedAt: string | null;
  avgScorecardScore: number | null;
  weekStartDate: string;
}

// ---- Anti-noise constants ----

const MIN_EVIDENCE_CALLS = 3;
const MAX_THEMES_PER_AGENT = 3;
const PRESENTATION_MIN_DURATION = 900; // 15 min

// ---- Theme detection functions ----

function isPresentationCall(c: ConversationRow): boolean {
  return c.duration_seconds >= PRESENTATION_MIN_DURATION;
}

function isClosingZoneCall(c: ConversationRow): boolean {
  const label = (c.call_label ?? "").toLowerCase();
  const outcome = (c.outcome ?? "").toLowerCase();
  return label.includes("presentation") ||
    outcome === "sale" ||
    outcome === "lost" ||
    c.duration_seconds >= PRESENTATION_MIN_DURATION;
}

interface DetectedTheme {
  key: ThemeKey;
  severity: ThemeSeverity;
  evidenceUuids: string[];
  agentValue: number;
  benchmarkValue: number | null;
}

function detectTier1(calls: ConversationRow[]): DetectedTheme[] {
  const themes: DetectedTheme[] = [];
  const presentations = calls.filter(isPresentationCall);
  if (presentations.length < MIN_EVIDENCE_CALLS) return themes;

  // skipped_discovery: discovery sub-score missing or low in >40% of presentations
  const withScorecard = presentations.filter(c => c.scorecard_breakdown);
  if (withScorecard.length >= MIN_EVIDENCE_CALLS) {
    const discoveryMissed = withScorecard.filter(c => {
      const bd = c.scorecard_breakdown!;
      const discoveryScore = bd.discovery ?? bd.discovery_needs ?? bd.needs_assessment ?? bd.needs_analysis;
      return discoveryScore === undefined || discoveryScore < 50;
    });
    const missRate = discoveryMissed.length / withScorecard.length;
    if (missRate > 0.4) {
      themes.push({
        key: "skipped_discovery",
        severity: missRate > 0.6 ? "high" : "med",
        evidenceUuids: discoveryMissed.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(missRate * 100),
        benchmarkValue: 20,
      });
    }
  }

  // no_next_step: calls without confirmed next step in >30%
  const noNextStep = presentations.filter(c => {
    const bd = c.scorecard_breakdown;
    if (!bd) return false;
    const nextStepScore = bd.next_step ?? bd.next_step_confirmed ?? bd.callback_set;
    return nextStepScore !== undefined && nextStepScore < 50;
  });
  if (noNextStep.length >= MIN_EVIDENCE_CALLS) {
    const rate = noNextStep.length / presentations.length;
    if (rate > 0.3) {
      themes.push({
        key: "no_next_step",
        severity: rate > 0.5 ? "high" : "med",
        evidenceUuids: noNextStep.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(rate * 100),
        benchmarkValue: 15,
      });
    }
  }

  // premium_not_anchored: premium discussed after first objection
  const premiumLate = presentations.filter(c => {
    const bd = c.scorecard_breakdown;
    if (!bd) return false;
    const premScore = bd.premium_anchored ?? bd.premium_before_objection;
    return premScore !== undefined && premScore < 50;
  });
  if (premiumLate.length >= MIN_EVIDENCE_CALLS) {
    const rate = premiumLate.length / presentations.length;
    if (rate > 0.3) {
      themes.push({
        key: "premium_not_anchored",
        severity: rate > 0.5 ? "high" : "med",
        evidenceUuids: premiumLate.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(rate * 100),
        benchmarkValue: 15,
      });
    }
  }

  // weak_rate_presentation: rate presentation sub-score low in >40% of presentations
  const weakRate = withScorecard.filter(c => {
    const bd = c.scorecard_breakdown!;
    const score = bd.rate_presentation ?? bd.transition_to_rate_presentation;
    return score !== undefined && score < 50;
  });
  if (weakRate.length >= MIN_EVIDENCE_CALLS) {
    const rate = weakRate.length / withScorecard.length;
    if (rate > 0.4) {
      themes.push({
        key: "weak_rate_presentation",
        severity: rate > 0.6 ? "high" : "med",
        evidenceUuids: weakRate.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(rate * 100),
        benchmarkValue: 20,
      });
    }
  }

  // weak_needs_analysis: needs analysis consistently below 50%
  const weakNeeds = withScorecard.filter(c => {
    const bd = c.scorecard_breakdown!;
    const score = bd.needs_analysis ?? bd.needs_assessment;
    return score !== undefined && score < 50;
  });
  if (weakNeeds.length >= MIN_EVIDENCE_CALLS) {
    const rate = weakNeeds.length / withScorecard.length;
    if (rate > 0.4) {
      themes.push({
        key: "weak_needs_analysis",
        severity: rate > 0.6 ? "high" : "med",
        evidenceUuids: weakNeeds.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(rate * 100),
        benchmarkValue: 20,
      });
    }
  }

  // weak_eligibility: eligibility qualification consistently below 50%
  const weakElig = withScorecard.filter(c => {
    const bd = c.scorecard_breakdown!;
    const score = bd.eligibility;
    return score !== undefined && score < 50;
  });
  if (weakElig.length >= MIN_EVIDENCE_CALLS) {
    const rate = weakElig.length / withScorecard.length;
    if (rate > 0.4) {
      themes.push({
        key: "weak_eligibility",
        severity: rate > 0.6 ? "high" : "med",
        evidenceUuids: weakElig.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(rate * 100),
        benchmarkValue: 20,
      });
    }
  }

  return themes;
}

function detectTier2(calls: ConversationRow[]): DetectedTheme[] {
  const themes: DetectedTheme[] = [];
  const closingCalls = calls.filter(isClosingZoneCall);

  // talk_too_much_in_close: talk_ratio > 0.65 on closing calls
  const highTalkCalls = closingCalls.filter(c =>
    c.talk_ratio !== null && c.talk_ratio > 0.65
  );
  if (highTalkCalls.length >= MIN_EVIDENCE_CALLS) {
    const rate = highTalkCalls.length / Math.max(1, closingCalls.length);
    if (rate > 0.4) {
      const avgRatio = highTalkCalls.reduce((s, c) => s + (c.talk_ratio ?? 0), 0) / highTalkCalls.length;
      themes.push({
        key: "talk_too_much_in_close",
        severity: avgRatio > 0.75 ? "high" : "med",
        evidenceUuids: highTalkCalls.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(avgRatio * 100),
        benchmarkValue: 55,
      });
    }
  }

  // price_stall: recovered_after_objection = false in >50% of price objections
  const priceObjections = calls.filter(c =>
    c.first_objection_type &&
    ["cost", "price", "expensive", "afford", "budget", "money"].includes(c.first_objection_type.toLowerCase())
  );
  if (priceObjections.length >= MIN_EVIDENCE_CALLS) {
    const unrecovered = priceObjections.filter(c => c.recovered_after_objection === false);
    const failRate = unrecovered.length / priceObjections.length;
    if (failRate > 0.5) {
      themes.push({
        key: "price_stall",
        severity: failRate > 0.7 ? "high" : "med",
        evidenceUuids: unrecovered.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(failRate * 100),
        benchmarkValue: 30,
      });
    }
  }

  // flat_sentiment: avg sentiment < 0.1 across week
  const withSentiment = calls.filter(c => c.sentiment_overall !== null);
  if (withSentiment.length >= MIN_EVIDENCE_CALLS) {
    const avgSentiment = withSentiment.reduce((s, c) => s + (c.sentiment_overall ?? 0), 0) / withSentiment.length;
    if (avgSentiment < 0.1) {
      const lowCalls = withSentiment.filter(c => (c.sentiment_overall ?? 0) < 0.1);
      themes.push({
        key: "flat_sentiment",
        severity: avgSentiment < 0 ? "high" : "med",
        evidenceUuids: lowCalls.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(avgSentiment * 100),
        benchmarkValue: 25,
      });
    }
  }

  return themes;
}

function detectTier3(
  calls: ConversationRow[],
  peerBenchmarks: PeerBenchmarks | null,
): DetectedTheme[] {
  const themes: DetectedTheme[] = [];
  if (!peerBenchmarks) return themes;

  const withScorecard = calls.filter(c => c.scorecard_breakdown && c.scorecard_total_score !== null);
  if (withScorecard.length < MIN_EVIDENCE_CALLS) return themes;

  // discovery_quality_gap: avg discovery sub-score vs top-quartile peer gap >15 points
  const discoveryScores = withScorecard
    .map(c => c.scorecard_breakdown!.discovery ?? c.scorecard_breakdown!.discovery_needs ?? c.scorecard_breakdown!.needs_analysis)
    .filter((s): s is number => s !== undefined);
  if (discoveryScores.length >= MIN_EVIDENCE_CALLS && peerBenchmarks.topQuartileDiscovery !== null) {
    const avgDiscovery = discoveryScores.reduce((s, v) => s + v, 0) / discoveryScores.length;
    const gap = peerBenchmarks.topQuartileDiscovery - avgDiscovery;
    if (gap > 15) {
      const lowCalls = withScorecard
        .filter(c => {
          const d = c.scorecard_breakdown!.discovery ?? c.scorecard_breakdown!.discovery_needs ?? c.scorecard_breakdown!.needs_analysis;
          return d !== undefined && d < peerBenchmarks.topQuartileDiscovery! - 10;
        });
      themes.push({
        key: "discovery_quality_gap",
        severity: gap > 25 ? "high" : "med",
        evidenceUuids: lowCalls.slice(0, 5).map(c => c.attention_uuid),
        agentValue: Math.round(avgDiscovery),
        benchmarkValue: Math.round(peerBenchmarks.topQuartileDiscovery),
      });
    }
  }

  // objection_blind_spot: one objection type closes <20% vs >50% for peers
  if (peerBenchmarks.objectionRecoveryByType) {
    const objectionCalls = calls.filter(c => c.first_objection_type);
    const byType = new Map<string, { total: number; recovered: number }>();
    for (const c of objectionCalls) {
      const type = c.first_objection_type!.toLowerCase();
      const entry = byType.get(type) ?? { total: 0, recovered: 0 };
      entry.total++;
      if (c.recovered_after_objection) entry.recovered++;
      byType.set(type, entry);
    }

    for (const [type, stats] of Array.from(byType)) {
      if (stats.total < 3) continue;
      const agentRate = stats.recovered / stats.total;
      const peerRate = peerBenchmarks.objectionRecoveryByType[type] ?? 0.5;
      if (agentRate < 0.2 && peerRate > 0.5) {
        const evidenceCalls = objectionCalls
          .filter(c => c.first_objection_type?.toLowerCase() === type && !c.recovered_after_objection);
        themes.push({
          key: "objection_blind_spot",
          severity: "high",
          evidenceUuids: evidenceCalls.slice(0, 5).map(c => c.attention_uuid),
          agentValue: Math.round(agentRate * 100),
          benchmarkValue: Math.round(peerRate * 100),
        });
        break; // Only surface the worst blind spot
      }
    }
  }

  return themes;
}

// ---- Peer benchmarks (computed from all agents' data) ----

export interface PeerBenchmarks {
  topQuartileDiscovery: number | null;
  topQuartileScorecardTotal: number | null;
  medianTalkRatio: number | null;
  objectionRecoveryByType: Record<string, number>;
}

export function computePeerBenchmarks(allCalls: ConversationRow[]): PeerBenchmarks {
  // Group by agent for per-agent averages
  const agentGroups = new Map<string, ConversationRow[]>();
  for (const c of allCalls) {
    const group = agentGroups.get(c.agent_id) ?? [];
    group.push(c);
    agentGroups.set(c.agent_id, group);
  }

  // Discovery scores per agent (averaged)
  const agentDiscoveryAvgs: number[] = [];
  const agentScorecardAvgs: number[] = [];
  const agentTalkRatios: number[] = [];

  for (const [, calls] of Array.from(agentGroups)) {
    const discoveryScores = calls
      .filter((c: ConversationRow) => c.scorecard_breakdown)
      .map((c: ConversationRow) => c.scorecard_breakdown!.discovery ?? c.scorecard_breakdown!.discovery_needs ?? c.scorecard_breakdown!.needs_analysis)
      .filter((s): s is number => s !== undefined);
    if (discoveryScores.length >= 3) {
      agentDiscoveryAvgs.push(discoveryScores.reduce((s: number, v: number) => s + v, 0) / discoveryScores.length);
    }

    const scorecardScores = calls
      .filter((c: ConversationRow) => c.scorecard_total_score !== null)
      .map((c: ConversationRow) => c.scorecard_total_score!);
    if (scorecardScores.length >= 3) {
      agentScorecardAvgs.push(scorecardScores.reduce((s: number, v: number) => s + v, 0) / scorecardScores.length);
    }

    const talkRatios = calls
      .filter((c: ConversationRow) => c.talk_ratio !== null)
      .map((c: ConversationRow) => c.talk_ratio!);
    if (talkRatios.length >= 3) {
      agentTalkRatios.push(talkRatios.reduce((s: number, v: number) => s + v, 0) / talkRatios.length);
    }
  }

  // Objection recovery rates across all agents
  const objectionByType = new Map<string, { total: number; recovered: number }>();
  for (const c of allCalls) {
    if (!c.first_objection_type) continue;
    const type = c.first_objection_type.toLowerCase();
    const entry = objectionByType.get(type) ?? { total: 0, recovered: 0 };
    entry.total++;
    if (c.recovered_after_objection) entry.recovered++;
    objectionByType.set(type, entry);
  }
  const objectionRecoveryByType: Record<string, number> = {};
  for (const [type, stats] of Array.from(objectionByType)) {
    if (stats.total >= 5) {
      objectionRecoveryByType[type] = stats.recovered / stats.total;
    }
  }

  return {
    topQuartileDiscovery: percentile75(agentDiscoveryAvgs),
    topQuartileScorecardTotal: percentile75(agentScorecardAvgs),
    medianTalkRatio: median(agentTalkRatios),
    objectionRecoveryByType,
  };
}

function percentile75(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  return sorted[idx];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- Main derivation: detect, rank, cap at 3 ----

export function deriveCoachingThemes(
  agentCalls: ConversationRow[],
  agentId: string,
  weekStartDate: string,
  peerBenchmarks: PeerBenchmarks | null,
): CoachingTheme[] {
  if (agentCalls.length < MIN_EVIDENCE_CALLS) return [];

  const tier1 = detectTier1(agentCalls);
  const tier2 = detectTier2(agentCalls);
  const tier3 = detectTier3(agentCalls, peerBenchmarks);

  const all: DetectedTheme[] = [...tier1, ...tier2, ...tier3];

  // Sort: tier ASC (T1 first = low-hanging fruit), then severity DESC
  const severityOrder: Record<ThemeSeverity, number> = { high: 3, med: 2, low: 1 };
  all.sort((a, b) => {
    const meta_a = THEME_META[a.key];
    const meta_b = THEME_META[b.key];
    if (meta_a.tier !== meta_b.tier) return meta_a.tier - meta_b.tier;
    return severityOrder[b.severity] - severityOrder[a.severity];
  });

  // Cap at MAX_THEMES_PER_AGENT
  return all.slice(0, MAX_THEMES_PER_AGENT).map((t) => ({
    agentId,
    weekStartDate,
    themeKey: t.key,
    themeLabel: THEME_META[t.key].label,
    tier: THEME_META[t.key].tier,
    severity: t.severity,
    evidenceCallUuids: t.evidenceUuids,
    suggestedAction: THEME_META[t.key].coachingAction,
    benchmarkValue: t.benchmarkValue,
    agentValue: t.agentValue,
  }));
}

// ---- UI helpers ----

export function getSeverityColor(severity: ThemeSeverity): string {
  switch (severity) {
    case "high": return "text-red-400";
    case "med": return "text-amber-400";
    case "low": return "text-blue-400";
  }
}

export function getSeverityBg(severity: ThemeSeverity): string {
  switch (severity) {
    case "high": return "bg-red-500/10 border-red-500/30";
    case "med": return "bg-amber-500/10 border-amber-500/30";
    case "low": return "bg-blue-500/10 border-blue-500/30";
  }
}

export function getTierLabel(tier: ThemeTier): string {
  switch (tier) {
    case 1: return "Process";
    case 2: return "Behavioral";
    case 3: return "Strategic";
  }
}

export function getTierColor(tier: ThemeTier): string {
  switch (tier) {
    case 1: return "text-emerald-400";
    case 2: return "text-violet-400";
    case 3: return "text-cyan-400";
  }
}
