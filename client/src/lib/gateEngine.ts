import {
  GateAnalysis,
  GateResult,
  MonthlyAgent,
  SwapResult,
  GATE_THRESHOLDS,
  getPercentile,
} from "./types";

/**
 * Run the full Elastic Swap cascade:
 * 1. Identify T3 promotion pool (top 5 by ROLI, CR >= 5%)
 * 2. Identify T2 demotion pool (bottom 5 by ROLI)
 * 3. Run Gates 1-3 on each T2 candidate
 * 4. Match promotions to unblocked demotions
 */
export function runElasticSwap(
  t3Agents: MonthlyAgent[],
  t2Agents: MonthlyAgent[],
  t1Agents?: MonthlyAgent[]
): SwapResult {
  // Sort T3 by ROLI descending
  const t3Sorted = [...t3Agents].sort((a, b) => b.roli - a.roli);
  // Filter for CR >= 5%
  const t3Eligible = t3Sorted.filter(
    (a) => a.closeRate >= GATE_THRESHOLDS.MIN_CR_FOR_PROMOTION
  );
  const t3Pool = t3Eligible.slice(0, 5);

  // Sort T2 by ROLI ascending (bottom 5)
  const t2Sorted = [...t2Agents].sort((a, b) => a.roli - b.roli);
  const t2Pool = t2Sorted.slice(0, 5);

  // Calculate T2 profit percentile for Gate 2
  const t2Profits = t2Agents.map((a) => a.profit);
  const profitFloor = getPercentile(
    t2Profits,
    GATE_THRESHOLDS.PROFIT_FLOOR_PERCENTILE
  );

  // Run gates on each T2 candidate
  const gateResults: GateAnalysis[] = t2Pool.map((t2Agent, index) => {
    const t3Replacement = t3Pool[index]; // The T3 agent who would take their seat

    // Gate 1: Cross-Tier ROLI
    let gate1: GateResult = "N/A";
    let gate1Detail = "";
    if (t3Replacement) {
      if (t2Agent.roli >= t3Replacement.roli) {
        gate1 = "BLOCKED";
        gate1Detail = `T2 ROLI (${t2Agent.roli.toFixed(2)}) >= T3 ROLI (${t3Replacement.roli.toFixed(2)})`;
      } else {
        gate1 = "PASS";
        gate1Detail = `T2 ROLI (${t2Agent.roli.toFixed(2)}) < T3 ROLI (${t3Replacement.roli.toFixed(2)})`;
      }
    } else {
      gate1 = "N/A";
      gate1Detail = "No T3 replacement available";
    }

    // Gate 2: Absolute Profit Floor
    let gate2: GateResult = "N/A";
    let gate2Detail = "";
    if (gate1 !== "BLOCKED") {
      if (t2Agent.profit >= profitFloor) {
        gate2 = "BLOCKED";
        gate2Detail = `Profit ($${t2Agent.profit.toLocaleString()}) >= 40th pctl ($${profitFloor.toLocaleString()})`;
      } else {
        gate2 = "PASS";
        gate2Detail = `Profit ($${t2Agent.profit.toLocaleString()}) < 40th pctl ($${profitFloor.toLocaleString()})`;
      }
    } else {
      gate2Detail = "Skipped — blocked by Gate 1";
    }

    // Gate 3: Trajectory
    let gate3: GateResult = "N/A";
    let gate3Detail = "";
    if (gate1 !== "BLOCKED" && gate2 !== "BLOCKED") {
      if (t2Agent.priorROLI !== undefined && t2Agent.priorROLI > 0) {
        const improvement =
          ((t2Agent.roli - t2Agent.priorROLI) / t2Agent.priorROLI) * 100;
        if (improvement >= GATE_THRESHOLDS.TRAJECTORY_IMPROVEMENT) {
          gate3 = "GRACE PERIOD";
          gate3Detail = `ROLI improved ${improvement.toFixed(1)}% (${t2Agent.priorROLI.toFixed(2)} → ${t2Agent.roli.toFixed(2)})`;
        } else {
          gate3 = "PASS";
          gate3Detail = `ROLI changed ${improvement.toFixed(1)}% (threshold: +${GATE_THRESHOLDS.TRAJECTORY_IMPROVEMENT}%)`;
        }
      } else {
        gate3 = "PASS";
        gate3Detail = "No prior month data — first cycle";
      }
    } else {
      gate3Detail = "Skipped — blocked by prior gate";
    }

    const finalResult: "CLEARED" | "BLOCKED" =
      gate1 === "BLOCKED" || gate2 === "BLOCKED" || gate3 === "GRACE PERIOD"
        ? "BLOCKED"
        : "CLEARED";

    return {
      agent: t2Agent,
      replacement: t3Replacement,
      gate1,
      gate1Detail,
      gate2,
      gate2Detail,
      gate3,
      gate3Detail,
      finalResult,
    };
  });

  // Count unblocked demotions
  const clearedDemotions = gateResults.filter(
    (g) => g.finalResult === "CLEARED"
  );
  const blockedDemotions = gateResults.filter(
    (g) => g.finalResult === "BLOCKED"
  );
  const swapCount = clearedDemotions.length;

  // Match promotions
  const promotions = t3Pool.slice(0, swapCount);
  const demotions = clearedDemotions.map((g) => g.agent);

  return {
    promotions,
    demotions,
    blocked: blockedDemotions,
    swapCount,
  };
}

/**
 * Run Gate 4 for T2 → T1 promotion eligibility
 */
export function runGate4(
  t2Agent: MonthlyAgent,
  t1Agents: MonthlyAgent[]
): { result: GateResult; detail: string } {
  const t1IBCRs = t1Agents
    .map((a) => a.closeRate)
    .sort((a, b) => a - b);
  const bottomQuartile = getPercentile(t1IBCRs, GATE_THRESHOLDS.T1_IB_CR_QUARTILE);

  const t2IBCR = t2Agent.ibCR ?? 0;

  if (t2IBCR >= bottomQuartile) {
    return {
      result: "PASS",
      detail: `IB CR (${t2IBCR}%) >= T1 bottom quartile (${bottomQuartile.toFixed(1)}%)`,
    };
  } else {
    return {
      result: "BLOCKED",
      detail: `IB CR (${t2IBCR}%) < T1 bottom quartile (${bottomQuartile.toFixed(1)}%)`,
    };
  }
}
