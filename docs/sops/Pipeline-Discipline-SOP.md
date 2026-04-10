# Pipeline Discipline — Standard Operating Procedure

**Effective:** April 2026

This document defines pipeline standards for all agents, how audits work, and what happens when pipelines aren't clean. It applies to T1, T2, and T3 equally.

---

## The Problem This Solves

Every past-due follow-up is a lead that was warm enough to set an appointment — and the agent let it go cold. Every overloaded queue is a pile of leads that should have been worked or withdrawn. The cost:


| Tier | Lead Cost     | Past Due × 5 Leads | Estimated Revenue Lost       |
| ---- | ------------- | ------------------ | ---------------------------- |
| T1   | $83/call      | $415 in lead spend | ~$1,438 in potential premium |
| T2   | $83/call (IB) | $415 in lead spend | ~$1,438 in potential premium |
| T3   | $15/lead (OB) | $75 in lead spend  | ~$575 in potential premium   |


Follow-up leads convert at **2-3x the rate of first contacts** because the prospect already expressed interest. Neglecting them is the most expensive mistake on the floor.

---

## What a Clean Pipeline Looks Like


| Metric                     | Clean                    | Needs Attention | Non-Compliant |
| -------------------------- | ------------------------ | --------------- | ------------- |
| Past Due Follow-Ups        | 0                        | 1-3             | 4+            |
| Pipeline Age (oldest lead) | < 7 days                 | 7-14 days       | 14+ days      |
| Queue Size (T3 only)       | 50-120                   | 120-200         | 200+          |
| Disposition Rate           | 100% same-day            | 90%+            | < 90%         |
| Follow-Up Set Rate         | Every interested contact | Most contacts   | Inconsistent  |


**The standard is zero past due.** Not low. Not "mostly caught up." Zero.

---

## Audit Process

### Daily Automated Check

A daily pipeline health alert runs every morning (automated via ROLI + Slack). It flags:

- Any agent with past due > 0
- Any agent with queue > 150 (T3) or pipeline > 25 (T1/T2)
- Any agent flagged as FOLLOWUP_AVOIDER or PIPELINE_HOARDER

This is a visibility tool. It surfaces problems the same day they start.

### Formal Pipeline Audit (Weekly — Every Wednesday)

Management conducts a formal pipeline review every Wednesday. This is the checkpoint where issues become documented and consequences begin.

**What the audit covers:**


| Check                  | Data Source               | Threshold                      |
| ---------------------- | ------------------------- | ------------------------------ |
| Past due follow-ups    | pipeline_compliance_daily | Must be 0                      |
| Past due trend (d/d)   | Daily delta               | Must be flat or declining      |
| Queue size (T3)        | pipeline_compliance_daily | Must be ≤ 120                  |
| Pipeline size (T1/T2)  | Active follow-ups         | Must be ≤ 25 (T1) or ≤ 40 (T2) |
| Close-out discipline   | Leads 14+ days old        | Must be worked or closed out   |
| Disposition compliance | Same-day disposition rate | Must be 100%                   |


**Who conducts it:** Site managers or team leads, using the ROLI Pipeline Intelligence dashboard.

**How long it takes:** 15-20 minutes per site. The data is pre-computed — the audit is a review, not a data-gathering exercise.

---

## Escalation Framework

Problems are addressed progressively. No one gets docked on a first offense. But repeated non-compliance has real consequences.

### Level 1: Coaching Conversation


| Trigger       | Past due > 0 for 2 consecutive business days                                       |
| ------------- | ---------------------------------------------------------------------------------- |
| Action        | 1-on-1 with manager. Review pipeline, identify missed leads, create catch-up plan. |
| Timeline      | Same day the audit flags it.                                                       |
| Documentation | Verbal, noted in manager's log.                                                    |


### Level 2: Written Warning


| Trigger       | Past due > 3 for 3+ consecutive days, OR Level 1 repeated within 2 weeks              |
| ------------- | ------------------------------------------------------------------------------------- |
| Action        | Formal written warning. Agent signs acknowledgment. Specific improvement targets set. |
| Timeline      | Next business day after identification.                                               |
| Documentation | Written, goes in agent's file.                                                        |


### Level 3: Lead Allocation Reduction


| Trigger       | Past due > 5 after written warning, OR chronic non-compliance (3+ warnings in 30 days)                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Action        | Reduce lead allocation until pipeline is clean. T1: drop from 10 to 7 IB/day. T2: drop from 7 to 5 IB/day. T3: suspend pool access. |
| Timeline      | Effective immediately. Restored when pipeline hits zero past due for 3 consecutive days.                                            |
| Documentation | Written notification. HR informed.                                                                                                  |
| Rationale     | If you can't work what you have, you shouldn't receive more.                                                                        |


### Level 4: Queue Sweep


| Trigger       | Queue > 200 (T3) or pipeline > 40 (T1/T2) after written warning                                        |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Action        | Management forcibly reviews the pipeline and withdraws/closes out leads the agent should have handled. |
| Timeline      | During the weekly audit.                                                                               |
| Documentation | Full list of swept leads recorded. Agent notified.                                                     |
| Impact        | Swept leads are redistributed or returned to pool. Agent's pipeline is reset to a manageable size.     |


### Level 5: Performance Review


| Trigger       | Sustained non-compliance after Level 3+4, OR 4+ warnings in 60 days                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Action        | Formal performance improvement plan (PIP). May include pay impact, tier demotion consideration, or termination discussion. |
| Timeline      | Within 5 business days of identification.                                                                                  |
| Documentation | HR-involved. PIP with measurable targets and timeline.                                                                     |


