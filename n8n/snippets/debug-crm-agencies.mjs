/** Quick CRM debug: load the Sale Made page and dump all UI hints about agencies. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const apifyDir = path.join(repoRoot, "apify", "dsb-crm-scraper");
const secretsPath = path.join(repoRoot, "n8n", "dsb-daily-n8n-secrets.json");

const require = createRequire(path.join(apifyDir, "package.json"));
const { chromium } = require("playwright");

const secrets = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
const { crmUsername, crmPassword, crmLoginUrl } = secrets;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(crmLoginUrl, { waitUntil: "networkidle" });
  await page.fill('input[name="email"], input[name="username"], input[type="email"], input[type="text"]', crmUsername);
  await page.fill('input[name="password"], input[type="password"]', crmPassword);
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
  await page.waitForNavigation({ waitUntil: "networkidle" });

  // Navigate to Sale Made WITHOUT agency_id param at all
  console.log("\n--- Loading /admin-sale-made/ (no params) ---");
  await page.goto("https://crm.digitalseniorbenefits.com/admin-sale-made/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  console.log("URL:", page.url());

  const allSelects = await page.$$eval("select", (sels) =>
    sels.map((s) => ({
      name: s.getAttribute("name") || "",
      id: s.id || "",
      cls: s.className || "",
      optionCount: s.options.length,
      sampleOpts: Array.from(s.options).slice(0, 50).map((o) => ({
        v: o.value?.trim() ?? "",
        l: o.textContent?.trim() ?? "",
        sel: o.selected,
      })),
    }))
  );
  console.log(`\n${allSelects.length} <select> elements:`);
  for (const s of allSelects) {
    console.log(`  name="${s.name}" id="${s.id}" class="${s.cls}" opts=${s.optionCount}`);
    if (s.optionCount <= 30) {
      for (const o of s.sampleOpts) console.log(`    ${o.sel ? "*" : " "} [${o.v}] ${o.l}`);
    } else {
      console.log(`    (first 5: ${s.sampleOpts.slice(0,5).map(o=>o.l).join(" | ")})`);
    }
  }

  // Look for any agency switcher in nav/header
  console.log("\n--- Looking for agency context ---");
  const agencyHints = await page.$$eval('*', (els) => {
    const out = [];
    for (const el of els) {
      const text = el.textContent || "";
      if (text.length > 200) continue;
      if (/agency/i.test(text) && /luminary|life|remote|cha|atx|rmt/i.test(text)) {
        out.push({ tag: el.tagName, class: el.className?.toString().slice(0,80) ?? "", text: text.trim().slice(0, 200) });
      }
    }
    return out.slice(0, 30);
  });
  for (const h of agencyHints) console.log(`  <${h.tag}> ${h.text}`);

  // Look at the page title for current agency
  const pageTitle = await page.evaluate(() => {
    const h1 = document.querySelector("h1, h2, .page-title");
    return h1?.textContent?.trim() ?? "";
  });
  console.log(`\nPage title: ${pageTitle}`);

  // Save full HTML for inspection
  const html = await page.content();
  const out = path.join(repoRoot, "n8n", "snippets", "out", "sale-made-page.html");
  if (!fs.existsSync(path.dirname(out))) fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`\nFull HTML saved to: ${out}`);

  await browser.close();
})();
