const {
  scrapeDate,
  centralHour,
  critical,
  warning,
  onTrack,
  agentCount,
  orgAgentCount,
  daysThisWeek,
  cfg,
  teamMedianRollingDials,
} = $input.first().json;

const orgN = typeof orgAgentCount === "number" ? orgAgentCount : agentCount;
const inScopeN = agentCount;

const [y, mo, d] = scrapeDate.split("-");
const dt = new Date(+y, +mo - 1, +d);
const dn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
const mn = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
][dt.getMonth()];
const dd = `${dn} ${mn} ${+d}, ${y}`;
const ampm =
  centralHour > 12
    ? `${centralHour - 12}:05 PM`
    : centralHour === 12
      ? "12:05 PM"
      : `${centralHour}:05 AM`;

/** Plain labels — readable in a mixed audience channel. */
const ACTION_LABEL = {
  TAKE_MORE_LEADS: "Take more leads",
  WORK_FOLLOWUPS: "Work follow-ups",
  GET_IN_POOL: "Get in pool",
  CLEAR_PIPELINE: "Clear pipeline",
  REVIEW_QUALITY: "Review call quality",
  FOCUS_PIPELINE: "Focus pipeline",
  STAY_IN_QUEUE: "Stay in queue",
  PICK_UP_PACE: "Pick up pace",
  ON_TRACK: "On track",
};

const fmt = (n) => "$" + Math.round(n).toLocaleString();

const blocks = [];

blocks.push({
  type: "header",
    text: {
    type: "plain_text",
    text: `ROLI — Hourly coaching — ${dd}`,
  },
});

blocks.push({
  type: "section",
  text: {
    type: "mrkdwn",
    text: [
      `*When:* ${ampm} Central`,
      `*Scope:* ${inScopeN} active agents (operations excluded). Org roster: ${orgN}.`,
      `*Week progress:* weekday ${daysThisWeek} of 5 (Mon–Fri).`,
      `*Team pace (last CRM interval):* ${
        teamMedianRollingDials != null ? `${teamMedianRollingDials} dials (median)` : "not enough snapshots yet"
      }`,
      `*This run:* ${critical.length} critical · ${warning.length} warning · ${onTrack.length} on track`,
    ].join("\n"),
  },
});

blocks.push({ type: "divider" });

function formatAgent(a, stackIdx) {
  const action = ACTION_LABEL[a.action] || String(a.action || "").replace(/_/g, " ");
  const rank = typeof stackIdx === "number" ? `#${stackIdx} ` : "";
  const lines = [
    `*${rank}${a.name}*`,
    `*Focus:* ${action}`,
    `Today (cumulative): ${a.todaysDials} dials · ${a.todaysTalkMin} min talk`,
  ];
  if (typeof a.rollingHourDials === "number") {
    lines.push(
      `Since prior snapshot: +${a.rollingHourDials} dials · +${Math.round(a.rollingHourTalkMin || 0)} min talk`
    );
  }
  if (a.todaysCR !== null) {
    lines.push(`Inbound today: ${a.todaysSales}/${a.todaysLeads} leads → ${a.todaysCR}% CR`);
  } else if (a.todaysLeads > 0) {
    lines.push(`Inbound today: ${a.todaysSales}/${a.todaysLeads} leads`);
  } else {
    lines.push(`Inbound today: no intraday row yet`);
  }
  if (a.weeklyCR !== null) {
    lines.push(`Week to date: ${a.weeklyCR}% CR (${a.weekSales} sales / ${a.weekLeads} leads)`);
  } else {
    lines.push(`Week to date: not enough closed days yet`);
  }
  if (a.pipelineSize !== null) {
    lines.push(
      `Pipeline: ${a.pipelineSize} leads` + (a.pastDue ? ` (${a.pastDue} past due)` : "")
    );
  }
  if (a.poolDials > 0) {
    lines.push(
      `Pool today: ${a.poolDials} dials · ${a.poolSelfAssigned} self-assigns · ${a.poolAnswered} answered`
    );
  }
  lines.push(`Pool week: ${a.poolWeekSales}/${cfg.POOL_WEEKLY_SALES} sales (weekly target)`);
  if (a.todaysPremium > 0) lines.push(`Premium today: ${fmt(a.todaysPremium)}`);
  if (a.costPerSale != null) {
    lines.push(`Cost/sale: ${fmt(a.costPerSale)} today` + (a.weekCostPerSale != null ? ` · ${fmt(a.weekCostPerSale)} week` : ""));
  } else if (a.todaysLeads > 0 && a.todayLeadSpend > 0) {
    lines.push(`Lead spend: ${fmt(a.todayLeadSpend)} today (0 sales)`);
  }
  lines.push(`${a.reason}`);
  return lines.join("\n");
}

