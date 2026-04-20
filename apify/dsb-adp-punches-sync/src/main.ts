/**
 * dsb-adp-punches-sync
 *
 * Pulls clock-in/clock-out punches from ADP Time & Labor for a date window
 * and emits a per-worker summary (first_in, last_out, total_hours, on_clock).
 *
 * STATE: SKELETON (NOT YET PROVISIONED)
 *   ADP returns 404 on every /time/* endpoint until the Time & Labor API
 *   product is added to the registered client app in ADP Marketplace.
 *
 *   When that 404 happens, the actor:
 *     - logs a clear "NOT_PROVISIONED" warning,
 *     - emits a single dataset item { _type: "adp_punches_not_provisioned" },
 *     - exits SUCCESS (NOT a failure) so n8n's nightly schedule keeps running
 *       silently rather than spamming Slack with "actor failed" alerts every
 *       morning until provisioning is complete.
 *
 *   Once provisioning lands, the actor will start receiving 200 responses and
 *   the normalize() path takes over automatically — no code change needed
 *   beyond confirming the response shape (ADP's punch schema is documented
 *   in the project's adp-integration skill).
 */

import { Actor, log } from "apify";
import { Agent, fetch } from "undici";

interface Input {
  adpClientId: string;
  adpClientSecret: string;
  adpCertPem: string;
  adpKeyPem: string;
  startDate?: string;
  endDate?: string;
  associateOids?: string[];
  punchesEndpoint?: string;
  tokenUrl?: string;
  apiBase?: string;
}

interface AdpPunch {
  associateOID?: string;
  punchDateTime?: string;
  punchActionCode?: { codeValue?: string }; // 'IN' / 'OUT'
}

interface AggregateRow {
  _type: "adp_punch_day";
  associate_oid: string;
  punch_date: string; // YYYY-MM-DD
  first_in: string; // ISO datetime
  last_out: string; // ISO datetime, may be empty if still on clock
  on_clock: boolean;
  total_hours: number;
  punch_count: number;
}

