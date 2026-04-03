# T3 Outbound — Standard Operating Procedure

**Version:** 2.0 · **Effective:** April 2026  
**Replaces:** T3 Leads Pool SOP v1.0

## Purpose

This document defines daily expectations for T3 outbound agents across **all three activity channels**: follow-up appointments, queue dialer, and the shared leads pool. The v1 SOP focused on pool-only KPIs. This revision establishes the complete outbound workflow, grounded in observed production data showing that balanced agents (25-39% pool, 4+ long calls, 180+ minutes talk time) produce at nearly 10× the rate of dial-heavy / low-engagement agents.

---

## The Three Activity Channels

T3 outbound activity splits into three distinct channels, each with different mechanics and expectations.

### Channel 1: Follow-Up Appointments (Task-Date Driven)

Scheduled callbacks the agent created from prior contacts. These are NOT in the dialer — the agent manually calls at the task-date time. Highest-value activity because the lead was already contacted and an appointment was set.

| Metric | Expectation |
|---|---|
| Daily follow-ups | 2-8 (varies by pipeline maturity) |
| Dials per follow-up | 1-3 attempts |
| Expected dials | 5-15/day |
| Expected talk time | 30-60 min |
| Past due tolerance | **0** — these are appointments, not optional |

**Rule:** Past due follow-ups must be zero. If past due is rising, the agent is missing scheduled appointments. Stop pool activity and clear follow-ups first.

### Channel 2: Queue Dialer (6-Attempt Cadence)

The dialer automatically cycles through the agent's assigned queue. The agent controls session start/stop and call quality. Each lead gets a maximum of **6 contact attempts**, then must be **withdrawn** from the queue.

| Metric | Expectation |
|---|---|
| Queue dials | 80-120/day |
| Expected talk time | 60-90 min |
| Healthy queue size | 50-120 leads |
| Max attempts per lead | 6, then withdraw |
| Queue delta d/d | Stable or declining |

**Cadence math:** At 1 attempt per lead per day, a queue of 100 leads produces ~100 dials/day. Each lead completes 6 attempts in 6 business days, then exits. New leads from pool self-assigns (4-8/day) and IB/OB assignment (5-10/day) keep the queue flowing.

**Queue health:** If queue exceeds 150, leads are accumulating without withdrawal. If queue delta is positive for 3+ consecutive days, the agent is not enforcing the 6-attempt rule.

### Channel 3: Leads Pool (Self-Assign + Clean)

The shared pool of unassigned leads. Agents enter the pool dialer, work leads, and self-assign every answered contact to remove them from rotation.

| Metric | Expectation |
|---|---|
| Pool dials | 70-100/day |
| Expected talk time | 60-90 min |
| Long calls (15+ min) | ≥ 4/day |
| Self-assign rate | ≥ 30% of pool answered |
| Pool % of total dials | 25-40% |

---

## Daily Workflow

### Block 1 — Follow-Up Appointments (AM / Scheduled Times)

Before anything else, work all scheduled follow-ups and clear past-due items. These are warm leads with prior contact — highest close probability.

- Check task list for today's appointments
- Call each at scheduled time (1-3 attempts if no answer)
- Qualify, present, close, or reschedule
- **Expected:** 5-15 dials, 30-60 min talk time

### Block 2 — Queue Dialer Session (AM–Early PM)

Start the regular dialer session. The system cycles through assigned queue leads automatically.

- Run dialer through assigned pipeline
- Each connected call: qualify and disposition
- Withdraw leads at 6th failed attempt
- **Expected:** 80-120 dials, 60-90 min talk time

### Block 3 — Pool Session (PM)

Switch to the leads pool dialer. New lead acquisition.

- Dial through pool leads
- Self-assign every answered contact (DNC, NI, wrong number, callbacks, sales)
- Target 4+ long calls (15+ min presentations)
- **Expected:** 70-100 dials, 60-90 min talk time

### Block 4 — Work Today's Self-Assigns (Late PM)

Follow through on pool leads pulled during today's session that need immediate attention.

- Set follow-up appointments for interested contacts
- Submit apps for sales made
- Disposition remaining contacts
- **Expected:** 10-20 dials, 20-40 min talk time

---

## Daily Compliance Scorecard

**Pass 5 of 7 gates to be compliant.**

| # | Gate | Metric | Target | Source |
|---|---|---|---|---|
| 1 | **Combined Volume** | Total dials (reg + pool) | ≥ 200 | daily_scrape_data + leads_pool_daily_data |
| 2 | **Pool Presence** | Pool % of total dials | 25-40% | leads_pool_daily_data |
| 3 | **Engagement** | Long calls (15+ min) | ≥ 4 | leads_pool_daily_data |
| 4 | **Talk Time** | Total talk minutes (reg + pool) | ≥ 180 min | daily_scrape_data + leads_pool_daily_data |
| 5 | **Assignment** | Self-assign rate | ≥ 30% of pool answered | leads_pool_daily_data |
| 6 | **Appointment Discipline** | Past due follow-ups | 0 | pipeline_compliance_daily |
| 7 | **Queue Health** | Call queue size | ≤ 120 | pipeline_compliance_daily |

### Compliance Status

