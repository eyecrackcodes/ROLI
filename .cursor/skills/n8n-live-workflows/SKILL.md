---
name: n8n-live-workflows
description: Maintain n8n workflow JSON files in this repo using the placeholder + LIVE pair convention. Use when creating, editing, deploying, or asking about n8n workflows under `/n8n`, when the user mentions a `*-LIVE.json` file, when generating a copy-pasteable n8n workflow, or when adding a new automation that hits Apify, Supabase, or Slack.
---

# n8n LIVE Workflow Convention

Every automated workflow in `/n8n` ships as a **pair** of files. Maintain both whenever a workflow changes.

| File | Purpose | Secrets? | Tracked? |
|---|---|---|---|
| `<workflow>.json` | Reference template — `YOUR_*` placeholders for every secret | No | Yes (committed) |
| `<workflow>-LIVE.json` | Drop-in import for n8n with real values inline | Yes | Yes (committed — this repo is private) |

Reference example: `n8n/dsb-pipeline-compliance-LIVE.json` ↔ (canonical placeholder version exists in git history before LIVE was promoted).

## When to use which

- **User says "give me the n8n workflow", "import into n8n", "copy paste"** → produce/update the `-LIVE.json` file.
- **User asks for a clean template, or you're committing a brand-new workflow** → produce the placeholder version first, then derive the LIVE file.
- **Editing an existing workflow** → edit BOTH files in the same commit. Drift between them is the #1 source of "n8n started failing" tickets.

## Required substitutions (placeholder → LIVE)

These are the canonical values for this project. Pull the live values from any existing `*-LIVE.json` in `/n8n` if a token has rotated — never guess.

| Placeholder | Live value source |
|---|---|
| `YOUR_SUPABASE_PROJECT` | `bcibmmbxrjfiulofserv` |
| `YOUR_SUPABASE_ANON_KEY` | The `eyJ...` JWT in `dsb-pipeline-compliance-LIVE.json` (search `apikey =`) |
| `YOUR_APIFY_TOKEN` | The `apify_api_...` token in any `-LIVE.json` URL |
| `YOUR_SLACK_WEBHOOK` | `T1KA0KDNJ/B0AH01XP6AV/PGcSdbAQ3QhDkqrPxS7RcMnq` (path after `/services/`) |
| `YOUR_*_ACTOR_ID` | The 17-char Apify actor ID — get from `apify push` output or the Apify console URL |
| `YOUR_DSB_USERNAME` / `YOUR_ICD_USERNAME` | `anthonypattonll` |
| `YOUR_DSB_PASSWORD` / `YOUR_ICD_PASSWORD` | `password` (yes literally — single SSO across DSB CRM and ICD) |
| `REPLACE_WITH_GMAIL_CRED_ID` | Leave as-is — n8n binds Gmail OAuth via its own credential picker on import |

## Workflow when changing an n8n workflow

1. Edit the placeholder file (`<workflow>.json`).
2. Mirror every change into `<workflow>-LIVE.json` with the substitution table above.
3. Run `npm run build` from the repo root to make sure no TypeScript edge-function changes broke the frontend.
4. `git add` both files (+ any related Apify actor / edge function changes).
5. Commit with a `feat(n8n):` or `fix(n8n):` prefix. Mention which workflow + what behavior changed.
6. Push to `origin/main`.
7. Tell the user to re-import the LIVE file into n8n (n8n does not auto-pick up file changes).

## Deploying a brand-new workflow end-to-end

When introducing a new n8n workflow that depends on a fresh Apify actor or Supabase function, do these in order before producing the LIVE file:

1. `apify push --force` from the actor folder — capture the new actor ID from the output (`Actor detail https://console.apify.com/actors/<ID>`).
2. Deploy the edge function via the Supabase MCP `deploy_edge_function` tool (preferred) or `supabase functions deploy <name>`.
3. Use the actor ID from step 1 to fill in `YOUR_*_ACTOR_ID` in the LIVE file.
4. If a one-time backfill is needed, drive it from the CLI directly (see "Backfilling without n8n" below) rather than waiting on the user to import the workflow.

## Backfilling without n8n

When you need to seed historical data and the n8n workflow isn't wired yet, the equivalent CLI dance is:

1. Build an actor input JSON in a `.tmp-*.json` file inside the actor's folder (gitignored implicitly via `.tmp-` prefix — but always delete after).
2. `apify call <actorId> -f .tmp-input.json --json --silent --timeout 1200`
3. Read `defaultDatasetId` from the run JSON.
4. Fetch the dataset: `Invoke-RestMethod "https://api.apify.com/v2/datasets/<id>/items?token=<APIFY_TOKEN>&clean=true"`
5. POST each dataset item to the Supabase edge function endpoint with the appropriate `Authorization: Bearer <ANON_KEY>` header and the right `mode` (e.g. `ib_leads_only`, `sales_only`, `full`).
6. **Delete every `.tmp-*` file before committing** — they contain credentials and dataset payloads.

## Hard rules

- **Never commit a temp file containing credentials.** The `.tmp-*` prefix is your reminder, not your guarantee — verify with `git status` before staging.
- **Never split-edit.** If you change `<workflow>.json` and not `<workflow>-LIVE.json` (or vice-versa) in the same commit, the next deployment will silently use stale logic.
- **Never substitute the placeholder anon key for the service role key.** The edge functions use the service role internally via env vars; n8n only ever needs the anon key.
- **`verify_jwt` should match what was deployed previously.** The current ROLI edge functions all use `verify_jwt: false` because n8n authenticates by passing the anon key in `Authorization: Bearer ...` and the function trusts that. Don't toggle this unless the user explicitly asks.

## Quick verification after deploying

```sql
-- After ingesting backfill data, eyeball totals against the source report:
SELECT agent_name, SUM(ib_leads_delivered) AS leads
FROM daily_scrape_data
WHERE scrape_date BETWEEN '<start>' AND '<end>'
GROUP BY agent_name
ORDER BY agent_name;
```

If a number is off by an order of magnitude, suspect alias drift first (run the `agent_name_aliases` query and look for `crm_name` collisions) before suspecting the actor.
