import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Funnel decomposition for a single agent vs the active floor.
 *
 * Source: `agent_performance_daily` rows where `scrape_hour IS NULL`
 * (the daily aggregate row written by the agent performance scraper).
 *
 * Funnel stages (from CRM Daily Agent Performance report):
 *   Dials → Contact Made → { Conversation (2-15min) | Presentation (15min+) } → Sale
 *
 * Conversations and Presentations are PARALLEL duration buckets, not
 * sequential (per metrics-glossary.mdc), so we model them as two branches
 * out of "Contact Made" and two flows into "Sale" with sales attributed
 * proportionally to each branch's volume × industry-typical close weight
 * (presentations close ~3× more reliably than conversations — adjustable
 * via PRES_WEIGHT below). The unattributed remainders become the "lost"
 * sinks that the Leak Diagnosis cards monetize.
 */

const PRES_WEIGHT = 3; // presentations weighted 3x conversations for sale attribution

export interface FunnelStageStats {
  /** Raw aggregate volumes for this entity over the window. */
  dials: number;
  leadsWorked: number;
  contactsMade: number;
  conversations: number;
  presentations: number;
  sales: number;
  premium: number;
  /** Derived per-stage rates (0..1 scale). */
  contactRate: number;       // contactsMade / dials
  engagementRate: number;    // (conversations + presentations) / contactsMade
  conversationCloseRate: number; // sales attributed to conv / conversations
  presentationCloseRate: number; // sales attributed to pres / presentations
  /** Avg premium per closed sale ($). */
  avgPremiumPerSale: number;
}

export interface FunnelLeak {
  /** Stable id used by the Sankey + diagnosis card. */
  id: "contact" | "engagement" | "conversation" | "presentation";
  /** Human-friendly label. */
  label: string;
  /** Short coaching one-liner. */
  blurb: string;
  /** Agent's current rate at this stage (0..1). */
  agentRate: number;
  /** Floor average rate at this stage (0..1). */
  floorRate: number;
  /** Volume entering this stage for the agent (used for what-if math). */
  upstreamVolume: number;
  /** Weekly-equivalent dollars unlocked if agent matches floor on this stage. */
  weeklyDollarsAtStake: number;
  /** Daily-window length used to normalize the weekly figure. */
  windowDays: number;
}

export interface SankeyDatum {
  nodes: { name: string; kind: "stage" | "lost" | "win" }[];
  /** source/target are indices into `nodes`. */
  links: { source: number; target: number; value: number; kind: "flow" | "lost" | "win" }[];
}

export interface FunnelDecomposition {
  agentName: string;
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  agent: FunnelStageStats;
  floor: FunnelStageStats;
  leaks: FunnelLeak[];
  sankey: SankeyDatum;
  /** True when the agent has at least one daily aggregate row in window. */
  hasData: boolean;
  loading: boolean;
  error: string | null;
}

interface PerfRow {
  agent_name: string;
  scrape_date: string;
  dials: number | null;
  leads_worked: number | null;
  contacts_made: number | null;
  conversations: number | null;
  presentations: number | null;
  sales: number | null;
  premium: number | null;
}

const ZERO_STATS: FunnelStageStats = {
  dials: 0, leadsWorked: 0, contactsMade: 0,
  conversations: 0, presentations: 0, sales: 0, premium: 0,
  contactRate: 0, engagementRate: 0,
  conversationCloseRate: 0, presentationCloseRate: 0,
  avgPremiumPerSale: 0,
};

