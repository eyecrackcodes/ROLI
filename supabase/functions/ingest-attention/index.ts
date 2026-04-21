import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConversationPayload {
  attention_uuid: string;
  attention_user_uuid: string;
  call_date: string;
  call_started_at: string;
  duration_seconds: number;
  call_label?: string;
  outcome?: string;
  scorecard_name?: string;
  scorecard_total_score?: number;
  scorecard_breakdown?: Record<string, number>;
  talk_ratio?: number;
  longest_monologue_sec?: number;
  sentiment_overall?: number;
  first_objection_type?: string;
  first_objection_at_seconds?: number;
  recovered_after_objection?: boolean;
  clip_url?: string;
  transcript_summary?: string;
  ai_themes?: string[];
  raw_payload?: Record<string, unknown>;
}

interface IngestPayload {
  conversations: ConversationPayload[];
  update_cursor?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const payload: IngestPayload = await req.json();

    if (!payload.conversations || !Array.isArray(payload.conversations)) {
      return new Response(
        JSON.stringify({ success: false, error: "conversations array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load agent lookup maps: attention_user_uuid → agent_id AND email → agent_id
    const { data: mappings } = await supabase
      .from("agent_attention_map")
      .select("attention_user_uuid, agent_id");
    const agentMap = new Map<string, string>();
    for (const m of (mappings ?? []) as Array<{ attention_user_uuid: string; agent_id: string }>) {
      agentMap.set(m.attention_user_uuid, m.agent_id);
    }

    const { data: agentRows } = await supabase
      .from("agents")
      .select("id, adp_work_email");
    const emailMap = new Map<string, string>();
    for (const a of (agentRows ?? []) as Array<{ id: string; adp_work_email: string | null }>) {
      if (a.adp_work_email) emailMap.set(a.adp_work_email.toLowerCase(), a.id);
    }

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    const BATCH_SIZE = 50;
    for (let i = 0; i < payload.conversations.length; i += BATCH_SIZE) {
      const batch = payload.conversations.slice(i, i + BATCH_SIZE);

      const records = batch
        .map((c) => {
          const agentId = agentMap.get(c.attention_user_uuid)
            ?? emailMap.get((c.attention_user_uuid ?? "").toLowerCase());
          if (!agentId) {
            skipped++;
            return null;
          }

          return {
            attention_uuid: c.attention_uuid,
            agent_id: agentId,
            call_date: c.call_date,
            call_started_at: c.call_started_at,
            duration_seconds: c.duration_seconds,
            call_label: c.call_label ?? null,
            outcome: c.outcome ?? null,
            scorecard_name: c.scorecard_name ?? null,
            scorecard_total_score: c.scorecard_total_score ?? null,
            scorecard_breakdown: c.scorecard_breakdown ?? null,
            talk_ratio: c.talk_ratio ?? null,
            longest_monologue_sec: c.longest_monologue_sec ?? null,
            sentiment_overall: c.sentiment_overall ?? null,
            first_objection_type: c.first_objection_type ?? null,
            first_objection_at_seconds: c.first_objection_at_seconds ?? null,
            recovered_after_objection: c.recovered_after_objection ?? null,
            clip_url: c.clip_url ?? null,
            transcript_summary: c.transcript_summary ?? null,
            ai_themes: c.ai_themes ?? [],
            raw_payload: c.raw_payload ?? null,
            synced_at: new Date().toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (records.length === 0) continue;

      const { error } = await supabase
        .from("conversation_intelligence")
        .upsert(records, { onConflict: "attention_uuid" });

      if (error) {
        errors.push(`Batch ${i / BATCH_SIZE}: ${error.message}`);
      } else {
        inserted += records.length;
      }
    }

    // Advance the sync cursor if requested
    if (payload.update_cursor) {
      const { error: cursorError } = await supabase
        .from("sync_cursors")
        .upsert(
          { source: "attention", last_cursor_iso: payload.update_cursor, updated_at: new Date().toISOString() },
          { onConflict: "source" },
        );
      if (cursorError) {
        errors.push(`cursor update: ${cursorError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        inserted,
        skipped,
        total: payload.conversations.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
