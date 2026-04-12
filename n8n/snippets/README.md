# Hourly action alert — source snippets

- **`hourly-fetch-with-marketing.example.js`** — safe template (committed). Copy to **`hourly-fetch-with-marketing.js`** (gitignored) and paste real keys; that local file is **not** committed.
- **`merge-hourly-fetch.mjs`** — writes the Fetch node into `../hourly-action-alert.json`. Uses the gitignored local file if it exists, else the `.example.js`. Pass **`--example`** to always merge the template (for clean exports / PRs).
- **`hourly-recommender-with-marketing.js`** — merged into **Run Recommender + Pace Engine**. Uses live **CPC** as `LEAD_COST` when marketing data exists.

```bash
node n8n/snippets/merge-hourly-fetch.mjs
node n8n/snippets/merge-hourly-fetch.mjs --example
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
