# N8N Integration — DSB Tier Calculator Ingestion Pipeline

## Architecture

```
CRM (3 reports) → Apify Actor (Playwright) → N8N Workflow → Supabase Edge Function → daily_scrape_data → Dashboard
```

The pipeline runs daily at 7PM Pacific, after the business day ends.

## Component 1: Apify Actor (`dsb-crm-scraper`)

### What It Does

The Playwright-based actor logs into `crm.digitalseniorbenefits.com`, scrapes 3 CRM reports across all 3 tiers using the CSV Export button, merges the data by agent name, and pushes a flat dataset.

**11 scrape passes per run:**

| # | Report | Agency | Lead Type | Extracts |
|---|--------|--------|-----------|----------|
| 1 | Lead Tracker | Tier 1 | (all) | IB leads delivered |
| 2 | Sale Made | Tier 1 | (all) | IB sales + premium |
| 3 | Calls Report | Tier 1 | n/a | Dials + talk time |
| 4 | Lead Tracker | Tier 2 | Callin | IB leads delivered |
| 5 | Lead Tracker | Tier 2 | Exclusive | OB leads delivered |
| 6 | Sale Made | Tier 2 | Callin | IB sales + premium |
| 7 | Sale Made | Tier 2 | Exclusive | OB sales + premium |
| 8 | Calls Report | Tier 2 | n/a | Dials + talk time |
| 9 | Lead Tracker | Tier 3 | (all) | OB leads delivered |
| 10 | Sale Made | Tier 3 | (all) | OB sales + premium |
| 11 | Calls Report | Tier 3 | n/a | Dials + talk time |

### Deploying the Actor

```bash
cd apify/dsb-crm-scraper
npm install
apify login
apify push
```

### Configuring Actor Secrets

In the Apify console, go to your actor and set the Input:

| Field | Value | Secret? |
|-------|-------|---------|
| `crmUsername` | `anthonypattonll` | No |
| `crmPassword` | (your CRM password) | Yes (encrypted) |
| `scrapeDate` | Leave empty for today, or `YYYY-MM-DD` | No |
| `loginUrl` | `https://crm.digitalseniorbenefits.com/login` | No |

### Actor Output

Each dataset item is one agent:

```json
{
  "agent_name": "Russell Tvedt",
  "tier": "T1",
  "ib_leads_delivered": 10,
  "ob_leads_delivered": 0,
  "ib_sales": 3,
  "ob_sales": 0,
  "custom_sales": 0,
  "ib_premium": 2800.00,
  "ob_premium": 0,
  "custom_premium": 0,
  "total_dials": 0,
  "talk_time_minutes": 0
}
```

### After First Run

Check the downloaded CSVs to verify column name mapping. The parser uses flexible matching (`findColumn`) but you may need to adjust if the CRM uses unusual column headers. The column matching looks for keywords like "agent", "name", "leads", "sales", "premium", "dials", "talk time".

---

## Component 2: N8N Workflow

### Workflow: "DSB Daily Scrape Pipeline"

**N8N Instance:** `https://jkdbga.app.n8n.cloud`
**Workflow ID:** `Fo7RucAVWIFRFWCM`

The workflow is already deployed. Open it at:
`https://jkdbga.app.n8n.cloud/workflow/Fo7RucAVWIFRFWCM`

### Workflow Nodes

```
Schedule (7PM PT) ──┐
                    ├→ Start Apify Run → Wait 3min → Check Status ─┐
Manual Trigger ─────┘                                               │
                                                    ┌── Yes ← Run Succeeded? ← ─┘
                                                    │              │
                                                    │         No → Wait & Retry → (back to Check Status)
                                                    ▼
                                              Fetch Dataset → Build Payload → POST to Supabase → Ingestion OK?
                                                                                                    │      │
                                                                                              Yes → Log   No → Error
```

### Configuration Required

Before activating the workflow, update these placeholder values in the N8N editor:

