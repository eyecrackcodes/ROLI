# N8N Integration — DSB Tier Calculator Ingestion Pipeline

## Hourly Action Alert + Marketing AAR

Workflow: [`n8n/hourly-action-alert.json`](../n8n/hourly-action-alert.json).

Each run (weekdays 9:00–17:00 CST) fetches **Marketing AAR** `company_daily_metrics` for the current Central date (or latest row), **upserts** into ROLI **`daily_marketing_summary`**, and uses live **CPC** as lead cost in Slack copy and the recommender. Configure ROLI + Marketing URLs and anon keys in the **Fetch All Data Sources** code node (see [`n8n/snippets/README.md`](../n8n/snippets/README.md)).

### Hourly digest scope vs other Slack automations

- **This hourly workflow** includes agents on sites **RMT** and **AUS** only (`selling` / `training`; `operations` excluded). Slack copy stays focused on that group.
- **DSB daily scrape** ([`n8n/dsb-daily-scrape-v5-pool.json`](../n8n/dsb-daily-scrape-v5-pool.json) or your LIVE copy) **ingests all agents** into Supabase; the **Slack “production digest”** in repo is scoped to **RMT + AUS** only (see `n8n/snippets/dsb-build-slack-production-digest.js` and `merge-dsb-daily-slack.mjs`). Point Charlotte-only summaries at a different webhook if you still need them.
- **If you see two hourly-style posts** in one channel (e.g. a legacy digest **and** “ROLI — Hourly coaching”), a **second n8n workflow** or duplicate schedule is still posting—deactivate it or use a **different Slack webhook** for one of them.

## Overview

The CRM scraper (Apify actor) runs daily and sends data to the DSB Tier Calculator via an N8N webhook. The data flows through:

```
Apify Actor → N8N Webhook → Supabase (daily_scrape_data table)
```

## Two Ingestion Methods

### Method A: Supabase Edge Function (Recommended)

Deploy the Edge Function at `supabase/functions/ingest-daily-scrape/`.

**Endpoint:**
```
POST https://<your-project>.supabase.co/functions/v1/ingest-daily-scrape
```

**Headers:**
```
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
```

### Method B: Direct Supabase RPC

Call the `ingest_daily_scrape` database function directly via Supabase REST API.

**Endpoint:**
```
POST https://<your-project>.supabase.co/rest/v1/rpc/ingest_daily_scrape
```

**Headers:**
```
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
```

**Body:**
```json
{
  "payload": {
    "scrape_date": "2026-04-15",
    "agents": [...]
  }
}
```

## Payload Schema

```json
{
  "scrape_date": "2026-04-15",
  "agents": [
    {
      "agent_name": "Alvin Fulmore",
      "tier": "T3",
      "ib_leads_delivered": 0,
      "ob_leads_delivered": 25,
      "custom_leads": 0,
      "ib_sales": 0,
      "ob_sales": 2,
      "custom_sales": 1,
      "ib_premium": 0,
      "ob_premium": 1850,
      "custom_premium": 750,
      "total_dials": 185,
      "talk_time_minutes": 214
    }
  ]
}
```

## Field Mapping from CRM Reports

| Payload Field        | CRM Report         | CRM Field                |
|---------------------|--------------------|--------------------------|
| `ib_leads_delivered`| Lead Tracker       | Leads Delivered (Type=9) |
| `ob_leads_delivered`| Lead Tracker       | Leads Delivered (Type=25)|
| `custom_leads`      | Lead Tracker       | Leads Delivered (Custom) |
| `ib_sales`          | Sale Made Report   | Sales (Type=9)           |
| `ob_sales`          | Sale Made Report   | Sales (Type=25)          |
| `custom_sales`      | Sale Made Report   | Sales (Custom)           |
| `ib_premium`        | Sale Made Report   | Premium (Type=9)         |
| `ob_premium`        | Sale Made Report   | Premium (Type=25)        |
| `custom_premium`    | Sale Made Report   | Premium (Custom)         |
| `total_dials`       | Calls Report       | Total Calls              |
| `talk_time_minutes` | Calls Report       | Talk Time (minutes)      |

## CRM Filter Values

| Filter        | Value  | Meaning                          |
|--------------|--------|----------------------------------|
| Agency 12055 | T1     | Luminary Life ALL Tier 1         |
| Agency 12056 | T2     | Luminary Life ALL Tier 2         |
| Agency 10581 | T3     | Luminary Life ALL Tier 3         |
| Lead Type 9  | IB     | Call In (Inbound)                |
| Lead Type 25 | OB     | FEX - Outbound (recycled leads)  |
| Lead Type Custom | Custom | Spouse/Referral sales         |

