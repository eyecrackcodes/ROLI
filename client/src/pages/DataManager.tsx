import { useState } from "react";
import { useData } from "@/contexts/DataContext";
import { useLeadCosts, type ActiveCost, type LeadCostEntry } from "@/hooks/useLeadCosts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Upload, Download, Database, Trash2,
  Pencil, ChevronDown, ChevronRight, AlertTriangle,
  RefreshCw, Wifi, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatCostLabel(tier: string, channel: string): string {
  return `${tier} ${channel === "inbound" ? "Inbound" : "Outbound"}`;
}

function CostCard({
  tier,
  channel,
  cost,
  onEdit,
}: {
  tier: string;
  channel: string;
  cost: number;
  onEdit: () => void;
}) {
  return (
    <div className="p-3 bg-background rounded-md border border-border group relative">
      <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">
        {formatCostLabel(tier, channel)}
      </span>
      <span className="text-lg font-mono font-bold text-foreground">
        ${cost.toFixed(2)}
      </span>
      <button
        onClick={onEdit}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

function EditCostDialog({
  open,
  onOpenChange,
  tier,
  channel,
  currentCost,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tier: string;
  channel: string;
  currentCost: number;
  onSave: (cost: number, date: string) => Promise<void>;
}) {
  const [newCost, setNewCost] = useState(currentCost.toString());
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const costNum = parseFloat(newCost);
    if (isNaN(costNum) || costNum < 0) {
      toast.error("Enter a valid cost");
      return;
    }
    setSaving(true);
    try {
      await onSave(costNum, effectiveDate);
      toast.success(`${formatCostLabel(tier, channel)} updated to $${costNum.toFixed(2)}`);
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save cost");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-widest">
            Edit {formatCostLabel(tier, channel)} Cost
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Current Cost (reference)
            </Label>
            <div className="p-3 bg-background rounded-md border border-border">
              <span className="font-mono text-lg font-bold">${currentCost.toFixed(2)}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-widest">
              New Cost
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono">
                $
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={newCost}
                onChange={(e) => setNewCost(e.target.value)}
                className="font-mono bg-background pl-7"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-widest">
              Effective Date
            </Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="font-mono bg-background"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="font-mono text-sm"
          >
            CANCEL
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="font-mono text-sm bg-blue-600 hover:bg-blue-700"
          >
            {saving ? "SAVING..." : "SAVE"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostHistorySection({ history, windowStart }: { history: LeadCostEntry[]; windowStart: string }) {
  const [open, setOpen] = useState(false);

  const grouped = new Map<string, LeadCostEntry[]>();
  for (const entry of history) {
    const key = `${entry.tier}-${entry.lead_channel}`;
    const existing = grouped.get(key) ?? [];
    existing.push(entry);
    grouped.set(key, existing);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm font-mono text-muted-foreground hover:text-foreground transition-colors w-full py-2">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="uppercase tracking-widest text-[11px] font-bold">Cost Change History</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Tier/Channel</th>
                <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Cost</th>
                <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Effective Date</th>
                <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => {
                const isInWindow = entry.effective_date >= windowStart;
                return (
                  <tr key={entry.id} className="border-b border-border/50 hover:bg-accent/30">
                    <td className="px-3 py-2 font-mono">{formatCostLabel(entry.tier, entry.lead_channel)}</td>
                    <td className="px-3 py-2 font-mono text-right tabular-nums">${entry.cost_per_lead.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{entry.effective_date}</td>
                    <td className="px-3 py-2">
                      {isInWindow && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                          <AlertTriangle className="h-3 w-3" />
                          MID-WINDOW
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function DataManager() {
  const data = useData();
  const { activeCosts, costHistory, setCost, loading: costsLoading } = useLeadCosts();
  const [jsonInput, setJsonInput] = useState("");
  const [editingCost, setEditingCost] = useState<{ tier: string; channel: string; cost: number } | null>(null);

  const costMap = new Map(
    activeCosts.map((c) => [`${c.tier}-${c.lead_channel}`, c.cost_per_lead])
  );

  const defaultCosts: Array<{ tier: string; channel: string }> = [
    { tier: "T1", channel: "inbound" },
    { tier: "T2", channel: "inbound" },
    { tier: "T2", channel: "outbound" },
    { tier: "T3", channel: "outbound" },
  ];

  const fallbackCosts: Record<string, number> = {
    "T1-inbound": 83,
    "T2-inbound": 73,
    "T2-outbound": 15,
    "T3-outbound": 15,
  };

  const hasMidWindowChange = costHistory.some(
    (c) => c.effective_date >= data.windowStart
  );

  const handleImportJSON = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (parsed.dailyT1) data.setDailyT1(parsed.dailyT1);
      if (parsed.dailyT2) data.setDailyT2(parsed.dailyT2);
      if (parsed.dailyT3) data.setDailyT3(parsed.dailyT3);
      if (parsed.monthlyT1) data.setMonthlyT1(parsed.monthlyT1);
      if (parsed.monthlyT2) data.setMonthlyT2(parsed.monthlyT2);
      if (parsed.monthlyT3) data.setMonthlyT3(parsed.monthlyT3);
      toast.success("Data imported successfully");
      setJsonInput("");
    } catch {
      toast.error("Invalid JSON format");
    }
  };

  const handleExportJSON = () => {
    const exportData = {
      dailyT1: data.dailyT1,
      dailyT2: data.dailyT2,
      dailyT3: data.dailyT3,
      monthlyT1: data.monthlyT1,
      monthlyT2: data.monthlyT2,
      monthlyT3: data.monthlyT3,
      windowStart: data.windowStart,
      windowEnd: data.windowEnd,
      workingDays: data.workingDays,
      workingDaysCompleted: data.workingDaysCompleted,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dsb-tier-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Data exported");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Data Manager</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            Import from scraper, configure costs, or export data
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.isConnected ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
              <Wifi className="h-3 w-3" />
              SUPABASE CONNECTED
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
              <WifiOff className="h-3 w-3" />
              OFFLINE (SAMPLE DATA)
            </span>
          )}
        </div>
      </div>

      <Tabs defaultValue="window" className="w-full">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="window" className="font-mono text-xs data-[state=active]:bg-accent">
            WINDOW SETTINGS
          </TabsTrigger>
          <TabsTrigger value="costs" className="font-mono text-xs data-[state=active]:bg-accent">
            LEAD COSTS
          </TabsTrigger>
          <TabsTrigger value="import" className="font-mono text-xs data-[state=active]:bg-accent">
            IMPORT / EXPORT
          </TabsTrigger>
          <TabsTrigger value="actions" className="font-mono text-xs data-[state=active]:bg-accent">
            ACTIONS
          </TabsTrigger>
        </TabsList>

        {/* Window Settings Tab */}
        <TabsContent value="window" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-md p-6 space-y-4">
            <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Evaluation Window Configuration
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">Window Start</Label>
                <Input
                  type="date"
                  value={data.windowStart}
                  onChange={(e) => data.setWindowStart(e.target.value)}
                  className="font-mono bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">Window End</Label>
                <Input
                  type="date"
                  value={data.windowEnd}
                  onChange={(e) => data.setWindowEnd(e.target.value)}
                  className="font-mono bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">Total Working Days</Label>
                <Input
                  type="number"
                  value={data.workingDays}
                  onChange={(e) => data.setWorkingDays(Number(e.target.value))}
                  className="font-mono bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">Working Days Completed</Label>
                <Input
                  type="number"
                  value={data.workingDaysCompleted}
                  onChange={(e) => data.setWorkingDaysCompleted(Number(e.target.value))}
                  className="font-mono bg-background"
                />
              </div>
            </div>
            {data.isConnected && (
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">Daily Pulse Date</Label>
                <Input
                  type="date"
                  value={data.selectedDate}
                  onChange={(e) => data.setSelectedDate(e.target.value)}
                  className="font-mono bg-background max-w-xs"
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* Lead Costs Tab */}
        <TabsContent value="costs" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground">
                Active Lead Costs
              </h2>
              {hasMidWindowChange && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                  <AlertTriangle className="h-3 w-3" />
                  Cost changed mid-window — ROLI uses blended rates
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {defaultCosts.map(({ tier, channel }) => {
                const key = `${tier}-${channel}`;
                const cost = costMap.get(key) ?? fallbackCosts[key] ?? 0;
                return (
                  <CostCard
                    key={key}
                    tier={tier}
                    channel={channel}
                    cost={cost}
                    onEdit={() => setEditingCost({ tier, channel, cost })}
                  />
                );
              })}
            </div>
          </div>

          <div className="bg-card border border-border rounded-md p-6">
            <CostHistorySection history={costHistory} windowStart={data.windowStart} />
          </div>

          {editingCost && (
            <EditCostDialog
              open={true}
              onOpenChange={(v) => !v && setEditingCost(null)}
              tier={editingCost.tier}
              channel={editingCost.channel}
              currentCost={editingCost.cost}
              onSave={async (cost, date) => {
                await setCost(
                  editingCost.tier as "T1" | "T2" | "T3",
                  editingCost.channel as "inbound" | "outbound",
                  cost,
                  date
                );
              }}
            />
          )}
        </TabsContent>

        {/* Import / Export Tab */}
        <TabsContent value="import" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-md p-6 space-y-4">
            <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Import JSON Data
            </h2>
            <p className="text-xs text-muted-foreground font-mono">
              Paste the JSON output from your N8N scraper workflow. The format should match the export schema.
            </p>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='{"monthlyT3": [...], "monthlyT2": [...], "monthlyT1": [...]}'
              className="w-full h-48 bg-background border border-border rounded-md p-3 font-mono text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button onClick={handleImportJSON} className="font-mono text-sm gap-2">
              <Upload className="h-4 w-4" />
              IMPORT
            </Button>
          </div>

          <div className="bg-card border border-border rounded-md p-6 space-y-4">
            <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Export Current Data
            </h2>
            <Button onClick={handleExportJSON} variant="outline" className="font-mono text-sm gap-2">
              <Download className="h-4 w-4" />
              EXPORT JSON
            </Button>
          </div>
        </TabsContent>

        {/* Actions Tab */}
        <TabsContent value="actions" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-md p-6 space-y-4">
            <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Quick Actions
            </h2>
            <div className="flex flex-wrap gap-3">
              {data.isConnected && (
                <Button
                  onClick={() => {
                    data.refreshDaily();
                    data.refreshMonthly();
                    toast.success("Data refreshed from Supabase");
                  }}
                  variant="outline"
                  className="font-mono text-sm gap-2 text-blue-400 hover:text-blue-300"
                >
                  <RefreshCw className="h-4 w-4" />
                  REFRESH FROM SUPABASE
                </Button>
              )}
              <Button onClick={data.loadSampleData} variant="outline" className="font-mono text-sm gap-2">
                <Database className="h-4 w-4" />
                LOAD SAMPLE DATA
              </Button>
              <Button onClick={data.clearData} variant="outline" className="font-mono text-sm gap-2 text-red-400 hover:text-red-300">
                <Trash2 className="h-4 w-4" />
                CLEAR ALL DATA
              </Button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-md p-6 space-y-3">
            <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground">
              Current Data Summary
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <div className="p-3 bg-background rounded-md border border-border text-center">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Daily T1</span>
                <span className="text-lg font-mono font-bold text-foreground">{data.dailyT1.length}</span>
              </div>
              <div className="p-3 bg-background rounded-md border border-border text-center">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Daily T2</span>
                <span className="text-lg font-mono font-bold text-foreground">{data.dailyT2.length}</span>
              </div>
              <div className="p-3 bg-background rounded-md border border-border text-center">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Daily T3</span>
                <span className="text-lg font-mono font-bold text-foreground">{data.dailyT3.length}</span>
              </div>
              <div className="p-3 bg-background rounded-md border border-border text-center">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Monthly T1</span>
                <span className="text-lg font-mono font-bold text-foreground">{data.monthlyT1.length}</span>
              </div>
              <div className="p-3 bg-background rounded-md border border-border text-center">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Monthly T2</span>
                <span className="text-lg font-mono font-bold text-foreground">{data.monthlyT2.length}</span>
              </div>
              <div className="p-3 bg-background rounded-md border border-border text-center">
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">Monthly T3</span>
                <span className="text-lg font-mono font-bold text-foreground">{data.monthlyT3.length}</span>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
