# ADP Workforce Now Integration (Luminary Life)

ADP is the **source of truth for employment status** in ROLI. Use it to:

1. Auto-deactivate terminated agents (no more manual `is_active=false` UPDATE)
2. Surface new sales hires for onboarding
3. Eventually (Phase 2 — Time & Labor must be provisioned first) replace the
   Lead Pacer's "no activity by 10 AM" absence heuristic with hard punch data

## Quick reference

| Thing | Where |
|---|---|
| Client ID | `ef0c52c2-11e3-44f7-8f1b-2533ae2c5774` (also stored in n8n LIVE workflow) |
| Client Secret | `f174886e-d268-4ea2-8fe6-bf27469219e4` (also stored in n8n LIVE workflow) |
| Cert PEM | `e:/patton-2/stack-rank/adp.cert.pem` (1928 chars, gitignored — outside repo) |
| Key PEM | `e:/patton-2/stack-rank/adp.key.pem` (1704 chars, gitignored — outside repo) |
| Token URL | `https://accounts.adp.com/auth/oauth/v2/token` |
| API base | `https://api.adp.com` |
| Token TTL | 3600s (1 hour) |
| Apify roster actor | `fERgob5mTvDNXVIb1` (`dsb-adp-roster-sync`) |
| Apify punches actor | `3kk84UMdsCPZsL6kq` (`dsb-adp-punches-sync`, dormant until provisioned) |
| n8n workflow | `n8n/dsb-adp-roster-sync.json` (template) + `n8n/dsb-adp-roster-sync-LIVE.json` (drop-in, gitignored) |

## How auth works

ADP requires **OAuth 2.0 client_credentials + mTLS** (mutual TLS). You present the
client cert during the TLS handshake AND send `client_id` + `client_secret` in the
form body. Both checks must pass.

```
Your app                         ADP
  |── TLS handshake (cert+key) ─→|
  |←── TLS established ───────────|
  |── POST /oauth/v2/token ──────→|  body: client_id, client_secret, grant_type
  |←── { access_token, ... } ─────|
  |── GET /hr/v2/workers ────────→|  Authorization: Bearer ...
```

**Why we don't run this from Supabase Edge Functions:** Deno's `fetch` doesn't
expose client-cert config. Node's `undici.Agent({ connect: { cert, key } })` does
it in two lines. So all ADP work happens in Apify actors (Node 20) and n8n hands
the data to Supabase via PostgREST.

## Confirmed-working endpoints

| Path | Purpose | Status |
|---|---|---|
| `POST /auth/oauth/v2/token` | Get bearer token | ✓ Working |
| `GET /hr/v2/workers?$top=N&$skip=N` | Paged worker list (abbreviated payload — **jobTitle is missing**) | ✓ Working |
| `GET /hr/v2/workers/{associateOID}` | Full worker detail (jobTitle, jobCode, work email, dept, status) | ✓ Working |

**The list endpoint omits jobTitle.** Always hit the per-worker detail endpoint
when you need title / job code / work email / department.

## NOT yet provisioned (404 today)

| Path | Purpose |
|---|---|
| `GET /time/v1/time-cards` | Worker timecards |
| `GET /time/v2/time-cards` | Worker timecards |
| `GET /time/v1/punches` | Punch-level detail |
| `GET /time/v2/punches` | Punch-level detail |
| `GET /payroll/v1/time-and-labor` | Payroll-attached time data |