| Gates Passed | Status | Action |
|---|---|---|
| 7/7 | Exceeding | Recognize performance |
| 5-6/7 | Compliant | On target |
| 3-4/7 | Below Standard | Coaching conversation |
| 0-2/7 | Non-Compliant | Immediate review with manager |

---

## Self-Assignment Rules

Self-assign **every** answered pool contact. This is non-negotiable.

| Outcome | Action | Why |
|---|---|---|
| DNC | Self-assign → mark DNC | Removes lead from rotation |
| Wrong Number | Self-assign → note it | Removes bad data from pool |
| Not Interested | Self-assign → note reason | Stops the lead from being re-dialed |
| Voicemail / No Answer | Do NOT assign | Lead stays in pool for future attempts |
| Callback Requested | Self-assign → set follow-up date | Lead moves to YOUR appointments |
| Interested | Self-assign → schedule follow-up | Lead becomes your active prospect |
| Sale | Self-assign → submit application | Close it |

---

## Queue Discipline: The 6-Attempt Rule

Every lead in the call queue gets a maximum of 6 contact attempts through the dialer. After the 6th attempt without meaningful contact, **withdraw the lead**.

### Queue Throughput Model

| Queue Size | Daily Dials | Days to Exhaust | Withdrawal Rate |
|---|---|---|---|
| 50 leads | ~50/day | 6 days | ~8 leads/day |
| 80 leads | ~80/day | 6 days | ~13 leads/day |
| 120 leads | ~120/day | 6 days | ~20 leads/day |

### Queue Health Signals

| Signal | Meaning | Action |
|---|---|---|
| Queue < 50 | Light load | Increase pool time for more self-assigns |
| Queue 50-120 | Healthy | Maintain current balance |
| Queue 120-200 | Accumulating | Audit queue, enforce withdrawals |
| Queue > 200 | Bloated — leads rotting | Stop pool, clear and withdraw stale leads |

---

## Pipeline Flow: How Pool Feeds Pipeline

Pool activity creates pipeline load. This is expected and healthy.

```
Day 1: Pool → 80 dials → 40 answered → 12 self-assigned
         ├── 6 dispositioned (DNC/NI/wrong#) → removed
         ├── 4-5 set callback → enter follow-up appointments
         ├── 1-2 interested → enter call queue for cadence
         └── 0-1 sale

Day 2: Pipeline now has 4-5 MORE follow-up appointments
        Work those FIRST → warmer leads → higher close rate
        Then queue dialer → work assigned pipeline
        Then pool → repeat

Week 2+: Pipeline is self-sustaining
          Follow-ups: 5-10/day from accumulated pool contacts
          Queue: 50-100 leads in rotation
          Pool: 70-100 dials/day for new acquisition
```

### Expected Pipeline Ramp (Starting from Zero)

| Week | Pool Self-Assigns/Day | Queue Leads | Daily Follow-Ups | Reg Dials | Pool Dials |
|---|---|---|---|---|---|
| Week 1 | 10-15 | 20-40 | 2-4 | 30-50 | 80-100 |
| Week 2 | 10-15 | 50-80 | 4-8 | 60-90 | 70-100 |
| Week 3 | 10-15 | 70-100 | 5-10 | 80-120 | 70-90 |
| Week 4+ | 10-15 | 80-120 steady | 5-10 | 100-130 | 70-90 |

---

## Revenue Projections

Based on observed data: agents in the 25-39% pool ratio with 4+ long calls average 0.86 sales/day.

### Daily Production

| Close Rate | Sales/Day | Premium/Day (at $350 avg) |
|---|---|---|
| 5% | 0.9 | $315 |
| 8% | 1.4 | $490 |
| 10% | 1.8 | $630 |
| 15% | 2.7 | $945 |

### Monthly Production (22 working days)

| Close Rate | Sales/Month | Premium/Month |
|---|---|---|
| 5% | 19.8 | $6,930 |
| 8% | 30.8 | $10,780 |
| 10% | 39.6 | $13,860 |
| 15% | 59.4 | $20,790 |

---

## Red Flag Detection

| Pattern | Signal | What It Means |
|---|---|---|
| High dials, low talk time | 200+ dials, < 100 min total talk | Speed-dialing without engaging (0.09 sales/day) |
| Past due rising | Past due > 0 and growing d/d | Missing scheduled appointments |
| Queue bloating | Queue > 150 and growing | Not withdrawing after 6 attempts |
| Pool farming | Pool > 40% of dials + queue > 120 | Avoiding pipeline for easy pool work |
| Assignment without engagement | High assign rate but 0 long calls | Gaming compliance without real conversations |

---

## Assumptions

| Parameter | Value | Source |
|---|---|---|
| Contact Rate (Pool) | 50% | Observed pool data, Mar-Apr 2026 |
| Contact Rate (Queue) | 50% | Dialer average |
| Avg Premium (Pool Sale) | $350 | Conservative T3 outbound estimate |
| Working Days/Month | 22 | Standard |
| Long Call Threshold | 15+ minutes | CRM definition |
| Queue Max Attempts | 6 | Business rule |
| Queue Withdrawal | After 6th failed attempt | Business rule |
