// ============================================================
// Gate Calculator — Command Center
// Runs the 4 Protective Gates and Elastic Swap cascade
// ============================================================

import { useState, useMemo } from "react";
import { useData } from "@/contexts/DataContext";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";
import { GatePipeline } from "@/components/GatePipeline";
import { runElasticSwap } from "@/lib/gateEngine";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function formatCurrency(val: number) {
  return "$" + val.toLocaleString();
}

export default function GateCalculator() {
  const { monthlyT3, monthlyT2, monthlyT1, windowStart, windowEnd } = useData();
  const [hasRun, setHasRun] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const result = useMemo(() => {
    if (!hasRun) return null;
    return runElasticSwap(monthlyT3, monthlyT2, monthlyT1);
  }, [hasRun, monthlyT3, monthlyT2, monthlyT1]);

  const handleRun = () => setHasRun(true);
  const handleReset = () => {
    setHasRun(false);
    setExpandedAgent(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Gate Calculator</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Elastic Swap cascade with 4 protective gates — {windowStart} → {windowEnd}
        </p>
      </div>

      {/* Control Panel */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleRun}
          disabled={hasRun}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-sm gap-2"
        >
          <Play className="h-4 w-4" />
          RUN GATES
        </Button>
        {hasRun && (
          <Button
            onClick={handleReset}
            variant="outline"
            className="font-mono text-sm gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            RESET
          </Button>
        )}
      </div>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="space-y-6"
          >
            {/* Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard
                label="Swaps Executed"
                value={result.swapCount}
                subtext="of 5 max"
                color={result.swapCount >= 3 ? "green" : "amber"}
              />
              <MetricCard
                label="Promotions (T3→T2)"
                value={result.promotions.length}
                color="green"
              />
              <MetricCard
                label="Demotions (T2→T3)"
                value={result.demotions.length}
                color="red"
              />
              <MetricCard
                label="Blocked by Gates"
                value={result.blocked.length}
                color="amber"
              />
            </div>

            {/* Promotions */}
            <div className="space-y-3">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Promotions (T3 → T2)
              </h2>
              {result.promotions.length === 0 ? (
                <p className="text-sm text-muted-foreground font-mono">No promotions — all gates blocked</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">CR%</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Premium</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Profit</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">ROLI</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.promotions.map((agent) => (
                        <tr key={agent.name} className="border-b border-border/50 bg-emerald-500/5">
                          <td className="px-3 py-2.5 font-semibold text-foreground">{agent.name}</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums">{agent.closeRate.toFixed(1)}%</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.totalPremium)}</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.profit)}</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.roli.toFixed(2)}x</td>
                          <td className="px-3 py-2.5"><StatusBadge status="PROMOTE" pulse /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Demotions */}
            <div className="space-y-3">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-red-400 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                Demotions (T2 → T3)
              </h2>
              {result.demotions.length === 0 ? (
                <p className="text-sm text-muted-foreground font-mono">No demotions — all candidates protected by gates</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Agent</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">IB CR</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">OB CR</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Lead Cost</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">Profit</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground text-right">ROLI</th>
                        <th className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.demotions.map((agent) => (
                        <tr key={agent.name} className="border-b border-border/50 bg-red-500/5">
                          <td className="px-3 py-2.5 font-semibold text-foreground">{agent.name}</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums">{(agent.ibCR ?? 0).toFixed(1)}%</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums">{(agent.obCR ?? 0).toFixed(1)}%</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.leadCost)}</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums">{formatCurrency(agent.profit)}</td>
                          <td className="px-3 py-2.5 font-mono text-right tabular-nums font-bold">{agent.roli.toFixed(2)}x</td>
                          <td className="px-3 py-2.5"><StatusBadge status="DEMOTE" pulse /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Blocked — Gate Analysis */}
            {result.blocked.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-mono font-bold uppercase tracking-widest text-amber-400 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Blocked by Gates (Protected from Demotion)
                </h2>
                <div className="space-y-2">
                  {result.blocked.map((ga) => (
                    <div key={ga.agent.name} className="border border-amber-500/30 rounded-md bg-amber-500/5">
                      <button
                        onClick={() =>
                          setExpandedAgent(
                            expandedAgent === ga.agent.name ? null : ga.agent.name
                          )
                        }
                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                      >
                        <div className="flex items-center gap-3">
                          {expandedAgent === ga.agent.name ? (
                            <ChevronDown className="h-4 w-4 text-amber-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-amber-400" />
                          )}
                          <span className="font-semibold text-foreground">{ga.agent.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            ROLI: {ga.agent.roli.toFixed(2)}x | Profit: {formatCurrency(ga.agent.profit)}
                          </span>
                        </div>
                        <StatusBadge status="WATCH" />
                      </button>
                      <AnimatePresence>
                        {expandedAgent === ga.agent.name && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 border-t border-amber-500/20 pt-3">
                              {ga.replacement && (
                                <div className="mb-4 p-3 bg-card rounded-md border border-border">
                                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
                                    Would be replaced by:
                                  </span>
                                  <div className="flex items-center gap-4 mt-1">
                                    <span className="font-semibold text-foreground">{ga.replacement.name}</span>
                                    <span className="font-mono text-sm text-emerald-400">
                                      ROLI: {ga.replacement.roli.toFixed(2)}x
                                    </span>
                                    <span className="font-mono text-sm text-muted-foreground">
                                      Profit: {formatCurrency(ga.replacement.profit)}
                                    </span>
                                  </div>
                                </div>
                              )}
                              <GatePipeline analysis={ga} />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pre-run state */}
      {!hasRun && (
        <div className="border border-dashed border-border rounded-md p-12 flex flex-col items-center justify-center gap-4 bg-card/30">
          <div className="text-6xl font-mono font-bold text-muted-foreground/20">⚡</div>
          <p className="text-sm font-mono text-muted-foreground text-center max-w-md">
            Click <strong className="text-foreground">RUN GATES</strong> to execute the Elastic Swap cascade.
            The engine will evaluate all T2 demotion candidates against the 4 protective gates
            and match promotions to unblocked demotions.
          </p>
        </div>
      )}
    </div>
  );
}