if (critical.length > 0) {
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Critical — ${critical.length}*` },
  });
  for (let ri = 0; ri < critical.length && ri < 15; ri++) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: formatAgent(critical[ri], ri + 1) },
    });
  }
  if (critical.length > 15) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `…and ${critical.length - 15} more (see ROLI for full list).` },
      ],
    });
  }
  blocks.push({ type: "divider" });
}

if (warning.length > 0) {
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Needs attention — ${warning.length}*` },
  });
  for (let ri = 0; ri < warning.length && ri < 15; ri++) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: formatAgent(warning[ri], ri + 1) },
    });
  }
  if (warning.length > 15) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `…and ${warning.length - 15} more (see ROLI for full list).` },
      ],
    });
  }
  blocks.push({ type: "divider" });
}

const MAX_ON_TRACK_NAMES = 18;
if (onTrack.length > 0) {
  const names = onTrack.map((a) => a.name);
  const shown = names.slice(0, MAX_ON_TRACK_NAMES).join(", ");
  const extra =
    names.length > MAX_ON_TRACK_NAMES
      ? `\n_${names.length - MAX_ON_TRACK_NAMES} others on track — open ROLI for names._`
      : "";
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*On track — ${onTrack.length}*\n${shown}${extra}`,
    },
  });
  blocks.push({ type: "divider" });
}

const allAgents = [...critical, ...warning, ...onTrack];
const totalPoolSales = allAgents.reduce((s, a) => s + a.poolWeekSales, 0);
const totalPoolAssigns = allAgents.reduce((s, a) => s + a.poolSelfAssigned, 0);
const totalPoolDials = allAgents.reduce((s, a) => s + a.poolDials, 0);
const agentsInPool = allAgents.filter((a) => a.poolDials > 0).length;
const agentsPoolGoalMet = allAgents.filter((a) => a.poolOnTrack).length;

blocks.push({
  type: "section",
  text: {
    type: "mrkdwn",
    text: [
      `*Pool snapshot (this digest)*`,
      `${agentsInPool} agents dialed pool today · ${totalPoolDials} pool dials · ${totalPoolAssigns} self-assigns`,
      `${totalPoolSales} pool sales this week · ${agentsPoolGoalMet}/${inScopeN} at weekly pool-sales target (${cfg.POOL_WEEKLY_SALES}/wk)`,
    ].join("\n"),
  },
});

blocks.push({
  type: "context",
  elements: [
    {
      type: "mrkdwn",
      text: `Targets: CR ${cfg.CR_TARGET}%+ · pipeline ≤${cfg.MAX_PIPELINE} · pool ${cfg.POOL_DAILY_ASSIGNS} assigns/day & ${cfg.POOL_WEEKLY_SALES} sale/wk · past due 0 · CPC $${cfg.LEAD_COST} · org avg premium $${cfg.AVG_PREMIUM_ORG}`,
    },
  ],
});

const fallback = `ROLI hourly — ${dd} ${ampm}: ${critical.length} critical, ${warning.length} warning, ${onTrack.length} on track`;

return [{ json: { text: fallback, blocks } }];
