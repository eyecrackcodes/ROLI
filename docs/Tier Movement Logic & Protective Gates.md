# Tier Movement Logic & Protective Gates
**A Strategic Guide for Analysts and Management**

**Prepared by:** Manus AI  
**Date:** March 18, 2026

## 1. Introduction: The Danger of Blind Forced-Ranking

The forced-ranking system—where the top 5 agents in Tier 3 are promoted and the bottom 5 agents in Tier 2 are demoted—is designed to create a competitive, merit-based floor while maintaining static bucket sizes (19 in T1, 47 in T2, 22 in T3). 

However, executing a blind, mechanical swap based solely on relative rank within a tier introduces a critical vulnerability: **Value-Destructive Demotions**. 

If an analyst simply takes the bottom 5 names on the Tier 2 list and swaps them with the top 5 names on the Tier 3 list, they risk removing highly profitable agents from expensive inbound leads and replacing them with less proven agents, resulting in a net loss of revenue for the company. 

This white paper outlines the mathematical logic behind these edge cases and establishes a system of **Protective Gates** that the analyst must run before finalizing any tier movement.

---

## 2. The Mechanics of Value Destruction

To understand why a blind swap is dangerous, we must examine how Return on Lead Investment (ROLI) behaves across different lead costs. 

**The ROLI Formula:**  
`ROLI = (Total Premium Sold - Total Lead Cost) / Total Lead Cost`

Because Tier 3 agents have a much lower lead cost base ($9,000 per cycle) compared to Tier 2 agents ($15,864 per cycle), a high ROLI in Tier 3 does not necessarily equate to higher absolute profit than a moderate ROLI in Tier 2.

### The Edge Case Scenario

Imagine it is the end of the month. The analyst looks at the stack ranks:
- **Agent A (Bottom 5 of Tier 2):** ROLI = 1.5. They generated $39,660 in premium on $15,864 in lead cost. **Absolute Profit = $23,796.**
- **Agent B (Top 5 of Tier 3):** ROLI = 1.8. They generated $25,200 in premium on $9,000 in lead cost. **Absolute Profit = $16,200.**

If the analyst executes a blind forced-ranking swap, Agent A is demoted and Agent B is promoted. 
- The floor just lost an agent generating $23K in profit and replaced them with an agent generating $16K in profit. 
- The company suffers a **net destruction of $7,596 in value** for that seat.

Furthermore, Agent A's pipeline of $83 inbound leads is disrupted, while Agent B is suddenly handed expensive inbound calls they have never proven they can close.

---

## 3. The Protective Gate Framework

To prevent value destruction, the analyst must not treat the "Top 5 / Bottom 5" rule as an absolute mandate. Instead, it is a **candidate pool**. 

The analyst identifies the 5 promotion candidates from T3 and the 5 demotion candidates from T2. Before any swap is executed, the analyst must pass the T2 demotion candidates through four **Protective Gates**. 

If a T2 candidate triggers a Gate, their demotion is **BLOCKED**.

### Gate 1: The Cross-Tier ROLI Comparison
A Tier 2 agent should never be demoted to make room for a Tier 3 agent who is less efficient with company capital.

- **The Rule:** Compare the ROLI of the specific T2 demotion candidate against the ROLI of the specific T3 promotion candidate who would replace them. If the T2 agent's ROLI is **greater than or equal to** the T3 agent's ROLI, the demotion is BLOCKED.
- **The Logic:** The T2 agent is already proving they can generate a higher return per dollar spent, even while handling a more complex hybrid lead mix. Demoting them punishes efficiency.

### Gate 2: The Absolute Profit Floor
Relative rank within a tier can be misleading if the entire tier had a highly profitable month. Being #43 out of 47 is only bad if #43 is actually losing money.

- **The Rule:** Calculate the median absolute profit for the entire Tier 2 cohort. If the demotion candidate's absolute profit is **above the 40th percentile** of the tier, the demotion is BLOCKED.
- **The Logic:** An agent who is generating significant, above-average absolute profit for the company should not be demoted simply because 42 other people had a slightly better month. 

