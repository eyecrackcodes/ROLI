import { useState, useMemo, useCallback } from "react";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown, Gift, TrendingUp } from "lucide-react";
import type { DailyPulseAgent } from "@/lib/types";

function formatCurrency(val: number) {
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type SortDir = "asc" | "desc";
interface SortState { key: string; dir: SortDir }

function SortHeader({ label, sortKey, current, onToggle, align = "right" }: {
  label: string; sortKey: string; current: SortState; onToggle: (k: string) => void; align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors",
        align === "right" && "text-right"
      )}
      onClick={() => onToggle(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (current.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </th>
  );
}

interface BonusAgent {
  name: string;
  site: string;
  tier: string;
  bonusLeads: number;
  bonusSales: number;
  bonusPremium: number;
  bonusCR: number;
  regularSales: number;
  totalSales: number;
  bonusShare: number;
}

export default function BonusTracker() {
  const data = useData();
  const [sort, setSort] = useState<SortState>({ key: "bonusPremium", dir: "desc" });

  const toggle = useCallback((key: string) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });
  }, []);

  const allAgents = useMemo(() => [...data.dailyT1, ...data.dailyT2, ...data.dailyT3], [data.dailyT1, data.dailyT2, data.dailyT3]);

  const bonusAgents = useMemo(() => {
    const agents: BonusAgent[] = allAgents
      .filter((a) => (a.bonusSales ?? 0) > 0 || (a.bonusLeads ?? 0) > 0)
      .map((a) => {
        const bonusLeads = a.bonusLeads ?? 0;
        const bonusSales = a.bonusSales ?? 0;
        const bonusPremium = a.bonusPremium ?? 0;
        const regularSales = a.salesToday - bonusSales;
        return {
          name: a.name,
          site: a.site,
          tier: a.tier,
          bonusLeads,
          bonusSales,
          bonusPremium,
          bonusCR: bonusLeads > 0 ? (bonusSales / bonusLeads) * 100 : 0,
          regularSales,
          totalSales: a.salesToday,
          bonusShare: a.salesToday > 0 ? (bonusSales / a.salesToday) * 100 : 0,
        };
      });

    return [...agents].sort((a, b) => {
      const getValue = (agent: BonusAgent): number | string => {
        switch (sort.key) {
          case "name": return agent.name;
          case "site": return agent.site;
          case "tier": return agent.tier;
          case "bonusLeads": return agent.bonusLeads;
          case "bonusSales": return agent.bonusSales;
          case "bonusPremium": return agent.bonusPremium;
          case "bonusCR": return agent.bonusCR;
          case "regularSales": return agent.regularSales;
          case "totalSales": return agent.totalSales;
          case "bonusShare": return agent.bonusShare;
          default: return 0;
        }
      };
      const va = getValue(a), vb = getValue(b);
      if (typeof va === "string" && typeof vb === "string") {
        return sort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sort.dir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [allAgents, sort]);

  const totals = useMemo(() => {
    const all = allAgents;
    return {
      totalBonusLeads: all.reduce((s, a) => s + (a.bonusLeads ?? 0), 0),
      totalBonusSales: all.reduce((s, a) => s + (a.bonusSales ?? 0), 0),
      totalBonusPremium: all.reduce((s, a) => s + (a.bonusPremium ?? 0), 0),
      agentsWithBonus: all.filter((a) => (a.bonusSales ?? 0) > 0).length,
      totalAgents: all.length,
      totalSales: all.reduce((s, a) => s + a.salesToday, 0),
      totalPremium: all.reduce((s, a) => s + a.totalPremium, 0),
    };
  }, [allAgents]);

  const bonusCR = totals.totalBonusLeads > 0
    ? ((totals.totalBonusSales / totals.totalBonusLeads) * 100).toFixed(1) + "%"
    : "--";
  const bonusSharePct = totals.totalSales > 0
    ? ((totals.totalBonusSales / totals.totalSales) * 100).toFixed(1) + "%"
    : "0%";
  const premiumSharePct = totals.totalPremium > 0
    ? ((totals.totalBonusPremium / totals.totalPremium) * 100).toFixed(1) + "%"
    : "0%";

  const tierBreakdown = useMemo(() => {
    const tiers = ["T1", "T2", "T3"] as const;
    return tiers.map((tier) => {
      const tierAgents = allAgents.filter((a) => a.tier === tier);
      const leads = tierAgents.reduce((s, a) => s + (a.bonusLeads ?? 0), 0);
      const sales = tierAgents.reduce((s, a) => s + (a.bonusSales ?? 0), 0);
      const premium = tierAgents.reduce((s, a) => s + (a.bonusPremium ?? 0), 0);
      const withBonus = tierAgents.filter((a) => (a.bonusSales ?? 0) > 0).length;
      return { tier, leads, sales, premium, withBonus, total: tierAgents.length };
    });
  }, [allAgents]);

  const dateLabel = data.isRangeMode
    ? `${data.dateRange.start} to ${data.dateRange.end}`
    : data.selectedDate;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Gift className="h-5 w-5 text-purple-400" />
          Bonus & Referral Tracker
        </h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Spouse, referral, and custom sales tracking — {dateLabel}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Bonus Sales" value={totals.totalBonusSales} color="green" />
        <MetricCard label="Bonus Premium" value={formatCurrency(totals.totalBonusPremium)} color="blue" />
        <MetricCard label="Bonus Leads" value={totals.totalBonusLeads} />
        <MetricCard label="Bonus CR" value={bonusCR} color="yellow" />
        <MetricCard label="Sales Share" value={bonusSharePct} subtext="of total sales" />
        <MetricCard label="Premium Share" value={premiumSharePct} subtext="of total premium" />
      </div>

      {/* Tier breakdown */}
      <div className="bg-card border border-border rounded-md p-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Bonus Production by Tier
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {tierBreakdown.map(({ tier, leads, sales, premium, withBonus, total }) => (
            <div key={tier} className="p-3 rounded-md bg-background border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
                  tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                  tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                  "bg-amber-500/10 text-amber-400 border-amber-500/30"
                )}>
                  {tier}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">{withBonus}/{total} agents</span>
              </div>
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Leads</span>
                  <span className="text-foreground">{leads}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sales</span>
                  <span className="text-purple-400 font-bold">{sales}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premium</span>
                  <span className="text-foreground">{formatCurrency(premium)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CR</span>
                  <span className="text-foreground">{leads > 0 ? ((sales / leads) * 100).toFixed(1) + "%" : "--"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent-level detail table */}
      {bonusAgents.length > 0 ? (
        <div className="bg-card border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Agent Bonus Detail
            </h3>
            <span className="text-[10px] font-mono text-muted-foreground">
              {bonusAgents.length} agents with bonus activity
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground w-12">#</th>
                  <SortHeader label="Agent" sortKey="name" current={sort} onToggle={toggle} align="left" />
                  <SortHeader label="Tier" sortKey="tier" current={sort} onToggle={toggle} align="left" />
                  <SortHeader label="Site" sortKey="site" current={sort} onToggle={toggle} align="left" />
                  <SortHeader label="Bonus Leads" sortKey="bonusLeads" current={sort} onToggle={toggle} />
                  <SortHeader label="Bonus Sales" sortKey="bonusSales" current={sort} onToggle={toggle} />
                  <SortHeader label="Bonus Premium" sortKey="bonusPremium" current={sort} onToggle={toggle} />
                  <SortHeader label="Bonus CR" sortKey="bonusCR" current={sort} onToggle={toggle} />
                  <SortHeader label="Regular Sales" sortKey="regularSales" current={sort} onToggle={toggle} />
                  <SortHeader label="Total Sales" sortKey="totalSales" current={sort} onToggle={toggle} />
                  <SortHeader label="Bonus %" sortKey="bonusShare" current={sort} onToggle={toggle} />
                </tr>
              </thead>
              <tbody>
                {bonusAgents.map((agent, i) => (
                  <tr
                    key={agent.name}
                    className={cn(
                      "border-b border-border/50 transition-colors hover:bg-accent/30",
                      i % 2 === 0 ? "bg-transparent" : "bg-card/30"
                    )}
                  >
                    <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2.5 font-semibold text-foreground">{agent.name}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border",
                        agent.tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                        agent.tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                        "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      )}>
                        {agent.tier}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{agent.site}</td>
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.bonusLeads}</td>
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold text-purple-400">{agent.bonusSales}</td>
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.bonusPremium)}</td>
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                      <span className={cn(
                        agent.bonusCR >= 50 ? "text-emerald-400" : agent.bonusCR >= 25 ? "text-amber-400" : "text-red-400"
                      )}>
                        {agent.bonusCR > 0 ? agent.bonusCR.toFixed(1) + "%" : "--"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.regularSales}</td>
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.totalSales}</td>
                    <td className="px-3 py-2.5 font-mono text-right tabular-nums">
                      {agent.bonusShare > 0 && (
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-12 h-1.5 bg-border rounded-full overflow-hidden">
                            <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.min(agent.bonusShare, 100)}%` }} />
                          </div>
                          <span className="text-purple-400 text-[10px]">{agent.bonusShare.toFixed(0)}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-3 bg-card/30">
          <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-mono text-muted-foreground text-center">
            No bonus/referral activity for this period.
          </p>
        </div>
      )}
    </div>
  );
}
