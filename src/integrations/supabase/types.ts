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
      ai_tasks: {
        Row: {
          apply_mode: string
          archived_at: string | null
          base_task_slug: string | null
          chunkable: boolean
          created_at: string
          id: string
          label: string
          output_format: string
          produces_sources: boolean
          scope: string
          slug: string
          system_prompt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          apply_mode?: string
          archived_at?: string | null
          base_task_slug?: string | null
          chunkable?: boolean
          created_at?: string
          id?: string
          label: string
          output_format?: string
          produces_sources?: boolean
          scope?: string
          slug: string
          system_prompt: string
          updated_at?: string
          user_id: string
        }
        Update: {
          apply_mode?: string
          archived_at?: string | null
          base_task_slug?: string | null
          chunkable?: boolean
          created_at?: string
          id?: string
          label?: string
          output_format?: string
          produces_sources?: boolean
          scope?: string
          slug?: string
          system_prompt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      annotations: {
        Row: {
          anchor: Json
          color: string | null
          created_at: string
          document_id: string
          id: string
          note: string
          user_id: string
        }
        Insert: {
          anchor?: Json
          color?: string | null
          created_at?: string
          document_id: string
          id?: string
          note: string
          user_id: string
        }
        Update: {
          anchor?: Json
          color?: string | null
          created_at?: string
          document_id?: string
          id?: string
          note?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "annotations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
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
      book_chapters: {
        Row: {
          chapter_number: number
          created_at: string
          id: string
          project_id: string
          sort_order: number
          status: string
          synopsis: string | null
          title: string
        }
        Insert: {
          chapter_number?: number
          created_at?: string
          id?: string
          project_id: string
          sort_order?: number
          status?: string
          synopsis?: string | null
          title: string
        }
        Update: {
          chapter_number?: number
          created_at?: string
          id?: string
          project_id?: string
          sort_order?: number
          status?: string
          synopsis?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_chapters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "book_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      book_projects: {
        Row: {
          abstract: string | null
          created_at: string
          current_word_count: number | null
          genre: string
          id: string
          project_id: string | null
          status: string
          subtitle: string | null
          target_word_count: number | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          abstract?: string | null
          created_at?: string
          current_word_count?: number | null
          genre?: string
          id?: string
          project_id?: string | null
          status?: string
          subtitle?: string | null
          target_word_count?: number | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          abstract?: string | null
          created_at?: string
          current_word_count?: number | null
          genre?: string
          id?: string
          project_id?: string | null
          status?: string
          subtitle?: string | null
          target_word_count?: number | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      book_sections: {
        Row: {
          chapter_id: string
          content: string | null
          created_at: string
          document_id: string | null
          id: string
          section_number: number
          sort_order: number
          status: string
          synopsis: string | null
          title: string
          updated_at: string
        }
        Insert: {
          chapter_id: string
          content?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          section_number?: number
          sort_order?: number
          status?: string
          synopsis?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          chapter_id?: string
          content?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          section_number?: number
          sort_order?: number
          status?: string
          synopsis?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_sections_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "book_chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_sections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      citation_feedback: {
        Row: {
          action: string
          consent_training: boolean
          corrected: Json | null
          created_at: string
          id: string
          original: Json
          source_id: string | null
          user_id: string
          verify_status: string | null
        }
        Insert: {
          action: string
          consent_training?: boolean
          corrected?: Json | null
          created_at?: string
          id?: string
          original: Json
          source_id?: string | null
          user_id: string
          verify_status?: string | null
        }
        Update: {
          action?: string
          consent_training?: boolean
          corrected?: Json | null
          created_at?: string
          id?: string
          original?: Json
          source_id?: string | null
          user_id?: string
          verify_status?: string | null
        }
        Relationships: []
      }
      device_link_codes: {
        Row: {
          claimed_at: string | null
          code: string
          confirmed_at: string | null
          created_at: string
          expires_at: string
          id: string
          status: string
          user_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          code: string
          confirmed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          code?: string
          confirmed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      document_versions: {
        Row: {
          content_json: Json
          created_at: string
          document_id: string
          id: string
          label: string | null
          plain_text: string
        }
        Insert: {
          content_json?: Json
          created_at?: string
          document_id: string
          id?: string
          label?: string | null
          plain_text?: string
        }
        Update: {
          content_json?: Json
          created_at?: string
          document_id?: string
          id?: string
          label?: string | null
          plain_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          content_json: Json
          created_at: string
          doc_type: string
          id: string
          plain_text: string
          project_id: string
          sort_order: number
          status: string
          text_direction: string | null
          title: string
          updated_at: string
          user_id: string
          word_count: number
        }
        Insert: {
          content_json?: Json
          created_at?: string
          doc_type?: string
          id?: string
          plain_text?: string
          project_id: string
          sort_order?: number
          status?: string
          text_direction?: string | null
          title?: string
          updated_at?: string
          user_id: string
          word_count?: number
        }
        Update: {
          content_json?: Json
          created_at?: string
          doc_type?: string
          id?: string
          plain_text?: string
          project_id?: string
          sort_order?: number
          status?: string
          text_direction?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      entities: {
        Row: {
          aliases: string[] | null
          canonical_name: string
          created_at: string
          id: string
          kind: string
          summary: string | null
          user_id: string
        }
        Insert: {
          aliases?: string[] | null
          canonical_name: string
          created_at?: string
          id?: string
          kind: string
          summary?: string | null
          user_id: string
        }
        Update: {
          aliases?: string[] | null
          canonical_name?: string
          created_at?: string
          id?: string
          kind?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      entity_relations: {
        Row: {
          created_at: string
          document_id: string | null
          evidence_quote: string | null
          id: string
          library_item_id: string | null
          relation_type: string
          source_entity_id: string
          target_entity_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          evidence_quote?: string | null
          id?: string
          library_item_id?: string | null
          relation_type: string
          source_entity_id: string
          target_entity_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          evidence_quote?: string | null
          id?: string
          library_item_id?: string | null
          relation_type?: string
          source_entity_id?: string
          target_entity_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_relations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relations_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relations_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_relations_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
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
      library_chunks: {
        Row: {
          char_end: number | null
          char_start: number | null
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          id: string
          language: string
          library_item_id: string
          meta: Json
          user_id: string
        }
        Insert: {
          char_end?: number | null
          char_start?: number | null
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          language?: string
          library_item_id: string
          meta?: Json
          user_id: string
        }
        Update: {
          char_end?: number | null
          char_start?: number | null
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          language?: string
          library_item_id?: string
          meta?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_chunks_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "library_items"
            referencedColumns: ["id"]
          },
        ]
      }
      library_items: {
        Row: {
          created_at: string
          id: string
          kind: string
          meta: Json | null
          project_id: string | null
          source_ref: Json | null
          storage_path: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          meta?: Json | null
          project_id?: string | null
          source_ref?: Json | null
          storage_path?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          meta?: Json | null
          project_id?: string | null
          source_ref?: Json | null
          storage_path?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      passage_translations: {
        Row: {
          created_at: string
          id: string
          is_cached: boolean
          is_verified: boolean
          language: string
          passage_key: string
          source_url: string | null
          text: string
          translator_slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_cached?: boolean
          is_verified?: boolean
          language: string
          passage_key: string
          source_url?: string | null
          text: string
          translator_slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_cached?: boolean
          is_verified?: boolean
          language?: string
          passage_key?: string
          source_url?: string | null
          text?: string
          translator_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "passage_translations_translator_slug_fkey"
            columns: ["translator_slug"]
            isOneToOne: false
            referencedRelation: "translators"
            referencedColumns: ["slug"]
          },
        ]
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
      projects: {
        Row: {
          created_at: string
          genre: string | null
          id: string
          kind: string
          meta: Json | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          genre?: string | null
          id?: string
          kind?: string
          meta?: Json | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          genre?: string | null
          id?: string
          kind?: string
          meta?: Json | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recipes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_builtin: boolean
          steps: Json
          title: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_builtin?: boolean
          steps?: Json
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_builtin?: boolean
          steps?: Json
          title?: string
          user_id?: string | null
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
          project_id: string | null
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
          project_id?: string | null
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
          project_id?: string | null
          selected_domains?: string[]
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_sessions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
          passage_key: string | null
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
          passage_key?: string | null
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
          passage_key?: string | null
          source_type?: string
          source_url?: string | null
          title?: string | null
        }
        Relationships: []
      }
      search_history: {
        Row: {
          created_at: string
          filters: Json
          id: string
          kind: string
          query: string
          result_count: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          kind: string
          query: string
          result_count?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          kind?: string
          query?: string
          result_count?: number | null
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          activated_at: string | null
          ai_confidence_score: number | null
          ai_verification_details: Json | null
          ai_verification_status: string
          billing_cycle_days: number
          cancel_at_period_end: boolean
          created_at: string
          environment: string | null
          expires_at: string | null
          id: string
          islamic_queries_limit: number
          islamic_queries_used: number
          last_renewed_at: string | null
          last_upgrade_request: string | null
          ocr_pages_limit: number
          ocr_pages_used: number
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          payment_proof_url: string | null
          payment_reference: string | null
          payment_source: string
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
          ai_confidence_score?: number | null
          ai_verification_details?: Json | null
          ai_verification_status?: string
          billing_cycle_days?: number
          cancel_at_period_end?: boolean
          created_at?: string
          environment?: string | null
          expires_at?: string | null
          id?: string
          islamic_queries_limit?: number
          islamic_queries_used?: number
          last_renewed_at?: string | null
          last_upgrade_request?: string | null
          ocr_pages_limit?: number
          ocr_pages_used?: number
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          payment_source?: string
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
          ai_confidence_score?: number | null
          ai_verification_details?: Json | null
          ai_verification_status?: string
          billing_cycle_days?: number
          cancel_at_period_end?: boolean
          created_at?: string
          environment?: string | null
          expires_at?: string | null
          id?: string
          islamic_queries_limit?: number
          islamic_queries_used?: number
          last_renewed_at?: string | null
          last_upgrade_request?: string | null
          ocr_pages_limit?: number
          ocr_pages_used?: number
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          payment_proof_url?: string | null
          payment_reference?: string | null
          payment_source?: string
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
      task_runs: {
        Row: {
          confidence: number | null
          created_at: string
          document_id: string | null
          error: string | null
          id: string
          input: Json | null
          model: string | null
          output: Json | null
          progress: Json | null
          project_id: string | null
          sources: Json | null
          status: string
          task_slug: string
          tokens_spent: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          error?: string | null
          id?: string
          input?: Json | null
          model?: string | null
          output?: Json | null
          progress?: Json | null
          project_id?: string | null
          sources?: Json | null
          status?: string
          task_slug: string
          tokens_spent?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          error?: string | null
          id?: string
          input?: Json | null
          model?: string | null
          output?: Json | null
          progress?: Json | null
          project_id?: string | null
          sources?: Json | null
          status?: string
          task_slug?: string
          tokens_spent?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_runs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      translation_chunks: {
        Row: {
          chunk_index: number
          id: string
          notes: string | null
          passage_key: string | null
          project_id: string
          reviewed: number[]
          source_text: string
          status: string
          tm_match_score: number | null
          translated_text: string | null
          updated_at: string
        }
        Insert: {
          chunk_index?: number
          id?: string
          notes?: string | null
          passage_key?: string | null
          project_id: string
          reviewed?: number[]
          source_text: string
          status?: string
          tm_match_score?: number | null
          translated_text?: string | null
          updated_at?: string
        }
        Update: {
          chunk_index?: number
          id?: string
          notes?: string | null
          passage_key?: string | null
          project_id?: string
          reviewed?: number[]
          source_text?: string
          status?: string
          tm_match_score?: number | null
          translated_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "translation_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "translation_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      translation_projects: {
        Row: {
          created_at: string
          document_id: string | null
          genre: string
          glossary: Json
          id: string
          project_id: string | null
          source_lang: string
          source_ref: string | null
          status: string
          style: string
          target_lang: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          genre?: string
          glossary?: Json
          id?: string
          project_id?: string | null
          source_lang?: string
          source_ref?: string | null
          status?: string
          style?: string
          target_lang?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          genre?: string
          glossary?: Json
          id?: string
          project_id?: string | null
          source_lang?: string
          source_ref?: string | null
          status?: string
          style?: string
          target_lang?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "translation_projects_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "translation_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      translators: {
        Row: {
          authority_note: string | null
          corpus_type: string
          created_at: string
          external_edition_id: string | null
          full_name: string
          is_enabled: boolean
          language: string
          maslak: string | null
          slug: string
          sort_order: number
          source: string
        }
        Insert: {
          authority_note?: string | null
          corpus_type?: string
          created_at?: string
          external_edition_id?: string | null
          full_name: string
          is_enabled?: boolean
          language: string
          maslak?: string | null
          slug: string
          sort_order?: number
          source: string
        }
        Update: {
          authority_note?: string | null
          corpus_type?: string
          created_at?: string
          external_edition_id?: string | null
          full_name?: string
          is_enabled?: boolean
          language?: string
          maslak?: string | null
          slug?: string
          sort_order?: number
          source?: string
        }
        Relationships: []
      }
      user_provider_keys: {
        Row: {
          created_at: string
          encrypted_key: string
          id: string
          last_four: string
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          last_four: string
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          last_four?: string
          provider?: string
          updated_at?: string
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
          ai_confidence_score: number
          ai_verification_details: Json
          ai_verification_status: string
          billing_cycle_days: number
          country: string
          created_at: string
          display_name: string
          email: string
          expires_at: string
          is_approved: boolean
          last_renewed_at: string
          last_upgrade_request: string
          payment_proof_url: string
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
      backfill_passage_keys: { Args: { p_batch?: number }; Returns: number }
      check_token_balance: { Args: { p_user_id: string }; Returns: Json }
      count_term_occurrences: {
        Args: {
          p_collections?: string[]
          p_exclude_definite_article?: boolean
          p_patterns: string[]
          p_source_types?: string[]
          p_surah?: number
        }
        Returns: {
          bucket_key: string
          bucket_label: string
          occurrences: number
          rows_matched: number
          source_type: string
        }[]
      }
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
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      escape_arabic_regex: { Args: { t: string }; Returns: string }
      get_passage_translations: {
        Args: { p_passage_key: string; p_slugs?: string[] }
        Returns: {
          full_name: string
          is_verified: boolean
          language: string
          maslak: string
          passage_key: string
          source_url: string
          text: string
          translator_slug: string
        }[]
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
      match_library_chunks: {
        Args: {
          filter_item_ids?: string[]
          filter_user_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          id: string
          language: string
          library_item_id: string
          meta: Json
          similarity: number
        }[]
      }
      match_scholarly_documents: {
        Args: {
          filter_domains?: string[]
          filter_language?: string
          match_count: number
          match_threshold: number
          query_embedding: string
        }
        Returns: {
          citation_ref: Json
          content: string
          content_ar: string
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
      scholarly_documents_check_batch: {
        Args: { payload: Json }
        Returns: Json
      }
      scholarly_documents_delete_by_scope: {
        Args: { p_collections: string[]; p_domain: string }
        Returns: {
          id: string
          passage_key: string
          source_url: string
        }[]
      }
      scholarly_documents_lookup_by_citation: {
        Args: { payload: Json }
        Returns: {
          ar_fingerprint: string
          citation_ref: Json
          collection: string
          content_ar: string
          domain: string
          hadith_number: string
          id: string
          passage_key: string
          source_url: string
        }[]
      }
      scholarly_documents_stats: {
        Args: never
        Returns: {
          domain: string
          embedded: number
          source_type: string
          total: number
        }[]
      }
      scholarly_documents_update_citation: {
        Args: { payload: Json }
        Returns: {
          passage_key: string
          updated: boolean
        }[]
      }
      scholarly_documents_update_content: {
        Args: { payload: Json }
        Returns: {
          passage_key: string
          updated: boolean
        }[]
      }
      search_classical_scoped: {
        Args: {
          p_disciplines?: string[]
          p_limit?: number
          p_patterns: string[]
        }
        Returns: {
          citation_ref: Json
          content: string
          content_ar: string
          domain: string
          id: string
          language: string
          match_score: number
          passage_key: string
          source_type: string
          source_url: string
        }[]
      }
      search_documents_scoped: {
        Args: {
          p_collections?: string[]
          p_limit?: number
          p_patterns: string[]
          p_source_types?: string[]
          p_surah?: number
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