### Gate 3: The Trajectory Gate (Grace Period)
Sales is a game of momentum. A snapshot of a single 24-day window can capture an agent just as they are turning the corner.

- **The Rule:** Look at the agent's ROLI from the previous month. If their current month ROLI shows a **positive increase of 20% or more** compared to the prior month, the demotion is BLOCKED for one cycle (Grace Period).
- **The Logic:** If an agent went from a 0.5 ROLI to a 1.1 ROLI, they are trending upward. Demoting them cuts off their momentum, resets their pipeline, and destroys the coaching investment made over the last 30 days.

### Gate 4: The Inbound Competency Gate (T2 to T1 Only)
This gate applies specifically to the optional promotions from Tier 2 up to the elite Tier 1 bucket. 

- **The Rule:** To be eligible for promotion to T1, the T2 agent's **Inbound-Only Close Rate** must be greater than or equal to the bottom quartile (bottom 25%) of the current T1 cohort.
- **The Logic:** Tier 1 is pure inbound ($83/call). A Tier 2 agent might have a massive overall ROLI because they are incredible at closing $15 outbound leads, but if their inbound close rate is poor, promoting them to T1 will result in burning expensive leads.

---

## 4. Executing the "Elastic Swap"

Because the Protective Gates will frequently block demotions, the analyst cannot force a rigid 5-for-5 swap every month. Doing so would violate the static bucket constraints (e.g., if 5 T3s move up, but only 2 T2s move down, Tier 2 swells to 50 agents).

Instead, the analyst must use an **Elastic Swap** methodology:

