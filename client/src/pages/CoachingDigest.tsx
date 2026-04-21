import { useState, useMemo } from "react";
import { useCoachingDigest } from "@/hooks/useCoachingBrief";
import {
  getSeverityColor,
  getSeverityBg,
  getTierLabel,
  getTierColor,
  THEME_META,
} from "@/lib/conversationIntelligence";
import type { CoachingDigestRow, ThemeKey, ThemeTier, ThemeSeverity } from "@/lib/conversationIntelligence";
import { AgentDrillDown } from "@/components/AgentDrillDown";
import { cn } from "@/lib/utils";
import { Brain, Filter, Download, ChevronDown, ExternalLink } from "lucide-react";
import ExcelJS from "exceljs";

type SortKey = "agent" | "severity" | "tier" | "themes" | "scorecard" | "lastCoached";
type SortDir = "asc" | "desc";

export default function CoachingDigest() {
  const { rows, loading, error } = useCoachingDigest();
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterSite, setFilterSite] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [drillAgent, setDrillAgent] = useState<string | null>(null);

  const sites = useMemo(() => {
    const s = new Set(rows.map(r => r.site));
    return ["all", ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    let result = [...rows];
    if (filterSite !== "all") result = result.filter(r => r.site === filterSite);
    if (filterSeverity !== "all") result = result.filter(r => r.topTheme?.severity === filterSeverity);
    if (filterTier !== "all") result = result.filter(r => String(r.topTheme?.tier) === filterTier);
    return result;
  }, [rows, filterSite, filterSeverity, filterTier]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "agent": return dir * a.agentName.localeCompare(b.agentName);
        case "severity": {
          const ord: Record<string, number> = { high: 3, med: 2, low: 1 };
          return dir * ((ord[b.topTheme?.severity ?? ""] ?? 0) - (ord[a.topTheme?.severity ?? ""] ?? 0));
        }
        case "tier": return dir * ((a.topTheme?.tier ?? 9) - (b.topTheme?.tier ?? 9));
        case "themes": return dir * (b.themeCount - a.themeCount);
        case "scorecard": return dir * ((b.avgScorecardScore ?? 0) - (a.avgScorecardScore ?? 0));
        case "lastCoached": {
          const aDate = a.lastCoachedAt ?? "";
          const bDate = b.lastCoachedAt ?? "";
          return dir * aDate.localeCompare(bDate);
        }
        default: return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortHeader = ({ label, sortKeyVal, className }: { label: string; sortKeyVal: SortKey; className?: string }) => (
    <button
      onClick={() => toggleSort(sortKeyVal)}
      className={cn("text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground flex items-center gap-0.5", className)}
    >
      {label}
      {sortKey === sortKeyVal && (
        <ChevronDown className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")} />
      )}
    </button>
  );

  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ROLI Coaching Digest";
    const ws = workbook.addWorksheet("Coaching Digest");

    ws.columns = [
      { header: "Agent", key: "agent", width: 20 },
      { header: "Site", key: "site", width: 8 },
      { header: "Top Theme", key: "theme", width: 28 },
      { header: "Severity", key: "severity", width: 10 },
      { header: "Tier", key: "tier", width: 12 },
      { header: "Themes", key: "themeCount", width: 8 },
      { header: "Scorecard Avg", key: "scorecard", width: 14 },
      { header: "Coaching Action", key: "action", width: 50 },
      { header: "Last Coached", key: "lastCoached", width: 14 },
    ];

    for (const row of sorted) {
      ws.addRow({
        agent: row.agentName,
        site: row.site,
        theme: row.topTheme?.themeLabel ?? "",
        severity: row.topTheme?.severity ?? "",
        tier: row.topTheme ? getTierLabel(row.topTheme.tier) : "",
        themeCount: row.themeCount,
        scorecard: row.avgScorecardScore ?? "",
        action: row.topTheme?.suggestedAction ?? "",
        lastCoached: row.lastCoachedAt ? row.lastCoachedAt.slice(0, 10) : "Never",
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coaching-digest-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-400" />
            Coaching Digest
          </h1>
          <p className="text-xs font-mono text-muted-foreground">
            Weekly coaching themes ranked by severity — max 3 per agent, low-hanging fruit first
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={sorted.length === 0}
          className="flex items-center gap-1.5 h-8 px-3 text-xs font-mono bg-card border border-border rounded-md hover:bg-accent disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] font-mono text-muted-foreground uppercase">Filters</span>
        </div>
        <select
          value={filterSite}
          onChange={(e) => setFilterSite(e.target.value)}
          className="h-7 px-2 text-xs font-mono bg-card border border-border rounded-md"
        >
          {sites.map(s => <option key={s} value={s}>{s === "all" ? "All Sites" : s}</option>)}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="h-7 px-2 text-xs font-mono bg-card border border-border rounded-md"
        >
          <option value="all">All Severity</option>
          <option value="high">High</option>
          <option value="med">Med</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filterTier}
          onChange={(e) => setFilterTier(e.target.value)}
          className="h-7 px-2 text-xs font-mono bg-card border border-border rounded-md"
        >
          <option value="all">All Tiers</option>
          <option value="1">Process</option>
          <option value="2">Behavioral</option>
          <option value="3">Strategic</option>
        </select>
        <span className="text-[10px] font-mono text-muted-foreground ml-auto">
          {sorted.length} agent{sorted.length !== 1 ? "s" : ""} with themes
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm font-mono text-muted-foreground animate-pulse">Loading coaching data...</p>
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-sm font-mono text-red-400">{error}</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Brain className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-sm font-mono text-muted-foreground">
            No coaching themes yet — themes populate after the nightly rollup processes Attention data
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-card border-b border-border">
                  <th className="px-3 py-2 text-left"><SortHeader label="Agent" sortKeyVal="agent" /></th>
                  <th className="px-3 py-2 text-left"><span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Site</span></th>
                  <th className="px-3 py-2 text-left"><span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Top Theme</span></th>
                  <th className="px-3 py-2 text-center"><SortHeader label="Severity" sortKeyVal="severity" className="justify-center" /></th>
                  <th className="px-3 py-2 text-center"><SortHeader label="Tier" sortKeyVal="tier" className="justify-center" /></th>
                  <th className="px-3 py-2 text-center"><SortHeader label="Themes" sortKeyVal="themes" className="justify-center" /></th>
                  <th className="px-3 py-2 text-center"><SortHeader label="Scorecard" sortKeyVal="scorecard" className="justify-center" /></th>
                  <th className="px-3 py-2 text-center"><SortHeader label="Last Coached" sortKeyVal="lastCoached" className="justify-center" /></th>
                  <th className="px-3 py-2 text-center"><span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={row.agentId}
                    className="border-b border-border/50 hover:bg-accent/30 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <span className="text-sm font-mono font-medium text-foreground">{row.agentName}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-mono text-muted-foreground">{row.site}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-foreground">{row.topTheme?.themeLabel ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.topTheme && (
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
                          getSeverityBg(row.topTheme.severity),
                          getSeverityColor(row.topTheme.severity),
                        )}>
                          {row.topTheme.severity.toUpperCase()}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.topTheme && (
                        <span className={cn("text-[10px] font-mono", getTierColor(row.topTheme.tier))}>
                          {getTierLabel(row.topTheme.tier)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-sm font-mono text-foreground">{row.themeCount}</span>
                      {row.highSeverityCount > 0 && (
                        <span className="text-[10px] font-mono text-red-400 ml-1">
                          ({row.highSeverityCount} high)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {row.avgScorecardScore !== null ? (
                        <span className={cn(
                          "text-sm font-mono font-bold",
                          row.avgScorecardScore >= 70 ? "text-emerald-400" :
                          row.avgScorecardScore >= 50 ? "text-amber-400" : "text-red-400",
                        )}>
                          {row.avgScorecardScore}
                        </span>
                      ) : (
                        <span className="text-xs font-mono text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-xs font-mono text-muted-foreground">
                        {row.lastCoachedAt ? row.lastCoachedAt.slice(0, 10) : "Never"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setDrillAgent(row.agentName)}
                        className="text-[10px] font-mono text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Drill-down dialog */}
      <AgentDrillDown
        agentName={drillAgent}
        open={!!drillAgent}
        onOpenChange={(open: boolean) => { if (!open) setDrillAgent(null); }}
      />
    </div>
  );
}
