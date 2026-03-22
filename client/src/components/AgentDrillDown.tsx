import { useAgentTrends } from "@/hooks/useAgentTrends";
import { TrendLineChart, Sparkline, DeltaBadge } from "@/components/TrendChart";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface AgentDrillDownProps {
  agentName: string | null;
  tier?: string;
  site?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(val: number) {
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function AgentDrillDown({ agentName, tier, site, open, onOpenChange }: AgentDrillDownProps) {
  const { daily, intraday, deltas, loading } = useAgentTrends(agentName, 7);

  const latestDay = daily.length > 0 ? daily[daily.length - 1] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] sm:w-[480px] bg-background border-border overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle className="text-lg font-bold text-foreground">{agentName}</SheetTitle>
          <div className="flex items-center gap-2 mt-1">
            {tier && (
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
                tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                "bg-amber-500/10 text-amber-400 border-amber-500/30"
              )}>
                {tier}
              </span>
            )}
            {site && <span className="text-xs font-mono text-muted-foreground">{site}</span>}
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading trends...</p>
          </div>
        ) : (
          <div className="space-y-6 pt-4">
            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-card rounded-md border border-border">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Sales</span>
                <span className="text-xl font-mono font-bold text-foreground">{latestDay?.sales ?? 0}</span>
                <div className="mt-1"><DeltaBadge value={deltas.salesVsYesterday} /></div>
                <span className="text-[9px] font-mono text-muted-foreground">vs yesterday</span>
              </div>
              <div className="p-3 bg-card rounded-md border border-border">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Premium</span>
                <span className="text-xl font-mono font-bold text-foreground">{latestDay ? formatCurrency(latestDay.premium) : "$0"}</span>
                <div className="mt-1"><DeltaBadge value={deltas.premiumVsYesterday} format="currency" /></div>
                <span className="text-[9px] font-mono text-muted-foreground">vs yesterday</span>
              </div>
              <div className="p-3 bg-card rounded-md border border-border">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Close Rate</span>
                <span className="text-xl font-mono font-bold text-foreground">{latestDay?.closeRate.toFixed(1) ?? "0"}%</span>
              </div>
              <div className="p-3 bg-card rounded-md border border-border">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Dials</span>
                <span className="text-xl font-mono font-bold text-foreground">{latestDay?.dials ?? 0}</span>
              </div>
            </div>

            {/* Sparkline Summary */}
            <div className="space-y-2">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
                Last {daily.length} Days
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-card rounded border border-border text-center">
                  <span className="text-[9px] font-mono text-muted-foreground block mb-1">Sales</span>
                  <Sparkline data={daily.map((d) => d.sales)} color="#34d399" width={60} height={20} />
                </div>
                <div className="p-2 bg-card rounded border border-border text-center">
                  <span className="text-[9px] font-mono text-muted-foreground block mb-1">Premium</span>
                  <Sparkline data={daily.map((d) => d.premium)} color="#60a5fa" width={60} height={20} />
                </div>
                <div className="p-2 bg-card rounded border border-border text-center">
                  <span className="text-[9px] font-mono text-muted-foreground block mb-1">CR%</span>
                  <Sparkline data={daily.map((d) => d.closeRate)} color="#fbbf24" width={60} height={20} />
                </div>
              </div>
            </div>

            {/* Daily Trend Chart */}
            <div className="space-y-2">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
                Daily Sales & Premium
              </h3>
              <TrendLineChart
                data={daily}
                xKey="date"
                lines={[
                  { key: "sales", color: "#34d399", name: "Sales", yAxisId: "left" },
                  { key: "premium", color: "#60a5fa", name: "Premium", yAxisId: "right" },
                ]}
                dualAxis
                height={200}
              />
            </div>

            {/* Intraday (if available) */}
            {intraday.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
                  Today's Intraday
                </h3>
                <TrendLineChart
                  data={intraday}
                  xKey="hourLabel"
                  lines={[
                    { key: "sales", color: "#34d399", name: "Sales" },
                    { key: "dials", color: "#a78bfa", name: "Dials" },
                  ]}
                  height={180}
                />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
