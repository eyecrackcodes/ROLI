import { cn } from "@/lib/utils";
import type { FunnelMetrics } from "@/lib/types";

interface FunnelStage {
  label: string;
  value: number;
  color: string;
  ratePct: string;
  rateLabel: string;
}

function buildStages(funnel: FunnelMetrics): FunnelStage[] {
  return [
    {
      label: "Dials",
      value: funnel.dials,
      color: "#a78bfa",
      ratePct: "",
      rateLabel: "",
    },
    {
      label: "Leads Worked",
      value: funnel.leadsWorked,
      color: "#818cf8",
      ratePct: funnel.dials > 0 ? ((funnel.leadsWorked / funnel.dials) * 100).toFixed(0) + "%" : "--",
      rateLabel: "work rate",
    },
    {
      label: "Contact Made",
      value: funnel.contactsMade,
      color: "#60a5fa",
      ratePct: funnel.contactPct.toFixed(0) + "%",
      rateLabel: "contact %",
    },
    {
      label: "Convos 2-15m",
      value: funnel.conversations,
      color: "#22d3ee",
      ratePct: funnel.conversationToClosePct.toFixed(0) + "%",
      rateLabel: "convo→close",
    },
    {
      label: "Pres 15m+",
      value: funnel.presentations,
      color: "#fbbf24",
      ratePct: funnel.presentationToClosePct.toFixed(0) + "%",
      rateLabel: "pres→close",
    },
    {
      label: "Sales",
      value: funnel.sales,
      color: "#34d399",
      ratePct: funnel.contactToClosePct.toFixed(0) + "%",
      rateLabel: "contact→close",
    },
  ];
}

function TrapezoidFunnel({ stages }: { stages: FunnelStage[] }) {
  const maxVal = Math.max(...stages.map(s => s.value), 1);

  return (
    <div className="relative flex flex-col items-center gap-0">
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.value / maxVal) * 100, 12);
        const nextWidthPct = i < stages.length - 1
          ? Math.max((stages[i + 1].value / maxVal) * 100, 12)
          : widthPct;

        const topLeft = (100 - widthPct) / 2;
        const topRight = 100 - topLeft;
        const botLeft = (100 - nextWidthPct) / 2;
        const botRight = 100 - botLeft;

        const clipPath = `polygon(${topLeft}% 0%, ${topRight}% 0%, ${botRight}% 100%, ${botLeft}% 100%)`;

        return (
          <div key={stage.label} className="w-full flex items-center group relative" style={{ height: 44 }}>
            {/* Left label */}
            <div className="absolute left-0 w-[22%] flex items-center justify-end pr-3 h-full z-10">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground text-right leading-tight">
                {stage.label}
              </span>
            </div>

            {/* Trapezoid shape */}
            <div className="absolute left-[22%] right-[22%] h-full">
              <div
                className="w-full h-full transition-all duration-500 relative overflow-hidden"
                style={{
                  clipPath,
                  background: `linear-gradient(135deg, ${stage.color}dd, ${stage.color}99)`,
                }}
              >
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    background: `repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.04) 4px)`,
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-mono font-black text-white drop-shadow-lg tabular-nums tracking-tight">
                    {stage.value.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Right rate */}
            <div className="absolute right-0 w-[22%] flex items-center pl-3 h-full z-10">
              {i > 0 && stage.ratePct && (
                <div className="flex flex-col">
                  <span className="text-xs font-mono font-bold tabular-nums" style={{ color: stage.color }}>
                    {stage.ratePct}
                  </span>
                  <span className="text-[8px] font-mono text-muted-foreground/60 uppercase tracking-wider">
                    {stage.rateLabel}
                  </span>
                </div>
              )}
            </div>

            {/* Connector line between stages */}
            {i < stages.length - 1 && (
              <div className="absolute bottom-0 left-[22%] right-[22%] h-px bg-border/20 z-20" />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface SalesFunnelProps {
  funnel: FunnelMetrics;
  className?: string;
}

export default function SalesFunnel({ funnel, className }: SalesFunnelProps) {
  if (funnel.dials === 0) return null;

  const stages = buildStages(funnel);
  const convoPct = funnel.contactsMade > 0 ? ((funnel.conversations / funnel.contactsMade) * 100).toFixed(0) : "--";
  const presPct = funnel.contactsMade > 0 ? ((funnel.presentations / funnel.contactsMade) * 100).toFixed(0) : "--";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-orange-400">
          Sales Funnel
        </h3>
        {funnel.followUpsSet > 0 && (
          <span className="text-[9px] font-mono text-muted-foreground">
            <span className="text-foreground font-bold">{funnel.followUpsSet}</span> F/U set
          </span>
        )}
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {/* Funnel viz */}
        <div className="px-2 py-4">
          <TrapezoidFunnel stages={stages} />
        </div>

        {/* Duration buckets callout */}
        <div className="border-t border-border/40 px-4 py-2.5 bg-card/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#22d3ee" }} />
                <span className="text-[9px] font-mono text-muted-foreground">
                  Convos <span className="text-foreground font-bold">{convoPct}%</span> of contacts
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#fbbf24" }} />
                <span className="text-[9px] font-mono text-muted-foreground">
                  Pres <span className="text-foreground font-bold">{presPct}%</span> of contacts
                </span>
              </div>
            </div>
            <span className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-wider">
              Duration buckets (parallel)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
