import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  metricDescription,
  metricLabel,
  type ProfileMetricKey,
} from "@/lib/activityProfile";
import { cn } from "@/lib/utils";

interface MetricLabelProps {
  metric: ProfileMetricKey;
  /** Override the rendered label (defaults to metricLabel(metric)). */
  label?: string;
  /** Append "(?)" tooltip trigger only — no label text. */
  iconOnly?: boolean;
  /** Tailwind classes for the wrapper (so callers control sizing/casing). */
  className?: string;
  /** Class for the info icon. */
  iconClassName?: string;
  /** Side the tooltip pops to. */
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Render a metric label with a hover-info tooltip explaining what it means,
 * how it's computed, and (when defined) its healthy band.
 *
 * Source of truth for the copy lives in `metricDescription()` in
 * `lib/activityProfile.ts` — DO NOT inline metric explanations elsewhere.
 */
export function MetricLabel({
  metric,
  label,
  iconOnly = false,
  className,
  iconClassName,
  side = "top",
}: MetricLabelProps) {
  const text = label ?? metricLabel(metric);
  const desc = metricDescription(metric);

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {!iconOnly && <span>{text}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring p-0.5 transition-colors"
            aria-label={`What is ${text}?`}
            // Stop propagation so the tooltip click doesn't trigger row clicks
            // / column-sort handlers on the parent.
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <Info className={cn("h-3 w-3 opacity-60", iconClassName)} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-xs whitespace-normal text-left bg-popover text-popover-foreground border border-border shadow-md p-3"
        >
          <div className="space-y-1.5">
            <div className="text-[11px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
              {text}
            </div>
            <div className="text-[11px] leading-snug">{desc.short}</div>
            <div className="text-[11px] leading-snug text-muted-foreground">
              {desc.long}
            </div>
            <div className="pt-1 border-t border-border/60 space-y-0.5">
              <div className="text-[10px] font-mono text-muted-foreground">
                <span className="opacity-60">Formula:</span> {desc.formula}
              </div>
              {desc.target && (
                <div className="text-[10px] font-mono text-muted-foreground">
                  <span className="opacity-60">Healthy band:</span> {desc.target}
                </div>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
