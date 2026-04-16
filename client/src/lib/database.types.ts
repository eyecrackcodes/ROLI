export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_name_aliases: {
        Row: {
          canonical_name: string
          created_at: string | null
          crm_name: string
          id: string
        }
        Insert: {
          canonical_name: string
          created_at?: string | null
          crm_name: string
          id?: string
        }
        Update: {
          canonical_name?: string
          created_at?: string | null
          crm_name?: string
          id?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          agent_status: string | null
          created_at: string | null
          crm_agent_id: string | null
          daily_lead_volume: number
          id: string
          is_active: boolean | null
          manager: string | null
          name: string
          site: string
          terminated_date: string | null
          tier: string
          updated_at: string | null
        }
        Insert: {
          agent_status?: string | null
          created_at?: string | null
          crm_agent_id?: string | null
          daily_lead_volume?: number
          id?: string
          is_active?: boolean | null
          manager?: string | null
          name: string
          site: string
          terminated_date?: string | null
          tier: string
          updated_at?: string | null
        }
        Update: {
          agent_status?: string | null
          created_at?: string | null
          crm_agent_id?: string | null
          daily_lead_volume?: number
          id?: string
          is_active?: boolean | null
          manager?: string | null
          name?: string
          site?: string
          terminated_date?: string | null
          tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      daily_marketing_summary: {
        Row: {
          avg_premium: number
          cost_per_sale: number
          cpc: number
          marketing_acq_pct: number
          report_date: string
          roas: number
          synced_at: string
          total_calls: number
          total_cost: number
          total_premium: number
          total_sales: number
        }
        Insert: {
          avg_premium?: number
          cost_per_sale?: number
          cpc?: number
          marketing_acq_pct?: number
          report_date: string
          roas?: number
          synced_at?: string
          total_calls?: number
          total_cost?: number
          total_premium?: number
          total_sales?: number
        }
        Update: {
          avg_premium?: number
          cost_per_sale?: number
          cpc?: number
          marketing_acq_pct?: number
          report_date?: string
          roas?: number
          synced_at?: string
          total_calls?: number
          total_cost?: number
          total_premium?: number
          total_sales?: number
        }
        Relationships: []
      }
      daily_scrape_data: {
        Row: {
          agent_id_crm: number | null
          agent_name: string
          created_at: string | null
          custom_leads: number | null
          custom_premium: number | null
          custom_sales: number | null
          ib_leads_delivered: number | null
          ib_premium: number | null
          ib_sales: number | null
          id: string
          ob_leads_delivered: number | null
          ob_premium: number | null
          ob_sales: number | null
          scrape_date: string
          talk_time_minutes: number | null
          tier: string
          total_dials: number | null
        }
        Insert: {
          agent_id_crm?: number | null
          agent_name: string
          created_at?: string | null
          custom_leads?: number | null
          custom_premium?: number | null
          custom_sales?: number | null
          ib_leads_delivered?: number | null
          ib_premium?: number | null
          ib_sales?: number | null
          id?: string
          ob_leads_delivered?: number | null
          ob_premium?: number | null
          ob_sales?: number | null
          scrape_date: string
          talk_time_minutes?: number | null
          tier: string
          total_dials?: number | null
        }
        Update: {
          agent_id_crm?: number | null
          agent_name?: string
          created_at?: string | null
          custom_leads?: number | null
          custom_premium?: number | null
          custom_sales?: number | null
          ib_leads_delivered?: number | null
          ib_premium?: number | null
          ib_sales?: number | null
          id?: string
          ob_leads_delivered?: number | null
          ob_premium?: number | null
          ob_sales?: number | null
          scrape_date?: string
          talk_time_minutes?: number | null
          tier?: string
          total_dials?: number | null
        }
        Relationships: []
      }
      evaluation_windows: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          is_active: boolean | null
          is_inaugural: boolean | null
          name: string
          start_date: string
          working_days: number
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          is_active?: boolean | null
          is_inaugural?: boolean | null
          name: string
          start_date: string
          working_days: number
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          is_active?: boolean | null
          is_inaugural?: boolean | null
          name?: string
          start_date?: string
          working_days?: number
        }
        Relationships: []
      }
      intraday_snapshots: {
        Row: {
          agent_name: string
          created_at: string | null
          custom_leads: number | null
          custom_premium: number | null
          custom_sales: number | null
          ib_leads_delivered: number | null
          ib_premium: number | null
          ib_sales: number | null
          id: string
          ob_leads_delivered: number | null
          ob_premium: number | null
          ob_sales: number | null
          pool_answered: number | null
          pool_contact_rate: number | null
          pool_dials: number | null
          pool_long_calls: number | null
          pool_self_assigned: number | null
          pool_talk_minutes: number | null
          scrape_date: string
          scrape_hour: number
          talk_time_minutes: number | null
          tier: string
          total_dials: number | null
        }
        Insert: {
          agent_name: string
          created_at?: string | null
          custom_leads?: number | null
          custom_premium?: number | null
          custom_sales?: number | null
          ib_leads_delivered?: number | null
          ib_premium?: number | null
          ib_sales?: number | null
          id?: string
          ob_leads_delivered?: number | null
          ob_premium?: number | null
          ob_sales?: number | null
          pool_answered?: number | null
          pool_contact_rate?: number | null
          pool_dials?: number | null
          pool_long_calls?: number | null
          pool_self_assigned?: number | null
          pool_talk_minutes?: number | null
          scrape_date: string
          scrape_hour: number
          talk_time_minutes?: number | null
          tier: string
          total_dials?: number | null
        }
        Update: {
          agent_name?: string
          created_at?: string | null
          custom_leads?: number | null
          custom_premium?: number | null
          custom_sales?: number | null
          ib_leads_delivered?: number | null
          ib_premium?: number | null
          ib_sales?: number | null
          id?: string
          ob_leads_delivered?: number | null
          ob_premium?: number | null
          ob_sales?: number | null
          pool_answered?: number | null
          pool_contact_rate?: number | null
          pool_dials?: number | null
          pool_long_calls?: number | null
          pool_self_assigned?: number | null
          pool_talk_minutes?: number | null
          scrape_date?: string
          scrape_hour?: number
          talk_time_minutes?: number | null
          tier?: string
          total_dials?: number | null
        }
        Relationships: []
      }
      lead_cost_config: {
        Row: {
          cost_per_lead: number
          created_at: string | null
          created_by: string | null
          effective_date: string
          id: string
          lead_channel: string
          tier: string
        }
        Insert: {
          cost_per_lead: number
          created_at?: string | null
          created_by?: string | null
          effective_date?: string
          id?: string
          lead_channel: string
          tier: string
        }
        Update: {
          cost_per_lead?: number
          created_at?: string | null
          created_by?: string | null
          effective_date?: string
          id?: string
          lead_channel?: string
          tier?: string
        }
        Relationships: []
      }
      leads_pool_daily_data: {
        Row: {
          agent_name: string
          answered_calls: number | null
          calls_made: number | null
          contact_rate: number | null
          created_at: string | null
          id: string
          long_calls: number | null
          premium: number | null
          sales_made: number | null
          scrape_date: string
          self_assigned_leads: number | null
          talk_time_minutes: number | null
        }
        Insert: {
          agent_name: string
          answered_calls?: number | null
          calls_made?: number | null
          contact_rate?: number | null
          created_at?: string | null
          id?: string
          long_calls?: number | null
          premium?: number | null
          sales_made?: number | null
          scrape_date: string
          self_assigned_leads?: number | null
          talk_time_minutes?: number | null
        }
        Update: {
          agent_name?: string
          answered_calls?: number | null
          calls_made?: number | null
          contact_rate?: number | null
          created_at?: string | null
          id?: string
          long_calls?: number | null
          premium?: number | null
          sales_made?: number | null
          scrape_date?: string
          self_assigned_leads?: number | null
          talk_time_minutes?: number | null
        }
        Relationships: []
      }
      leads_pool_inventory: {
        Row: {
          created_at: string | null
          id: string
          scrape_date: string
          scrape_hour: number
          status: string
          total_leads: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          scrape_date: string
          scrape_hour?: number
          status: string
          total_leads?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          scrape_date?: string
          scrape_hour?: number
          status?: string
          total_leads?: number | null
        }
        Relationships: []
      }
      monthly_snapshots: {
        Row: {
          agent_name: string
          close_rate: number | null
          created_at: string | null
          daily_pace: number | null
          ib_close_rate: number | null
          id: string
          lead_cost: number | null
          ob_close_rate: number | null
          prior_roli: number | null
          profit: number | null
          rank_in_tier: number | null
          roli: number | null
          site: string | null
          status: string | null
          tier: string
          total_custom_premium: number | null
          total_custom_sales: number | null
          total_dials: number | null
          total_ib_calls: number | null
          total_ib_premium: number | null
          total_ib_sales: number | null
          total_leads_delivered: number | null
          total_ob_leads: number | null
          total_ob_premium: number | null
          total_ob_sales: number | null
          total_premium: number | null
          total_sales: number | null
          total_talk_minutes: number | null
          window_id: string | null
        }
        Insert: {
          agent_name: string
          close_rate?: number | null
          created_at?: string | null
          daily_pace?: number | null
          ib_close_rate?: number | null
          id?: string
          lead_cost?: number | null
          ob_close_rate?: number | null
          prior_roli?: number | null
          profit?: number | null
          rank_in_tier?: number | null
          roli?: number | null
          site?: string | null
          status?: string | null
          tier: string
          total_custom_premium?: number | null
          total_custom_sales?: number | null
          total_dials?: number | null
          total_ib_calls?: number | null
          total_ib_premium?: number | null
          total_ib_sales?: number | null
          total_leads_delivered?: number | null
          total_ob_leads?: number | null
          total_ob_premium?: number | null
          total_ob_sales?: number | null
          total_premium?: number | null
          total_sales?: number | null
          total_talk_minutes?: number | null
          window_id?: string | null
        }
        Update: {
          agent_name?: string
          close_rate?: number | null
          created_at?: string | null
          daily_pace?: number | null
          ib_close_rate?: number | null
          id?: string
          lead_cost?: number | null
          ob_close_rate?: number | null
          prior_roli?: number | null
          profit?: number | null
          rank_in_tier?: number | null
          roli?: number | null
          site?: string | null
          status?: string | null
          tier?: string
          total_custom_premium?: number | null
          total_custom_sales?: number | null
          total_dials?: number | null
          total_ib_calls?: number | null
          total_ib_premium?: number | null
          total_ib_sales?: number | null
          total_leads_delivered?: number | null
          total_ob_leads?: number | null
          total_ob_premium?: number | null
          total_ob_sales?: number | null
          total_premium?: number | null
          total_sales?: number | null
          total_talk_minutes?: number | null
          window_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_snapshots_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "evaluation_windows"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_compliance_daily: {
        Row: {
          agent_id_crm: string | null
          agent_name: string
          call_queue_count: number | null
          created_at: string | null
          id: string
          new_leads: number | null
          past_due_follow_ups: number | null
          post_sale_leads: number | null
          projected_recovery: number | null
          revenue_at_risk: number | null
          scrape_date: string
          tier: string
          todays_follow_ups: number | null
          total_stale: number | null
        }
        Insert: {
          agent_id_crm?: string | null
          agent_name: string
          call_queue_count?: number | null
          created_at?: string | null
          id?: string
          new_leads?: number | null
          past_due_follow_ups?: number | null
          post_sale_leads?: number | null
          projected_recovery?: number | null
          revenue_at_risk?: number | null
          scrape_date: string
          tier?: string
          todays_follow_ups?: number | null
          total_stale?: number | null
        }
        Update: {
          agent_id_crm?: string | null
          agent_name?: string
          call_queue_count?: number | null
          created_at?: string | null
          id?: string
          new_leads?: number | null
          past_due_follow_ups?: number | null
          post_sale_leads?: number | null
          projected_recovery?: number | null
          revenue_at_risk?: number | null
          scrape_date?: string
          tier?: string
          todays_follow_ups?: number | null
          total_stale?: number | null
        }
        Relationships: []
      }
      system_config: {
        Row: {
          key: string
          updated_at: string | null
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      tier_movements: {
        Row: {
          agent_name: string
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          from_tier: string
          gate_results: Json | null
          id: string
          movement_type: string
          to_tier: string
          window_id: string | null
        }
        Insert: {
          agent_name: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          from_tier: string
          gate_results?: Json | null
          id?: string
          movement_type: string
          to_tier: string
          window_id?: string | null
        }
        Update: {
          agent_name?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          from_tier?: string
          gate_results?: Json | null
          id?: string
          movement_type?: string
          to_tier?: string
          window_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tier_movements_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: false
            referencedRelation: "evaluation_windows"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compute_monthly_snapshot: {
        Args: { p_window_id: string }
        Returns: undefined
      }
      get_active_lead_costs: {
        Args: { target_date?: string }
        Returns: {
          cost_per_lead: number
          lead_channel: string
          tier: string
        }[]
      }
      ingest_daily_scrape: { Args: { payload: Json }; Returns: Json }
      ingest_intraday_scrape: { Args: { payload: Json }; Returns: Json }
      ingest_leads_pool_data: { Args: { payload: Json }; Returns: Json }
      resolve_agent_name: { Args: { raw_name: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
