import React from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  color?: "default" | "green" | "amber" | "red" | "blue";
  className?: string;
  tooltip?: string;
}

const colorMap = {
  default: "border-border",
  green: "border-emerald-500/40",
  amber: "border-amber-500/40",
  red: "border-red-500/40",
  blue: "border-blue-500/40",
};

const textColorMap = {
  default: "text-foreground",
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-red-400",
  blue: "text-blue-400",
};

export function MetricCard({ label, value, subtext, color = "default", className, tooltip }: MetricCardProps) {
  return (
    <div
      className={cn(
        "bg-card border rounded-md p-4 flex flex-col gap-1",
        colorMap[color],
        className
      )}
    >
      <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
        {label}
        {tooltip && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground cursor-help transition-colors shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed font-mono">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className={cn("text-2xl font-mono font-bold tabular-nums", textColorMap[color])}>
        {value}
      </span>
      {subtext && (
        <span className="text-xs text-muted-foreground font-mono">{subtext}</span>
      )}
    </div>
  );
}
