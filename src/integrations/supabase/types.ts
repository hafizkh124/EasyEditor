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
      activity_log: {
        Row: {
          created_at: string
          id: string
          label: string
          tokens_spent: number | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          tokens_spent?: number | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          tokens_spent?: number | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_payments: {
        Row: {
          amount_pkr: number
          created_at: string | null
          id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          payment_reference: string | null
          payment_type: string
          recorded_by: string
          tier_at_payment: string | null
          user_id: string
        }
        Insert: {
          amount_pkr: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_reference?: string | null
          payment_type: string
          recorded_by: string
          tier_at_payment?: string | null
          user_id: string
        }
        Update: {
          amount_pkr?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_reference?: string | null
          payment_type?: string
          recorded_by?: string
          tier_at_payment?: string | null
          user_id?: string
        }
        Relationships: []
      }
      api_response_cache: {
        Row: {
          cache_key: string
          created_at: string
          domain: string
          expires_at: string
          response: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          domain: string
          expires_at: string
          response: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          domain?: string
          expires_at?: string
          response?: Json
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      ingest_jobs: {
        Row: {
          dataset: string
          errors: number
          finished_at: string | null
          id: string
          notes: string | null
          processed: number
          started_at: string | null
          status: string
          total_rows: number | null
        }
        Insert: {
          dataset: string
          errors?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          processed?: number
          started_at?: string | null
          status?: string
          total_rows?: number | null
        }
        Update: {
          dataset?: string
          errors?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          processed?: number
          started_at?: string | null
          status?: string
          total_rows?: number | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          cloned_voice_id: string | null
          country: string | null
          created_at: string
          display_name: string | null
          id: string
          is_approved: boolean
          preferred_language: string
          profession: string | null
          referral_code: string | null
          referral_credits: number
          referred_by: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          rejection_status: string | null
          updated_at: string
          user_id: string
          whatsapp_number: string | null
        }
        Insert: {
          avatar_url?: string | null
          cloned_voice_id?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_approved?: boolean
          preferred_language?: string
          profession?: string | null
          referral_code?: string | null
          referral_credits?: number
          referred_by?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          rejection_status?: string | null
          updated_at?: string
          user_id: string
          whatsapp_number?: string | null
        }
        Update: {
          avatar_url?: string | null
          cloned_voice_id?: string | null
          country?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_approved?: boolean
          preferred_language?: string
          profession?: string | null
          referral_code?: string | null
          referral_credits?: number
          referred_by?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          rejection_status?: string | null
          updated_at?: string
          user_id?: string
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      referral_events: {
        Row: {
          credits_granted: number
          granted_at: string
          id: string
          referee_id: string
          referrer_id: string
        }
        Insert: {
          credits_granted: number
          granted_at?: string
          id?: string
          referee_id: string
          referrer_id: string
        }
        Update: {
          credits_granted?: number
          granted_at?: string
          id?: string
          referee_id?: string
          referrer_id?: string
        }
        Relationships: []
      }
      research_sessions: {
        Row: {
          citations: Json
          created_at: string
          id: string
          messages: Json
          mode: string
          selected_domains: string[]
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          citations?: Json
          created_at?: string
          id?: string
          messages?: Json
          mode?: string
          selected_domains?: string[]
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          citations?: Json
          created_at?: string
          id?: string
          messages?: Json
          mode?: string
          selected_domains?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      research_sources: {
        Row: {
          created_at: string
          id: string
          source_type: string
          storage_path: string | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_type: string
          storage_path?: string | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          source_type?: string
          storage_path?: string | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scholarly_documents: {
        Row: {
          citation_ref: Json
          content: string
          content_ar: string | null
          domain: string
          embedding: string | null
          id: string
          ingested_at: string
          language: string
          source_type: string
          source_url: string | null
          title: string | null
        }
        Insert: {
          citation_ref?: Json
          content: string
          content_ar?: string | null
          domain: string
          embedding?: string | null
          id?: string
          ingested_at?: string
          language?: string
          source_type: string
          source_url?: string | null
          title?: string | null
        }
        Update: {
          citation_ref?: Json
          content?: string
          content_ar?: string | null
          domain?: string
          embedding?: string | null
          id?: string
          ingested_at?: string
          language?: string
          source_type?: string
          source_url?: string | null
          title?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          activated_at: string | null
          billing_cycle_days: number
          created_at: string
          expires_at: string | null
          id: string
          islamic_queries_limit: number
          islamic_queries_used: number
          last_renewed_at: string | null
          last_upgrade_request: string | null
          ocr_pages_limit: number
          ocr_pages_used: number
          payment_reference: string | null
          pending_tier: string | null
          renewal_count: number
          research_queries_limit: number
          research_queries_used: number
          tier: Database["public"]["Enums"]["subscription_tier"]
          transcription_limit: number
          transcription_seconds_used: number
          tts_character_limit: number
          tts_characters_used: number
          updated_at: string
          upgrade_requested: boolean
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          billing_cycle_days?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          islamic_queries_limit?: number
          islamic_queries_used?: number
          last_renewed_at?: string | null
          last_upgrade_request?: string | null
          ocr_pages_limit?: number
          ocr_pages_used?: number
          payment_reference?: string | null
          pending_tier?: string | null
          renewal_count?: number
          research_queries_limit?: number
          research_queries_used?: number
          tier?: Database["public"]["Enums"]["subscription_tier"]
          transcription_limit?: number
          transcription_seconds_used?: number
          tts_character_limit?: number
          tts_characters_used?: number
          updated_at?: string
          upgrade_requested?: boolean
          user_id: string
        }
        Update: {
          activated_at?: string | null
          billing_cycle_days?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          islamic_queries_limit?: number
          islamic_queries_used?: number
          last_renewed_at?: string | null
          last_upgrade_request?: string | null
          ocr_pages_limit?: number
          ocr_pages_used?: number
          payment_reference?: string | null
          pending_tier?: string | null
          renewal_count?: number
          research_queries_limit?: number
          research_queries_used?: number
          tier?: Database["public"]["Enums"]["subscription_tier"]
          transcription_limit?: number
          transcription_seconds_used?: number
          tts_character_limit?: number
          tts_characters_used?: number
          updated_at?: string
          upgrade_requested?: boolean
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      token_transactions: {
        Row: {
          action_detail: string | null
          action_type: string
          amount: number
          balance_after: number
          created_at: string
          id: string
          source: string
          user_id: string
        }
        Insert: {
          action_detail?: string | null
          action_type: string
          amount: number
          balance_after: number
          created_at?: string
          id?: string
          source?: string
          user_id: string
        }
        Update: {
          action_detail?: string | null
          action_type?: string
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      token_wallets: {
        Row: {
          created_at: string
          monthly_balance: number
          monthly_limit: number
          topup_balance: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          monthly_balance?: number
          monthly_limit?: number
          topup_balance?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          monthly_balance?: number
          monthly_limit?: number
          topup_balance?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      topup_requests: {
        Row: {
          created_at: string
          id: string
          payment_reference: string | null
          pkr_amount: number
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          token_amount: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payment_reference?: string | null
          pkr_amount: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          token_amount: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payment_reference?: string | null
          pkr_amount?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          token_amount?: number
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          section: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          section: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          section?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_get_income_summary: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      admin_list_users: {
        Args: {
          p_country?: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_profession?: string
          p_search?: string
          p_status?: string
        }
        Returns: {
          activated_at: string
          billing_cycle_days: number
          country: string
          created_at: string
          display_name: string
          email: string
          expires_at: string
          is_approved: boolean
          last_renewed_at: string
          last_upgrade_request: string
          payment_reference: string
          pending_tier: string
          profession: string
          referral_code: string
          referral_credits: number
          referred_by: string
          rejected_at: string
          rejection_reason: string
          rejection_status: string
          renewal_count: number
          tier: string
          token_monthly_balance: number
          token_monthly_limit: number
          token_topup_balance: number
          total_count: number
          upgrade_requested: boolean
          user_id: string
          whatsapp_number: string
        }[]
      }
      check_token_balance: { Args: { p_user_id: string }; Returns: Json }
      credit_tokens: {
        Args: {
          p_action_type: string
          p_amount: number
          p_detail?: string
          p_source: string
          p_user_id: string
        }
        Returns: Json
      }
      deduct_tokens: {
        Args: {
          p_action_detail?: string
          p_action_type: string
          p_amount: number
          p_user_id: string
        }
        Returns: Json
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_islamic_queries: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      increment_research_queries: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      match_scholarly_documents: {
        Args: {
          filter_domains?: string[]
          filter_language?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          citation_ref: Json
          content: string
          domain: string
          id: string
          language: string
          similarity: number
          source_type: string
          source_url: string
          title: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_arabic_text: { Args: { t: string }; Returns: string }
      purge_expired_cache: { Args: never; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reset_monthly_quotas: { Args: never; Returns: number }
      reset_monthly_tokens: { Args: { p_bonus_rate?: number }; Returns: number }
      scholarly_documents_stats: {
        Args: never
        Returns: {
          domain: string
          embedded: number
          source_type: string
          total: number
        }[]
      }
      search_documents_smart: {
        Args: {
          p_match_limit?: number
          p_source_types?: string[]
          p_terms: string[]
        }
        Returns: {
          citation_ref: Json
          content: string
          content_ar: string
          domain: string
          id: string
          language: string
          match_score: number
          source_type: string
          source_url: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
      subscription_tier: "free" | "pro" | "basic" | "ultra"
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
    Enums: {
      app_role: ["admin", "user"],
      subscription_tier: ["free", "pro", "basic", "ultra"],
    },
  },
} as const
