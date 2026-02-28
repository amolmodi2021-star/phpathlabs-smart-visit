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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      abnormal_history: {
        Row: {
          created_at: string
          id: string
          message: string
          mobile_number: string
          sent: boolean
          sent_at: string | null
          sent_context: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          mobile_number: string
          sent?: boolean
          sent_at?: string | null
          sent_context?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          mobile_number?: string
          sent?: boolean
          sent_at?: string | null
          sent_context?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      estimate_tests: {
        Row: {
          created_at: string
          discount_applicable: boolean
          discounted_price: number
          estimate_id: string
          fasting_required: boolean
          id: string
          individual_discount_type: string | null
          individual_discount_value: number | null
          price: number
          test_id: string
          test_name: string
        }
        Insert: {
          created_at?: string
          discount_applicable?: boolean
          discounted_price: number
          estimate_id: string
          fasting_required?: boolean
          id?: string
          individual_discount_type?: string | null
          individual_discount_value?: number | null
          price: number
          test_id: string
          test_name: string
        }
        Update: {
          created_at?: string
          discount_applicable?: boolean
          discounted_price?: number
          estimate_id?: string
          fasting_required?: boolean
          id?: string
          individual_discount_type?: string | null
          individual_discount_value?: number | null
          price?: number
          test_id?: string
          test_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_tests_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_tests_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          created_at: string
          discount_amount: number
          dob: string | null
          doctor_name: string | null
          email: string | null
          final_amount: number
          gender: string | null
          global_discount_type: string | null
          global_discount_value: number | null
          home_visit_charges: number
          id: string
          patient_name: string | null
          status: string
          title: string | null
          total_amount: number
          umr_number: string | null
          updated_at: string
          whatsapp_number: string
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          dob?: string | null
          doctor_name?: string | null
          email?: string | null
          final_amount?: number
          gender?: string | null
          global_discount_type?: string | null
          global_discount_value?: number | null
          home_visit_charges?: number
          id?: string
          patient_name?: string | null
          status?: string
          title?: string | null
          total_amount?: number
          umr_number?: string | null
          updated_at?: string
          whatsapp_number: string
        }
        Update: {
          created_at?: string
          discount_amount?: number
          dob?: string | null
          doctor_name?: string | null
          email?: string | null
          final_amount?: number
          gender?: string | null
          global_discount_type?: string | null
          global_discount_value?: number | null
          home_visit_charges?: number
          id?: string
          patient_name?: string | null
          status?: string
          title?: string | null
          total_amount?: number
          umr_number?: string | null
          updated_at?: string
          whatsapp_number?: string
        }
        Relationships: []
      }
      home_visits: {
        Row: {
          address: string
          cancellation_reason: string | null
          created_at: string
          delay_reason: string | null
          due_amount: number | null
          estimate_id: string
          id: string
          paid_amount: number | null
          payment_mode: string | null
          payment_remarks: string | null
          phlebotomist_id: string | null
          status: string
          updated_at: string
          visit_date: string
          visit_time: string
        }
        Insert: {
          address: string
          cancellation_reason?: string | null
          created_at?: string
          delay_reason?: string | null
          due_amount?: number | null
          estimate_id: string
          id?: string
          paid_amount?: number | null
          payment_mode?: string | null
          payment_remarks?: string | null
          phlebotomist_id?: string | null
          status?: string
          updated_at?: string
          visit_date: string
          visit_time: string
        }
        Update: {
          address?: string
          cancellation_reason?: string | null
          created_at?: string
          delay_reason?: string | null
          due_amount?: number | null
          estimate_id?: string
          id?: string
          paid_amount?: number | null
          payment_mode?: string | null
          payment_remarks?: string | null
          phlebotomist_id?: string | null
          status?: string
          updated_at?: string
          visit_date?: string
          visit_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "home_visits_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "home_visits_phlebotomist_id_fkey"
            columns: ["phlebotomist_id"]
            isOneToOne: false
            referencedRelation: "phlebotomists"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          created_at: string
          id: string
          template_key: string
          template_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          template_key: string
          template_value: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          template_key?: string
          template_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      phlebotomist_leaves: {
        Row: {
          created_at: string
          id: string
          leave_date: string
          phlebotomist_id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          leave_date: string
          phlebotomist_id: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          leave_date?: string
          phlebotomist_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phlebotomist_leaves_phlebotomist_id_fkey"
            columns: ["phlebotomist_id"]
            isOneToOne: false
            referencedRelation: "phlebotomists"
            referencedColumns: ["id"]
          },
        ]
      }
      phlebotomists: {
        Row: {
          alternate_mobile: string | null
          area_zone: string | null
          created_at: string
          id: string
          mobile: string
          name: string
          notes: string | null
          status: string
          updated_at: string
          weekly_off_days: number[] | null
        }
        Insert: {
          alternate_mobile?: string | null
          area_zone?: string | null
          created_at?: string
          id?: string
          mobile: string
          name: string
          notes?: string | null
          status?: string
          updated_at?: string
          weekly_off_days?: number[] | null
        }
        Update: {
          alternate_mobile?: string | null
          area_zone?: string | null
          created_at?: string
          id?: string
          mobile?: string
          name?: string
          notes?: string | null
          status?: string
          updated_at?: string
          weekly_off_days?: number[] | null
        }
        Relationships: []
      }
      tests: {
        Row: {
          created_at: string
          description: string | null
          discount_applicable: boolean
          fasting_required: boolean
          id: string
          incentive_allowed: boolean
          incentive_amount: number
          price: number
          test_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount_applicable?: boolean
          fasting_required?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          price?: number
          test_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          discount_applicable?: boolean
          fasting_required?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          price?: number
          test_name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_abnormal_history_counts: {
        Args: never
        Returns: {
          sent_records: number
          total_records: number
          unsent_records: number
        }[]
      }
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