1. **Apify Actor ID** — In the "Start Apify Run" node, replace `YOUR_ACTOR_ID` in the URL with your actual Apify actor ID (found in the Apify console after deploying)

2. **Apify API Token** — In these 3 nodes, replace `YOUR_APIFY_TOKEN` with your Apify API token:
   - "Start Apify Run" (Authorization header)
   - "Check Run Status" (Authorization header)
   - "Fetch Dataset Items" (Authorization header)

3. **Activate** — Once configured, toggle the workflow to Active in the N8N editor

### Manual Test Run

1. Open the workflow in N8N
2. Click "Test Workflow" (uses the Manual Trigger)
3. Watch each node execute in sequence
4. Check the "POST to Supabase" node output for `{ success: true, inserted: N }`
5. Verify data in Supabase: `SELECT COUNT(*) FROM daily_scrape_data WHERE scrape_date = CURRENT_DATE;`

### Backup Import

A backup of the workflow JSON is saved at `n8n/dsb-daily-scrape.json`. To import:

1. In N8N, go to Workflows → Import from File
2. Select `n8n/dsb-daily-scrape.json`
3. Update the placeholder values as described above

---

## Component 3: Supabase Edge Function

### Endpoint

```
POST https://bcibmmbxrjfiulofserv.supabase.co/functions/v1/ingest-daily-scrape
```

No authentication required (JWT verification is disabled for webhook access).

### Payload Schema

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

### Response

```json
{
  "success": true,
  "scrape_date": "2026-04-15",
  "total_agents": 88,
  "inserted": 88,
  "updated": 0,
  "errors": []
}
```

### Upsert Behavior

Uses `ON CONFLICT (scrape_date, agent_name)` — re-running the scraper for the same date updates existing records.

---

## CRM Filter Reference

| Filter | Dropdown Value | Meaning |
|--------|---------------|---------|
| Agency | Luminary Life ALL Tier 1 | T1 agents (Agency 12055) |
| Agency | Luminary Life ALL Tier 2 | T2 agents (Agency 12056) |
| Agency | Luminary Life ALL Tier 3 | T3 agents (Agency 10581) |
| Lead Type | Callin | Inbound calls |
| Lead Type | Exclusive | Outbound leads (recycled missed TV calls) |
| Time Period | Custom | From/To date range |

### Cost Mapping

| Tier | Channel | Lead Type Filter | Cost per Lead |
|------|---------|-----------------|---------------|
| T1 | Inbound | (all — T1 is pure IB) | $83.00 |
| T2 | Inbound | Callin | $73.00 |
| T2 | Outbound | Exclusive | $15.00 |
| T3 | Outbound | (all — T3 is pure OB) | $15.00 |

---

## Troubleshooting

### Login Failures
- Verify CRM credentials in Apify actor input
- Check if the CRM login page URL has changed
- Look for CAPTCHA or 2FA that may have been added

### Empty Datasets
- Check if the date filter was set correctly (date format: YYYY-MM-DD)
- Verify the Agency dropdown value matches exactly (e.g., "Luminary Life ALL Tier 1")
- Check if the CRM session expired mid-scrape

### CSV Download Timeout
- Increase the download timeout in `downloadCSVExport()` (default: 30s)
- The CRM may be slow for large date ranges — try narrowing the range

### N8N Workflow Failures
- Check the "Check Run Status" node — if the Apify run is still RUNNING, increase the Wait time
- Check the "POST to Supabase" node response for error details
- Verify the edge function is still deployed: `https://bcibmmbxrjfiulofserv.supabase.co/functions/v1/ingest-daily-scrape`

### Data Validation
After ingestion, verify in Supabase:
```sql
-- Check today's data
SELECT agent_name, tier, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales
FROM daily_scrape_data
WHERE scrape_date = CURRENT_DATE
ORDER BY tier, agent_name;

-- Check agent counts by tier
SELECT tier, COUNT(*) FROM daily_scrape_data
WHERE scrape_date = CURRENT_DATE
GROUP BY tier;
```
