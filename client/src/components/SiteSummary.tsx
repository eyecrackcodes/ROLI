import { cn } from "@/lib/utils";

interface AgentWithSite {
  site?: string;
  ibCalls?: number;
  ibSales?: number;
  obLeads?: number;
  obSales?: number;
  bonusSales?: number;
  customSales?: number;
  totalPremium: number;
  premiumToday?: number;
  // Monthly fields
  leadCost?: number;
  profit?: number;
  roli?: number;
}

interface SiteSummaryProps {
  agents: AgentWithSite[];
  showProfit?: boolean;
}

interface SiteStats {
  sales: number;
  premium: number;
  ibLeads: number;
  ibSales: number;
  obLeads: number;
  obSales: number;
  bonus: number;
  bonusPremium: number;
  agents: number;
  profit: number;
  leadCost: number;
}

function calcSite(agents: AgentWithSite[], siteCode: string): SiteStats {
  const filtered = agents.filter((a) => a.site === siteCode);
  return {
    sales: filtered.reduce((s, a) => s + (a.ibSales ?? 0) + (a.obSales ?? 0), 0),
    premium: filtered.reduce((s, a) => s + a.totalPremium, 0),
    ibLeads: filtered.reduce((s, a) => s + (a.ibCalls ?? 0), 0),
    ibSales: filtered.reduce((s, a) => s + (a.ibSales ?? 0), 0),
    obLeads: filtered.reduce((s, a) => s + (a.obLeads ?? 0), 0),
    obSales: filtered.reduce((s, a) => s + (a.obSales ?? 0), 0),
    bonus: filtered.reduce((s, a) => s + (a.bonusSales ?? a.customSales ?? 0), 0),
    bonusPremium: 0,
    agents: filtered.length,
    profit: filtered.reduce((s, a) => s + (a.profit ?? 0), 0),
    leadCost: filtered.reduce((s, a) => s + (a.leadCost ?? 0), 0),
  };
}

function formatCR(sales: number, leads: number): string {
  if (leads === 0) return "--";
  return ((sales / leads) * 100).toFixed(1) + "%";
}

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString();
}

function SiteCard({
  label,
  stats,
  showProfit,
  className,
}: {
  label: string;
  stats: SiteStats;
  showProfit?: boolean;
  className?: string;
}) {
  const totalSales = stats.sales + stats.bonus;
  const ibCR = formatCR(stats.ibSales, stats.ibLeads);
  const obCR = formatCR(stats.obSales, stats.obLeads);

  return (
    <div className={cn("bg-card border border-border rounded-md p-4 space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {stats.agents} agents
        </span>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-mono font-bold text-foreground tabular-nums">
          {totalSales}
        </span>
        <span className="text-xs font-mono text-muted-foreground">sales</span>
        <span className="text-lg font-mono font-bold text-blue-400 tabular-nums">
          {fmt(stats.premium)}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono">
        <span>
          IB CR: <span className={cn("font-bold", ibCR !== "--" ? "text-emerald-400" : "text-muted-foreground")}>{ibCR}</span>
        </span>
        <span>
          OB CR: <span className={cn("font-bold", obCR !== "--" ? "text-amber-400" : "text-muted-foreground")}>{obCR}</span>
        </span>
      </div>

      {stats.bonus > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground">
          + {stats.bonus} bonus sales
        </div>
      )}

      {showProfit && (
        <div className="flex items-center gap-3 text-xs font-mono pt-1 border-t border-border/50">
          <span>
            Profit: <span className={cn("font-bold", stats.profit >= 0 ? "text-emerald-400" : "text-red-400")}>{fmt(stats.profit)}</span>
          </span>
          <span>
            Cost: <span className="text-muted-foreground">{fmt(stats.leadCost)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

export function SiteSummary({ agents, showProfit }: SiteSummaryProps) {
  const rmt = calcSite(agents, "RMT");
  const clt = calcSite(agents, "CHA");
  const atx = calcSite(agents, "AUS");

  const sites: Array<{ label: string; stats: SiteStats }> = [];
  if (rmt.agents > 0) sites.push({ label: "RMT (Remote)", stats: rmt });
  if (clt.agents > 0) sites.push({ label: "CLT (Charlotte)", stats: clt });
  if (atx.agents > 0) sites.push({ label: "ATX (Austin)", stats: atx });

  const combined: SiteStats = {
    sales: sites.reduce((s, x) => s + x.stats.sales, 0),
    premium: sites.reduce((s, x) => s + x.stats.premium, 0),
    ibLeads: sites.reduce((s, x) => s + x.stats.ibLeads, 0),
    ibSales: sites.reduce((s, x) => s + x.stats.ibSales, 0),
    obLeads: sites.reduce((s, x) => s + x.stats.obLeads, 0),
    obSales: sites.reduce((s, x) => s + x.stats.obSales, 0),
    bonus: sites.reduce((s, x) => s + x.stats.bonus, 0),
    bonusPremium: 0,
    agents: sites.reduce((s, x) => s + x.stats.agents, 0),
    profit: sites.reduce((s, x) => s + x.stats.profit, 0),
    leadCost: sites.reduce((s, x) => s + x.stats.leadCost, 0),
  };

  if (combined.agents === 0) return null;

  const cols = sites.length + 1;

  return (
    <div className={`grid grid-cols-1 md:grid-cols-${Math.min(cols, 4)} gap-3`}>
      {sites.map(({ label, stats }) => (
        <SiteCard key={label} label={label} stats={stats} showProfit={showProfit} />
      ))}
      <SiteCard label="Combined" stats={combined} showProfit={showProfit} className="border-blue-500/30" />
    </div>
  );
}
