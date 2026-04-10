import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { BUSINESS_HOURS } from "@/lib/t3Targets";

interface InvRow {
  scrape_hour: number;
  status: string;
  total_leads: number;
}

interface SnapRow {
  agent_name: string;
  scrape_hour: number;
  pool_dials: number;
  pool_self_assigned: number;
}

export interface PoolFlowPoint {
  hour: number;
  totalLeads: number;
  newLeads: number;
  attempt2: number;
  attempt3: number;
  delta: number;
  deltaPct: number;
  teamPoolDials: number;
  teamAssigns: number;
  teamDialsDelta: number;
  teamAssignsDelta: number;
}

export type PoolActionType = "add_agents" | "reduce_pool" | "assign_discipline" | "balanced" | "low_inventory" | "depletion_warning" | "surplus_hours";

export interface PoolAction {
  type: PoolActionType;
  severity: "info" | "warning" | "critical";
  label: string;
  detail: string;
}

export interface PoolFlowStatus {
  direction: "growing" | "shrinking" | "stable";
  rate: number;
  totalDelta: number;
  actions: PoolAction[];
  points: PoolFlowPoint[];
  latestHour: number;
  startSize: number;
  endSize: number;
  activeAgents: number;
}

function getCentralDate(): string {
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return central.toISOString().slice(0, 10);
}

function hourLabel(h: number): string {
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display} ${suffix}`;
}

function buildActions(
  points: PoolFlowPoint[],
  direction: "growing" | "shrinking" | "stable",
  rate: number,
  totalDelta: number,
  startSize: number,
  endSize: number,
  activeAgents: number,
): PoolAction[] {
  const actions: PoolAction[] = [];
  if (points.length < 2) return actions;

  const latest = points[points.length - 1];
  const first = points[0];
  const hoursElapsed = points.length - 1;

  // Compute burn rate (team dials per hour)
  const totalTeamDials = latest.teamPoolDials;
  const burnPerHour = hoursElapsed > 0 ? totalTeamDials / hoursElapsed : 0;
  const avgDialsPerAgent = activeAgents > 0 ? burnPerHour / activeAgents : 0;

  // Attempt 3 growth
  const attempt3Delta = latest.attempt3 - first.attempt3;
  const attempt3GrowthPct = first.attempt3 > 0 ? (attempt3Delta / first.attempt3) * 100 : 0;

  // Hours remaining in day
  const hoursLeft = Math.max(0, BUSINESS_HOURS.END - latest.hour);

  if (direction === "growing") {
    // Surplus work hours
    if (burnPerHour > 0 && totalDelta > 0) {
      const hoursToWork = (totalDelta / burnPerHour).toFixed(1);
      actions.push({
        type: "surplus_hours",
        severity: "warning",
        label: `Pool grew +${totalDelta} leads today (${rate > 0 ? "+" : ""}${rate.toFixed(1)}%/hr)`,
        detail: `At the current burn rate of ${Math.round(burnPerHour)} pool dials/hr, the team needs ~${hoursToWork} extra hours to work through the surplus.`,
      });
    }

    // Need more agents
    if (totalDelta > startSize * 0.10 && hoursLeft > 0 && avgDialsPerAgent > 0) {
      const surplusPerHour = totalDelta / hoursElapsed;
      const neededAgents = Math.ceil(surplusPerHour / avgDialsPerAgent);
      actions.push({
        type: "add_agents",
        severity: "critical",
        label: `Add ${neededAgents} more agent${neededAgents > 1 ? "s" : ""} to pool rotation`,
        detail: `Pool is filling ${Math.round(surplusPerHour)} leads/hr faster than ${activeAgents} agents can work it. Each agent averages ${Math.round(avgDialsPerAgent)} pool dials/hr.`,
      });
    }

    // Attempt 3 recycling
    if (attempt3Delta > 100 || attempt3GrowthPct > 50) {
      actions.push({
        type: "assign_discipline",
        severity: "warning",
        label: `Attempt 3 leads accumulating: ${latest.attempt3.toLocaleString()} (${attempt3Delta > 0 ? "+" : ""}${attempt3Delta})`,
        detail: `These are contacts being re-dialed without self-assignment. Review agent assign discipline — every answered contact should be self-assigned to remove it from rotation.`,
      });
    }

  } else if (direction === "shrinking") {
    // Depletion estimate
    if (rate < 0 && hoursLeft > 0) {
      const shrinkPerHour = Math.abs(totalDelta) / hoursElapsed;
      const hoursUntilThreshold = endSize > 500 ? ((endSize - 500) / shrinkPerHour) : 0;
      if (hoursUntilThreshold > 0 && hoursUntilThreshold < hoursLeft) {
        actions.push({
          type: "depletion_warning",
          severity: "warning",
          label: `Pool will drop below 500 leads by ~${hourLabel(latest.hour + Math.ceil(hoursUntilThreshold))}`,
          detail: `Shrinking at ~${Math.round(shrinkPerHour)} leads/hr. At this rate, contactable inventory will be critically low in ${hoursUntilThreshold.toFixed(1)} hours.`,
        });
      }
    }

    // Low inventory
    if (endSize < 500) {
      actions.push({
        type: "low_inventory",
        severity: "critical",
        label: `Low pool inventory: ${endSize.toLocaleString()} contactable leads`,
        detail: `Tell agents to reduce pool time and focus on their personal pipeline until pool refills. Pause pool sessions for agents who've already hit their daily pool dial target.`,
      });
    } else if (endSize < 800) {
      actions.push({
        type: "reduce_pool",
        severity: "warning",
        label: `Pool inventory declining: ${endSize.toLocaleString()} leads remaining`,
        detail: `Consider having agents prioritize pipeline work over pool. Reserve pool time for agents who still need long calls.`,
      });
    }

  } else {
    actions.push({
      type: "balanced",
      severity: "info",
      label: "Pool is balanced",
      detail: `Fill rate matches production velocity. Pool moved ${totalDelta > 0 ? "+" : ""}${totalDelta} leads across ${hoursElapsed} hours — no action needed.`,
    });
  }

  return actions;
}

