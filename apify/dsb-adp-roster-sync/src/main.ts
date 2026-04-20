/**
 * dsb-adp-roster-sync
 *
 * Pulls the ADP Workforce Now roster via OAuth 2.0 (client_credentials) + mTLS
 * and emits one normalized dataset item per agent we care about. n8n picks up
 * the dataset and upserts into the ROLI agents.adp_* columns + Slacks any
 * status changes.
 *
 * Why mTLS via Node and not Deno (Supabase Edge Functions)?
 *   ADP requires a client certificate during the TLS handshake. Deno's fetch
 *   API doesn't expose client-cert config; in Node we get it for free with
 *   undici.Agent({ connect: { cert, key } }) and the `dispatcher` option.
 *
 * Cert handling: the cert and key are passed in as PEM strings via input
 * (isSecret: true). They never touch disk, never get logged, and Apify
 * stores secret inputs encrypted at rest.
 */

import { Actor, log } from "apify";
import { Agent, fetch } from "undici";

interface Input {
  adpClientId: string;
  adpClientSecret: string;
  adpCertPem: string;
  adpKeyPem: string;
  linkedOids?: string[];
  salesTitleKeywords?: string[];
  /**
   * Lowercased substrings that DISQUALIFY a job title from being treated as a
   * sales producer, even if it contains a sales keyword. Catches things like
   * "Sales Operations", "Brokerage Sales Support", "Director of Sales",
   * "Sales Manager" — leadership/back-office roles that should never trigger
   * "new sales hire" Slack alerts.
   *
   * Default: ["operations", "support", "director", "manager"].
   *
   * Linked workers always bypass this filter (so we still pull status updates
   * for the GM if he was ever onboarded as an agent and later promoted).
   */
  salesTitleExcludeKeywords?: string[];
  /**
   * ADP associateOIDs to skip outright — never emitted, never Slacked.
   * Use this for known noise (sales ops, leadership, support staff in the
   * XAJ tenant whose titles match the sales keyword regex).
   *
   * NOTE: Only applies to UNLINKED workers. If an OID here is also in
   * linkedOids, the linked-worker path wins so terminations still propagate.
   */
  ignoredAssociateOids?: string[];
  /**
   * ADP company code allowlist. Workers whose primary assignment positionID
   * does NOT start with one of these prefixes are excluded from the dataset.
   * Defaults to ["XAJ"] (Digital Senior Benefits) — the only company we
   * actively manage in ROLI. Brokerage and other ADP entities under the same
   * client credentials are filtered out.
   *
   * Empty array = no filter (return everyone).
   */
  companyCodeAllowlist?: string[];
  tokenUrl?: string;
  apiBase?: string;
  pageSize?: number;
  requestDelayMs?: number;
}

interface AdpName {
  givenName?: string;
  middleName?: string;
  familyName1?: string;
  formattedName?: string;
}

interface AdpAssignment {
  primaryIndicator?: boolean;
  hireDate?: string;
  terminationDate?: string;
  jobTitle?: string;
  jobCode?: { codeValue?: string; shortName?: string };
  workerTypeCode?: { codeValue?: string; shortName?: string };
  /**
   * Position ID — typically formatted "<COMPANY_CODE><NNNNNN>" in ADP
   * (e.g. "XAJ000381"). Used to derive the company code for tenant filtering.
   */
  positionID?: string;
  assignmentStatus?: {
    statusCode?: { codeValue?: string; shortName?: string };
    effectiveDate?: string;
  };
  homeOrganizationalUnits?: Array<{
    nameCode?: { codeValue?: string; shortName?: string };
    typeCode?: { codeValue?: string };
  }>;
  /**
   * Some ADP tenants expose company code as a separate field on the assignment
   * (under assignedOrganizationalUnits w/ typeCode "BusinessUnit"). We check
   * positionID first since it's universally populated.
   */
  assignedOrganizationalUnits?: Array<{
    nameCode?: { codeValue?: string; shortName?: string };
    typeCode?: { codeValue?: string };
  }>;
}

