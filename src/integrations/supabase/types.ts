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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          color: string | null
          created_at: string
          credentials: Json | null
          icon: string | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          name: string
          sync_direction: Database["public"]["Enums"]["sync_direction"]
          type: Database["public"]["Enums"]["account_type"]
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          credentials?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name: string
          sync_direction?: Database["public"]["Enums"]["sync_direction"]
          type: Database["public"]["Enums"]["account_type"]
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          credentials?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          name?: string
          sync_direction?: Database["public"]["Enums"]["sync_direction"]
          type?: Database["public"]["Enums"]["account_type"]
          user_id?: string
        }
        Relationships: []
      }
      ai_feedback: {
        Row: {
          corrected_category: string | null
          corrected_priority: string | null
          created_at: string
          email_id: string
          from_address: string | null
          id: string
          original_category: string | null
          original_priority: string | null
          subject: string | null
          user_id: string
        }
        Insert: {
          corrected_category?: string | null
          corrected_priority?: string | null
          created_at?: string
          email_id: string
          from_address?: string | null
          id?: string
          original_category?: string | null
          original_priority?: string | null
          subject?: string | null
          user_id: string
        }
        Update: {
          corrected_category?: string | null
          corrected_priority?: string | null
          created_at?: string
          email_id?: string
          from_address?: string | null
          id?: string
          original_category?: string | null
          original_priority?: string | null
          subject?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_prompts: {
        Row: {
          attachments: Json
          content: string
          created_at: string
          id: string
          is_active: boolean
          target: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attachments?: Json
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          target?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attachments?: Json
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          target?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          ip: string | null
          metadata: Json | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          account_id: string | null
          category: string
          color: string | null
          created_at: string
          description: string | null
          end_at: string
          external_id: string | null
          gcal_connection_id: string | null
          google_event_id: string | null
          id: string
          is_all_day: boolean
          location: string | null
          recurrence_rule: string | null
          source: Database["public"]["Enums"]["calendar_source"] | null
          start_at: string
          sync_direction: Database["public"]["Enums"]["sync_direction"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          category?: string
          color?: string | null
          created_at?: string
          description?: string | null
          end_at: string
          external_id?: string | null
          gcal_connection_id?: string | null
          google_event_id?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          recurrence_rule?: string | null
          source?: Database["public"]["Enums"]["calendar_source"] | null
          start_at: string
          sync_direction?: Database["public"]["Enums"]["sync_direction"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          category?: string
          color?: string | null
          created_at?: string
          description?: string | null
          end_at?: string
          external_id?: string | null
          gcal_connection_id?: string | null
          google_event_id?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          recurrence_rule?: string | null
          source?: Database["public"]["Enums"]["calendar_source"] | null
          start_at?: string
          sync_direction?: Database["public"]["Enums"]["sync_direction"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      collab_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          message_at: string
          metadata: Json
          sender_name: string | null
          space_id: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          message_at?: string
          metadata?: Json
          sender_name?: string | null
          space_id: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          message_at?: string
          metadata?: Json
          sender_name?: string | null
          space_id?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collab_messages_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "collab_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      collab_spaces: {
        Row: {
          archived_at: string | null
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          name: string
          type: string
          updated_at: string
          user_id: string
          whatsapp_group_id: string | null
          whatsapp_phone_number: string | null
        }
        Insert: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          type?: string
          updated_at?: string
          user_id: string
          whatsapp_group_id?: string | null
          whatsapp_phone_number?: string | null
        }
        Update: {
          archived_at?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          type?: string
          updated_at?: string
          user_id?: string
          whatsapp_group_id?: string | null
          whatsapp_phone_number?: string | null
        }
        Relationships: []
      }
      collab_wa_imports: {
        Row: {
          created_at: string
          error_message: string | null
          filename: string
          id: string
          imported_messages: number | null
          raw_content: string | null
          space_id: string
          status: string
          total_messages: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          filename: string
          id?: string
          imported_messages?: number | null
          raw_content?: string | null
          space_id: string
          status?: string
          total_messages?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          filename?: string
          id?: string
          imported_messages?: number | null
          raw_content?: string | null
          space_id?: string
          status?: string
          total_messages?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collab_wa_imports_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "collab_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string[] | null
          external_ids: Json | null
          first_name: string | null
          id: string
          last_name: string | null
          notes: string | null
          organization: string | null
          phone: string[] | null
          role: string | null
          sources: string[] | null
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string[] | null
          external_ids?: Json | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          organization?: string | null
          phone?: string[] | null
          role?: string | null
          sources?: string[] | null
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string[] | null
          external_ids?: Json | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          organization?: string | null
          phone?: string[] | null
          role?: string | null
          sources?: string[] | null
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      deleted_calendar_events: {
        Row: {
          deleted_at: string
          gcal_connection_id: string
          google_event_id: string
          id: string
          user_id: string
        }
        Insert: {
          deleted_at?: string
          gcal_connection_id: string
          google_event_id: string
          id?: string
          user_id: string
        }
        Update: {
          deleted_at?: string
          gcal_connection_id?: string
          google_event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      deleted_emails: {
        Row: {
          account_id: string
          deleted_at: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          account_id: string
          deleted_at?: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          account_id?: string
          deleted_at?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: []
      }
      document_retention_settings: {
        Row: {
          ai_min_size_kb: number
          created_at: string
          email_retention_days: number
          manual_retention_days: number
          max_file_size_mb: number
          meeting_retention_days: number
          task_retention_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_min_size_kb?: number
          created_at?: string
          email_retention_days?: number
          manual_retention_days?: number
          max_file_size_mb?: number
          meeting_retention_days?: number
          task_retention_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_min_size_kb?: number
          created_at?: string
          email_retention_days?: number
          manual_retention_days?: number
          max_file_size_mb?: number
          meeting_retention_days?: number
          task_retention_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          account_id: string | null
          ai_category: string | null
          ai_priority: string | null
          ai_processed_at: string | null
          ai_skipped_reason: string | null
          ai_summary: string | null
          checksum: string | null
          created_at: string
          description: string | null
          file_size: number
          filename: string
          id: string
          is_sensitive: boolean
          local_only: boolean
          mime_type: string | null
          onedrive_folder_path: string | null
          onedrive_item_id: string | null
          onedrive_web_url: string | null
          original_filename: string
          saved_at: string | null
          sensitive_reason: string | null
          sensitive_score: number | null
          source_id: string | null
          source_type: string
          storage_path: string | null
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          ai_category?: string | null
          ai_priority?: string | null
          ai_processed_at?: string | null
          ai_skipped_reason?: string | null
          ai_summary?: string | null
          checksum?: string | null
          created_at?: string
          description?: string | null
          file_size?: number
          filename: string
          id?: string
          is_sensitive?: boolean
          local_only?: boolean
          mime_type?: string | null
          onedrive_folder_path?: string | null
          onedrive_item_id?: string | null
          onedrive_web_url?: string | null
          original_filename: string
          saved_at?: string | null
          sensitive_reason?: string | null
          sensitive_score?: number | null
          source_id?: string | null
          source_type?: string
          storage_path?: string | null
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          ai_category?: string | null
          ai_priority?: string | null
          ai_processed_at?: string | null
          ai_skipped_reason?: string | null
          ai_summary?: string | null
          checksum?: string | null
          created_at?: string
          description?: string | null
          file_size?: number
          filename?: string
          id?: string
          is_sensitive?: boolean
          local_only?: boolean
          mime_type?: string | null
          onedrive_folder_path?: string | null
          onedrive_item_id?: string | null
          onedrive_web_url?: string | null
          original_filename?: string
          saved_at?: string | null
          sensitive_reason?: string | null
          sensitive_score?: number | null
          source_id?: string | null
          source_type?: string
          storage_path?: string | null
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_themes: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          email_count: number
          icon: string | null
          id: string
          keywords: string[]
          last_email_at: string | null
          name: string
          scope: string
          source: string
          updated_at: string
          user_id: string
          utility_level: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          email_count?: number
          icon?: string | null
          id?: string
          keywords?: string[]
          last_email_at?: string | null
          name: string
          scope?: string
          source?: string
          updated_at?: string
          user_id: string
          utility_level?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          email_count?: number
          icon?: string | null
          id?: string
          keywords?: string[]
          last_email_at?: string | null
          name?: string
          scope?: string
          source?: string
          updated_at?: string
          user_id?: string
          utility_level?: string
        }
        Relationships: []
      }
      emails: {
        Row: {
          account_id: string
          ai_category: string | null
          ai_priority: string | null
          ai_processed_at: string | null
          ai_summary: string | null
          ai_theme_id: string | null
          body_html: string | null
          body_text: string | null
          created_at: string
          deleted_at: string | null
          from_address: string | null
          from_name: string | null
          has_attachment: boolean
          id: string
          is_archived: boolean
          is_read: boolean
          is_sensitive: boolean
          is_starred: boolean
          labels: string[] | null
          meeting_link: string | null
          message_id: string | null
          origin_tag: Database["public"]["Enums"]["email_origin"] | null
          received_at: string | null
          sensitive_reason: string | null
          sensitive_score: number | null
          spam_label: string | null
          spam_reason: string | null
          spam_score: number | null
          subject: string | null
          theme_processed_at: string | null
          thread_id: string | null
          to_address: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          ai_category?: string | null
          ai_priority?: string | null
          ai_processed_at?: string | null
          ai_summary?: string | null
          ai_theme_id?: string | null
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          deleted_at?: string | null
          from_address?: string | null
          from_name?: string | null
          has_attachment?: boolean
          id?: string
          is_archived?: boolean
          is_read?: boolean
          is_sensitive?: boolean
          is_starred?: boolean
          labels?: string[] | null
          meeting_link?: string | null
          message_id?: string | null
          origin_tag?: Database["public"]["Enums"]["email_origin"] | null
          received_at?: string | null
          sensitive_reason?: string | null
          sensitive_score?: number | null
          spam_label?: string | null
          spam_reason?: string | null
          spam_score?: number | null
          subject?: string | null
          theme_processed_at?: string | null
          thread_id?: string | null
          to_address?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          ai_category?: string | null
          ai_priority?: string | null
          ai_processed_at?: string | null
          ai_summary?: string | null
          ai_theme_id?: string | null
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          deleted_at?: string | null
          from_address?: string | null
          from_name?: string | null
          has_attachment?: boolean
          id?: string
          is_archived?: boolean
          is_read?: boolean
          is_sensitive?: boolean
          is_starred?: boolean
          labels?: string[] | null
          meeting_link?: string | null
          message_id?: string | null
          origin_tag?: Database["public"]["Enums"]["email_origin"] | null
          received_at?: string | null
          sensitive_reason?: string | null
          sensitive_score?: number | null
          spam_label?: string | null
          spam_reason?: string | null
          spam_score?: number | null
          subject?: string | null
          theme_processed_at?: string | null
          thread_id?: string | null
          to_address?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_ai_theme_id_fkey"
            columns: ["ai_theme_id"]
            isOneToOne: false
            referencedRelation: "email_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      folder_routing_history: {
        Row: {
          ai_score: number | null
          ai_suggested: boolean
          created_at: string
          filename: string | null
          folder_id: string | null
          folder_path: string
          from_address: string | null
          id: string
          mime_type: string | null
          provider: string
          subject: string | null
          theme_id: string | null
          theme_name: string | null
          user_id: string
        }
        Insert: {
          ai_score?: number | null
          ai_suggested?: boolean
          created_at?: string
          filename?: string | null
          folder_id?: string | null
          folder_path: string
          from_address?: string | null
          id?: string
          mime_type?: string | null
          provider?: string
          subject?: string | null
          theme_id?: string | null
          theme_name?: string | null
          user_id: string
        }
        Update: {
          ai_score?: number | null
          ai_suggested?: boolean
          created_at?: string
          filename?: string | null
          folder_id?: string | null
          folder_path?: string
          from_address?: string | null
          id?: string
          mime_type?: string | null
          provider?: string
          subject?: string | null
          theme_id?: string | null
          theme_name?: string | null
          user_id?: string
        }
        Relationships: []
      }
      google_calendar_connections: {
        Row: {
          access_token: string
          calendar_id: string
          category: string
          color: string | null
          created_at: string
          expires_at: string
          google_email: string | null
          id: string
          is_active: boolean
          label: string
          last_sync_at: string | null
          refresh_token: string
          sync_direction: string
          sync_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_id?: string
          category?: string
          color?: string | null
          created_at?: string
          expires_at: string
          google_email?: string | null
          id?: string
          is_active?: boolean
          label: string
          last_sync_at?: string | null
          refresh_token: string
          sync_direction?: string
          sync_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_id?: string
          category?: string
          color?: string | null
          created_at?: string
          expires_at?: string
          google_email?: string | null
          id?: string
          is_active?: boolean
          label?: string
          last_sync_at?: string | null
          refresh_token?: string
          sync_direction?: string
          sync_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Relationships: []
      }
      meeting_agenda_items: {
        Row: {
          created_at: string
          duration_minutes: number
          id: string
          meeting_id: string
          position: number
          responsible_email: string | null
          responsible_name: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number
          id?: string
          meeting_id: string
          position?: number
          responsible_email?: string | null
          responsible_name?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          id?: string
          meeting_id?: string
          position?: number
          responsible_email?: string | null
          responsible_name?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_agenda_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_equipment_presets: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          label: string
          position: number
          user_id: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          label: string
          position?: number
          user_id: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          label?: string
          position?: number
          user_id?: string
        }
        Relationships: []
      }
      meeting_notes_history: {
        Row: {
          content: string
          created_at: string
          id: string
          meeting_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          meeting_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          meeting_id?: string
          user_id?: string
        }
        Relationships: []
      }
      meeting_participants: {
        Row: {
          contact_id: string | null
          created_at: string
          email: string
          id: string
          meeting_id: string
          name: string | null
          responded_at: string | null
          role: string
          rsvp_status: string
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          email: string
          id?: string
          meeting_id: string
          name?: string | null
          responded_at?: string | null
          role?: string
          rsvp_status?: string
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          email?: string
          id?: string
          meeting_id?: string
          name?: string | null
          responded_at?: string | null
          role?: string
          rsvp_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_poll_slots: {
        Row: {
          created_at: string
          end_at: string
          id: string
          is_online: boolean
          location: string | null
          online_provider: string | null
          poll_id: string
          position: number
          start_at: string
        }
        Insert: {
          created_at?: string
          end_at: string
          id?: string
          is_online?: boolean
          location?: string | null
          online_provider?: string | null
          poll_id: string
          position?: number
          start_at: string
        }
        Update: {
          created_at?: string
          end_at?: string
          id?: string
          is_online?: boolean
          location?: string | null
          online_provider?: string | null
          poll_id?: string
          position?: number
          start_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_poll_slots_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "meeting_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_poll_votes: {
        Row: {
          created_at: string
          id: string
          is_internal: boolean
          poll_id: string
          slot_id: string
          user_id: string | null
          vote: string
          voter_email: string
          voter_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_internal?: boolean
          poll_id: string
          slot_id: string
          user_id?: string | null
          vote?: string
          voter_email: string
          voter_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_internal?: boolean
          poll_id?: string
          slot_id?: string
          user_id?: string | null
          vote?: string
          voter_email?: string
          voter_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "meeting_polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_poll_votes_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "meeting_poll_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_polls: {
        Row: {
          created_at: string
          deadline: string | null
          description: string | null
          id: string
          meeting_id: string
          public_token: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          meeting_id: string
          public_token?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          description?: string | null
          id?: string
          meeting_id?: string
          public_token?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_polls_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_settings: {
        Row: {
          created_at: string
          default_duration_min: number
          default_provider: string
          email_template_confirm: string
          email_template_invite: string
          min_lead_hours: number
          onenote_auto_sync: boolean
          onenote_enabled: boolean
          onenote_notebook_id: string | null
          onenote_section_id: string | null
          rsvp_reminder_hours_before: number
          rsvp_reminders_enabled: boolean
          updated_at: string
          user_id: string
          work_days: number[]
          work_end_time: string
          work_start_time: string
        }
        Insert: {
          created_at?: string
          default_duration_min?: number
          default_provider?: string
          email_template_confirm?: string
          email_template_invite?: string
          min_lead_hours?: number
          onenote_auto_sync?: boolean
          onenote_enabled?: boolean
          onenote_notebook_id?: string | null
          onenote_section_id?: string | null
          rsvp_reminder_hours_before?: number
          rsvp_reminders_enabled?: boolean
          updated_at?: string
          user_id: string
          work_days?: number[]
          work_end_time?: string
          work_start_time?: string
        }
        Update: {
          created_at?: string
          default_duration_min?: number
          default_provider?: string
          email_template_confirm?: string
          email_template_invite?: string
          min_lead_hours?: number
          onenote_auto_sync?: boolean
          onenote_enabled?: boolean
          onenote_notebook_id?: string | null
          onenote_section_id?: string | null
          rsvp_reminder_hours_before?: number
          rsvp_reminders_enabled?: boolean
          updated_at?: string
          user_id?: string
          work_days?: number[]
          work_end_time?: string
          work_start_time?: string
        }
        Relationships: []
      }
      meeting_shared_files: {
        Row: {
          created_at: string
          document_id: string
          id: string
          meeting_id: string
          share_with_externals: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          meeting_id: string
          share_with_externals?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          meeting_id?: string
          share_with_externals?: boolean
          user_id?: string
        }
        Relationships: []
      }
      meeting_tasks: {
        Row: {
          created_at: string
          id: string
          meeting_id: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meeting_id: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meeting_id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          calendar_event_id: string | null
          confirmed_at: string | null
          confirmed_slot_id: string | null
          created_at: string
          decisions: string | null
          description: string | null
          end_at: string
          equipment: string[]
          id: string
          importance: string
          is_online: boolean
          location: string | null
          notes: string | null
          notes_updated_at: string | null
          onenote_page_id: string | null
          onenote_page_url: string | null
          onenote_synced_at: string | null
          online_link: string | null
          online_provider: string | null
          online_provider_default: string | null
          organizer_email: string | null
          organizer_name: string | null
          quorum_minimum: number | null
          recurrence_parent_id: string | null
          recurrence_rule: string | null
          room: string | null
          rsvp_reminder_hours_before: number
          rsvp_reminder_sent_at: string | null
          session_number: number | null
          source_email_id: string | null
          start_at: string
          status: string
          title: string
          updated_at: string
          user_id: string
          zoom_meeting_id: string | null
          zoom_password: string | null
        }
        Insert: {
          calendar_event_id?: string | null
          confirmed_at?: string | null
          confirmed_slot_id?: string | null
          created_at?: string
          decisions?: string | null
          description?: string | null
          end_at: string
          equipment?: string[]
          id?: string
          importance?: string
          is_online?: boolean
          location?: string | null
          notes?: string | null
          notes_updated_at?: string | null
          onenote_page_id?: string | null
          onenote_page_url?: string | null
          onenote_synced_at?: string | null
          online_link?: string | null
          online_provider?: string | null
          online_provider_default?: string | null
          organizer_email?: string | null
          organizer_name?: string | null
          quorum_minimum?: number | null
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          room?: string | null
          rsvp_reminder_hours_before?: number
          rsvp_reminder_sent_at?: string | null
          session_number?: number | null
          source_email_id?: string | null
          start_at: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
          zoom_meeting_id?: string | null
          zoom_password?: string | null
        }
        Update: {
          calendar_event_id?: string | null
          confirmed_at?: string | null
          confirmed_slot_id?: string | null
          created_at?: string
          decisions?: string | null
          description?: string | null
          end_at?: string
          equipment?: string[]
          id?: string
          importance?: string
          is_online?: boolean
          location?: string | null
          notes?: string | null
          notes_updated_at?: string | null
          onenote_page_id?: string | null
          onenote_page_url?: string | null
          onenote_synced_at?: string | null
          online_link?: string | null
          online_provider?: string | null
          online_provider_default?: string | null
          organizer_email?: string | null
          organizer_name?: string | null
          quorum_minimum?: number | null
          recurrence_parent_id?: string | null
          recurrence_rule?: string | null
          room?: string | null
          rsvp_reminder_hours_before?: number
          rsvp_reminder_sent_at?: string | null
          session_number?: number | null
          source_email_id?: string | null
          start_at?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          zoom_meeting_id?: string | null
          zoom_password?: string | null
        }
        Relationships: []
      }
      oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          label: string | null
          provider: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          label?: string | null
          provider: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          label?: string | null
          provider?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      op_plan_subthemes: {
        Row: {
          created_at: string
          id: string
          items: string[]
          name: string
          position: number
          show_in_plan: boolean
          theme_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: string[]
          name: string
          position?: number
          show_in_plan?: boolean
          theme_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: string[]
          name?: string
          position?: number
          show_in_plan?: boolean
          theme_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "op_plan_subthemes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "op_plan_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      op_plan_themes: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          show_in_plan: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position?: number
          show_in_plan?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          show_in_plan?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          first_name: string | null
          hds_notice_accepted_at: string | null
          id: string
          is_suspended: boolean
          last_name: string | null
          onboarding_completed_at: string | null
          quota_emails: number
          quota_storage_mb: number
          theme: string
          totp_enabled: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          hds_notice_accepted_at?: string | null
          id: string
          is_suspended?: boolean
          last_name?: string | null
          onboarding_completed_at?: string | null
          quota_emails?: number
          quota_storage_mb?: number
          theme?: string
          totp_enabled?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          first_name?: string | null
          hds_notice_accepted_at?: string | null
          id?: string
          is_suspended?: boolean
          last_name?: string | null
          onboarding_completed_at?: string | null
          quota_emails?: number
          quota_storage_mb?: number
          theme?: string
          totp_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      security_settings: {
        Row: {
          blacklist: string[]
          created_at: string
          sensitive_action: string
          sensitivity_level: string
          updated_at: string
          user_id: string
          whitelist: string[]
        }
        Insert: {
          blacklist?: string[]
          created_at?: string
          sensitive_action?: string
          sensitivity_level?: string
          updated_at?: string
          user_id: string
          whitelist?: string[]
        }
        Update: {
          blacklist?: string[]
          created_at?: string
          sensitive_action?: string
          sensitivity_level?: string
          updated_at?: string
          user_id?: string
          whitelist?: string[]
        }
        Relationships: []
      }
      sender_theme_map: {
        Row: {
          created_at: string
          from_address: string
          id: string
          theme_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_address: string
          id?: string
          theme_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          from_address?: string
          id?: string
          theme_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sender_theme_map_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "email_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_queue: {
        Row: {
          action: Database["public"]["Enums"]["sync_queue_action"]
          created_at: string
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["sync_entity_type"]
          id: string
          payload: Json | null
          status: Database["public"]["Enums"]["sync_queue_status"]
          user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["sync_queue_action"]
          created_at?: string
          entity_id?: string | null
          entity_type: Database["public"]["Enums"]["sync_entity_type"]
          id?: string
          payload?: Json | null
          status?: Database["public"]["Enums"]["sync_queue_status"]
          user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["sync_queue_action"]
          created_at?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["sync_entity_type"]
          id?: string
          payload?: Json | null
          status?: Database["public"]["Enums"]["sync_queue_status"]
          user_id?: string
        }
        Relationships: []
      }
      sync_settings: {
        Row: {
          created_at: string
          direction: Database["public"]["Enums"]["sync_direction"]
          entity_type: Database["public"]["Enums"]["sync_entity_type"]
          id: string
          last_sync_at: string | null
          source: string
          sync_frequency_minutes: number
          user_id: string
        }
        Insert: {
          created_at?: string
          direction?: Database["public"]["Enums"]["sync_direction"]
          entity_type: Database["public"]["Enums"]["sync_entity_type"]
          id?: string
          last_sync_at?: string | null
          source: string
          sync_frequency_minutes?: number
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: Database["public"]["Enums"]["sync_direction"]
          entity_type?: Database["public"]["Enums"]["sync_entity_type"]
          id?: string
          last_sync_at?: string | null
          source?: string
          sync_frequency_minutes?: number
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          attachments: Json
          calendar_event_id: string | null
          comments: string | null
          created_at: string
          description: string | null
          due_date: string | null
          gantt_color: string | null
          gantt_end: string | null
          gantt_start: string | null
          id: string
          kanban_column: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          reminder_at: string | null
          source_app: Database["public"]["Enums"]["task_source"]
          source_email_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          attachments?: Json
          calendar_event_id?: string | null
          comments?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          gantt_color?: string | null
          gantt_end?: string | null
          gantt_start?: string | null
          id?: string
          kanban_column?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          reminder_at?: string | null
          source_app?: Database["public"]["Enums"]["task_source"]
          source_email_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          attachments?: Json
          calendar_event_id?: string | null
          comments?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          gantt_color?: string | null
          gantt_end?: string | null
          gantt_start?: string | null
          id?: string
          kanban_column?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          reminder_at?: string | null
          source_app?: Database["public"]["Enums"]["task_source"]
          source_email_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_source_email_id_fkey"
            columns: ["source_email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_suggestions: {
        Row: {
          created_at: string
          created_event_id: string | null
          created_task_id: string | null
          description: string | null
          due_at: string | null
          id: string
          kind: string
          meeting_end_at: string | null
          meeting_start_at: string | null
          message_id: string | null
          payload: Json
          priority: string | null
          reviewed_at: string | null
          source_message_at: string | null
          source_sender: string | null
          source_text: string | null
          space_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
          wa_import_id: string | null
        }
        Insert: {
          created_at?: string
          created_event_id?: string | null
          created_task_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          kind: string
          meeting_end_at?: string | null
          meeting_start_at?: string | null
          message_id?: string | null
          payload?: Json
          priority?: string | null
          reviewed_at?: string | null
          source_message_at?: string | null
          source_sender?: string | null
          source_text?: string | null
          space_id: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
          wa_import_id?: string | null
        }
        Update: {
          created_at?: string
          created_event_id?: string | null
          created_task_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          kind?: string
          meeting_end_at?: string | null
          meeting_start_at?: string | null
          message_id?: string | null
          payload?: Json
          priority?: string | null
          reviewed_at?: string | null
          source_message_at?: string | null
          source_sender?: string | null
          source_text?: string | null
          space_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          wa_import_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_suggestions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "collab_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_suggestions_wa_import_id_fkey"
            columns: ["wa_import_id"]
            isOneToOne: false
            referencedRelation: "collab_wa_imports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      account_type: "gmail" | "outlook" | "imap" | "icloud"
      app_role: "admin" | "user"
      calendar_source: "google" | "icloud" | "outlook"
      email_origin: "chu" | "univ" | "gmail" | "outlook" | "imap"
      sync_direction: "push" | "pull" | "bidirectional" | "disabled"
      sync_entity_type: "email" | "task" | "calendar" | "contact"
      sync_queue_action: "create" | "update" | "delete"
      sync_queue_status: "pending" | "synced" | "failed"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_source:
        | "myhubpro"
        | "microsoft_todo"
        | "apple_reminders"
        | "whatsapp"
      task_status: "todo" | "in_progress" | "done" | "archived"
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
      account_type: ["gmail", "outlook", "imap", "icloud"],
      app_role: ["admin", "user"],
      calendar_source: ["google", "icloud", "outlook"],
      email_origin: ["chu", "univ", "gmail", "outlook", "imap"],
      sync_direction: ["push", "pull", "bidirectional", "disabled"],
      sync_entity_type: ["email", "task", "calendar", "contact"],
      sync_queue_action: ["create", "update", "delete"],
      sync_queue_status: ["pending", "synced", "failed"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_source: [
        "myhubpro",
        "microsoft_todo",
        "apple_reminders",
        "whatsapp",
      ],
      task_status: ["todo", "in_progress", "done", "archived"],
    },
  },
} as const