function aggregate(rows: PerfRow[]): FunnelStageStats {
  const sum = (sel: (r: PerfRow) => number | null) =>
    rows.reduce((s, r) => s + (sel(r) ?? 0), 0);

  const dials = sum((r) => r.dials);
  const leadsWorked = sum((r) => r.leads_worked);
  const contactsMade = sum((r) => r.contacts_made);
  const conversations = sum((r) => r.conversations);
  const presentations = sum((r) => r.presentations);
  const sales = sum((r) => r.sales);
  const premium = sum((r) => r.premium);

  // Sales attribution to conversation vs presentation (parallel buckets).
  // Weight presentations PRES_WEIGHT× higher because long calls close more.
  const weightedConv = conversations;
  const weightedPres = presentations * PRES_WEIGHT;
  const totalWeighted = weightedConv + weightedPres;
  const salesFromConv = totalWeighted > 0 ? sales * (weightedConv / totalWeighted) : 0;
  const salesFromPres = totalWeighted > 0 ? sales * (weightedPres / totalWeighted) : 0;

  return {
    dials, leadsWorked, contactsMade, conversations, presentations, sales, premium,
    contactRate: dials > 0 ? contactsMade / dials : 0,
    engagementRate: contactsMade > 0 ? (conversations + presentations) / contactsMade : 0,
    conversationCloseRate: conversations > 0 ? salesFromConv / conversations : 0,
    presentationCloseRate: presentations > 0 ? salesFromPres / presentations : 0,
    avgPremiumPerSale: sales > 0 ? premium / sales : 0,
  };
}

function buildSankey(s: FunnelStageStats): SankeyDatum {
  // Node order matters for layout — left to right.
  const nodes: SankeyDatum["nodes"] = [
    { name: "Dials", kind: "stage" },                   // 0
    { name: "Contact Made", kind: "stage" },            // 1
    { name: "Conversation 2-15m", kind: "stage" },      // 2
    { name: "Presentation 15m+", kind: "stage" },       // 3
    { name: "Sale", kind: "win" },                       // 4
    { name: "No Answer / VM", kind: "lost" },            // 5
    { name: "Short Call", kind: "lost" },                // 6
    { name: "Conv — No Close", kind: "lost" },           // 7
    { name: "Pres — No Close", kind: "lost" },           // 8
  ];

  const noContact = Math.max(0, s.dials - s.contactsMade);
  const shortCalls = Math.max(0, s.contactsMade - s.conversations - s.presentations);

  // Re-derive sale attribution with the same weighted formula used in aggregate().
  const weightedConv = s.conversations;
  const weightedPres = s.presentations * PRES_WEIGHT;
  const totalWeighted = weightedConv + weightedPres;
  const salesFromConv = totalWeighted > 0 ? s.sales * (weightedConv / totalWeighted) : 0;
  const salesFromPres = totalWeighted > 0 ? s.sales * (weightedPres / totalWeighted) : 0;

  const convLost = Math.max(0, s.conversations - salesFromConv);
  const presLost = Math.max(0, s.presentations - salesFromPres);

  const allLinks: SankeyDatum["links"] = [
    { source: 0, target: 1, value: s.contactsMade, kind: "flow" },
    { source: 0, target: 5, value: noContact, kind: "lost" },
    { source: 1, target: 2, value: s.conversations, kind: "flow" },
    { source: 1, target: 3, value: s.presentations, kind: "flow" },
    { source: 1, target: 6, value: shortCalls, kind: "lost" },
    { source: 2, target: 4, value: salesFromConv, kind: "win" },
    { source: 2, target: 7, value: convLost, kind: "lost" },
    { source: 3, target: 4, value: salesFromPres, kind: "win" },
    { source: 3, target: 8, value: presLost, kind: "lost" },
  ];
  // recharts Sankey rejects zero-width links and crashes on them.
  const links = allLinks.filter((l) => l.value > 0);

  return { nodes, links };
}

/**
 * Build the leak list comparing agent rates to floor rates.
 * Each leak's weekly $ value = (floor − agent) × upstream × avgPremium / windowDays × 7.
 */
