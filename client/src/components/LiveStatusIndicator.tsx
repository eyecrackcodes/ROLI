import { useEffect, useState } from "react";
import { useData } from "@/contexts/DataContext";
import { cn } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

/**
 * Top-bar chip that shows realtime connection state + relative "Updated · Nm ago".
 *
 * - Green pulse + "Live" when the Supabase realtime channel is SUBSCRIBED
 * - Gray dot + "Offline" when not connected (sample mode, network drop)
 * - Click the chip to force a manual refresh of every dataset
 *
 * The relative timestamp re-renders every 30s without re-rendering the rest
 * of the app — local interval state, not derived from context.
 */
function formatRelative(now: Date, then: Date | null): string {
  if (!then) return "syncing…";
  const diffSec = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return then.toLocaleDateString();
}

export function LiveStatusIndicator() {
  const { isLive, lastUpdatedAt, refreshAll } = useData();
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);

  const handleClick = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const relative = formatRelative(now, lastUpdatedAt);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={refreshing}
      title={
        lastUpdatedAt
          ? `Last updated ${lastUpdatedAt.toLocaleString()} • click to force refresh`
          : "Realtime connecting… • click to force refresh"
      }
      className={cn(
        "flex items-center gap-2 px-2.5 py-1 rounded-md border transition-colors text-[11px] font-mono",
        "border-border/60 bg-card hover:bg-muted/40",
        "disabled:opacity-60 disabled:cursor-wait",
      )}
      aria-label="Data freshness indicator"
    >
      <span className="relative flex h-2 w-2">
        {isLive && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            isLive ? "bg-emerald-500" : "bg-zinc-500",
          )}
        />
      </span>
      <span
        className={cn(
          "uppercase tracking-widest",
          isLive ? "text-emerald-400" : "text-muted-foreground",
        )}
      >
        {isLive ? "Live" : "Offline"}
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">{relative}</span>
      <RefreshCw
        className={cn(
          "h-3 w-3 ml-1 text-muted-foreground/70",
          refreshing && "animate-spin text-foreground",
        )}
      />
    </button>
  );
}
