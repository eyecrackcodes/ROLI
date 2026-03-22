export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agents: {
        Row: {
          created_at: string | null
          daily_lead_volume: number
          id: string
          is_active: boolean | null
          name: string
          site: string
          tier: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          daily_lead_volume?: number
          id?: string
          is_active?: boolean | null
          name: string
          site: string
          tier: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          daily_lead_volume?: number
          id?: string
          is_active?: boolean | null
          name?: string
          site?: string
          tier?: string
          updated_at?: string | null
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