function buildLeaks(
  agent: FunnelStageStats,
  floor: FunnelStageStats,
  windowDays: number,
): FunnelLeak[] {
  const days = Math.max(1, windowDays);
  const weeklyMultiplier = 7 / days;
  const avgPrem = agent.avgPremiumPerSale > 0 ? agent.avgPremiumPerSale : floor.avgPremiumPerSale;

  return [
    {
      id: "contact",
      label: "Contact Rate",
      blurb: "% of dials that got a live person on the phone.",
      agentRate: agent.contactRate,
      floorRate: floor.contactRate,
      upstreamVolume: agent.dials,
      windowDays: days,
      weeklyDollarsAtStake: agent.contactRate < floor.contactRate
        // Extra contacts × engagement rate × (proportional close rate) × avg premium
        ? (floor.contactRate - agent.contactRate) * agent.dials
            * floor.engagementRate
            * ((floor.conversationCloseRate + floor.presentationCloseRate) / 2)
            * avgPrem * weeklyMultiplier
        : 0,
    },
    {
      id: "engagement",
      label: "Engagement Rate",
      blurb: "% of live contacts that became real conversations (2+ min) or presentations.",
      agentRate: agent.engagementRate,
      floorRate: floor.engagementRate,
      upstreamVolume: agent.contactsMade,
      windowDays: days,
      weeklyDollarsAtStake: agent.engagementRate < floor.engagementRate
        ? (floor.engagementRate - agent.engagementRate) * agent.contactsMade
            * ((floor.conversationCloseRate + floor.presentationCloseRate) / 2)
            * avgPrem * weeklyMultiplier
        : 0,
    },
    {
      id: "conversation",
      label: "Conversation → Close",
      blurb: "How often a 2-15 min conversation turns into a sale.",
      agentRate: agent.conversationCloseRate,
      floorRate: floor.conversationCloseRate,
      upstreamVolume: agent.conversations,
      windowDays: days,
      weeklyDollarsAtStake: agent.conversationCloseRate < floor.conversationCloseRate
        ? (floor.conversationCloseRate - agent.conversationCloseRate)
            * agent.conversations * avgPrem * weeklyMultiplier
        : 0,
    },
    {
      id: "presentation",
      label: "Presentation → Close",
      blurb: "How often a 15+ min presentation turns into a sale. The biggest needle-mover.",
      agentRate: agent.presentationCloseRate,
      floorRate: floor.presentationCloseRate,
      upstreamVolume: agent.presentations,
      windowDays: days,
      weeklyDollarsAtStake: agent.presentationCloseRate < floor.presentationCloseRate
        ? (floor.presentationCloseRate - agent.presentationCloseRate)
            * agent.presentations * avgPrem * weeklyMultiplier
        : 0,
    },
  ];
}

export function useFunnelDecomposition(
  agentName: string | null | undefined,
  startDate: string,
  endDate: string,
): FunnelDecomposition {
  const [agentRows, setAgentRows] = useState<PerfRow[]>([]);
  const [floorRows, setFloorRows] = useState<PerfRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured || !agentName) {
      setAgentRows([]); setFloorRows([]); return;
    }
    setLoading(true); setError(null);
    try {
      const cols = "agent_name, scrape_date, dials, leads_worked, contacts_made, conversations, presentations, sales, premium";

      // Pull every daily aggregate row (scrape_hour IS NULL) for the window — single
      // round trip, then split client-side. The table indexes scrape_date so this is
      // cheap relative to two separate queries.
      const { data, error: qErr } = await supabase
        .from("agent_performance_daily")
        .select(cols)
        .gte("scrape_date", startDate)
        .lte("scrape_date", endDate)
        .is("scrape_hour", null);

      if (qErr) throw qErr;
      const all = (data ?? []) as PerfRow[];
      setAgentRows(all.filter((r) => r.agent_name === agentName));
      setFloorRows(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load funnel data");
      setAgentRows([]); setFloorRows([]);
    } finally {
      setLoading(false);
    }
  }, [agentName, startDate, endDate]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return useMemo<FunnelDecomposition>(() => {
    if (!agentName) {
      return {
        agentName: "", windowStart: startDate, windowEnd: endDate, windowDays: 0,
        agent: ZERO_STATS, floor: ZERO_STATS, leaks: [],
        sankey: { nodes: [], links: [] },
        hasData: false, loading, error,
      };
    }
    const agent = aggregate(agentRows);
    const floor = aggregate(floorRows);
    // Window length in calendar days, inclusive of both endpoints.
    const start = new Date(startDate + "T00:00:00Z").getTime();
    const end = new Date(endDate + "T00:00:00Z").getTime();
    const windowDays = Math.max(1, Math.round((end - start) / 86_400_000) + 1);

    return {
      agentName,
      windowStart: startDate,
      windowEnd: endDate,
      windowDays,
      agent,
      floor,
      leaks: buildLeaks(agent, floor, windowDays),
      sankey: buildSankey(agent),
      hasData: agentRows.length > 0,
      loading,
      error,
    };
  }, [agentName, startDate, endDate, agentRows, floorRows, loading, error]);
}
