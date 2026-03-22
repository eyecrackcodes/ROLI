# DSB Tier Movement Calculator — Design Brainstorm

<response>
<text>
## Idea 1: "Command Center" — Military-Grade Operations Dashboard

**Design Movement:** Inspired by mission control interfaces and Bloomberg terminals — dense, information-rich, and authoritative.

**Core Principles:**
1. Information density over decoration — every pixel earns its place
2. Status-at-a-glance through color-coded severity indicators
3. Monospaced data alignment for rapid scanning
4. Dark interface to reduce eye strain during long analysis sessions

**Color Philosophy:** Dark slate background (#0F172A) with high-contrast data. Green (#22C55E) for PROMOTE/PASS, Amber (#F59E0B) for WATCH/GRACE, Red (#EF4444) for DEMOTE/EXIT RISK, Cool blue (#3B82F6) for neutral data and headers. The palette communicates urgency and status without needing to read labels.

**Layout Paradigm:** Fixed left sidebar navigation with collapsible tier sections. Main content area uses a split-pane layout — top half for the active tier's stack rank table, bottom half for the gate analysis panel. Tabs switch between Daily Pulse, Monthly Stack Rank, and Gate Calculator.

**Signature Elements:**
- Status "chips" with pulsing dot indicators (green pulse = promote, red pulse = demote)
- Horizontal progress bars showing ROLI relative to tier median
- Gate analysis presented as a sequential pipeline with pass/fail indicators at each stage

**Interaction Philosophy:** Keyboard-navigable. Click an agent row to expand their gate analysis. Hover reveals tooltip with prior month comparison. Data entry feels like a spreadsheet — tab between cells.

**Animation:** Minimal and purposeful. Gate results animate in sequence (Gate 1 → Gate 2 → Gate 3) to reinforce the cascade logic. Status badges fade in. No gratuitous motion.

**Typography System:** JetBrains Mono for all numerical data and tables. Inter for labels and headers. The monospace font ensures columns align perfectly and numbers are instantly scannable.
</text>
<probability>0.08</probability>
</response>

<response>
<text>
## Idea 2: "The Analyst's Workbench" — Clean Editorial Data Tool

**Design Movement:** Inspired by Notion, Linear, and modern SaaS analytics tools — clean, spacious, and structured with editorial typography.

**Core Principles:**
1. Clarity through hierarchy — large section headers, subtle dividers, generous whitespace
2. Progressive disclosure — summary cards at top, drill-down tables below
3. Light interface with strategic color accents only on actionable items
4. Print-friendly layouts that look good when exported

**Color Philosophy:** Warm white background (#FAFAF9) with charcoal text (#1C1917). Emerald (#059669) for positive outcomes, Rose (#E11D48) for negative, Slate blue (#6366F1) as the primary accent for interactive elements. Color is used sparingly — only on status badges, chart elements, and CTAs — so the data speaks for itself.

**Layout Paradigm:** Full-width single-column layout with a top navigation bar switching between views (Daily Pulse / Monthly Review / Gate Calculator). Each view uses summary metric cards at top, then a full-width data table below. The Gate Calculator uses a step-by-step wizard layout — one gate per screen with a progress indicator.

**Signature Elements:**
- Large metric cards with sparkline trends (ROLI over last 3 months)
- Step-by-step wizard for the gate analysis with a vertical progress rail
- Inline editing with subtle blue highlight on editable cells

**Interaction Philosophy:** Guided and approachable. The gate calculator walks the analyst through each step with explanatory text. Hover states reveal contextual help. The tool teaches while it calculates.

**Animation:** Smooth page transitions between wizard steps. Numbers count up when metrics load. Subtle scale-up on card hover. Spring-based easing for a natural feel.

**Typography System:** Instrument Serif for page titles and section headers (editorial authority). DM Sans for body text and table data (clean, modern readability). The serif/sans pairing creates visual hierarchy without relying on size alone.
</text>
<probability>0.06</probability>
</response>

<response>
<text>
## Idea 3: "War Room" — High-Contrast Tactical Interface

**Design Movement:** Inspired by sports analytics dashboards (ESPN, Statcast) and trading platforms — bold, high-energy, and competitive.

**Core Principles:**
1. Competition is the theme — leaderboard aesthetics, rank badges, movement arrows
2. Bold typography and strong color blocking to create visual impact
3. Split-screen comparisons for cross-tier analysis
4. Real-time feel even with static data

**Color Philosophy:** Near-black background (#09090B) with electric accents. Neon green (#4ADE80) for promotions, hot red (#FF3B30) for demotions, electric blue (#60A5FA) for neutral highlights, gold (#FBBF24) for grace period/watch. The palette is aggressive and competitive — it makes agents feel like they're on a scoreboard.

**Layout Paradigm:** Three-column layout on desktop — one column per tier, always visible. The Gate Calculator overlays as a modal with a side-by-side comparison (T2 agent on left, T3 replacement on right). Mobile collapses to swipeable tier cards.

**Signature Elements:**
- Large rank numbers with up/down movement arrows (↑3 or ↓2 from last month)
- Side-by-side "Tale of the Tape" comparison cards for gate analysis
- Animated tier flow diagram showing the cascade (T3 → T2 → T1) with agent avatars moving between tiers

**Interaction Philosophy:** Competitive and visceral. Clicking "Run Gates" triggers a dramatic sequential reveal. Agent cards can be dragged between tiers in the manual override mode. Everything feels like a draft pick.

**Animation:** Bold entrance animations — cards slide in from the sides. Gate results stamp in with a slight bounce. The tier flow diagram animates agents moving between buckets. Victory confetti when a swap is finalized (optional, toggleable).

**Typography System:** Space Grotesk for headlines and rank numbers (geometric, bold, modern). Work Sans for body and table data (clean and neutral). The geometric display font reinforces the competitive, data-driven aesthetic.
</text>
<probability>0.04</probability>
</response>
