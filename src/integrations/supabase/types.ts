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
      calendar_events: {
        Row: {
          account_id: string | null
          color: string | null
          created_at: string
          description: string | null
          end_at: string
          external_id: string | null
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
          color?: string | null
          created_at?: string
          description?: string | null
          end_at: string
          external_id?: string | null
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
          color?: string | null
          created_at?: string
          description?: string | null
          end_at?: string
          external_id?: string | null
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
      emails: {
        Row: {
          account_id: string
          ai_category: string | null
          ai_priority: string | null
          ai_processed_at: string | null
          ai_summary: string | null
          body_html: string | null
          body_text: string | null
          created_at: string
          from_address: string | null
          from_name: string | null
          has_attachment: boolean
          id: string
          is_archived: boolean
          is_read: boolean
          is_starred: boolean
          labels: string[] | null
          message_id: string | null
          origin_tag: Database["public"]["Enums"]["email_origin"] | null
          received_at: string | null
          subject: string | null
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
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          from_address?: string | null
          from_name?: string | null
          has_attachment?: boolean
          id?: string
          is_archived?: boolean
          is_read?: boolean
          is_starred?: boolean
          labels?: string[] | null
          message_id?: string | null
          origin_tag?: Database["public"]["Enums"]["email_origin"] | null
          received_at?: string | null
          subject?: string | null
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
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          from_address?: string | null
          from_name?: string | null
          has_attachment?: boolean
          id?: string
          is_archived?: boolean
          is_read?: boolean
          is_starred?: boolean
          labels?: string[] | null
          message_id?: string | null
          origin_tag?: Database["public"]["Enums"]["email_origin"] | null
          received_at?: string | null
          subject?: string | null
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
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          theme: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          theme?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          theme?: string
          updated_at?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_type: "gmail" | "outlook" | "imap" | "icloud"
      calendar_source: "google" | "icloud" | "outlook"
      email_origin: "chu" | "univ" | "gmail" | "outlook" | "imap"
      sync_direction: "push" | "pull" | "bidirectional" | "disabled"
      sync_entity_type: "email" | "task" | "calendar" | "contact"
      sync_queue_action: "create" | "update" | "delete"
      sync_queue_status: "pending" | "synced" | "failed"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_source: "myhubpro" | "microsoft_todo" | "apple_reminders"
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
      calendar_source: ["google", "icloud", "outlook"],
      email_origin: ["chu", "univ", "gmail", "outlook", "imap"],
      sync_direction: ["push", "pull", "bidirectional", "disabled"],
      sync_entity_type: ["email", "task", "calendar", "contact"],
      sync_queue_action: ["create", "update", "delete"],
      sync_queue_status: ["pending", "synced", "failed"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_source: ["myhubpro", "microsoft_todo", "apple_reminders"],
      task_status: ["todo", "in_progress", "done", "archived"],
    },
  },
} as const
