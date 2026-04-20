// ============================================================
// DSB Tier Calculator — Types & Constants
// Design: Command Center / Bloomberg Terminal aesthetic
// ============================================================

export type Tier = "T1" | "T2" | "T3";

export type AgentStatus =
  | "PROMOTE"
  | "DEMOTE"
  | "HOLD"
  | "AT RISK"
  | "EXIT RISK"
  | "ELIGIBLE T1"
  | "WATCH"
  | "GRACE PERIOD";

export type GateResult = "PASS" | "BLOCKED" | "GRACE PERIOD" | "N/A";

// ---- Cost Constants ----
export const LEAD_COSTS = {
  T1_INBOUND: 83,
  T2_INBOUND: 73,
  T2_OUTBOUND: 15,
  T3_OUTBOUND: 15,
} as const;

// ---- Volume Constants ----
export const DAILY_VOLUMES = {
  T1_INBOUND_CALLS: 10,
  T2_INBOUND_CALLS: 7,
  T2_OUTBOUND_LEADS: 10,
  T3_OUTBOUND_LEADS: 25,
} as const;

// ---- Bucket Sizes ----
export const BUCKET_SIZES = {
  T1: 19,
  T2: 47,
  T3: 22,
} as const;

// ---- Pace Targets (T3 @ 25/day) ----
export const PACE_TARGETS = {
  T3_FLOOR: 1.25, // 5% CR
  T3_PROMO: 2.0, // 8% CR
} as const;

// ---- Gate Thresholds ----
export const GATE_THRESHOLDS = {
  MIN_CR_FOR_PROMOTION: 5, // 5% minimum close rate
  PROFIT_FLOOR_PERCENTILE: 40, // 40th percentile
  TRAJECTORY_IMPROVEMENT: 20, // 20% improvement
  T1_IB_CR_QUARTILE: 25, // bottom 25th percentile
} as const;

// ---- Agent Data Interfaces ----

export interface DailyPulseAgent {
  name: string;
  site: string;
  tier: Tier;
  manager?: string | null;
  /** ADP-sourced original hire date (YYYY-MM-DD). Drives tenure cohorts. */
  hiredDate?: string | null;
  // Inbound metrics
  ibCalls?: number;
  ibSales?: number;
  // Outbound metrics
  obLeads?: number;
  obSales?: number;
  // Effort metrics
  dials?: number;
  talkTimeMin?: number;
  // Production
  salesToday: number;
  premiumToday: number;
  bonusSales?: number;
  bonusLeads?: number;
  bonusPremium?: number;
  totalPremium: number;
  // MTD
  mtdSales?: number;
  mtdPace?: number;
  mtdROLI?: number;
  // Range mode
  daysActive?: number;
  // Leads Pool metrics
  pool?: PoolMetrics;
  // Sales funnel metrics (from agent_performance_daily)
  funnel?: FunnelMetrics;
}

export interface PoolMetrics {
  callsMade: number;
  talkTimeMin: number;
  salesMade: number;
  premium: number;
  selfAssignedLeads: number;
  answeredCalls: number;
  longCalls: number;
  contactRate: number;
  assignRate: number;    // selfAssigned / answeredCalls × 100
  closeRate: number;     // salesMade / selfAssignedLeads × 100
}

export interface PoolInventorySnapshot {
  status: string;
  totalLeads: number;
}

export interface FunnelMetrics {
  dials: number;
  leadsWorked: number;
  contactsMade: number;
  conversations: number;   // calls 2–15 min (duration bucket, NOT sequential)
  presentations: number;   // calls 15+ min (duration bucket, NOT sequential)
  followUpsSet: number;
  sales: number;
  talkTimeMinutes: number;
  premium: number;
  // CRM-defined rates
  contactPct: number;             // contactsMade / leadsWorked × 100
  contactToClosePct: number;      // sales / contactsMade × 100
  conversationToClosePct: number; // sales / conversations × 100
  presentationToClosePct: number; // sales / presentations × 100
}

export interface MonthlyAgent {
  name: string;
  site?: string;
  tier: Tier;
  // Volume
  leadsDelivered: number;
  ibCalls?: number;
  obLeads?: number;
  // Sales
  sales: number;
  ibSales?: number;
  obSales?: number;
  bonusSales?: number;
  // Financials
  totalPremium: number;
  leadCost: number;
  profit: number;
  roli: number;
  // Close rates
  closeRate: number;
  ibCR?: number;
  obCR?: number;
  // Prior month
  priorROLI?: number;
  // Computed
  status?: AgentStatus;
  rank?: number;
}

export interface GateAnalysis {
  agent: MonthlyAgent;
  replacement?: MonthlyAgent;
  gate1: GateResult;
  gate1Detail: string;
  gate2: GateResult;
  gate2Detail: string;
  gate3: GateResult;
  gate3Detail: string;
  gate4?: GateResult;
  gate4Detail?: string;
  finalResult: "CLEARED" | "BLOCKED";
}

export interface SwapResult {
  promotions: MonthlyAgent[];
  demotions: MonthlyAgent[];
  blocked: GateAnalysis[];
  swapCount: number;
}

// ---- Calculation Helpers ----

export function calcROLI(premium: number, leadCost: number): number {
  if (leadCost === 0) return 0;
  return (premium - leadCost) / leadCost;
}

export function calcCloseRate(sales: number, leads: number): number {
  if (leads === 0) return 0;
  return (sales / leads) * 100;
}

export function calcProfit(premium: number, leadCost: number): number {
  return premium - leadCost;
}

export function calcLeadCost(tier: Tier, ibCalls?: number, obLeads?: number): number {
  switch (tier) {
    case "T1":
      return (ibCalls ?? 0) * LEAD_COSTS.T1_INBOUND;
    case "T2":
      return (ibCalls ?? 0) * LEAD_COSTS.T2_INBOUND + (obLeads ?? 0) * LEAD_COSTS.T2_OUTBOUND;
    case "T3":
      return (obLeads ?? 0) * LEAD_COSTS.T3_OUTBOUND;
  }
}

export function calcPace(totalSales: number, workingDaysCompleted: number): number {
  if (workingDaysCompleted === 0) return 0;
  return totalSales / workingDaysCompleted;
}

export function getPaceColor(pace: number): "green" | "yellow" | "red" {
  if (pace >= PACE_TARGETS.T3_PROMO) return "green";
  if (pace >= PACE_TARGETS.T3_FLOOR) return "yellow";
  return "red";
}

export function getPercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export function getStatusColor(status: AgentStatus): string {
  switch (status) {
    case "PROMOTE":
    case "ELIGIBLE T1":
      return "text-emerald-400";
    case "DEMOTE":
    case "EXIT RISK":
      return "text-red-400";
    case "AT RISK":
    case "WATCH":
    case "GRACE PERIOD":
      return "text-amber-400";
    case "HOLD":
    default:
      return "text-muted-foreground";
  }
}

export function getStatusBg(status: AgentStatus): string {
  switch (status) {
    case "PROMOTE":
    case "ELIGIBLE T1":
      return "bg-emerald-500/10 border-emerald-500/30";
    case "DEMOTE":
    case "EXIT RISK":
      return "bg-red-500/10 border-red-500/30";
    case "AT RISK":
    case "WATCH":
    case "GRACE PERIOD":
      return "bg-amber-500/10 border-amber-500/30";
    case "HOLD":
    default:
      return "bg-muted/50 border-border";
  }
}
