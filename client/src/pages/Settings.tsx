import { useState, lazy, Suspense } from "react";
import { useAgents, type Agent } from "@/hooks/useAgents";

const DataManager = lazy(() => import("./DataManager"));
import { useEvaluationWindows, type EvaluationWindow } from "@/hooks/useEvaluationWindows";
import { useSystemConfig, type GateThresholds } from "@/hooks/useSystemConfig";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Upload, Play, WifiOff, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Agent Roster Tab ----

function AgentRosterTab() {
  const { agents, loading, addAgent, updateAgent, toggleActive, terminateAgent, bulkImport } = useAgents();
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reassignManager, setReassignManager] = useState("");
  const [reassignSelected, setReassignSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ name: "", site: "RMT" as "RMT", tier: "T3" as "T1" | "T2" | "T3", daily_lead_volume: 7, is_active: true, manager: "" as string, agent_status: "selling" as "selling" | "training" | "unlicensed" });
  const [csvInput, setCsvInput] = useState("");
  const [rosterFilter, setRosterFilter] = useState<"all" | string>("all");

  const resetForm = () => setForm({ name: "", site: "RMT" as "RMT", tier: "T2", daily_lead_volume: 7, is_active: true, manager: "", agent_status: "selling" });

  const managers = [...new Set(agents.map((a) => a.manager).filter(Boolean))].sort() as string[];

  const handleAddAgent = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    try {
      await addAgent({ ...form, manager: form.manager || null });
      toast.success(`Agent ${form.name} added`);
      resetForm();
      setShowAdd(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add agent");
    }
  };

  const handleUpdateAgent = async () => {
    if (!editingId) return;
    try {
      await updateAgent(editingId, { ...form, manager: form.manager || null });
      toast.success("Agent updated");
      setEditingId(null);
      resetForm();
    } catch (err) {
      toast.error("Failed to update agent");
    }
  };

  const handleBulkImport = async () => {
    try {
      const raw = csvInput.trim();
      const lines = raw.split("\n").filter(Boolean);
      const agents: Array<Omit<Agent, "id" | "created_at" | "updated_at">> = [];

      const isTabSeparated = raw.includes("\t");
      const separator = isTabSeparated ? "\t" : ",";

      const firstLine = lines[0].split(separator).map((s) => s.trim().toLowerCase());
      const hasHeader = firstLine.some((col) =>
        ["name", "site", "tier", "volume"].includes(col)
      );

      let colMap: Record<string, number> = { name: 0, site: 1, tier: 2, volume: 3 };
      const startIdx = hasHeader ? 1 : 0;

      if (hasHeader) {
        firstLine.forEach((col, i) => {
          if (col === "name") colMap.name = i;
          else if (col === "site") colMap.site = i;
          else if (col === "tier") colMap.tier = i;
          else if (col === "volume") colMap.volume = i;
        });
      } else {
        const cols = lines[0].split(separator).map((s) => s.trim());
        const siteValues = ["RMT"];
        const tierValues = ["T1", "T2", "T3"];
        if (siteValues.includes(cols[0]?.toUpperCase())) {
          colMap = { site: 0, name: 1, tier: 2, volume: 3 };
        } else if (tierValues.includes(cols[0]?.toUpperCase())) {
          colMap = { tier: 0, name: 1, site: 2, volume: 3 };
        }
      }

      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(separator).map((s) => s.trim());
        const name = cols[colMap.name];
        const site = cols[colMap.site]?.toUpperCase();
        const tier = cols[colMap.tier]?.toUpperCase();
        const volume = cols[colMap.volume];

        if (!name || site !== "RMT" || !["T1", "T2", "T3"].includes(tier)) continue;

        agents.push({
          name,
          site: "RMT" as "RMT",
          tier: tier as "T1" | "T2" | "T3",
          daily_lead_volume: parseInt(volume) || 25,
          is_active: true,
        });
      }

      if (agents.length === 0) { toast.error("No valid rows found"); return; }
      await bulkImport(agents);
      toast.success(`Imported ${agents.length} agents`);
      setCsvInput("");
      setShowBulk(false);
    } catch (err) {
      toast.error("Bulk import failed");
    }
  };

  const handleBulkReassign = async () => {
    if (reassignSelected.size === 0) { toast.error("Select at least one agent"); return; }
    try {
      const targetManager = reassignManager.trim() || null;
      for (const agentId of Array.from(reassignSelected)) {
        await updateAgent(agentId, { manager: targetManager } as Partial<Agent>);
      }
      toast.success(`${reassignSelected.size} agent(s) reassigned to ${targetManager ?? "Unassigned"}`);
      setReassignSelected(new Set());
      setReassignManager("");
      setShowReassign(false);
    } catch {
      toast.error("Reassignment failed");
    }
  };

  const toggleReassignAgent = (id: string) => {
    setReassignSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      site: "RMT" as "RMT",
      tier: agent.tier,
      daily_lead_volume: agent.daily_lead_volume,
      is_active: agent.is_active,
      manager: agent.manager ?? "",
      agent_status: agent.agent_status ?? "selling",
    });
  };

  const tierCounts = { T1: 0, T2: 0, T3: 0 };
  agents.filter((a) => a.is_active).forEach((a) => { tierCounts[a.tier]++; });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-muted-foreground">
            T1: {tierCounts.T1} | T2: {tierCounts.T2} | T3: {tierCounts.T3} | Total: {agents.filter((a) => a.is_active).length}
          </span>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { setReassignSelected(new Set()); setReassignManager(""); setShowReassign(true); }} variant="outline" className="font-mono text-xs gap-1.5">
            <UserPlus className="h-3.5 w-3.5" />
            REASSIGN
          </Button>
          <Button onClick={() => setShowBulk(true)} variant="outline" className="font-mono text-xs gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            BULK CSV
          </Button>
          <Button onClick={() => { resetForm(); setShowAdd(true); }} className="font-mono text-xs gap-1.5 bg-blue-600 hover:bg-blue-700">
            <Plus className="h-3.5 w-3.5" />
            ADD AGENT
          </Button>
        </div>
      </div>

      {/* Team filter */}
      {managers.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">Team:</span>
          <select
            value={rosterFilter}
            onChange={(e) => setRosterFilter(e.target.value)}
            className="text-[10px] font-mono bg-card border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="all">All Teams</option>
            <option value="unassigned">Unassigned</option>
            {managers.map((m) => (
              <option key={m} value={m}>{m} ({agents.filter((a) => a.manager === m && a.is_active).length})</option>
            ))}
          </select>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Name</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Team</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Site</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Tier</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Daily Vol</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-center">Status</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.filter((a) => rosterFilter === "all" || (rosterFilter === "unassigned" ? !a.manager : a.manager === rosterFilter)).map((agent, i) => (
              <tr
                key={agent.id}
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/30",
                  !agent.is_active && "opacity-50",
                  i % 2 === 0 ? "bg-transparent" : "bg-card/30"
                )}
              >
                <td className="px-3 py-2.5 font-semibold text-foreground">{agent.name}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{agent.manager ?? <span className="text-muted-foreground/40 italic">—</span>}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{agent.site}</td>
                <td className="px-3 py-2.5">
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
                    agent.tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                    agent.tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                    "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  )}>
                    {agent.tier}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.daily_lead_volume}</td>
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <Switch
                      checked={agent.is_active}
                      onCheckedChange={(v) => toggleActive(agent.id, v)}
                      className="scale-75"
                    />
                    {agent.terminated_date && (
                      <span className="text-[9px] font-mono text-red-400" title={`Terminated ${agent.terminated_date}`}>
                        {agent.terminated_date.slice(5)}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right flex items-center justify-end gap-1">
                  {agent.is_active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const date = prompt("Terminate agent — enter last active date (YYYY-MM-DD):", new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }));
                        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) terminateAgent(agent.id, date);
                      }}
                      className="font-mono text-[10px] h-7 px-2 text-red-400 hover:text-red-300"
                    >
                      TERM
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => terminateAgent(agent.id, null)}
                      className="font-mono text-[10px] h-7 px-2 text-emerald-400 hover:text-emerald-300"
                    >
                      REACTIVATE
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(agent)}
                    className="font-mono text-[10px] h-7 px-2"
                  >
                    EDIT
                  </Button>
                </td>
              </tr>
            ))}
            {agents.filter((a) => rosterFilter === "all" || (rosterFilter === "unassigned" ? !a.manager : a.manager === rosterFilter)).length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground font-mono text-sm">
                  {rosterFilter === "all" ? "No agents in roster. Add agents or import via CSV." : `No agents in team "${rosterFilter}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Agent Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">Add Agent</DialogTitle>
          </DialogHeader>
          <AgentForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)} className="font-mono text-sm">CANCEL</Button>
            <Button onClick={handleAddAgent} className="font-mono text-sm bg-blue-600 hover:bg-blue-700">ADD</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Agent Dialog */}
      <Dialog open={!!editingId} onOpenChange={(v) => !v && setEditingId(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">Edit Agent</DialogTitle>
          </DialogHeader>
          <AgentForm form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)} className="font-mono text-sm">CANCEL</Button>
            <Button onClick={handleUpdateAgent} className="font-mono text-sm bg-blue-600 hover:bg-blue-700">SAVE</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={showBulk} onOpenChange={setShowBulk}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">Bulk CSV Import</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs font-mono text-muted-foreground">
              Paste tab-separated or comma-separated data. Auto-detects column order from headers (Site, Name, Tier, Volume) or from values.
            </p>
            <textarea
              value={csvInput}
              onChange={(e) => setCsvInput(e.target.value)}
              placeholder={"Site\tName\tTier\tVolume\nRMT\tAlvin Fulmore\tT3\t25\nRMT\tNaimah German\tT2\t17"}
              className="w-full h-40 bg-background border border-border rounded-md p-3 font-mono text-xs text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulk(false)} className="font-mono text-sm">CANCEL</Button>
            <Button onClick={handleBulkImport} className="font-mono text-sm bg-blue-600 hover:bg-blue-700 gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              IMPORT
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Reassign Dialog */}
      <Dialog open={showReassign} onOpenChange={setShowReassign}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">Bulk Reassign Teams</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-widest">Assign to Manager</Label>
              <div className="flex gap-2">
                <Input
                  value={reassignManager}
                  onChange={(e) => setReassignManager(e.target.value)}
                  placeholder="Manager name (empty = unassign)"
                  className="font-mono bg-background text-sm flex-1"
                />
                {managers.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) setReassignManager(e.target.value); }}
                    className="text-[10px] font-mono bg-card border border-border rounded px-2 py-1 text-foreground"
                  >
                    <option value="">Pick existing...</option>
                    {managers.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Select agents ({reassignSelected.size} selected):
            </div>
            <div className="overflow-y-auto flex-1 border border-border rounded-md divide-y divide-border/50 max-h-[40vh]">
              {agents.filter((a) => a.is_active).map((agent) => (
                <label key={agent.id} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reassignSelected.has(agent.id)}
                    onChange={() => toggleReassignAgent(agent.id)}
                    className="accent-blue-500"
                  />
                  <span className="font-mono text-xs text-foreground flex-1">{agent.name}</span>
                  <span className="text-[9px] font-mono text-muted-foreground">{agent.manager ?? "—"}</span>
                  <span className={cn(
                    "text-[9px] font-mono px-1.5 py-0.5 rounded border",
                    agent.tier === "T1" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                    agent.tier === "T2" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                    "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  )}>{agent.tier}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReassign(false)} className="font-mono text-sm">CANCEL</Button>
            <Button
              onClick={handleBulkReassign}
              disabled={reassignSelected.size === 0}
              className="font-mono text-sm bg-blue-600 hover:bg-blue-700 gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" />
              REASSIGN ({reassignSelected.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentForm({
  form,
  setForm,
}: {
  form: { name: string; site: "RMT"; tier: "T1" | "T2" | "T3"; daily_lead_volume: number; is_active: boolean; manager: string; agent_status: "selling" | "training" | "unlicensed" };
  setForm: (f: typeof form) => void;
}) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-widest">Name</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="font-mono bg-background" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-widest">Site</Label>
          <Input value="RMT" disabled className="font-mono bg-background text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-widest">Tier</Label>
          <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v as "T1" | "T2" | "T3" })}>
            <SelectTrigger className="font-mono bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="T1">T1 — Inbound</SelectItem>
              <SelectItem value="T2">T2 — Hybrid</SelectItem>
              <SelectItem value="T3">T3 — Outbound</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-widest">Manager / Team</Label>
          <Input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} placeholder="e.g. David Druxman" className="font-mono bg-background" />
        </div>
        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-widest">Agent Status</Label>
          <Select value={form.agent_status} onValueChange={(v) => setForm({ ...form, agent_status: v as "selling" | "training" | "unlicensed" })}>
            <SelectTrigger className="font-mono bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="selling">Selling</SelectItem>
              <SelectItem value="training">Training</SelectItem>
              <SelectItem value="unlicensed">Unlicensed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-widest">Daily Lead Volume</Label>
        <Input
          type="number"
          value={form.daily_lead_volume}
          onChange={(e) => setForm({ ...form, daily_lead_volume: parseInt(e.target.value) || 0 })}
          className="font-mono bg-background"
        />
      </div>
    </div>
  );
}

// ---- Evaluation Windows Tab ----

function EvaluationWindowsTab() {
  const { windows, loading, setActiveWindow, addWindow, updateWindow, computeSnapshot } = useEvaluationWindows();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [computing, setComputing] = useState<string | null>(null);
  const [windowForm, setWindowForm] = useState({
    name: "", start_date: "", end_date: "", working_days: 20,
    is_active: false, is_inaugural: false,
  });

  const handleAddWindow = async () => {
    if (!windowForm.name || !windowForm.start_date || !windowForm.end_date) {
      toast.error("Fill all required fields");
      return;
    }
    try {
      await addWindow(windowForm);
      toast.success("Window added");
      setShowAdd(false);
      setWindowForm({ name: "", start_date: "", end_date: "", working_days: 20, is_active: false, is_inaugural: false });
    } catch (err) {
      toast.error("Failed to add window");
    }
  };

  const startEditWindow = (w: EvaluationWindow) => {
    setEditingId(w.id);
    setWindowForm({
      name: w.name,
      start_date: w.start_date,
      end_date: w.end_date,
      working_days: w.working_days,
      is_active: w.is_active,
      is_inaugural: w.is_inaugural,
    });
  };

  const handleUpdateWindow = async () => {
    if (!editingId) return;
    try {
      await updateWindow(editingId, {
        name: windowForm.name,
        start_date: windowForm.start_date,
        end_date: windowForm.end_date,
        working_days: windowForm.working_days,
        is_inaugural: windowForm.is_inaugural,
      });
      toast.success("Window updated");
      setEditingId(null);
    } catch (err) {
      toast.error("Failed to update window");
    }
  };

  const handleCompute = async (windowId: string) => {
    setComputing(windowId);
    try {
      await computeSnapshot(windowId);
      toast.success("Monthly snapshot computed successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Computation failed");
    } finally {
      setComputing(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowAdd(true)} className="font-mono text-xs gap-1.5 bg-blue-600 hover:bg-blue-700">
          <Plus className="h-3.5 w-3.5" />
          ADD WINDOW
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Name</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Start</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">End</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Days</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-center">Active</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-center">Inaugural</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((w, i) => (
              <tr
                key={w.id}
                className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/30",
                  w.is_active && "bg-blue-500/5",
                  i % 2 === 0 ? "bg-transparent" : "bg-card/30"
                )}
              >
                <td className="px-3 py-2.5 font-semibold text-foreground">{w.name}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{w.start_date}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{w.end_date}</td>
                <td className="px-3 py-2.5 font-mono text-right tabular-nums">{w.working_days}</td>
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="radio"
                    name="active-window"
                    checked={w.is_active}
                    onChange={() => setActiveWindow(w.id)}
                    className="accent-blue-500"
                  />
                </td>
                <td className="px-3 py-2.5 text-center">
                  {w.is_inaugural && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                      1ST
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEditWindow(w)}
                    className="font-mono text-[10px] h-7 px-2"
                  >
                    EDIT
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCompute(w.id)}
                    disabled={computing === w.id}
                    className="font-mono text-[10px] h-7 px-2 gap-1"
                  >
                    <Play className="h-3 w-3" />
                    {computing === w.id ? "COMPUTING..." : "COMPUTE"}
                  </Button>
                </td>
              </tr>
            ))}
            {windows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground font-mono text-sm">
                  No evaluation windows configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">Add Evaluation Window</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-widest">Name</Label>
              <Input value={windowForm.name} onChange={(e) => setWindowForm({ ...windowForm, name: e.target.value })} placeholder="e.g. April 2026" className="font-mono bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">Start Date</Label>
                <Input type="date" value={windowForm.start_date} onChange={(e) => setWindowForm({ ...windowForm, start_date: e.target.value })} className="font-mono bg-background" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">End Date</Label>
                <Input type="date" value={windowForm.end_date} onChange={(e) => setWindowForm({ ...windowForm, end_date: e.target.value })} className="font-mono bg-background" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-widest">Working Days</Label>
              <Input type="number" value={windowForm.working_days} onChange={(e) => setWindowForm({ ...windowForm, working_days: parseInt(e.target.value) || 0 })} className="font-mono bg-background" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={windowForm.is_inaugural} onCheckedChange={(v) => setWindowForm({ ...windowForm, is_inaugural: v })} />
              <Label className="font-mono text-xs">Inaugural (first cycle)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)} className="font-mono text-sm">CANCEL</Button>
            <Button onClick={handleAddWindow} className="font-mono text-sm bg-blue-600 hover:bg-blue-700">ADD</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Window Dialog */}
      <Dialog open={!!editingId} onOpenChange={(v) => !v && setEditingId(null)}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm uppercase tracking-widest">Edit Evaluation Window</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-widest">Name</Label>
              <Input value={windowForm.name} onChange={(e) => setWindowForm({ ...windowForm, name: e.target.value })} className="font-mono bg-background" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">Start Date</Label>
                <Input type="date" value={windowForm.start_date} onChange={(e) => setWindowForm({ ...windowForm, start_date: e.target.value })} className="font-mono bg-background" />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-widest">End Date</Label>
                <Input type="date" value={windowForm.end_date} onChange={(e) => setWindowForm({ ...windowForm, end_date: e.target.value })} className="font-mono bg-background" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-widest">Working Days</Label>
              <Input type="number" value={windowForm.working_days} onChange={(e) => setWindowForm({ ...windowForm, working_days: parseInt(e.target.value) || 0 })} className="font-mono bg-background" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={windowForm.is_inaugural} onCheckedChange={(v) => setWindowForm({ ...windowForm, is_inaugural: v })} />
              <Label className="font-mono text-xs">Inaugural (first cycle)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)} className="font-mono text-sm">CANCEL</Button>
            <Button onClick={handleUpdateWindow} className="font-mono text-sm bg-blue-600 hover:bg-blue-700">SAVE</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Gate Thresholds Tab ----

function GateThresholdsTab() {
  const { gateThresholds, saveThresholds, loading } = useSystemConfig();
  const [form, setForm] = useState<GateThresholds>(gateThresholds);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const update = (key: keyof GateThresholds, value: number) => {
    setForm({ ...form, [key]: value });
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveThresholds(form);
      toast.success("Gate thresholds saved");
      setDirty(false);
    } catch {
      toast.error("Failed to save thresholds");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-md p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-widest">Min CR for Promotion (%)</Label>
            <p className="text-[10px] font-mono text-muted-foreground">T3 agents need this CR to be eligible for T2 promotion</p>
            <div className="relative">
              <Input
                type="number"
                step="0.5"
                value={form.MIN_CR_FOR_PROMOTION}
                onChange={(e) => update("MIN_CR_FOR_PROMOTION", parseFloat(e.target.value) || 0)}
                className="font-mono bg-background pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">%</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-widest">Profit Floor Percentile</Label>
            <p className="text-[10px] font-mono text-muted-foreground">Gate 2: T2 agents above this percentile are protected</p>
            <div className="relative">
              <Input
                type="number"
                step="5"
                value={form.PROFIT_FLOOR_PERCENTILE}
                onChange={(e) => update("PROFIT_FLOOR_PERCENTILE", parseFloat(e.target.value) || 0)}
                className="font-mono bg-background pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">pctl</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-widest">Trajectory Improvement (%)</Label>
            <p className="text-[10px] font-mono text-muted-foreground">Gate 3: ROLI improvement that triggers grace period</p>
            <div className="relative">
              <Input
                type="number"
                step="5"
                value={form.TRAJECTORY_IMPROVEMENT}
                onChange={(e) => update("TRAJECTORY_IMPROVEMENT", parseFloat(e.target.value) || 0)}
                className="font-mono bg-background pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">%</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-widest">T1 IB CR Quartile</Label>
            <p className="text-[10px] font-mono text-muted-foreground">Gate 4: T2→T1 blocked if IB CR below this T1 quartile</p>
            <div className="relative">
              <Input
                type="number"
                step="5"
                value={form.T1_IB_CR_QUARTILE}
                onChange={(e) => update("T1_IB_CR_QUARTILE", parseFloat(e.target.value) || 0)}
                className="font-mono bg-background pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">pctl</span>
            </div>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label className="font-mono text-xs uppercase tracking-widest">Max Swaps per Window</Label>
            <p className="text-[10px] font-mono text-muted-foreground">Maximum number of T3↔T2 swaps allowed in a single evaluation</p>
            <Input
              type="number"
              min="1"
              max="10"
              value={form.MAX_SWAPS_PER_WINDOW}
              onChange={(e) => update("MAX_SWAPS_PER_WINDOW", parseInt(e.target.value) || 5)}
              className="font-mono bg-background max-w-32"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border">
          <span className={cn("text-[10px] font-mono", dirty ? "text-amber-400" : "text-muted-foreground")}>
            {dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <Button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="font-mono text-sm bg-blue-600 hover:bg-blue-700"
          >
            {saving ? "SAVING..." : "SAVE THRESHOLDS"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Name Aliases Tab ----

function NameAliasesTab() {
  const [aliases, setAliases] = useState<Array<{ id: string; crm_name: string; canonical_name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [newCrm, setNewCrm] = useState("");
  const [newCanonical, setNewCanonical] = useState("");

  const fetchAliases = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("agent_name_aliases")
      .select("*")
      .order("crm_name");
    setAliases((data as typeof aliases) ?? []);
    setLoading(false);
  };

  useState(() => { fetchAliases(); });

  const handleAdd = async () => {
    if (!newCrm.trim() || !newCanonical.trim()) { toast.error("Both fields required"); return; }
    const { error } = await supabase
      .from("agent_name_aliases")
      .insert({ crm_name: newCrm.trim(), canonical_name: newCanonical.trim() });
    if (error) { toast.error(error.message); return; }
    toast.success(`Alias added: ${newCrm.trim()} → ${newCanonical.trim()}`);
    setNewCrm("");
    setNewCanonical("");
    fetchAliases();
  };

  const handleDelete = async (id: string, name: string) => {
    await supabase.from("agent_name_aliases").delete().eq("id", id);
    toast.success(`Alias removed: ${name}`);
    fetchAliases();
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-md p-4 space-y-3">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
          Add Name Alias
        </h3>
        <p className="text-[10px] font-mono text-muted-foreground">
          When the CRM uses a different name than the roster, add an alias so data merges correctly.
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <Label className="font-mono text-[10px] uppercase tracking-widest">CRM Name</Label>
            <Input value={newCrm} onChange={(e) => setNewCrm(e.target.value)} placeholder="e.g. Jimmy Hoang" className="font-mono bg-background text-sm" />
          </div>
          <span className="text-muted-foreground font-mono text-sm pb-2">→</span>
          <div className="flex-1 space-y-1">
            <Label className="font-mono text-[10px] uppercase tracking-widest">Roster Name</Label>
            <Input value={newCanonical} onChange={(e) => setNewCanonical(e.target.value)} placeholder="e.g. James Hoang" className="font-mono bg-background text-sm" />
          </div>
          <Button onClick={handleAdd} className="font-mono text-xs bg-blue-600 hover:bg-blue-700 gap-1">
            <Plus className="h-3.5 w-3.5" />
            ADD
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">CRM Name</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">→</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Roster Name</th>
              <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {aliases.map((a, i) => (
              <tr key={a.id} className={cn("border-b border-border/50 hover:bg-accent/30", i % 2 === 0 ? "bg-transparent" : "bg-card/30")}>
                <td className="px-3 py-2.5 font-mono text-foreground">{a.crm_name}</td>
                <td className="px-3 py-2.5 text-muted-foreground">→</td>
                <td className="px-3 py-2.5 font-mono font-semibold text-foreground">{a.canonical_name}</td>
                <td className="px-3 py-2.5 text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(a.id, a.crm_name)} className="font-mono text-[10px] h-7 px-2 text-red-400 hover:text-red-300">
                    DELETE
                  </Button>
                </td>
              </tr>
            ))}
            {aliases.length === 0 && !loading && (
              <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground font-mono text-sm">No aliases configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Main Settings Page ----

export default function Settings() {
  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            System configuration and management
          </p>
        </div>
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-4 bg-card/30">
          <WifiOff className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm font-mono text-muted-foreground text-center max-w-md">
            Supabase is not configured. Set <code className="text-foreground">VITE_SUPABASE_URL</code> and{" "}
            <code className="text-foreground">VITE_SUPABASE_ANON_KEY</code> in your <code className="text-foreground">.env</code> file to enable Settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Agent roster, evaluation windows, and gate configuration
        </p>
      </div>

      <Tabs defaultValue="roster" className="w-full">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="roster" className="font-mono text-xs data-[state=active]:bg-accent">
            AGENT ROSTER
          </TabsTrigger>
          <TabsTrigger value="windows" className="font-mono text-xs data-[state=active]:bg-accent">
            EVALUATION WINDOWS
          </TabsTrigger>
          <TabsTrigger value="gates" className="font-mono text-xs data-[state=active]:bg-accent">
            GATE THRESHOLDS
          </TabsTrigger>
          <TabsTrigger value="aliases" className="font-mono text-xs data-[state=active]:bg-accent">
            NAME ALIASES
          </TabsTrigger>
          <TabsTrigger value="data" className="font-mono text-xs data-[state=active]:bg-accent">
            DATA IMPORT
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster" className="mt-4">
          <AgentRosterTab />
        </TabsContent>
        <TabsContent value="windows" className="mt-4">
          <EvaluationWindowsTab />
        </TabsContent>
        <TabsContent value="gates" className="mt-4">
          <GateThresholdsTab />
        </TabsContent>
        <TabsContent value="aliases" className="mt-4">
          <NameAliasesTab />
        </TabsContent>
        <TabsContent value="data" className="mt-4">
          <Suspense fallback={<div className="text-sm font-mono text-muted-foreground animate-pulse p-8">Loading data manager...</div>}>
            <DataManager />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
