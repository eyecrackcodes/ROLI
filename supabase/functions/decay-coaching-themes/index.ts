import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Decay stale coaching themes:
 * - Themes older than 2 weeks that have no coaching_action logged against them
 *   get their severity downgraded (high→med, med→low).
 * - Themes older than 4 weeks with no action are deleted to keep the table lean.
 *
 * Designed to run nightly alongside the rollup, triggered by the same
 * dsb-coaching-nightly-rollup n8n workflow (add a second POST node).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14);
    const fourWeeksAgo = new Date(now);
    fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);

    const twoWeekCutoff = twoWeeksAgo.toISOString().slice(0, 10);
    const fourWeekCutoff = fourWeeksAgo.toISOString().slice(0, 10);

    // Find themes with no coaching action
    const { data: allThemes } = await supabase
      .from("coaching_themes_weekly")
      .select("id, week_start_date, severity")
      .lt("week_start_date", twoWeekCutoff);

    if (!allThemes || allThemes.length === 0) {
      return new Response(
        JSON.stringify({ success: true, decayed: 0, deleted: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check which themes have coaching actions
    const themeIds = allThemes.map(t => t.id);
    const { data: actions } = await supabase
      .from("coaching_actions")
      .select("theme_id")
      .in("theme_id", themeIds);

    const actionedThemeIds = new Set((actions ?? []).map((a: { theme_id: string }) => a.theme_id));

    let decayed = 0;
    let deleted = 0;

    for (const theme of allThemes as Array<{ id: string; week_start_date: string; severity: string }>) {
      if (actionedThemeIds.has(theme.id)) continue;

      if (theme.week_start_date < fourWeekCutoff) {
        // Delete themes older than 4 weeks with no action
        await supabase.from("coaching_themes_weekly").delete().eq("id", theme.id);
        deleted++;
      } else if (theme.severity === "high") {
        await supabase.from("coaching_themes_weekly").update({ severity: "med" }).eq("id", theme.id);
        decayed++;
      } else if (theme.severity === "med") {
        await supabase.from("coaching_themes_weekly").update({ severity: "low" }).eq("id", theme.id);
        decayed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, decayed, deleted, totalChecked: allThemes.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