## N8N Workflow Setup

### Step 1: Apify Trigger
- Use the **Apify** node or a **Webhook** trigger that fires when the scraper finishes

### Step 2: Transform Data
- Use a **Code** node to transform Apify output into the payload schema above
- Map each CRM report's data to the correct fields
- Set the `scrape_date` to the report date
- Assign `tier` based on the Agency filter used

### Step 3: HTTP Request to Supabase
- **Method:** POST
- **URL:** `https://<project>.supabase.co/functions/v1/ingest-daily-scrape`
- **Authentication:** Bearer Token = Service Role Key
- **Body:** The transformed payload

### Step 4: Handle Response
- Check for errors in the response
- Alert if any agent records failed to ingest

## Response Format

```json
{
  "success": true,
  "scrape_date": "2026-04-15",
  "total_agents": 88,
  "inserted": 85,
  "updated": 3,
  "errors": []
}
```

## Upsert Behavior

The endpoint uses `ON CONFLICT (scrape_date, agent_name)` — if you re-run the scraper for the same date, it will **update** existing records rather than creating duplicates.

---

## Intraday Snapshots Pipeline

The intraday pipeline captures hourly snapshots of agent performance throughout the day, enabling the Intraday tab in Agent Trends.

### Ingestion Methods

#### Method A: Edge Function (Recommended)

**Endpoint:**
```
POST https://bcibmmbxrjfiulofserv.supabase.co/functions/v1/ingest-intraday-scrape
```

**Headers:**
```
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
```

#### Method B: Direct Supabase RPC

**Endpoint:**
```
POST https://bcibmmbxrjfiulofserv.supabase.co/rest/v1/rpc/ingest_intraday_scrape
```

**Headers:**
```
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
```

**Body (RPC wrapper):**
```json
{
  "payload": {
    "scrape_date": "2026-04-15",
    "scrape_hour": 14,
    "agents": [...]
  }
}
```

### Intraday Payload Schema

```json
{
  "scrape_date": "2026-04-15",
  "scrape_hour": 14,
  "agents": [
    {
      "agent_name": "Alvin Fulmore",
      "tier": "T3",
      "ib_leads_delivered": 0,
      "ob_leads_delivered": 18,
      "ib_sales": 0,
      "ob_sales": 1,
      "custom_sales": 0,
      "ib_premium": 0,
      "ob_premium": 925,
      "custom_premium": 0,
      "total_dials": 120,
      "talk_time_minutes": 145
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scrape_date` | string | Yes | Date in YYYY-MM-DD format |
| `scrape_hour` | integer | Yes | Hour of snapshot (0-23, Pacific Time) |
| `agents` | array | Yes | Array of agent data objects |

### Upsert Behavior

Uses `ON CONFLICT (scrape_date, scrape_hour, agent_name)` — re-running the same hour updates existing records.

### Recommended Scrape Schedule

Run the intraday scraper every 2 hours during business hours (Pacific Time):

| Hour | Label | Cron |
|------|-------|------|
| 10 | 10AM | `0 10 * * 1-5` |
| 12 | 12PM | `0 12 * * 1-5` |
| 14 | 2PM | `0 14 * * 1-5` |
| 16 | 4PM | `0 16 * * 1-5` |
| 18 | 6PM | `0 18 * * 1-5` |
| 20 | 8PM | `0 20 * * 1-5` |

### N8N Intraday Workflow Setup

1. **Schedule Trigger** — Cron node firing at the hours above (Mon-Fri only)
2. **Get Current Hour** — Code node: `const now = new Date(); return [{ json: { scrape_hour: now.getHours(), scrape_date: now.toISOString().slice(0, 10) } }];`
3. **Run CRM Scraper** — Same Apify actor as daily, but capturing cumulative totals at that hour
4. **Transform Data** — Map CRM output to the intraday payload schema (same fields as daily)
5. **POST to Edge Function** — HTTP Request to `ingest-intraday-scrape`
6. **Handle Response** — Check for errors, alert if agents failed

### Response Format

```json
{
  "success": true,
  "scrape_date": "2026-04-15",
  "scrape_hour": 14,
  "total_agents": 88,
  "inserted": 85,
  "updated": 3,
  "errors": []
}
```