1. **Identify the Pools:** Pull the Top 5 T3 agents (ranked by ROLI, must have >= 5% CR) and the Bottom 5 T2 agents (ranked by ROLI).
2. **Run the Gates:** Pass the 5 T2 candidates through the Protective Gates. 
3. **Count the Failures:** Determine how many T2 agents *failed* the gates and are legitimately cleared for demotion (e.g., 3 agents).
4. **Match the Promotions:** Promote exactly that same number of agents from the top of the T3 pool (e.g., the Top 3 T3 agents are promoted; agents #4 and #5 remain in T3).

**The Golden Rule for the Analyst:**  
*The number of promotions from Tier 3 must always equal the number of unblocked demotions from Tier 2.* 

This ensures the bucket sizes remain perfectly static while guaranteeing that every single tier movement makes the floor mathematically more profitable.


---

## 5. The Analyst's Decision Flowchart

The following table provides a step-by-step decision process for the analyst to follow at the end of each Monthly Evaluation Window. Each row represents a sequential action.

| Step | Action | Input | Output |
| :--- | :--- | :--- | :--- |
| **1** | Pull the Tier 3 Stack Rank | Monthly window data, sorted by ROLI DESC | Ordered list of T3 agents with ROLI and CR |
| **2** | Identify the T3 Promotion Pool | Top 5 agents from Step 1 | Up to 5 candidates; remove any with CR < 5% |
| **3** | Pull the Tier 2 Stack Rank | Monthly window data, sorted by ROLI DESC | Ordered list of T2 agents with ROLI, IB CR, OB CR, Absolute Profit |
| **4** | Identify the T2 Demotion Pool | Bottom 5 agents from Step 3 | Up to 5 candidates |
| **5** | Run Gate 1 (Cross-Tier ROLI) | Compare each T2 candidate's ROLI against the T3 candidate who would replace them | Mark each T2 candidate as PASS or BLOCKED |
| **6** | Run Gate 2 (Absolute Profit Floor) | Calculate 40th percentile of T2 absolute profit; compare each remaining candidate | Mark additional candidates as BLOCKED if above threshold |
| **7** | Run Gate 3 (Trajectory) | Compare each remaining candidate's ROLI to their prior month ROLI | Mark as GRACE PERIOD if improvement >= 20% |
| **8** | Count Unblocked Demotions | Sum of T2 candidates that passed all gates | A number between 0 and 5 |
| **9** | Match Promotions to Demotions | Take the top N agents from the T3 pool (where N = unblocked demotions) | Final promotion list |
| **10** | Execute the Swap | Move the matched agents between tiers in the CRM | Bucket sizes remain static |
| **11** | (Optional) Evaluate T2→T1 | Run Gate 4 (Inbound Competency) on top T2 agents vs bottom T1 agents | Management decision |

---

## 6. Worked Example: April 2026 Evaluation Window

To make this concrete, consider the following hypothetical scenario at the end of the April 2026 evaluation window (March 30 – May 1, 24 working days).

### Step 1–2: The Tier 3 Promotion Pool

| Rank | Agent | Leads Delivered | Sales | CR | Lead Cost | Premium | Profit | ROLI |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Tamara Hemmings | 600 | 54 | 9.0% | $9,000 | $48,600 | $39,600 | 4.40 |
| 2 | Brandon Simmons | 600 | 48 | 8.0% | $9,000 | $43,200 | $34,200 | 3.80 |
| 3 | Aldo Acosta | 600 | 45 | 7.5% | $9,000 | $40,500 | $31,500 | 3.50 |
| 4 | Marcus Reed | 600 | 42 | 7.0% | $9,000 | $37,800 | $28,800 | 3.20 |
| 5 | Denise Fowler | 600 | 38 | 6.3% | $9,000 | $34,200 | $25,200 | 2.80 |

All 5 candidates have CR >= 5%. The Promotion Pool has 5 eligible agents.

### Step 3–4: The Tier 2 Demotion Pool

The Tier 2 median absolute profit for the month is **$18,500**. The 40th percentile is **$15,200**.

| Rank | Agent | IB CR | OB CR | Lead Cost | Premium | Profit | ROLI | Prior ROLI |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 43 | Sean Leary | 18% | 5.0% | $15,864 | $28,000 | $12,136 | 0.76 | 0.55 |
| 44 | Doug Curttright | 15% | 4.0% | $15,864 | $22,000 | $6,136 | 0.38 | 0.42 |
| 45 | James Batton | 12% | 3.0% | $15,864 | $18,000 | $2,136 | 0.13 | 0.10 |
| 46 | Maria Voss | 20% | 4.5% | $15,864 | $30,000 | $14,136 | 0.89 | 0.60 |
| 47 | Tyler Knox | 14% | 3.5% | $15,864 | $20,000 | $4,136 | 0.26 | 0.30 |

### Step 5: Gate 1 — Cross-Tier ROLI Comparison

Each T2 demotion candidate is compared against the T3 promotion candidate who would take their seat.

| T2 Candidate | T2 ROLI | vs. T3 Replacement | T3 ROLI | Result |
| :--- | :--- | :--- | :--- | :--- |
| Sean Leary (#43) | 0.76 | Tamara Hemmings (#1) | 4.40 | **PASS** — T3 agent is far more efficient |
| Doug Curttright (#44) | 0.38 | Brandon Simmons (#2) | 3.80 | **PASS** |
| James Batton (#45) | 0.13 | Aldo Acosta (#3) | 3.50 | **PASS** |
| Maria Voss (#46) | 0.89 | Marcus Reed (#4) | 3.20 | **PASS** |
| Tyler Knox (#47) | 0.26 | Denise Fowler (#5) | 2.80 | **PASS** |

In this example, all 5 pass Gate 1 because the T3 candidates are significantly more efficient. This is the expected outcome when the system is working well.

### Step 6: Gate 2 — Absolute Profit Floor (40th Percentile = $15,200)

| T2 Candidate | Absolute Profit | vs. 40th Percentile ($15,200) | Result |
| :--- | :--- | :--- | :--- |
| Sean Leary | $12,136 | Below | **PASS** |
| Doug Curttright | $6,136 | Below | **PASS** |
| James Batton | $2,136 | Below | **PASS** |
| Maria Voss | $14,136 | Below | **PASS** |
| Tyler Knox | $4,136 | Below | **PASS** |

All 5 are below the 40th percentile. No blocks.

### Step 7: Gate 3 — Trajectory (20% Improvement Threshold)

| T2 Candidate | Prior ROLI | Current ROLI | Change | Result |
| :--- | :--- | :--- | :--- | :--- |
| Sean Leary | 0.55 | 0.76 | **+38%** | **BLOCKED — GRACE PERIOD** |
| Doug Curttright | 0.42 | 0.38 | -9.5% | **PASS** — declining |
| James Batton | 0.10 | 0.13 | +30% | **BLOCKED — GRACE PERIOD** |
| Maria Voss | 0.60 | 0.89 | **+48%** | **BLOCKED — GRACE PERIOD** |
| Tyler Knox | 0.30 | 0.26 | -13% | **PASS** — declining |

Three agents are blocked by the Trajectory Gate. They are improving significantly and deserve another cycle to prove themselves.

### Step 8–9: Final Count

| Outcome | Count |
| :--- | :--- |
| T2 agents cleared for demotion | **2** (Doug Curttright, Tyler Knox) |
| T2 agents blocked (Grace Period) | **3** (Sean Leary, James Batton, Maria Voss) |
| T3 agents promoted | **2** (Tamara Hemmings, Brandon Simmons) |
| T3 agents remaining | **3** (Aldo Acosta, Marcus Reed, Denise Fowler stay in T3) |

The Elastic Swap executes a **2-for-2 swap** instead of the original 5-for-5. The bucket sizes remain static (19 / 47 / 22), and the floor is now more profitable because only the truly underperforming T2 agents were removed.

---

## 7. What Happens to Blocked Agents?

Agents who are blocked by the Protective Gates are not simply ignored. Their status is tracked and escalated.

**Grace Period Agents (Blocked by Gate 3):** These agents are given a yellow "WATCH" flag. If they are in the bottom 5 again the following month and their trajectory has flattened or declined, the Grace Period expires and they are eligible for demotion. An agent can only receive one consecutive Grace Period; two consecutive bottom-5 appearances with a flattening trajectory results in automatic demotion eligibility.

**Profit Floor Agents (Blocked by Gate 2):** These agents are generating meaningful profit but are still ranked low within their tier. Management should investigate whether their low relative rank is due to a temporary issue (e.g., illness, PTO, lead quality anomaly) or a systemic performance problem. If the agent appears in the bottom 5 for two consecutive months while still above the profit floor, management should initiate a coaching intervention rather than an automatic demotion.

**Cross-Tier ROLI Agents (Blocked by Gate 1):** This is the rarest and most important block. It means the T2 agent is genuinely more efficient than the T3 agent who would replace them. In this case, the T3 agent simply does not get promoted that month. The message to the T3 agent is clear: "You are good, but the person you would replace is better. Keep improving."

---

## 8. ROLI Across Tiers: Why Direct Comparison Requires Context

It is tempting to compare ROLI scores across tiers and conclude that a Tier 3 agent with a 4.0 ROLI is "better" than a Tier 1 agent with a 2.0 ROLI. This comparison is mathematically valid but operationally misleading, and the analyst must understand why.

### The Denominator Effect

ROLI is a ratio. Its denominator is lead cost. Because Tier 3 lead costs are dramatically lower ($9,000/cycle) compared to Tier 1 ($19,920/cycle), a small amount of premium sold in Tier 3 produces a large ROLI.

Consider two agents with identical premium production:

| Agent | Tier | Premium Sold | Lead Cost | Profit | ROLI |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Agent X | Tier 1 | $40,000 | $19,920 | $20,080 | **1.01** |
| Agent Y | Tier 3 | $40,000 | $9,000 | $31,000 | **3.44** |

Agent Y's ROLI is 3.4x higher, but both agents sold the same premium. The difference is entirely driven by the cost of the leads they were given. Agent X had to close $83 inbound calls to get there; Agent Y had to grind through 600 outbound leads. Both are valuable. Neither is objectively "better."

### When Cross-Tier ROLI Comparison IS Valid

Cross-tier ROLI comparison becomes valid in exactly one context: **the tier movement decision**. When deciding whether to swap Agent A (T2) for Agent B (T3), the question is not "who is better in absolute terms?" but rather "will this swap make the floor more profitable?" 

That is precisely what Gate 1 answers. If the T2 agent's ROLI is already higher than the T3 agent's ROLI, promoting the T3 agent into a more expensive lead pool will not improve the floor's total return on investment.

---

## 9. The Analyst's Monthly Checklist

At the end of each Monthly Evaluation Window, the analyst should execute the following checklist. Each item should be documented and saved as part of the monthly review record.

| # | Task | Data Required | Deliverable |
| :--- | :--- | :--- | :--- |
| 1 | Generate the Tier 3 Stack Rank | Agent Summary (FEX-Outbound, Agency = T3, Custom Date Range) | Sorted table with ROLI, CR, Profit |
| 2 | Generate the Tier 2 Stack Rank | Agent Summary (Call In + FEX-Outbound, Agency = T2, Custom Date Range) | Sorted table with ROLI, IB CR, OB CR, Profit |
| 3 | Generate the Tier 1 Stack Rank | Agent Summary (Call In, Agency = T1, Custom Date Range) | Sorted table with ROLI, CR, Profit |
| 4 | Identify T3 Promotion Pool | Top 5 T3 agents with CR >= 5% | List of up to 5 candidates |
| 5 | Identify T2 Demotion Pool | Bottom 5 T2 agents | List of 5 candidates |
| 6 | Run Gate 1: Cross-Tier ROLI | Compare each T2 candidate vs. their T3 replacement | PASS / BLOCKED per candidate |
| 7 | Run Gate 2: Absolute Profit Floor | Calculate T2 40th percentile profit | PASS / BLOCKED per candidate |
| 8 | Run Gate 3: Trajectory | Compare current ROLI vs. prior month ROLI | PASS / GRACE PERIOD per candidate |
| 9 | Calculate Final Swap Count | Count unblocked demotions | Number of swaps to execute |
| 10 | Execute Swaps in CRM | Move agents between Agency groups | Updated roster |
| 11 | (Optional) Evaluate T2→T1 | Run Gate 4 on top T2 vs. bottom T1 | Management recommendation |
| 12 | Document and Archive | All gate results and decisions | Monthly review record |

---

## 10. Summary of the Gate Framework

| Gate | Applies To | Rule | Trigger | Effect |
| :--- | :--- | :--- | :--- | :--- |
| **Gate 1** | T2 → T3 Demotion | T2 agent's ROLI >= T3 replacement's ROLI | T2 agent is more efficient per dollar | **BLOCK** demotion |
| **Gate 2** | T2 → T3 Demotion | T2 agent's absolute profit >= 40th percentile of T2 | Agent is generating meaningful profit | **BLOCK** demotion |
| **Gate 3** | T2 → T3 Demotion | T2 agent's ROLI improved >= 20% vs. prior month | Agent is trending upward | **GRACE PERIOD** (1 cycle) |
| **Gate 4** | T2 → T1 Promotion | T2 agent's IB CR >= bottom quartile of T1 IB CR | Agent must prove inbound competency | **BLOCK** promotion if not met |

The Protective Gate framework transforms the forced-ranking system from a blunt instrument into a precision tool. It preserves the competitive pressure that drives performance (agents know they must rank well or face demotion) while preventing the mathematical absurdity of removing a profitable agent to install a less profitable one. The analyst's role is not to simply read the bottom of a list—it is to apply evidence-based reasoning to every single tier movement decision.
