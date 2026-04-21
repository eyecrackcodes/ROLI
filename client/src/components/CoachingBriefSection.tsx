import { useState } from "react";
import { useCoachingBrief, markThemeCoached } from "@/hooks/useCoachingBrief";
import {
  THEME_META,
  getSeverityColor,
  getSeverityBg,
  getTierLabel,
  getTierColor,
} from "@/lib/conversationIntelligence";
import type { CoachingTheme } from "@/lib/conversationIntelligence";
import { cn } from "@/lib/utils";
import { ExternalLink, CheckCircle2, MessageSquare, Brain, Mic2 } from "lucide-react";

interface CoachingBriefSectionProps {
  agentName: string;
}

function ThemeCard({ theme, onCoached }: { theme: CoachingTheme; onCoached: () => void }) {
  const [marking, setMarking] = useState(false);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const meta = THEME_META[theme.themeKey];

  const handleMark = async () => {
    if (!theme.id) return;
    setMarking(true);
    await markThemeCoached(theme.id, theme.agentId, notes || undefined);
    setMarking(false);
    setShowNotes(false);
    onCoached();
  };

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", getSeverityBg(theme.severity))}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-xs font-bold font-mono", getSeverityColor(theme.severity))}>
              {theme.severity.toUpperCase()}
            </span>
            <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", getTierColor(theme.tier))}>
              {getTierLabel(theme.tier)}
            </span>
          </div>
          <h4 className="text-sm font-semibold text-foreground mt-1">{theme.themeLabel}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{meta?.description ?? ""}</p>
        </div>
        {theme.agentValue !== null && theme.benchmarkValue !== null && (
          <div className="text-right shrink-0">
            <div className="text-lg font-mono font-bold text-foreground">{theme.agentValue}%</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              vs {theme.benchmarkValue}% peer
            </div>
          </div>
        )}
      </div>

      {/* Coaching action */}
      <div className="bg-background/50 rounded-md px-2.5 py-2 border border-border/50">
        <div className="flex items-center gap-1.5 mb-1">
          <MessageSquare className="h-3 w-3 text-blue-400" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-blue-400">
            Coaching Action
          </span>
        </div>
        <p className="text-xs text-foreground">{theme.suggestedAction}</p>
      </div>

      {/* Evidence clips */}
      {theme.evidenceCallUuids.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-muted-foreground">
            {theme.evidenceCallUuids.length} supporting call{theme.evidenceCallUuids.length > 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Mark coached */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/30">
        {showNotes ? (
          <div className="flex-1 flex items-center gap-2">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional coaching notes..."
              className="flex-1 h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
            <button
              onClick={handleMark}
              disabled={marking}
              className="h-7 px-3 text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-md hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {marking ? "..." : "Save"}
            </button>
            <button
              onClick={() => setShowNotes(false)}
              className="h-7 px-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNotes(true)}
            className="flex items-center gap-1.5 h-7 px-3 text-[10px] font-mono font-bold uppercase text-emerald-400 hover:bg-emerald-500/10 rounded-md transition-colors"
          >
            <CheckCircle2 className="h-3 w-3" />
            Mark Coached
          </button>
        )}
      </div>
    </div>
  );
}

export function CoachingBriefSection({ agentName }: CoachingBriefSectionProps) {
  const brief = useCoachingBrief(agentName);
  const [refreshKey, setRefreshKey] = useState(0);

  // Re-fetch workaround: bump key after marking coached
  const handleCoached = () => setRefreshKey((k) => k + 1);

  if (!brief || brief.themes.length === 0) return null;

  return (
    <div>
      <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
        <Brain className="h-3.5 w-3.5 text-violet-400" />
        Coaching Brief
        <span className="text-muted-foreground/60 font-normal ml-1">
          Week of {brief.weekStartDate}
        </span>
      </h3>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {brief.avgScorecardScore !== null && (
          <div className="p-2 bg-card rounded-md border border-border text-center">
            <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">
              Scorecard Avg
            </span>
            <span className={cn(
              "text-lg font-mono font-bold",
              brief.avgScorecardScore >= 70 ? "text-emerald-400" :
              brief.avgScorecardScore >= 50 ? "text-amber-400" : "text-red-400"
            )}>
              {brief.avgScorecardScore}
            </span>
          </div>
        )}
        {brief.avgTalkRatio !== null && (
          <div className="p-2 bg-card rounded-md border border-border text-center">
            <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">
              Talk Ratio
            </span>
            <span className={cn(
              "text-lg font-mono font-bold",
              brief.avgTalkRatio <= 0.55 ? "text-emerald-400" :
              brief.avgTalkRatio <= 0.65 ? "text-amber-400" : "text-red-400"
            )}>
              {Math.round(brief.avgTalkRatio * 100)}%
            </span>
          </div>
        )}
        <div className="p-2 bg-card rounded-md border border-border text-center">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground block">
            <Mic2 className="h-3 w-3 inline mr-0.5" />
            Calls Analyzed
          </span>
          <span className="text-lg font-mono font-bold text-foreground">
            {brief.totalCallsAnalyzed}
          </span>
        </div>
      </div>

      {/* Theme cards (max 3) */}
      <div className="space-y-2" key={refreshKey}>
        {brief.themes.map((theme) => (
          <ThemeCard key={theme.themeKey} theme={theme} onCoached={handleCoached} />
        ))}
      </div>

      {/* Recent coaching actions */}
      {brief.actions.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border/30">
          <span className="text-[10px] font-mono text-muted-foreground">
            {brief.actions.filter(a => a.status === "done").length} coaching action{brief.actions.filter(a => a.status === "done").length !== 1 ? "s" : ""} completed recently
          </span>
        </div>
      )}
    </div>
  );
}