interface AdpWorker {
  associateOID?: string;
  workerID?: { idValue?: string };
  person?: {
    legalName?: AdpName;
    preferredName?: AdpName;
  };
  workerStatus?: { statusCode?: { codeValue?: string } };
  workerDates?: { originalHireDate?: string };
  businessCommunication?: {
    emails?: Array<{ nameCode?: { codeValue?: string }; emailUri?: string }>;
  };
  workAssignments?: AdpAssignment[];
}

interface OutputItem {
  _type: "adp_worker";
  associate_oid: string;
  worker_id: string;
  legal_first_name: string;
  legal_middle_name: string;
  legal_last_name: string;
  legal_full_name: string;
  status_code: string;
  status_short: string;
  status_effective_date: string;
  job_title: string;
  job_code: string;
  worker_type: string;
  department_short: string;
  worker_status_top_level: string;
  hire_date: string;
  termination_date: string;
  original_hire_date: string;
  work_email: string;
  is_sales_role: boolean;
  /** Raw position ID (e.g. "XAJ000381") — used downstream for company filtering + audit. */
  position_id: string;
  /** Derived company code (3-char prefix of positionID, or BusinessUnit lookup). */
  company_code: string;
}

const SUMMARY_KEY = "adp_roster_sync_summary";

function trim(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

function pickPrimary(assignments: AdpAssignment[] | undefined): AdpAssignment {
  if (!assignments || assignments.length === 0) return {};
  return assignments.find((a) => a.primaryIndicator) ?? assignments[0];
}

function pickWorkEmail(worker: AdpWorker): string {
  const emails = worker.businessCommunication?.emails ?? [];
  const work = emails.find((e) => trim(e.nameCode?.codeValue).toLowerCase().includes("work"));
  return trim((work ?? emails[0])?.emailUri);
}

/**
 * Derive the ADP company code from a worker's primary assignment.
 *
 * Priority order:
 *   1. Explicit BusinessUnit / Company in assignedOrganizationalUnits
 *   2. First 3 chars of positionID (e.g. "XAJ000381" → "XAJ")
 *
 * Returns "" when neither source is available — those workers are excluded
 * from a non-empty allowlist (fail closed).
 */
function deriveCompanyCode(assignment: AdpAssignment): string {
  const orgs = assignment.assignedOrganizationalUnits ?? [];
  for (const o of orgs) {
    const t = trim(o.typeCode?.codeValue).toLowerCase();
    if (t === "businessunit" || t === "company" || t === "companycode") {
      const code = trim(o.nameCode?.codeValue);
      if (code) return code.toUpperCase();
    }
  }
  const pid = trim(assignment.positionID);
  if (pid.length >= 3) {
    const prefix = pid.slice(0, 3).toUpperCase();
    // Only treat the prefix as a company code when it's all letters — guards
    // against tenants that use numeric position IDs.
    if (/^[A-Z]{3}$/.test(prefix)) return prefix;
  }
  return "";
}

function isSalesRole(
  assignment: AdpAssignment,
  keywords: string[],
  excludeKeywords: string[] = [],
): boolean {
  const haystack = [
    assignment.jobTitle ?? "",
    assignment.jobCode?.shortName ?? "",
    assignment.jobCode?.codeValue ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (excludeKeywords.some((k) => k && haystack.includes(k.toLowerCase()))) {
    return false;
  }
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}

function normalize(
  worker: AdpWorker,
  salesKeywords: string[],
  salesExcludeKeywords: string[] = [],
): OutputItem | null {
  const oid = trim(worker.associateOID);
  if (!oid) return null;

  const legal = worker.person?.legalName ?? {};
  const primary = pickPrimary(worker.workAssignments);
  const status = primary.assignmentStatus?.statusCode?.codeValue ?? "";
  const department = primary.homeOrganizationalUnits?.find(
    (u) => trim(u.typeCode?.codeValue).toLowerCase() === "department",
  );

  return {
    _type: "adp_worker",
    associate_oid: oid,
    worker_id: trim(worker.workerID?.idValue),
    legal_first_name: trim(legal.givenName),
    legal_middle_name: trim(legal.middleName),
    legal_last_name: trim(legal.familyName1),
    legal_full_name:
      trim(legal.formattedName) ||
      [trim(legal.givenName), trim(legal.familyName1)].filter(Boolean).join(" "),
    status_code: status,
    status_short: trim(primary.assignmentStatus?.statusCode?.shortName),
    status_effective_date: trim(primary.assignmentStatus?.effectiveDate),
    job_title: trim(primary.jobTitle),
    job_code: trim(primary.jobCode?.codeValue),
    worker_type: trim(primary.workerTypeCode?.codeValue),
    department_short: trim(department?.nameCode?.shortName),
    worker_status_top_level: trim(worker.workerStatus?.statusCode?.codeValue),
    hire_date: trim(primary.hireDate),
    termination_date: trim(primary.terminationDate),
    original_hire_date: trim(worker.workerDates?.originalHireDate),
    work_email: pickWorkEmail(worker),
    is_sales_role: isSalesRole(primary, salesKeywords, salesExcludeKeywords),
    position_id: trim(primary.positionID),
    company_code: deriveCompanyCode(primary),
  };
}

/**
 * Decide whether to keep a worker given the company allowlist.
 *
 * - Empty/undefined allowlist → keep everyone (no-op filter).
 * - Worker company_code in allowlist → keep.
 * - Linked workers (already in ROLI) are ALWAYS kept regardless of company,
 *   because removing them silently would orphan agent rows. If the company
 *   genuinely changed, that's a coaching/HR conversation — surfaced via Slack.
 */
function passesCompanyFilter(
  item: OutputItem,
  allowlist: string[],
  isLinked: boolean,
): boolean {
  if (allowlist.length === 0) return true;
  if (isLinked) return true;
  return allowlist.includes(item.company_code);
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
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error(`ADP token response missing access_token: ${JSON.stringify(json).slice(0, 500)}`);
  }
  log.info(`[ADP] Got bearer token (expires_in=${json.expires_in ?? "?"}s)`);
  return json.access_token;
}

async function adpGet(
  dispatcher: Agent,
  url: string,
  token: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    dispatcher,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`ADP GET ${url} failed: HTTP ${resp.status} -- ${txt.slice(0, 500)}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

async function fetchAllWorkers(
  dispatcher: Agent,
  apiBase: string,
  token: string,
  pageSize: number,
  delayMs: number,
): Promise<AdpWorker[]> {
  const workers: AdpWorker[] = [];
  let skip = 0;
  while (true) {
    const url = `${apiBase}/hr/v2/workers?$top=${pageSize}&$skip=${skip}`;
    const page = (await adpGet(dispatcher, url, token)) as { workers?: AdpWorker[] };
    const batch = page.workers ?? [];
    if (batch.length === 0) break;
    workers.push(...batch);
    log.info(`[ADP] Roster page (skip=${skip}, +${batch.length}, total=${workers.length})`);
    skip += pageSize;
    if (batch.length < pageSize) break;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  return workers;
}

async function fetchWorkerDetail(
  dispatcher: Agent,
  apiBase: string,
  token: string,
  oid: string,
): Promise<AdpWorker | null> {
  try {
    const data = (await adpGet(dispatcher, `${apiBase}/hr/v2/workers/${oid}`, token)) as {
      workers?: AdpWorker[];
    };
    return data.workers?.[0] ?? null;
  } catch (err) {
    log.warning(`[ADP] Detail fetch failed for ${oid}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

await Actor.init();
try {
  const input = (await Actor.getInput<Input>()) ?? ({} as Input);
  const tokenUrl = input.tokenUrl ?? "https://accounts.adp.com/auth/oauth/v2/token";
  const apiBase = input.apiBase ?? "https://api.adp.com";
  const pageSize = input.pageSize ?? 100;
  const delayMs = input.requestDelayMs ?? 250;
  const linkedOids = (input.linkedOids ?? []).filter(
    (o): o is string => typeof o === "string" && o.length > 0,
  );
  const salesKeywords = input.salesTitleKeywords ?? ["agent", "sales", "producer"];
  const salesExcludeKeywords = (
    input.salesTitleExcludeKeywords ?? ["operations", "support", "director", "manager"]
  )
    .map((k) => trim(k).toLowerCase())
    .filter((k) => k.length > 0);
  const ignoredOidSet = new Set(
    (input.ignoredAssociateOids ?? [])
      .filter((o): o is string => typeof o === "string" && o.length > 0),
  );
  const companyAllowlist = (input.companyCodeAllowlist ?? ["XAJ"])
    .map((c) => trim(c).toUpperCase())
    .filter((c) => c.length > 0);
  if (companyAllowlist.length > 0) {
    log.info(`[ADP] Company allowlist active: [${companyAllowlist.join(", ")}] (linked workers always kept)`);
  } else {
    log.warning(`[ADP] companyCodeAllowlist is empty — no company filter applied`);
  }
  if (salesExcludeKeywords.length > 0) {
    log.info(`[ADP] Sales title exclude keywords: [${salesExcludeKeywords.join(", ")}]`);
  }
  if (ignoredOidSet.size > 0) {
    log.info(`[ADP] Ignored OIDs: ${ignoredOidSet.size} (linked workers bypass)`);
  }

  if (!input.adpClientId || !input.adpClientSecret) {
    throw new Error("Missing adpClientId / adpClientSecret in actor input.");
  }
  if (!input.adpCertPem || !input.adpKeyPem) {
    throw new Error("Missing adpCertPem / adpKeyPem in actor input — both PEM blobs required for mTLS.");
  }

  const dispatcher = new Agent({
    connect: {
      cert: input.adpCertPem,
      key: input.adpKeyPem,
    },
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 30_000,
  });

  log.info(`[ADP] Starting roster sync (linkedOids=${linkedOids.length}, pageSize=${pageSize})`);
  const token = await getToken(dispatcher, tokenUrl, input.adpClientId, input.adpClientSecret);

  const listWorkers = await fetchAllWorkers(dispatcher, apiBase, token, pageSize, delayMs);
  log.info(`[ADP] Roster list complete: ${listWorkers.length} workers`);

  const byOid = new Map<string, AdpWorker>();
  for (const w of listWorkers) {
    if (w.associateOID) byOid.set(w.associateOID, w);
  }

  // Hydrate detail for every linked agent + every currently-Active worker.
  // The list endpoint omits jobTitle, so we hit /hr/v2/workers/{oid} for the
  // workers we care about. Active workers get hydrated so we can detect new
  // sales hires (worker exists in ADP but not yet in ROLI).
  const detailTargets = new Set<string>(linkedOids);
  for (const w of listWorkers) {
    const status = pickPrimary(w.workAssignments).assignmentStatus?.statusCode?.codeValue;
    if (status === "A" && w.associateOID) detailTargets.add(w.associateOID);
  }

  log.info(`[ADP] Hydrating detail for ${detailTargets.size} workers`);
  const detailedByOid = new Map<string, AdpWorker>();
  let detailFailures = 0;
  let i = 0;
  for (const oid of detailTargets) {
    i += 1;
    const detail = await fetchWorkerDetail(dispatcher, apiBase, token, oid);
    if (detail) {
      detailedByOid.set(oid, detail);
    } else {
      detailFailures += 1;
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (i % 25 === 0) log.info(`[ADP]   detail progress: ${i}/${detailTargets.size}`);
  }
  log.info(`[ADP] Detail hydration done: ${detailedByOid.size} ok, ${detailFailures} failed`);

  // Emit:
  //   - linked OIDs always (so terminations propagate even if status=T was paged out of the active hydration set)
  //   - unlinked workers only when is_sales_role=true AND in companyAllowlist (so n8n only Slacks "new sales hire" for our tenant)
  const emitted: OutputItem[] = [];
  let filteredByCompany = 0;
  let filteredByOidIgnore = 0;
  for (const oid of detailTargets) {
    const isLinked = linkedOids.includes(oid);
    // Hard skip: explicit ignore list (only applies to UNLINKED workers — we
    // never want a leadership/ops OID to silently break a linked agent row).
    if (!isLinked && ignoredOidSet.has(oid)) {
      filteredByOidIgnore += 1;
      continue;
    }
    const source = detailedByOid.get(oid) ?? byOid.get(oid);
    if (!source) continue;
    const item = normalize(source, salesKeywords, salesExcludeKeywords);
    if (!item) continue;

    if (!passesCompanyFilter(item, companyAllowlist, isLinked)) {
      filteredByCompany += 1;
      continue;
    }
    if (isLinked || item.is_sales_role) {
      emitted.push(item);
    }
  }

  // Also re-hydrate any linked OID that was filtered out by the "Active only"
  // gate above (e.g. someone got terminated yesterday — we still need the row
  // to flip is_active=false in ROLI). Linked workers bypass the company filter
  // AND the ignore list.
  for (const oid of linkedOids) {
    if (detailedByOid.has(oid)) continue;
    const detail = await fetchWorkerDetail(dispatcher, apiBase, token, oid);
    if (!detail) continue;
    const item = normalize(detail, salesKeywords, salesExcludeKeywords);
    if (item) emitted.push(item);
  }

  if (companyAllowlist.length > 0) {
    log.info(`[ADP] Company filter dropped ${filteredByCompany} unlinked workers (kept ${emitted.length})`);
  }
  if (ignoredOidSet.size > 0) {
    log.info(`[ADP] OID ignore list dropped ${filteredByOidIgnore} unlinked workers`);
  }

  const dataset = await Actor.openDataset();
  if (emitted.length > 0) {
    await dataset.pushData(emitted as unknown as Record<string, unknown>[]);
  }

  const summary = {
    _type: "adp_roster_sync_summary",
    timestamp_utc: new Date().toISOString(),
    total_workers_in_adp: listWorkers.length,
    linked_oids_input: linkedOids.length,
    detail_hydrated: detailedByOid.size,
    detail_failed: detailFailures,
    emitted_items: emitted.length,
    emitted_linked: emitted.filter((e) => linkedOids.includes(e.associate_oid)).length,
    emitted_unlinked_sales: emitted.filter(
      (e) => !linkedOids.includes(e.associate_oid) && e.is_sales_role,
    ).length,
    company_allowlist: companyAllowlist,
    company_filter_dropped: filteredByCompany,
    sales_title_exclude_keywords: salesExcludeKeywords,
    ignored_oids_count: ignoredOidSet.size,
    ignored_oids_dropped: filteredByOidIgnore,
  };
  await dataset.pushData(summary as unknown as Record<string, unknown>);
  await Actor.setValue(SUMMARY_KEY, summary);

  log.info(
    `[ADP] DONE. emitted=${emitted.length} (${summary.emitted_linked} linked + ${summary.emitted_unlinked_sales} unlinked-sales)`,
  );

  await dispatcher.close();

  if (emitted.length === 0) {
    await Actor.fail("ADP roster sync emitted 0 items — treating as failure");
  } else {
    await Actor.exit();
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log.error(`[ADP] Actor failed: ${msg}`);
  await Actor.fail(msg);
}
