# N8N Integration — DSB Tier Calculator Ingestion Pipeline

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
