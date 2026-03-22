import { DailyPulseAgent, MonthlyAgent } from "./types";

// ============================================================
// Sample Data — Replace with CRM scraper data in production
// ============================================================

export const sampleDailyT3: DailyPulseAgent[] = [
  { name: "Alvin Fulmore", site: "CHA", tier: "T3", obLeads: 25, dials: 185, talkTimeMin: 214, salesToday: 2, premiumToday: 1850, totalPremium: 1850, mtdSales: 18, mtdPace: 1.8 },
  { name: "Tamara Hemmings", site: "AUS", tier: "T3", obLeads: 25, dials: 172, talkTimeMin: 198, salesToday: 1, premiumToday: 900, totalPremium: 900, mtdSales: 22, mtdPace: 2.2 },
  { name: "Brandon Simmons", site: "CHA", tier: "T3", obLeads: 25, dials: 160, talkTimeMin: 187, salesToday: 2, premiumToday: 1650, totalPremium: 1650, mtdSales: 20, mtdPace: 2.0 },
  { name: "Aldo Acosta", site: "AUS", tier: "T3", obLeads: 25, dials: 155, talkTimeMin: 176, salesToday: 1, premiumToday: 750, totalPremium: 750, mtdSales: 15, mtdPace: 1.5 },
  { name: "Marcus Reed", site: "CHA", tier: "T3", obLeads: 25, dials: 148, talkTimeMin: 165, salesToday: 0, premiumToday: 0, totalPremium: 0, mtdSales: 14, mtdPace: 1.4 },
  { name: "Denise Fowler", site: "AUS", tier: "T3", obLeads: 25, dials: 140, talkTimeMin: 155, salesToday: 1, premiumToday: 850, totalPremium: 850, mtdSales: 16, mtdPace: 1.6 },
  { name: "Noah Nunn", site: "AUS", tier: "T3", obLeads: 25, dials: 135, talkTimeMin: 148, salesToday: 0, premiumToday: 0, totalPremium: 0, mtdSales: 8, mtdPace: 0.8 },
  { name: "Doug Yang", site: "CHA", tier: "T3", obLeads: 25, dials: 120, talkTimeMin: 132, salesToday: 1, premiumToday: 700, totalPremium: 700, mtdSales: 6, mtdPace: 0.6 },
];

export const sampleDailyT2: DailyPulseAgent[] = [
  { name: "Naimah German", site: "CHA", tier: "T2", ibCalls: 7, ibSales: 2, obLeads: 10, obSales: 1, salesToday: 3, premiumToday: 2750, totalPremium: 2750, mtdROLI: 1.85 },
  { name: "Chris Cantu", site: "AUS", tier: "T2", ibCalls: 7, ibSales: 2, obLeads: 10, obSales: 1, salesToday: 3, premiumToday: 2500, totalPremium: 2500, mtdROLI: 2.27 },
  { name: "Austin Houser", site: "AUS", tier: "T2", ibCalls: 8, ibSales: 1, obLeads: 10, obSales: 0, salesToday: 1, premiumToday: 850, totalPremium: 850, mtdROLI: 0.95 },
  { name: "Sean Leary", site: "CHA", tier: "T2", ibCalls: 6, ibSales: 1, obLeads: 10, obSales: 0, salesToday: 1, premiumToday: 780, totalPremium: 780, mtdROLI: 0.76 },
  { name: "Doug Curttright", site: "AUS", tier: "T2", ibCalls: 7, ibSales: 0, obLeads: 10, obSales: 1, salesToday: 1, premiumToday: 650, totalPremium: 650, mtdROLI: 0.38 },
];

export const sampleDailyT1: DailyPulseAgent[] = [
  { name: "Russell Tvedt", site: "CHA", tier: "T1", ibCalls: 10, salesToday: 3, premiumToday: 2800, bonusSales: 1, totalPremium: 3500, mtdROLI: 2.10 },
  { name: "Kyle Williford", site: "AUS", tier: "T1", ibCalls: 10, salesToday: 2, premiumToday: 1900, bonusSales: 0, totalPremium: 1900, mtdROLI: 1.45 },
  { name: "Sarah Mitchell", site: "CHA", tier: "T1", ibCalls: 9, salesToday: 1, premiumToday: 950, bonusSales: 0, totalPremium: 950, mtdROLI: 0.90 },
];

// ---- Monthly Stack Rank Data ----

