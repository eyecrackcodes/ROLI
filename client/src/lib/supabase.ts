import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env"
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// QAvOne (Conversation Intelligence source) — read-only
const qavUrl = import.meta.env.VITE_QAV_SUPABASE_URL;
const qavKey = import.meta.env.VITE_QAV_SUPABASE_ANON_KEY;

export const supabaseQav = createClient(qavUrl ?? "", qavKey ?? "");
export const isQavConfigured = Boolean(qavUrl && qavKey);
