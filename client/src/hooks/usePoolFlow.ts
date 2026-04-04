import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

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

export interface PoolFlowStatus {
  direction: "growing" | "shrinking" | "stable";
  rate: number;
  totalDelta: number;
  alert: string | null;
  points: PoolFlowPoint[];
  latestHour: number;
  startSize: number;
  endSize: number;
}

function getCentralDate(): string {
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return central.toISOString().slice(0, 10);
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
          .eq("tier", "T3")
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

      // Group intraday snapshots by hour — sum across agents (cumulative values, take max per agent per hour)
      const agentHourDials = new Map<string, Map<number, { dials: number; assigns: number }>>();
      for (const s of snaps) {
        let agentMap = agentHourDials.get(s.agent_name);
        if (!agentMap) { agentMap = new Map(); agentHourDials.set(s.agent_name, agentMap); }
        agentMap.set(s.scrape_hour, { dials: s.pool_dials ?? 0, assigns: s.pool_self_assigned ?? 0 });
      }

      // For each hour, sum the latest cumulative values across all agents
      const hours = [...hourMap.keys()].sort((a, b) => a - b);
      const teamByHour = new Map<number, { dials: number; assigns: number }>();
      for (const h of hours) {
        let totalDials = 0, totalAssigns = 0;
        for (const [, agentMap] of agentHourDials) {
          // Find this agent's value at this hour or the closest prior hour
          let best: { dials: number; assigns: number } | undefined;
          for (const [ah, val] of agentMap) {
            if (ah <= h) {
              if (!best || ah > (best as { dials: number; assigns: number } & { _h?: number })._h!) {
                best = val;
                (best as { dials: number; assigns: number } & { _h?: number })._h = ah;
              }
            }
          }
          if (best) { totalDials += best.dials; totalAssigns += best.assigns; }
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
          hour: h,
          totalLeads,
          newLeads: inv.newLeads,
          attempt2: inv.attempt2,
          attempt3: inv.attempt3,
          delta,
          deltaPct,
          teamPoolDials: team.dials,
          teamAssigns: team.assigns,
          teamDialsDelta: team.dials - prevTeam.dials,
          teamAssignsDelta: team.assigns - prevTeam.assigns,
        });
      }

      // Compute overall flow status
      const startSize = points[0]?.totalLeads ?? 0;
      const endSize = points[points.length - 1]?.totalLeads ?? 0;
      const totalDelta = endSize - startSize;
      const avgRate = points.length > 1 ? (totalDelta / startSize) * 100 / (points.length - 1) : 0;

      const direction: PoolFlowStatus["direction"] =
        totalDelta > startSize * 0.02 ? "growing"
        : totalDelta < -(startSize * 0.02) ? "shrinking"
        : "stable";

      // Alert detection
      let alert: string | null = null;
      const consecutiveGrowing = points.reduce((run, p) => p.delta > 0 ? run + 1 : 0, 0);
      const consecutiveShrinking = points.reduce((run, p) => p.delta < 0 ? run + 1 : 0, 0);

      if (consecutiveGrowing >= 3 && avgRate > 2) {
        alert = `Pool growing ${avgRate.toFixed(1)}%/hr for ${consecutiveGrowing} consecutive hours — leads are outpacing production capacity.`;
      } else if (consecutiveShrinking >= 3 && avgRate < -5) {
        alert = `Pool shrinking ${Math.abs(avgRate).toFixed(1)}%/hr for ${consecutiveShrinking} consecutive hours — may run out of contactable leads.`;
      } else if (totalDelta > startSize * 0.15) {
        alert = `Pool grew ${((totalDelta / startSize) * 100).toFixed(0)}% today (+${totalDelta} leads) — consider adding pool capacity.`;
      }

      setStatus({
        direction,
        rate: avgRate,
        totalDelta,
        alert,
        points,
        latestHour: hours[hours.length - 1],
        startSize,
        endSize,
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
