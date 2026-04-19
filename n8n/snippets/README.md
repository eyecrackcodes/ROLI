# Hourly action alert — source snippets

- **`hourly-fetch-with-marketing.example.js`** — safe template (committed). Copy to **`hourly-fetch-with-marketing.js`** (gitignored) and paste real keys; that local file is **not** committed.
- **`merge-hourly-fetch.mjs`** — writes the Fetch node into `../hourly-action-alert.json`. Uses the gitignored local file if it exists, else the `.example.js`. Pass **`--example`** to always merge the template (for clean exports / PRs).
- **`hourly-recommender-with-marketing.js`** — source for **Run Recommender + Pace Engine** (merge with script below). Uses live **CPC** as `LEAD_COST` when marketing data exists; compares each agent’s **rolling-hour dial delta** to the **team median** for pace coaching.
- **`merge-hourly-recommender.mjs`** — writes the Recommender node into `../hourly-action-alert.json` from `hourly-recommender-with-marketing.js`.
- **`build-hourly-slack-alert.js`** — Slack Block Kit copy for **Build Unified Slack Alert** (clear, low-emoji; merge with script below).
- **`merge-hourly-slack.mjs`** — writes Slack node into a workflow JSON (default `../hourly-action-alert.json`). Optional path: `node n8n/snippets/merge-hourly-slack.mjs n8n/hourly-action-alert-LIVE.json`
- **`merge-hourly-action-LIVE.mjs`** — one-shot refresh of gitignored **`hourly-action-alert-LIVE.json`**: injects **local** `hourly-fetch-with-marketing.js` (keys), plus recommender + Slack snippets. Run after editing any of those three files.
- **`dsb-build-slack-production-digest.js`** — **DSB daily scrape** Slack body (RMT + AUS digest only; Charlotte not shown). Merge with **`merge-dsb-daily-slack.mjs`** into `../dsb-daily-scrape-v5-pool.json`. Ingestion still sends **all** agents to Supabase; only Slack is filtered.
- **`reconcile-wtd-sales.mjs`** — Diff-only check of CRM Sale Made aggregate vs `daily_scrape_data` for the WTD window. Run on demand when total sales feel off. No writes.
- **`reconcile-wtd-pool.mjs`** — Diff CRM **Leads Pool Report** WTD aggregate vs `leads_pool_daily_data` per agent. Catches sales CRM only attributes into the aggregate view (per-day pulls miss them). Pass `--apply` to PATCH today's row by the positive delta.

```bash
node n8n/snippets/reconcile-wtd-sales.mjs            # diff-only
node n8n/snippets/reconcile-wtd-pool.mjs             # diff-only
node n8n/snippets/reconcile-wtd-pool.mjs --apply     # apply positive deltas onto today's row
```

> The Apify scraper now performs this WTD-aggregate reconciliation automatically every hour (Mon–Fri 8 AM–6 PM CST), bumping today's row in-flight before ingest. The standalone script is for ad-hoc diagnostic use or to apply a correction immediately without waiting for the next scheduled run.

```bash
node n8n/snippets/merge-hourly-fetch.mjs
node n8n/snippets/merge-hourly-fetch.mjs --example
node n8n/snippets/merge-hourly-recommender.mjs
node n8n/snippets/merge-hourly-slack.mjs
node n8n/snippets/merge-hourly-action-LIVE.mjs
node n8n/snippets/merge-dsb-daily-slack.mjs
```

## Placeholders (in `.example.js` or your local copy)

| Variable | Example |
|----------|---------|
| `YOUR_ROLI_ANON_KEY` | ROLI Supabase anon JWT |
| `YOUR_ROLI_SUPABASE_URL` | `https://<roli-ref>.supabase.co` |
| `YOUR_MARKETING_AAR_ANON_KEY` | Marketing AAR anon JWT |
| `YOUR_MARKETING_AAR_REST_URL` | `https://<marketing-ref>.supabase.co` (host only is fine; `/rest/v1` is appended in code) |

If marketing placeholders are left as `YOUR_*`, the workflow skips the marketing fetch and uses **LEAD_COST 60** (fallback).

Or re-copy `jsCode` from the snippet files into the n8n UI.

### Duplicate hourly posts in Slack

The repo workflow posts **ROLI — Hourly coaching** (RMT + AUS only). If you also see a second, different hourly digest in the same channel, another n8n workflow is still active—deactivate it or use a different webhook. See [`docs/N8N-Integration.md`](../docs/N8N-Integration.md).