export const sampleMonthlyT3: MonthlyAgent[] = [
  { name: "Tamara Hemmings", site: "AUS", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 54, totalPremium: 48600, leadCost: 9000, profit: 39600, roli: 4.40, closeRate: 9.0, priorROLI: 3.80 },
  { name: "Brandon Simmons", site: "CHA", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 48, totalPremium: 43200, leadCost: 9000, profit: 34200, roli: 3.80, closeRate: 8.0, priorROLI: 3.20 },
  { name: "Aldo Acosta", site: "AUS", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 45, totalPremium: 40500, leadCost: 9000, profit: 31500, roli: 3.50, closeRate: 7.5, priorROLI: 3.10 },
  { name: "Marcus Reed", site: "CHA", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 42, totalPremium: 37800, leadCost: 9000, profit: 28800, roli: 3.20, closeRate: 7.0, priorROLI: 2.90 },
  { name: "Denise Fowler", site: "AUS", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 38, totalPremium: 34200, leadCost: 9000, profit: 25200, roli: 2.80, closeRate: 6.3, priorROLI: 2.40 },
  { name: "Alvin Fulmore", site: "CHA", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 35, totalPremium: 31500, leadCost: 9000, profit: 22500, roli: 2.50, closeRate: 5.8, priorROLI: 2.20 },
  { name: "Noah Nunn", site: "AUS", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 25, totalPremium: 22500, leadCost: 9000, profit: 13500, roli: 1.50, closeRate: 4.1, priorROLI: 1.30 },
  { name: "Doug Yang", site: "CHA", tier: "T3", leadsDelivered: 600, obLeads: 600, sales: 20, totalPremium: 18000, leadCost: 9000, profit: 9000, roli: 1.00, closeRate: 3.3, priorROLI: 0.80 },
];

export const sampleMonthlyT2: MonthlyAgent[] = [
  { name: "Chris Cantu", site: "AUS", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 62, ibSales: 52, obSales: 10, totalPremium: 52000, leadCost: 15864, profit: 36136, roli: 2.27, closeRate: 15.2, ibCR: 31, obCR: 8, priorROLI: 2.10 },
  { name: "Naimah German", site: "CHA", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 55, ibSales: 42, obSales: 13, totalPremium: 46000, leadCost: 15864, profit: 30136, roli: 1.90, closeRate: 13.5, ibCR: 25, obCR: 5.4, priorROLI: 1.75 },
  { name: "Austin Houser", site: "AUS", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 48, ibSales: 35, obSales: 13, totalPremium: 40000, leadCost: 15864, profit: 24136, roli: 1.52, closeRate: 11.8, ibCR: 21, obCR: 5.4, priorROLI: 1.40 },
  { name: "Sean Leary", site: "CHA", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 38, ibSales: 30, obSales: 8, totalPremium: 28000, leadCost: 15864, profit: 12136, roli: 0.76, closeRate: 9.3, ibCR: 18, obCR: 3.3, priorROLI: 0.55 },
  { name: "Doug Curttright", site: "AUS", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 32, ibSales: 25, obSales: 7, totalPremium: 22000, leadCost: 15864, profit: 6136, roli: 0.38, closeRate: 7.8, ibCR: 15, obCR: 2.9, priorROLI: 0.42 },
  { name: "James Batton", site: "CHA", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 28, ibSales: 20, obSales: 8, totalPremium: 18000, leadCost: 15864, profit: 2136, roli: 0.13, closeRate: 6.9, ibCR: 12, obCR: 3.3, priorROLI: 0.10 },
  { name: "Maria Voss", site: "AUS", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 42, ibSales: 34, obSales: 8, totalPremium: 30000, leadCost: 15864, profit: 14136, roli: 0.89, closeRate: 10.3, ibCR: 20, obCR: 3.3, priorROLI: 0.60 },
  { name: "Tyler Knox", site: "CHA", tier: "T2", leadsDelivered: 408, ibCalls: 168, obLeads: 240, sales: 30, ibSales: 23, obSales: 7, totalPremium: 20000, leadCost: 15864, profit: 4136, roli: 0.26, closeRate: 7.4, ibCR: 14, obCR: 2.9, priorROLI: 0.30 },
];

export const sampleMonthlyT1: MonthlyAgent[] = [
  { name: "Russell Tvedt", site: "CHA", tier: "T1", leadsDelivered: 240, ibCalls: 240, sales: 85, totalPremium: 76500, leadCost: 19920, profit: 56580, roli: 2.84, closeRate: 35.4, priorROLI: 2.70 },
  { name: "Kyle Williford", site: "AUS", tier: "T1", leadsDelivered: 240, ibCalls: 240, sales: 45, totalPremium: 38000, leadCost: 19920, profit: 18080, roli: 0.90, closeRate: 18.7, priorROLI: 0.95 },
  { name: "Sarah Mitchell", site: "CHA", tier: "T1", leadsDelivered: 240, ibCalls: 240, sales: 55, totalPremium: 49500, leadCost: 19920, profit: 29580, roli: 1.48, closeRate: 22.9, priorROLI: 1.50 },
];
