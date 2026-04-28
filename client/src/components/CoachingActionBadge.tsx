import { cn } from "@/lib/utils";
import { ACTION_META, type CoachingAction } from "@/hooks/useCoachingActions";

/**
 * Inline action badge for the Daily Pulse table.
 * Compact, color-coded, hover for full rationale.
 *
 * Renders nothing if no action is provided. Pass `compact` for the
 * single-letter dot variant used inside dense tables.
 */
export function CoachingActionBadge({
  action,
  compact = false,
}: {
  action: CoachingAction | undefined;
  compact?: boolean;
}) {
  if (!action) return null;
  const meta = ACTION_META[action.action_code];

  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center h-2 w-2 rounded-full shrink-0",
          meta.dot,
        )}
        title={`${meta.label} — ${action.action_rationale}`}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5",
        "font-mono text-[9px] font-bold uppercase tracking-wider whitespace-nowrap",
        meta.tw,
      )}
      title={action.action_rationale}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.short}
    </span>
  );
}

/**
 * Full-width action card for the AgentDrillDown header.
 * Shows the action label prominently + the rationale + supporting metrics.
 */
export function CoachingActionCard({ action }: { action: CoachingAction | undefined }) {
  if (!action) {
    return (
      <div className="rounded-md border border-dashed border-border bg-card/30 p-3">
        <p className="text-xs font-mono text-muted-foreground">No coaching action available for this date.</p>
      </div>
    );
  }
  const meta = ACTION_META[action.action_code];

  return (
    <div className={cn("rounded-md border p-3", meta.tw, "border")}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
          <span className="text-[10px] font-mono uppercase tracking-widest opacity-80">
            Today's coaching action
          </span>
        </div>
        <span className="text-[9px] font-mono opacity-70">
          Priority {action.action_priority}
        </span>
      </div>
      <h4 className="text-base font-bold leading-tight mb-1">{meta.label}</h4>
      <p className="text-xs leading-snug opacity-90 mb-2">{action.action_rationale}</p>
      <div className="grid grid-cols-4 gap-2 text-[10px] font-mono opacity-90">
        <KV k="RPA" v={`${Math.round(action.rpa_minutes)}m`} />
        <KV k="Sales" v={action.total_sales} />
        <KV k="Premium" v={"$" + Math.round(action.total_premium).toLocaleString()} />
        <KV k="Past Due" v={action.past_due} />
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | number }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest opacity-60">{k}</div>
      <div className="text-sm font-bold tabular-nums">{v}</div>
    </div>
  );
}

/**
 * Top-of-page tally strip — "today the floor is X pipeline / Y effort / Z skill / etc.".
 */
export function CoachingActionTallies({
  tallies,
}: {
  tallies: import("@/hooks/useCoachingActions").CoachingActionTallies;
}) {
  if (tallies.total === 0) return null;
  const items = [
    { code: "clear_pipeline" as const, value: tallies.clear_pipeline },
    { code: "get_on_phones" as const, value: tallies.get_on_phones },
    { code: "coach_close" as const, value: tallies.coach_close },
    { code: "audit_calls" as const, value: tallies.audit_calls },
    { code: "stay_course" as const, value: tallies.stay_course },
    { code: "build_the_day" as const, value: tallies.build_the_day },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map((it) => {
        const meta = ACTION_META[it.code];
        const pct = tallies.total > 0 ? Math.round((it.value / tallies.total) * 100) : 0;
        return (
          <div
            key={it.code}
            className={cn(
              "rounded-md border p-2.5",
              it.value > 0 ? meta.tw : "bg-card/30 text-muted-foreground/60 border-border",
            )}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
              <span className="text-[9px] font-mono uppercase tracking-widest">{meta.short}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold tabular-nums">{it.value}</span>
              <span className="text-[10px] font-mono opacity-60">/ {pct}%</span>
            </div>
            <div className="text-[10px] font-mono opacity-70 leading-tight mt-0.5">{meta.label}</div>
          </div>
        );
      })}
    </div>
  );
}