function todayCstIso(): string {
  // en-CA produces YYYY-MM-DD which we can pass straight to ADP's date filter.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

async function getToken(
  dispatcher: Agent,
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    dispatcher,
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`ADP token request failed: HTTP ${resp.status} -- ${txt.slice(0, 500)}`);
  }
  const json = (await resp.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error(`ADP token response missing access_token: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json.access_token;
}

function aggregate(punches: AdpPunch[], filterOids: Set<string>): AggregateRow[] {
  // Group by (associate_oid, date)
  const grouped = new Map<string, AdpPunch[]>();
  for (const p of punches) {
    if (!p.associateOID || !p.punchDateTime) continue;
    if (filterOids.size > 0 && !filterOids.has(p.associateOID)) continue;
    const date = p.punchDateTime.slice(0, 10);
    const key = `${p.associateOID}|${date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(p);
  }

  const rows: AggregateRow[] = [];
  for (const [key, items] of grouped) {
    const [oid, date] = key.split("|");
    const sorted = items.slice().sort((a, b) =>
      (a.punchDateTime ?? "").localeCompare(b.punchDateTime ?? ""),
    );
    const ins = sorted.filter((p) => (p.punchActionCode?.codeValue ?? "").toUpperCase() === "IN");
    const outs = sorted.filter((p) => (p.punchActionCode?.codeValue ?? "").toUpperCase() === "OUT");
    const firstIn = ins[0]?.punchDateTime ?? "";
    const lastOut = outs[outs.length - 1]?.punchDateTime ?? "";

    let totalHours = 0;
    let onClock = false;
    if (ins.length === outs.length && firstIn && lastOut) {
      // Pair each IN with the next OUT in chronological order.
      const pairs = Math.min(ins.length, outs.length);
      for (let i = 0; i < pairs; i += 1) {
        const t1 = new Date(ins[i].punchDateTime!).getTime();
        const t2 = new Date(outs[i].punchDateTime!).getTime();
        if (Number.isFinite(t1) && Number.isFinite(t2) && t2 > t1) {
          totalHours += (t2 - t1) / 36e5;
        }
      }
    } else if (ins.length > outs.length) {
      // Still on the clock — count from last unmatched IN to "now".
      onClock = true;
      const pairs = outs.length;
      for (let i = 0; i < pairs; i += 1) {
        const t1 = new Date(ins[i].punchDateTime!).getTime();
        const t2 = new Date(outs[i].punchDateTime!).getTime();
        if (Number.isFinite(t1) && Number.isFinite(t2) && t2 > t1) {
          totalHours += (t2 - t1) / 36e5;
        }
      }
      const lastInTs = new Date(ins[ins.length - 1].punchDateTime!).getTime();
      if (Number.isFinite(lastInTs)) {
        totalHours += (Date.now() - lastInTs) / 36e5;
      }
    }

    rows.push({
      _type: "adp_punch_day",
      associate_oid: oid,
      punch_date: date,
      first_in: firstIn,
      last_out: lastOut,
      on_clock: onClock,
      total_hours: Math.max(0, Math.round(totalHours * 100) / 100),
      punch_count: items.length,
    });
  }
  return rows;
}

await Actor.init();
try {
  const input = (await Actor.getInput<Input>()) ?? ({} as Input);
  const tokenUrl = input.tokenUrl ?? "https://accounts.adp.com/auth/oauth/v2/token";
  const apiBase = input.apiBase ?? "https://api.adp.com";
  const punchesEndpoint = input.punchesEndpoint ?? "/time/v2/punches";
  const startDate = input.startDate || todayCstIso();
  const endDate = input.endDate || startDate;
  const filterOids = new Set((input.associateOids ?? []).filter(Boolean));

  if (!input.adpClientId || !input.adpClientSecret) {
    throw new Error("Missing adpClientId / adpClientSecret in actor input.");
  }
  if (!input.adpCertPem || !input.adpKeyPem) {
    throw new Error("Missing adpCertPem / adpKeyPem in actor input — both PEM blobs required for mTLS.");
  }

  const dispatcher = new Agent({
    connect: { cert: input.adpCertPem, key: input.adpKeyPem },
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 30_000,
  });

  log.info(`[ADP-Punches] Auth + window ${startDate}..${endDate} via ${punchesEndpoint}`);
  const token = await getToken(dispatcher, tokenUrl, input.adpClientId, input.adpClientSecret);

  // ADP punch endpoints accept ISO date or ISO datetime; we send full-day
  // bounds in UTC to be safe.
  const startDateTime = `${startDate}T00:00:00Z`;
  const endDateTime = `${endDate}T23:59:59Z`;
  const url =
    `${apiBase}${punchesEndpoint}` +
    `?startDateTime=${encodeURIComponent(startDateTime)}` +
    `&endDateTime=${encodeURIComponent(endDateTime)}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    dispatcher,
  });

  const dataset = await Actor.openDataset();

  if (resp.status === 404) {
    // Time & Labor product not provisioned — emit a "not provisioned" record
    // and exit SUCCESS so n8n's nightly schedule doesn't alert until ADP is set up.
    const notProvisioned = {
      _type: "adp_punches_not_provisioned" as const,
      timestamp_utc: new Date().toISOString(),
      attempted_url: url,
      message:
        "ADP Time & Labor returned 404. Add the 'Time & Labor' API product to the registered client app in ADP Marketplace, wait 15-30 min for provisioning, then re-run.",
    };
    await dataset.pushData(notProvisioned as unknown as Record<string, unknown>);
    log.warning("[ADP-Punches] NOT_PROVISIONED — emitting marker and exiting cleanly.");
    await dispatcher.close();
    await Actor.exit();
  } else if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`ADP punches GET failed: HTTP ${resp.status} -- ${txt.slice(0, 500)}`);
  } else {
    const json = (await resp.json()) as { punches?: AdpPunch[] };
    const punches = json.punches ?? [];
    log.info(`[ADP-Punches] Received ${punches.length} raw punches`);
    const rows = aggregate(punches, filterOids);
    if (rows.length > 0) {
      await dataset.pushData(rows as unknown as Record<string, unknown>[]);
    }
    const summary = {
      _type: "adp_punches_sync_summary" as const,
      timestamp_utc: new Date().toISOString(),
      window_start: startDate,
      window_end: endDate,
      raw_punches: punches.length,
      aggregated_rows: rows.length,
      filtered_by_oid: filterOids.size,
    };
    await dataset.pushData(summary as unknown as Record<string, unknown>);
    await Actor.setValue("adp_punches_sync_summary", summary);
    log.info(`[ADP-Punches] DONE. ${rows.length} per-agent rows emitted.`);
    await dispatcher.close();
    await Actor.exit();
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`[ADP-Punches] Actor failed: ${msg}`);
  await Actor.fail(msg);
}
