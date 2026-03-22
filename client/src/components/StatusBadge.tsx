import { AgentStatus, getStatusColor, getStatusBg } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: AgentStatus;
  className?: string;
  pulse?: boolean;
}

export function StatusBadge({ status, className, pulse = false }: StatusBadgeProps) {
  const dotColor = status === "PROMOTE" || status === "ELIGIBLE T1"
    ? "bg-emerald-400"
    : status === "DEMOTE" || status === "EXIT RISK"
    ? "bg-red-400"
    : "bg-amber-400";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm border text-xs font-mono font-semibold tracking-wide uppercase",
        getStatusBg(status),
        getStatusColor(status),
        className
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
              dotColor
            )}
          />
        )}
        <span
          className={cn("relative inline-flex rounded-full h-1.5 w-1.5", dotColor)}
        />
      </span>
      {status}
    </span>
  );
}
