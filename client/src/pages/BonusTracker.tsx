import { useState, useMemo, useCallback, useEffect } from "react";
import { useData } from "@/contexts/DataContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { MetricCard } from "@/components/MetricCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown, Gift, TrendingUp, Calendar, Zap } from "lucide-react";

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

interface BonusRow {
  agent_name: string;
  tier: string;
  custom_leads: number;
  custom_sales: number;
  custom_premium: number;
  ib_sales: number;
  ob_sales: number;
  scrape_date: string;
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
  daysActive: number;
}

function todayCentral(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export default function BonusTracker() {
  const data = useData();
  const [sort, setSort] = useState<SortState>({ key: "bonusPremium", dir: "desc" });
  const [startDate, setStartDate] = useState(data.windowStart);
  const [endDate, setEndDate] = useState(() => todayCentral());
  const [rows, setRows] = useState<BonusRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (data.windowStart) setStartDate(data.windowStart);
  }, [data.windowStart]);

  const fetchBonusData = useCallback(async () => {
    if (!isSupabaseConfigured || !startDate || !endDate) return;
    setLoading(true);
    try {
      const { data: result } = await supabase
        .from("daily_scrape_data")
        .select("agent_name, tier, custom_leads, custom_sales, custom_premium, ib_sales, ob_sales, scrape_date")
        .gte("scrape_date", startDate)
        .lte("scrape_date", endDate);
      setRows((result ?? []) as BonusRow[]);
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { fetchBonusData(); }, [fetchBonusData]);

  const toggle = useCallback((key: string) => {
    setSort((prev) => prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });
  }, []);

  const agentSiteMap = useMemo(() => {
    const map = new Map<string, string>();
    [...data.dailyT1, ...data.dailyT2, ...data.dailyT3].forEach((a) => map.set(a.name, a.site));
    return map;
  }, [data.dailyT1, data.dailyT2, data.dailyT3]);

  const bonusAgents = useMemo(() => {
    const grouped = new Map<string, { rows: BonusRow[]; dates: Set<string> }>();
    for (const row of rows) {
      const existing = grouped.get(row.agent_name) ?? { rows: [], dates: new Set() };
      existing.rows.push(row);
      existing.dates.add(row.scrape_date);
      grouped.set(row.agent_name, existing);
    }

    const agents: BonusAgent[] = [];
    for (const [name, { rows: agentRows, dates }] of grouped) {
      const bonusLeads = agentRows.reduce((s, r) => s + (r.custom_leads ?? 0), 0);
      const bonusSales = agentRows.reduce((s, r) => s + (r.custom_sales ?? 0), 0);
      const bonusPremium = agentRows.reduce((s, r) => s + Number(r.custom_premium ?? 0), 0);
      const regularSales = agentRows.reduce((s, r) => s + r.ib_sales + r.ob_sales, 0);
      const totalSales = regularSales + bonusSales;

      if (bonusLeads === 0 && bonusSales === 0) continue;

      agents.push({
        name,
        site: agentSiteMap.get(name) ?? "CHA",
        tier: agentRows[0].tier,
        bonusLeads,
        bonusSales,
        bonusPremium,
        bonusCR: bonusLeads > 0 ? (bonusSales / bonusLeads) * 100 : 0,
        regularSales,
        totalSales,
        bonusShare: totalSales > 0 ? (bonusSales / totalSales) * 100 : 0,
        daysActive: dates.size,
      });
    }

    return [...agents].sort((a, b) => {
      const get = (agent: BonusAgent): number | string => {
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
          case "daysActive": return agent.daysActive;
          default: return 0;
        }
      };
      const va = get(a), vb = get(b);
      if (typeof va === "string") return sort.dir === "asc" ? (va as string).localeCompare(vb as string) : (vb as string).localeCompare(va as string);
      return sort.dir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [rows, sort, agentSiteMap]);

  const totals = useMemo(() => {
    const allBonusLeads = rows.reduce((s, r) => s + (r.custom_leads ?? 0), 0);
    const allBonusSales = rows.reduce((s, r) => s + (r.custom_sales ?? 0), 0);
    const allBonusPremium = rows.reduce((s, r) => s + Number(r.custom_premium ?? 0), 0);
    const allRegularSales = rows.reduce((s, r) => s + r.ib_sales + r.ob_sales, 0);
    const allTotalSales = allRegularSales + allBonusSales;
    const allTotalPremium = rows.reduce((s, r) => s + Number(r.custom_premium ?? 0) + Number((r as any).ib_premium ?? 0) + Number((r as any).ob_premium ?? 0), 0);
    const uniqueDates = new Set(rows.map((r) => r.scrape_date)).size;

    return {
      bonusLeads: allBonusLeads,
      bonusSales: allBonusSales,
      bonusPremium: allBonusPremium,
      totalSales: allTotalSales,
      agentsWithBonus: bonusAgents.length,
      uniqueDates,
      salesShare: allTotalSales > 0 ? ((allBonusSales / allTotalSales) * 100).toFixed(1) + "%" : "0%",
      cr: allBonusLeads > 0 ? ((allBonusSales / allBonusLeads) * 100).toFixed(1) + "%" : "--",
    };
  }, [rows, bonusAgents.length]);

  const siteBreakdown = useMemo(() => {
    const siteSet = new Set(rows.map(r => r.site ?? "Other"));
    return Array.from(siteSet).sort().map((site) => {
      const siteRows = rows.filter((r) => (r.site ?? "Other") === site);
      const leads = siteRows.reduce((s, r) => s + (r.custom_leads ?? 0), 0);
      const sales = siteRows.reduce((s, r) => s + (r.custom_sales ?? 0), 0);
      const premium = siteRows.reduce((s, r) => s + Number(r.custom_premium ?? 0), 0);
      const agentsWithActivity = new Set(siteRows.filter((r) => (r.custom_leads ?? 0) > 0 || (r.custom_sales ?? 0) > 0).map((r) => r.agent_name)).size;
      const totalAgents = new Set(siteRows.map((r) => r.agent_name)).size;
      return { site, leads, sales, premium, agentsWithActivity, totalAgents };
    });
  }, [rows]);

  const windowName = data.activeWindow ? (data.activeWindow as { name?: string }).name ?? "Current" : "Current";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Gift className="h-5 w-5 text-purple-400" />
          Bonus & Referral Tracker
        </h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Spouse, referral, and custom sale tracking across the organization
        </p>
      </div>

      {/* Date picker */}
      <div className="bg-card border border-border rounded-md p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="font-mono bg-background w-36 text-center text-xs h-8"
          />
          <span className="text-xs font-mono text-muted-foreground">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="font-mono bg-background w-36 text-center text-xs h-8"
          />

          <div className="h-5 w-px bg-border mx-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setStartDate(data.windowStart); setEndDate(data.availableDates[0] ?? todayCentral()); }}
            className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            {windowName} WINDOW
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const today = todayCentral();
              setStartDate(today);
              setEndDate(today);
            }}
            className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            TODAY
          </Button>
          {data.availableDates.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStartDate(data.availableDates[data.availableDates.length - 1]); setEndDate(data.availableDates[0]); }}
              className="font-mono text-[10px] h-7 px-2 text-muted-foreground hover:text-foreground"
            >
              ALL DATA
            </Button>
          )}

          <div className="flex-1" />
          <span className="text-[10px] font-mono text-muted-foreground">
            {totals.uniqueDates} day{totals.uniqueDates !== 1 ? "s" : ""} of data
          </span>
        </div>
      </div>

      {loading ? (
        <div className="border border-dashed border-border rounded-md p-12 flex items-center justify-center bg-card/30">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading bonus data...</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard label="Bonus Sales" value={totals.bonusSales} color="green" />
            <MetricCard label="Bonus Premium" value={formatCurrency(totals.bonusPremium)} color="blue" />
            <MetricCard label="Bonus Leads" value={totals.bonusLeads} />
            <MetricCard label="Bonus CR" value={totals.cr} color="yellow" />
            <MetricCard label="Sales Share" value={totals.salesShare} subtext="of total sales" />
            <MetricCard label="Agents Active" value={totals.agentsWithBonus} subtext={`of ${new Set(rows.map((r) => r.agent_name)).size}`} />
          </div>

          {/* Site breakdown */}
          <div className="bg-card border border-border rounded-md p-4">
            <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Bonus Production by Site
            </h3>
            <div className={cn("grid gap-4", siteBreakdown.length === 2 ? "grid-cols-2" : siteBreakdown.length >= 3 ? "grid-cols-3" : "grid-cols-1")}>
              {siteBreakdown.map(({ site, leads, sales, premium, agentsWithActivity, totalAgents }) => (
                <div key={site} className="p-3 rounded-md bg-background border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
                      site === "RMT" ? "bg-violet-500/10 text-violet-400 border-violet-500/30" :
                      site === "CLT" || site === "CHA" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                      "bg-blue-500/10 text-blue-400 border-blue-500/30"
                    )}>
                      {site}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">{agentsWithActivity}/{totalAgents} agents</span>
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
                      <SortHeader label="Site" sortKey="site" current={sort} onToggle={toggle} align="left" />
                      <SortHeader label="Days" sortKey="daysActive" current={sort} onToggle={toggle} />
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
                            agent.site === "RMT" ? "bg-violet-500/10 text-violet-400 border-violet-500/30" :
                            (agent.site === "CLT" || agent.site === "CHA") ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                            "bg-blue-500/10 text-blue-400 border-blue-500/30"
                          )}>
                            {agent.site}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-right tabular-nums text-muted-foreground">{agent.daysActive}</td>
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
                No bonus/referral activity for {startDate} to {endDate}.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