---

## Tier-Specific Pipeline Standards

### T1 — Inbound


| Metric               | Standard                                     | Audit Check                |
| -------------------- | -------------------------------------------- | -------------------------- |
| Past due             | 0                                            | Daily alert + weekly audit |
| Pipeline size        | ≤ 25 active follow-ups                       | Weekly audit               |
| Close-out discipline | No leads older than 14 days without activity | Weekly audit               |
| Disposition          | 100% same-day                                | Daily alert                |


T1 agents handle the most expensive leads. Their pipeline should be small, fast-moving, and fully worked. A T1 agent with 10 past-due follow-ups has ~$2,875 in revenue sitting idle.

### T2 — Hybrid


| Metric               | Standard                                     | Audit Check                |
| -------------------- | -------------------------------------------- | -------------------------- |
| Past due             | 0                                            | Daily alert + weekly audit |
| Pipeline size        | ≤ 40 active follow-ups                       | Weekly audit               |
| Close-out discipline | No leads older than 14 days without activity | Weekly audit               |
| Pool follow-through  | Pool self-assigns generating follow-ups      | Weekly audit               |
| Disposition          | 100% same-day                                | Daily alert                |


T2 agents have the most complex pipeline — fed by both inbound and pool. The risk is that pool self-assigns pile up without being worked. Agents must treat pool follow-ups with the same urgency as inbound follow-ups.

### T3 — Outbound


| Metric                | Standard          | Audit Check                |
| --------------------- | ----------------- | -------------------------- |
| Past due              | 0                 | Daily alert + weekly audit |
| Queue size            | ≤ 120 leads       | Daily alert + weekly audit |
| Queue delta (d/d)     | Flat or declining | Weekly audit               |
| 6-attempt withdrawal  | Enforced          | Weekly audit               |
| Pool self-assign rate | ≥ 30%             | Daily scorecard            |
| Disposition           | 100% same-day     | Daily alert                |


T3 agents manage the largest pipelines. Queue bloat is the primary risk — leads accumulating without being withdrawn after 6 attempts. The queue should be a flowing river, not a stagnant pond.

---

## The Weekly Audit Checklist

Every Wednesday, the auditor runs through this checklist per agent.


| #   | Check                        | Source                                | Pass           | Fail           |
| --- | ---------------------------- | ------------------------------------- | -------------- | -------------- |
| 1   | Past due = 0                 | ROLI Pipeline Dashboard               | Zero           | Any > 0        |
| 2   | Past due trend               | d/d delta from prior week             | Flat or down   | Rising         |
| 3   | Pipeline/queue within limits | Tier-specific max                     | Within range   | Over limit     |
| 4   | No leads older than 14 days  | Pipeline age distribution             | All < 14 days  | Any ≥ 14 days  |
| 5   | Disposition rate = 100%      | Same-day disposition                  | 100%           | < 100%         |
| 6   | Close-out discipline         | Leads with 3+ missed appts still open | All closed out | Any still open |


**Scoring:**

- 6/6: Clean pipeline — no action needed
- 4-5/6: Minor issues — coaching conversation, must fix by next audit
- 2-3/6: Significant issues — written warning
- 0-1/6: Critical — escalate to Level 3+ immediately

---

## Revenue Impact Model

This is why pipeline discipline is a financial priority, not just an operational one.

### Monthly Revenue at Risk (per agent, by tier)

Assumes 5 past-due follow-ups sustained over a month, at tier-specific close rates and $1,150 avg premium.


| Tier | Follow-Up Close Rate            | Revenue Lost/Month (5 past due) |
| ---- | ------------------------------- | ------------------------------- |
| T1   | 35% (follow-ups convert higher) | $4,025                          |
| T2   | 30%                             | $3,450                          |
| T3   | 20%                             | $2,300                          |


### Floor-Wide Impact


| Agents with 5+ Past Due | Monthly Revenue Leak |
| ----------------------- | -------------------- |
| 5 agents                | $15,000 - $20,000    |
| 10 agents               | $30,000 - $40,000    |
| 20 agents               | $60,000 - $80,000    |


This is recoverable revenue. These leads already exist. They already showed interest. The only thing standing between the company and this money is an agent making a phone call.

---

## Automated Enforcement (ROLI Integration)

The following automated checks run daily and feed into the weekly audit:


| Alert                | Trigger                                       | Channel                |
| -------------------- | --------------------------------------------- | ---------------------- |
| Past Due Alert       | Any agent past due > 0                        | Slack #pipeline-health |
| Queue Bloat Alert    | T3 agent queue > 150                          | Slack #pipeline-health |
| Pipeline Overload    | T1/T2 agent pipeline > 25/40                  | Slack #pipeline-health |
| Behavioral Flag      | FOLLOWUP_AVOIDER or PIPELINE_HOARDER detected | Slack #pipeline-health |
| Weekly Audit Summary | Wednesday rollup of all agents                | Slack #management      |


---

## Assumptions


| Parameter                 | Value                                       | Source                                                   |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| Avg Premium Per Sale      | $1,150                                      | Floor average                                            |
| IB Lead Cost              | ~$83/call                                   | Business rule                                            |
| Follow-Up Close Rate (T1) | 35%                                         | Estimated — follow-ups convert higher than first contact |
| Follow-Up Close Rate (T2) | 30%                                         | Estimated                                                |
| Follow-Up Close Rate (T3) | 20%                                         | Estimated                                                |
| Audit Cadence             | Weekly (Wednesday) + daily automated alerts | Business rule                                            |
| Working Days/Month        | 22                                          | Standard                                                 |