export function usePoolFlow(overrideDate?: string) {
  const [status, setStatus] = useState<PoolFlowStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const targetDate = overrideDate ?? getCentralDate();

  const fetchFlow = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);

    try {
      const [{ data: invData }, { data: snapData }] = await Promise.all([
        supabase.from("leads_pool_inventory")
          .select("scrape_hour, status, total_leads")
          .eq("scrape_date", targetDate)
          .order("scrape_hour"),
        supabase.from("intraday_snapshots")
          .select("agent_name, scrape_hour, pool_dials, pool_self_assigned")
          .eq("scrape_date", targetDate)
          .gt("pool_dials", 0)
          .order("scrape_hour"),
      ]);

      if (!invData || invData.length === 0) {
        setStatus(null);
        return;
      }

      const rows = invData as InvRow[];
      const snaps = (snapData ?? []) as SnapRow[];

      // Group inventory by hour
      const hourMap = new Map<number, { newLeads: number; attempt2: number; attempt3: number; other: number }>();
      for (const r of rows) {
        const h = r.scrape_hour;
        const entry = hourMap.get(h) ?? { newLeads: 0, attempt2: 0, attempt3: 0, other: 0 };
        if (r.status.toLowerCase().includes("new")) entry.newLeads += r.total_leads;
        else if (r.status.includes("2")) entry.attempt2 += r.total_leads;
        else if (r.status.includes("3")) entry.attempt3 += r.total_leads;
        else entry.other += r.total_leads;
        hourMap.set(h, entry);
      }

      // Group intraday snapshots — track unique agents and cumulative dials per hour
      const agentHourDials = new Map<string, Map<number, { dials: number; assigns: number }>>();
      for (const s of snaps) {
        let agentMap = agentHourDials.get(s.agent_name);
        if (!agentMap) { agentMap = new Map(); agentHourDials.set(s.agent_name, agentMap); }
        agentMap.set(s.scrape_hour, { dials: s.pool_dials ?? 0, assigns: s.pool_self_assigned ?? 0 });
      }

      const activeAgents = agentHourDials.size;

      const hours = [...hourMap.keys()].sort((a, b) => a - b);
      const teamByHour = new Map<number, { dials: number; assigns: number }>();
      for (const h of hours) {
        let totalDials = 0, totalAssigns = 0;
        for (const [, agentMap] of agentHourDials) {
          let bestHour = -1;
          let bestVal = { dials: 0, assigns: 0 };
          for (const [ah, val] of agentMap) {
            if (ah <= h && ah > bestHour) { bestHour = ah; bestVal = val; }
          }
          if (bestHour >= 0) { totalDials += bestVal.dials; totalAssigns += bestVal.assigns; }
        }
        teamByHour.set(h, { dials: totalDials, assigns: totalAssigns });
      }

      // Build flow points
      const points: PoolFlowPoint[] = [];
      for (let i = 0; i < hours.length; i++) {
        const h = hours[i];
        const inv = hourMap.get(h)!;
        const totalLeads = inv.newLeads + inv.attempt2 + inv.attempt3 + inv.other;
        const prevTotal = i > 0 ? points[i - 1].totalLeads : totalLeads;
        const delta = totalLeads - prevTotal;
        const deltaPct = prevTotal > 0 ? (delta / prevTotal) * 100 : 0;

        const team = teamByHour.get(h) ?? { dials: 0, assigns: 0 };
        const prevTeam = i > 0 ? { dials: points[i - 1].teamPoolDials, assigns: points[i - 1].teamAssigns } : { dials: 0, assigns: 0 };

        points.push({
          hour: h, totalLeads,
          newLeads: inv.newLeads, attempt2: inv.attempt2, attempt3: inv.attempt3,
          delta, deltaPct,
          teamPoolDials: team.dials, teamAssigns: team.assigns,
          teamDialsDelta: team.dials - prevTeam.dials,
          teamAssignsDelta: team.assigns - prevTeam.assigns,
        });
      }

      const startSize = points[0]?.totalLeads ?? 0;
      const endSize = points[points.length - 1]?.totalLeads ?? 0;
      const totalDelta = endSize - startSize;
      const avgRate = points.length > 1 && startSize > 0 ? (totalDelta / startSize) * 100 / (points.length - 1) : 0;

      const direction: PoolFlowStatus["direction"] =
        totalDelta > startSize * 0.02 ? "growing"
        : totalDelta < -(startSize * 0.02) ? "shrinking"
        : "stable";

      const actions = buildActions(points, direction, avgRate, totalDelta, startSize, endSize, activeAgents);

      setStatus({
        direction, rate: avgRate, totalDelta, actions, points,
        latestHour: hours[hours.length - 1], startSize, endSize, activeAgents,
      });
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, [targetDate]);

  useEffect(() => { fetchFlow(); }, [fetchFlow]);

  return { status, loading, refresh: fetchFlow };
}