To enable: log into [ADP Marketplace](https://apps.adp.com) as admin → My Apps →
API Gateway → find client app `ef0c52c2-...` → add **Time & Labor** product →
wait 15-30 min for provisioning.

The `dsb-adp-punches-sync` actor is already built and will start emitting real
data the instant `/time/v2/punches` returns 200. Until then it emits a single
`adp_punches_not_provisioned` marker and exits SUCCESS (so n8n's nightly schedule
doesn't spam Slack).

## Database link (`agents.adp_*`)

| Column | What | Updated by |
|---|---|---|
| `adp_associate_oid` | ADP's stable internal ID — survives legal-name changes | One-time seed (migration 016) + manual when adding new agents |
| `adp_status` | `A` (Active), `T` (Terminated), `L` (Leave), etc | n8n nightly |
| `adp_status_effective_date` | When the assignment status was last set in ADP | n8n nightly |
| `adp_job_title` | `workAssignments[primary].jobTitle` (e.g. "Agent", "Term Agent") | n8n nightly |
| `adp_work_email` | `businessCommunication.emails[Work E-mail]` | n8n nightly |
| `adp_synced_at` | Last successful sync timestamp | n8n nightly |

`adp_associate_oid` has a partial unique index (`WHERE adp_associate_oid IS NOT NULL`)
so 1099 contractors and pre-paperwork hires can still live in the agents table
without a link.

## Reconciling a name mismatch (when ADP and ROLI disagree)

ROLI's `agents.name` stays the canonical join key for historical scrape data
(daily_scrape_data, leads_pool_daily_data, etc.). When ADP's legal name differs:

1. **Don't rename** the ROLI agent row. Existing data joined on the old name will
   stop matching.
2. **Set `adp_associate_oid`** on the existing row so ADP can update status/title/email.
3. **Add an alias** in `agent_name_aliases` so any future ADP-driven workflow that
   uses the legal name (e.g. an HR-driven payroll integration) resolves to the
   canonical row.

Example — `Magifira Jemal` (ROLI) ↔ `Magfira Jemal` (ADP):

```sql
UPDATE agents SET adp_associate_oid = 'G3T32RWRP7P8ZR4T' WHERE name = 'Magifira Jemal';
INSERT INTO agent_name_aliases (canonical_name, crm_name, ams_name)
VALUES ('Magifira Jemal', 'Magfira Jemal', 'Magfira Jemal');
```

## Deploy / re-deploy procedure

```powershell
# Roster sync
cd e:\cursor\ROLI\apify\dsb-adp-roster-sync
apify push --force

# Punches (dormant, but rebuild after any code change)
cd e:\cursor\ROLI\apify\dsb-adp-punches-sync
apify push --force

# Refresh the LIVE n8n workflow (re-embeds the cert+key from disk)
python e:\cursor\ROLI\.tmp-build-live.py   # if you keep this script around
# OR manually: open dsb-adp-roster-sync-LIVE.json and update YOUR_* placeholders
```

## Manual smoke test (mimics n8n end-to-end)

The script `.tmp-smoke-roster.py` (kept around between sessions) runs the full
roster sync against live ADP, prints a per-agent status check, and lists
unlinked sales workers. Use after any code change to verify nothing broke.

```powershell
python e:\cursor\ROLI\.tmp-smoke-roster.py
```

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `HTTP 401 invalid_client` from token endpoint | Cert+key don't match the registered client app | Re-download cert from ADP Marketplace |
| `HTTP 404 on /time/*` | Time & Labor product not provisioned | Add Time & Labor in ADP Marketplace |
| Apify build error: `Field schema.properties.X.description is required` | INPUT_SCHEMA.json property is missing `description` | Add a description to every property |
| n8n PATCH fails with `permission denied` on agents | RLS policy was tightened | Use service_role key OR add anon UPDATE policy |
| Worker missing `jobTitle` in dataset | Used the list endpoint payload not detail | Hydrate via `GET /hr/v2/workers/{oid}` |

## Rate limits (observed)

- ~100 RPM, ~10,000 RPD per client app
- Concurrency: ≤ 5-10 simultaneous connections
- Token: cache and reuse for ~55 min (don't request per call)
- Pagination: max `$top=1000` on the workers endpoint

For 316 workers + 81 active hydration = ~82 detail calls per sync, so we burn
~83 calls in ~30 sec. Well under the limit.

## Hard rules

- **Never commit** `*.cert.pem` or `*.key.pem` to git. They live at
  `e:/patton-2/stack-rank/` outside the repo.
- **Never paste cert contents into a regular `.json` template file** — only into
  the gitignored `*-LIVE.json`.
- **Never log the bearer token or PEM contents.** The actor's `log.info` calls
  intentionally log only token length / cert length.
- The `agents.adp_*` columns are write-only-by-sync. Don't hand-edit them; if
  you need a fix, fix it in ADP and let the next sync propagate, or update
  `adp_associate_oid` only (the next sync will refresh the rest).
