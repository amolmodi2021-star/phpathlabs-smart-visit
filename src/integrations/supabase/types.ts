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
      abnormal_card_templates: {
        Row: {
          background_color: string | null
          bands: Json | null
          canvas_width: number | null
          created_at: string | null
          details_band_height: number | null
          footer_lines: Json | null
          header_band_height: number | null
          header_bg_color: string | null
          header_font_color: string | null
          id: string
          logo_height: number | null
          logo_url: string | null
          logo_width: number | null
          logo_x: number | null
          logo_y: number | null
          name: string
          placeholders: Json | null
          show_header_band: boolean | null
          table_config: Json | null
          updated_at: string | null
        }
        Insert: {
          background_color?: string | null
          bands?: Json | null
          canvas_width?: number | null
          created_at?: string | null
          details_band_height?: number | null
          footer_lines?: Json | null
          header_band_height?: number | null
          header_bg_color?: string | null
          header_font_color?: string | null
          id?: string
          logo_height?: number | null
          logo_url?: string | null
          logo_width?: number | null
          logo_x?: number | null
          logo_y?: number | null
          name: string
          placeholders?: Json | null
          show_header_band?: boolean | null
          table_config?: Json | null
          updated_at?: string | null
        }
        Update: {
          background_color?: string | null
          bands?: Json | null
          canvas_width?: number | null
          created_at?: string | null
          details_band_height?: number | null
          footer_lines?: Json | null
          header_band_height?: number | null
          header_bg_color?: string | null
          header_font_color?: string | null
          id?: string
          logo_height?: number | null
          logo_url?: string | null
          logo_width?: number | null
          logo_x?: number | null
          logo_y?: number | null
          name?: string
          placeholders?: Json | null
          show_header_band?: boolean | null
          table_config?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      app_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          permissions: Json
          role_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          permissions?: Json
          role_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          permissions?: Json
          role_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          setting_key: string
          setting_value: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          setting_key: string
          setting_value?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          setting_key?: string
          setting_value?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_user_login_history: {
        Row: {
          id: string
          ip_address: string | null
          login_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          id?: string
          ip_address?: string | null
          login_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          id?: string
          ip_address?: string | null
          login_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_user_login_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          can_approve_as_doctor: boolean
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean
          last_login_at: string | null
          password_hash: string
          role_id: string | null
          updated_at: string
          username: string
        }
        Insert: {
          can_approve_as_doctor?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          password_hash: string
          role_id?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          can_approve_as_doctor?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          password_hash?: string
          role_id?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "app_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      approved_reports: {
        Row: {
          address: string | null
          approval_date: string | null
          approved_by: string | null
          created_at: string
          dob: string | null
          doctor_name: string | null
          email: string | null
          gender: string | null
          id: string
          invoice_number: string | null
          is_held: boolean
          is_stat: boolean | null
          mobile_number: string | null
          outsourced_snip_urls: Json | null
          patient_name: string | null
          print_date: string | null
          registration_date: string | null
          registration_id: string
          report_language: string | null
          sample_collection_date: string | null
          test_date: string | null
          test_results: Json | null
          title: string | null
          umr_number: string | null
          visit_type: string | null
        }
        Insert: {
          address?: string | null
          approval_date?: string | null
          approved_by?: string | null
          created_at?: string
          dob?: string | null
          doctor_name?: string | null
          email?: string | null
          gender?: string | null
          id?: string
          invoice_number?: string | null
          is_held?: boolean
          is_stat?: boolean | null
          mobile_number?: string | null
          outsourced_snip_urls?: Json | null
          patient_name?: string | null
          print_date?: string | null
          registration_date?: string | null
          registration_id: string
          report_language?: string | null
          sample_collection_date?: string | null
          test_date?: string | null
          test_results?: Json | null
          title?: string | null
          umr_number?: string | null
          visit_type?: string | null
        }
        Update: {
          address?: string | null
          approval_date?: string | null
          approved_by?: string | null
          created_at?: string
          dob?: string | null
          doctor_name?: string | null
          email?: string | null
          gender?: string | null
          id?: string
          invoice_number?: string | null
          is_held?: boolean
          is_stat?: boolean | null
          mobile_number?: string | null
          outsourced_snip_urls?: Json | null
          patient_name?: string | null
          print_date?: string | null
          registration_date?: string | null
          registration_id?: string
          report_language?: string | null
          sample_collection_date?: string | null
          test_date?: string | null
          test_results?: Json | null
          title?: string | null
          umr_number?: string | null
          visit_type?: string | null
        }
        Relationships: []
      }
      billing_profile_tests: {
        Row: {
          created_at: string
          display_order: number
          id: string
          profile_id: string
          test_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          profile_id: string
          test_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          profile_id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_profile_tests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "billing_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_profile_tests_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_profiles: {
        Row: {
          bold_in_report: boolean
          created_at: string
          department_id: string | null
          description: string | null
          discount_applicable: boolean
          display_name: string | null
          fasting_required: boolean
          id: string
          incentive_allowed: boolean
          incentive_amount: number
          instrument_name: string | null
          interpretation: string | null
          is_active: boolean
          is_outsourced: boolean
          method: string | null
          price: number
          profile_code: string | null
          profile_name: string
          sample_type: string | null
          show_in_report: boolean
          updated_at: string
        }
        Insert: {
          bold_in_report?: boolean
          created_at?: string
          department_id?: string | null
          description?: string | null
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          instrument_name?: string | null
          interpretation?: string | null
          is_active?: boolean
          is_outsourced?: boolean
          method?: string | null
          price?: number
          profile_code?: string | null
          profile_name: string
          sample_type?: string | null
          show_in_report?: boolean
          updated_at?: string
        }
        Update: {
          bold_in_report?: boolean
          created_at?: string
          department_id?: string | null
          description?: string | null
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          instrument_name?: string | null
          interpretation?: string | null
          is_active?: boolean
          is_outsourced?: boolean
          method?: string | null
          price?: number
          profile_code?: string | null
          profile_name?: string
          sample_type?: string | null
          show_in_report?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "report_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_prices: {
        Row: {
          channel_id: string
          created_at: string
          custom_price: number
          id: string
          test_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          custom_price?: number
          id?: string
          test_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          custom_price?: number
          id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_prices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_prices_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          address: string | null
          billing_cycle: string
          billing_type: string
          contact_person: string | null
          created_at: string
          default_discount_pct: number
          id: string
          name: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          billing_cycle?: string
          billing_type?: string
          contact_person?: string | null
          created_at?: string
          default_discount_pct?: number
          id?: string
          name: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          billing_cycle?: string
          billing_type?: string
          contact_person?: string | null
          created_at?: string
          default_discount_pct?: number
          id?: string
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      cloudinary_accounts: {
        Row: {
          account_name: string
          api_key: string | null
          api_secret: string | null
          cloud_name: string
          created_at: string
          id: string
          is_active: boolean
          updated_at: string
          upload_preset: string
        }
        Insert: {
          account_name: string
          api_key?: string | null
          api_secret?: string | null
          cloud_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          upload_preset: string
        }
        Update: {
          account_name?: string
          api_key?: string | null
          api_secret?: string | null
          cloud_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          upload_preset?: string
        }
        Relationships: []
      }
      combo_profiles: {
        Row: {
          combo_id: string
          created_at: string
          display_order: number
          id: string
          profile_id: string
        }
        Insert: {
          combo_id: string
          created_at?: string
          display_order?: number
          id?: string
          profile_id: string
        }
        Update: {
          combo_id?: string
          created_at?: string
          display_order?: number
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_profiles_combo_id_fkey"
            columns: ["combo_id"]
            isOneToOne: false
            referencedRelation: "combos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "billing_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_tests: {
        Row: {
          combo_id: string
          created_at: string
          display_order: number
          id: string
          test_id: string
        }
        Insert: {
          combo_id: string
          created_at?: string
          display_order?: number
          id?: string
          test_id: string
        }
        Update: {
          combo_id?: string
          created_at?: string
          display_order?: number
          id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_tests_combo_id_fkey"
            columns: ["combo_id"]
            isOneToOne: false
            referencedRelation: "combos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_tests_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      combos: {
        Row: {
          bold_in_report: boolean
          combo_code: string | null
          combo_name: string
          created_at: string
          discount_applicable: boolean
          display_name: string | null
          fasting_required: boolean
          id: string
          incentive_allowed: boolean
          incentive_amount: number
          is_active: boolean
          price: number
          show_in_report: boolean
          updated_at: string
        }
        Insert: {
          bold_in_report?: boolean
          combo_code?: string | null
          combo_name: string
          created_at?: string
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          is_active?: boolean
          price?: number
          show_in_report?: boolean
          updated_at?: string
        }
        Update: {
          bold_in_report?: boolean
          combo_code?: string | null
          combo_name?: string
          created_at?: string
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          is_active?: boolean
          price?: number
          show_in_report?: boolean
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
          item_type: string
          price: number
          report_date: string | null
          report_time: string | null
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
          item_type?: string
          price: number
          report_date?: string | null
          report_time?: string | null
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
          item_type?: string
          price?: number
          report_date?: string | null
          report_time?: string | null
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
      health_checkup_profiles: {
        Row: {
          created_at: string
          display_order: number
          health_checkup_id: string
          id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          health_checkup_id: string
          id?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          health_checkup_id?: string
          id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_checkup_profiles_health_checkup_id_fkey"
            columns: ["health_checkup_id"]
            isOneToOne: false
            referencedRelation: "health_checkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_checkup_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "billing_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_checkup_tests: {
        Row: {
          created_at: string
          display_order: number
          health_checkup_id: string
          id: string
          test_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          health_checkup_id: string
          id?: string
          test_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          health_checkup_id?: string
          id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_checkup_tests_health_checkup_id_fkey"
            columns: ["health_checkup_id"]
            isOneToOne: false
            referencedRelation: "health_checkups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_checkup_tests_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      health_checkups: {
        Row: {
          bold_in_report: boolean
          created_at: string
          discount_applicable: boolean
          display_name: string | null
          fasting_required: boolean
          health_checkup_code: string | null
          health_checkup_name: string
          id: string
          incentive_allowed: boolean
          incentive_amount: number
          is_active: boolean
          price: number
          show_in_report: boolean
          updated_at: string
        }
        Insert: {
          bold_in_report?: boolean
          created_at?: string
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          health_checkup_code?: string | null
          health_checkup_name: string
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          is_active?: boolean
          price?: number
          show_in_report?: boolean
          updated_at?: string
        }
        Update: {
          bold_in_report?: boolean
          created_at?: string
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          health_checkup_code?: string | null
          health_checkup_name?: string
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          is_active?: boolean
          price?: number
          show_in_report?: boolean
          updated_at?: string
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
      invoice_counter: {
        Row: {
          date_key: string
          last_sequence: number
        }
        Insert: {
          date_key: string
          last_sequence?: number
        }
        Update: {
          date_key?: string
          last_sequence?: number
        }
        Relationships: []
      }
      lims_code_mapping: {
        Row: {
          created_at: string | null
          id: string
          machine_code: string
          machine_id: string | null
          mapped_param_code: string | null
          mapped_test_code: string | null
          parameter_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          machine_code: string
          machine_id?: string | null
          mapped_param_code?: string | null
          mapped_test_code?: string | null
          parameter_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          machine_code?: string
          machine_id?: string | null
          mapped_param_code?: string | null
          mapped_test_code?: string | null
          parameter_name?: string | null
        }
        Relationships: []
      }
      lims_interface_logs: {
        Row: {
          created_at: string
          direction: string
          event_type: string
          id: string
          machine_id: string | null
          request_body: Json | null
          response_body: Json | null
          sample_id: string | null
        }
        Insert: {
          created_at?: string
          direction?: string
          event_type: string
          id?: string
          machine_id?: string | null
          request_body?: Json | null
          response_body?: Json | null
          sample_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          event_type?: string
          id?: string
          machine_id?: string | null
          request_body?: Json | null
          response_body?: Json | null
          sample_id?: string | null
        }
        Relationships: []
      }
      lims_no_map_required: {
        Row: {
          created_at: string
          id: string
          machine_code: string
          machine_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          machine_code: string
          machine_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          machine_code?: string
          machine_id?: string | null
        }
        Relationships: []
      }
      lims_test_orders: {
        Row: {
          created_at: string
          id: string
          patient_name: string | null
          sample_id: string
          status: string
          tests: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          patient_name?: string | null
          sample_id: string
          status?: string
          tests?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          patient_name?: string | null
          sample_id?: string
          status?: string
          tests?: Json
          updated_at?: string
        }
        Relationships: []
      }
      lims_unmapped_results: {
        Row: {
          flag: string | null
          id: string
          is_resolved: boolean | null
          machine_code: string
          machine_id: string | null
          order_id: string | null
          received_at: string | null
          reference_range: string | null
          result_value: string | null
          sample_id: string
          unit: string | null
        }
        Insert: {
          flag?: string | null
          id?: string
          is_resolved?: boolean | null
          machine_code: string
          machine_id?: string | null
          order_id?: string | null
          received_at?: string | null
          reference_range?: string | null
          result_value?: string | null
          sample_id: string
          unit?: string | null
        }
        Update: {
          flag?: string | null
          id?: string
          is_resolved?: boolean | null
          machine_code?: string
          machine_id?: string | null
          order_id?: string | null
          received_at?: string | null
          reference_range?: string | null
          result_value?: string | null
          sample_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lims_unmapped_results_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "lims_test_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_card_templates: {
        Row: {
          background_image_url: string | null
          created_at: string
          id: string
          name: string
          placeholders: Json
          updated_at: string
        }
        Insert: {
          background_image_url?: string | null
          created_at?: string
          id?: string
          name: string
          placeholders?: Json
          updated_at?: string
        }
        Update: {
          background_image_url?: string | null
          created_at?: string
          id?: string
          name?: string
          placeholders?: Json
          updated_at?: string
        }
        Relationships: []
      }
      marketing_templates: {
        Row: {
          api_base_url: string | null
          api_key: string | null
          auth_header_name: string | null
          auth_header_prefix: string | null
          body_mapping: string | null
          created_at: string
          from_number: string | null
          id: string
          template_name: string
          updated_at: string
          variables: Json
          whatsapp_template_name: string
        }
        Insert: {
          api_base_url?: string | null
          api_key?: string | null
          auth_header_name?: string | null
          auth_header_prefix?: string | null
          body_mapping?: string | null
          created_at?: string
          from_number?: string | null
          id?: string
          template_name: string
          updated_at?: string
          variables?: Json
          whatsapp_template_name: string
        }
        Update: {
          api_base_url?: string | null
          api_key?: string | null
          auth_header_name?: string | null
          auth_header_prefix?: string | null
          body_mapping?: string | null
          created_at?: string
          from_number?: string | null
          id?: string
          template_name?: string
          updated_at?: string
          variables?: Json
          whatsapp_template_name?: string
        }
        Relationships: []
      }
      master_lookup: {
        Row: {
          category: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          mapped_value: string | null
          mapped_value_2: string | null
          value: string
        }
        Insert: {
          category: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          mapped_value?: string | null
          mapped_value_2?: string | null
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          mapped_value?: string | null
          mapped_value_2?: string | null
          value?: string
        }
        Relationships: []
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
      outsourced_test_snips: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          outsource_status: string
          outsourced_lab_name: string | null
          outsourced_parameter_ids: Json | null
          registration_id: string
          result_mode: string
          sent_at: string | null
          snip_image_url: string | null
          snip_image_urls: Json | null
          test_id: string
          top_margin_pct: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          outsource_status?: string
          outsourced_lab_name?: string | null
          outsourced_parameter_ids?: Json | null
          registration_id: string
          result_mode?: string
          sent_at?: string | null
          snip_image_url?: string | null
          snip_image_urls?: Json | null
          test_id: string
          top_margin_pct?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          outsource_status?: string
          outsourced_lab_name?: string | null
          outsourced_parameter_ids?: Json | null
          registration_id?: string
          result_mode?: string
          sent_at?: string | null
          snip_image_url?: string | null
          snip_image_urls?: Json | null
          test_id?: string
          top_margin_pct?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      parameter_normal_ranges: {
        Row: {
          age_max: number | null
          age_min: number | null
          created_at: string
          descriptive_options: Json | null
          expected_value: string | null
          gender: string
          id: string
          normal_range_high: number | null
          normal_range_low: number | null
          normal_range_text: string | null
          parameter_id: string
          range_type: string
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          created_at?: string
          descriptive_options?: Json | null
          expected_value?: string | null
          gender?: string
          id?: string
          normal_range_high?: number | null
          normal_range_low?: number | null
          normal_range_text?: string | null
          parameter_id: string
          range_type?: string
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          created_at?: string
          descriptive_options?: Json | null
          expected_value?: string | null
          gender?: string
          id?: string
          normal_range_high?: number | null
          normal_range_low?: number | null
          normal_range_text?: string | null
          parameter_id?: string
          range_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "parameter_normal_ranges_parameter_id_fkey"
            columns: ["parameter_id"]
            isOneToOne: false
            referencedRelation: "report_test_parameters"
            referencedColumns: ["id"]
          },
        ]
      }
      pathologist_signatures: {
        Row: {
          created_at: string | null
          designation: string | null
          id: string
          mapped_user_id: string | null
          pathologist_name: string
          qualification: string | null
          signature_image_path: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          designation?: string | null
          id?: string
          mapped_user_id?: string | null
          pathologist_name: string
          qualification?: string | null
          signature_image_path?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          designation?: string | null
          id?: string
          mapped_user_id?: string | null
          pathologist_name?: string
          qualification?: string | null
          signature_image_path?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      patient_master: {
        Row: {
          address: string | null
          age: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          first_visit_date: string | null
          gender: string | null
          id: string
          last_visit_date: string | null
          legacy_imported_at: string | null
          mobile_number: string | null
          patient_name: string
          source: string
          title: string | null
          umr_id: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          age?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_visit_date?: string | null
          gender?: string | null
          id?: string
          last_visit_date?: string | null
          legacy_imported_at?: string | null
          mobile_number?: string | null
          patient_name: string
          source?: string
          title?: string | null
          umr_id: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          age?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_visit_date?: string | null
          gender?: string | null
          id?: string
          last_visit_date?: string | null
          legacy_imported_at?: string | null
          mobile_number?: string | null
          patient_name?: string
          source?: string
          title?: string | null
          umr_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      patient_registrations: {
        Row: {
          accepted_samples: Json
          address: string | null
          bill_cancelled: boolean
          cancelled_tests: Json
          channel_id: string | null
          collected_samples: Json
          created_at: string
          discount_amount: number
          dob: string | null
          doctor_name: string | null
          due_amount: number
          email: string | null
          final_amount: number
          gender: string | null
          global_discount_type: string | null
          global_discount_value: number | null
          gross_amount: number
          home_visit_charges: number
          home_visit_id: string | null
          id: string
          invoice_number: string
          is_bad_debt: boolean
          is_stat: boolean
          mobile_number: string
          net_amount: number
          paid_amount: number
          patient_name: string
          payments: Json
          pickup_point_id: string | null
          refund_amount: number
          refund_date: string | null
          refund_mode: string | null
          registered_by: string | null
          remarks: string | null
          report_language: string | null
          status: string
          tests: Json
          title: string | null
          umr_number: string | null
          updated_at: string
          visit_type: string
        }
        Insert: {
          accepted_samples?: Json
          address?: string | null
          bill_cancelled?: boolean
          cancelled_tests?: Json
          channel_id?: string | null
          collected_samples?: Json
          created_at?: string
          discount_amount?: number
          dob?: string | null
          doctor_name?: string | null
          due_amount?: number
          email?: string | null
          final_amount?: number
          gender?: string | null
          global_discount_type?: string | null
          global_discount_value?: number | null
          gross_amount?: number
          home_visit_charges?: number
          home_visit_id?: string | null
          id?: string
          invoice_number: string
          is_bad_debt?: boolean
          is_stat?: boolean
          mobile_number: string
          net_amount?: number
          paid_amount?: number
          patient_name: string
          payments?: Json
          pickup_point_id?: string | null
          refund_amount?: number
          refund_date?: string | null
          refund_mode?: string | null
          registered_by?: string | null
          remarks?: string | null
          report_language?: string | null
          status?: string
          tests?: Json
          title?: string | null
          umr_number?: string | null
          updated_at?: string
          visit_type?: string
        }
        Update: {
          accepted_samples?: Json
          address?: string | null
          bill_cancelled?: boolean
          cancelled_tests?: Json
          channel_id?: string | null
          collected_samples?: Json
          created_at?: string
          discount_amount?: number
          dob?: string | null
          doctor_name?: string | null
          due_amount?: number
          email?: string | null
          final_amount?: number
          gender?: string | null
          global_discount_type?: string | null
          global_discount_value?: number | null
          gross_amount?: number
          home_visit_charges?: number
          home_visit_id?: string | null
          id?: string
          invoice_number?: string
          is_bad_debt?: boolean
          is_stat?: boolean
          mobile_number?: string
          net_amount?: number
          paid_amount?: number
          patient_name?: string
          payments?: Json
          pickup_point_id?: string | null
          refund_amount?: number
          refund_date?: string | null
          refund_mode?: string | null
          registered_by?: string | null
          remarks?: string | null
          report_language?: string | null
          status?: string
          tests?: Json
          title?: string | null
          umr_number?: string | null
          updated_at?: string
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_registrations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_registrations_home_visit_id_fkey"
            columns: ["home_visit_id"]
            isOneToOne: false
            referencedRelation: "home_visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_registrations_pickup_point_id_fkey"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_results: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          dispatched_at: string | null
          dispatched_by: string | null
          entered_at: string | null
          entered_by: string | null
          flag: string | null
          id: string
          is_calculated: boolean
          is_from_interface: boolean
          normal_range_high: number | null
          normal_range_low: number | null
          note: string | null
          param_code: string | null
          parameter_id: string
          parameter_name: string | null
          reference_range: string | null
          registration_id: string
          result_value: string | null
          status: string
          test_id: string
          test_note: string | null
          unit: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          dispatched_at?: string | null
          dispatched_by?: string | null
          entered_at?: string | null
          entered_by?: string | null
          flag?: string | null
          id?: string
          is_calculated?: boolean
          is_from_interface?: boolean
          normal_range_high?: number | null
          normal_range_low?: number | null
          note?: string | null
          param_code?: string | null
          parameter_id: string
          parameter_name?: string | null
          reference_range?: string | null
          registration_id: string
          result_value?: string | null
          status?: string
          test_id: string
          test_note?: string | null
          unit?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          dispatched_at?: string | null
          dispatched_by?: string | null
          entered_at?: string | null
          entered_by?: string | null
          flag?: string | null
          id?: string
          is_calculated?: boolean
          is_from_interface?: boolean
          normal_range_high?: number | null
          normal_range_low?: number | null
          note?: string | null
          param_code?: string | null
          parameter_id?: string
          parameter_name?: string | null
          reference_range?: string | null
          registration_id?: string
          result_value?: string | null
          status?: string
          test_id?: string
          test_note?: string | null
          unit?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          cash_amount: number | null
          created_at: string
          credit_card_amount: number | null
          direction: string
          discount_amount: number | null
          due_amount: number | null
          final_amount: number | null
          gpay_amount: number | null
          gross_amount: number | null
          id: string
          invoice_number: string
          neft_amount: number | null
          paid_amount: number | null
          patient_name: string | null
          paytm_amount: number | null
          performed_by: string | null
          refund_amount: number | null
          registration_id: string
          remarks: string | null
          total_amount: number | null
          transaction_date: string
          transaction_type: string
        }
        Insert: {
          cash_amount?: number | null
          created_at?: string
          credit_card_amount?: number | null
          direction?: string
          discount_amount?: number | null
          due_amount?: number | null
          final_amount?: number | null
          gpay_amount?: number | null
          gross_amount?: number | null
          id?: string
          invoice_number: string
          neft_amount?: number | null
          paid_amount?: number | null
          patient_name?: string | null
          paytm_amount?: number | null
          performed_by?: string | null
          refund_amount?: number | null
          registration_id: string
          remarks?: string | null
          total_amount?: number | null
          transaction_date?: string
          transaction_type: string
        }
        Update: {
          cash_amount?: number | null
          created_at?: string
          credit_card_amount?: number | null
          direction?: string
          discount_amount?: number | null
          due_amount?: number | null
          final_amount?: number | null
          gpay_amount?: number | null
          gross_amount?: number | null
          id?: string
          invoice_number?: string
          neft_amount?: number | null
          paid_amount?: number | null
          patient_name?: string | null
          paytm_amount?: number | null
          performed_by?: string | null
          refund_amount?: number | null
          registration_id?: string
          remarks?: string | null
          total_amount?: number | null
          transaction_date?: string
          transaction_type?: string
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
      pickup_point_invoice_items: {
        Row: {
          created_at: string
          display_order: number
          id: string
          invoice_id: string
          net_amount: number
          patient_name: string | null
          registration_date: string | null
          registration_id: string | null
          registration_invoice: string | null
          test_names: string | null
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          invoice_id: string
          net_amount?: number
          patient_name?: string | null
          registration_date?: string | null
          registration_id?: string | null
          registration_invoice?: string | null
          test_names?: string | null
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          invoice_id?: string
          net_amount?: number
          patient_name?: string | null
          registration_date?: string | null
          registration_id?: string | null
          registration_invoice?: string | null
          test_names?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_point_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "pickup_point_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_point_invoice_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          payment_date: string
          payment_mode: string
          recorded_by: string | null
          reference_no: string | null
          remarks: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id: string
          payment_date?: string
          payment_mode: string
          recorded_by?: string | null
          reference_no?: string | null
          remarks?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          payment_date?: string
          payment_mode?: string
          recorded_by?: string | null
          reference_no?: string | null
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_point_invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "pickup_point_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_point_invoices: {
        Row: {
          created_at: string
          due_amount: number
          id: string
          invoice_month: number
          invoice_number: string | null
          invoice_year: number
          last_reminder_sent_at: string | null
          no_reminder: boolean
          notes: string | null
          paid_amount: number
          patient_count: number
          period_from: string
          period_to: string
          pickup_point_id: string
          reminder_days: number | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          due_amount?: number
          id?: string
          invoice_month: number
          invoice_number?: string | null
          invoice_year: number
          last_reminder_sent_at?: string | null
          no_reminder?: boolean
          notes?: string | null
          paid_amount?: number
          patient_count?: number
          period_from: string
          period_to: string
          pickup_point_id: string
          reminder_days?: number | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          due_amount?: number
          id?: string
          invoice_month?: number
          invoice_number?: string | null
          invoice_year?: number
          last_reminder_sent_at?: string | null
          no_reminder?: boolean
          notes?: string | null
          paid_amount?: number
          patient_count?: number
          period_from?: string
          period_to?: string
          pickup_point_id?: string
          reminder_days?: number | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      pickup_point_prices: {
        Row: {
          created_at: string
          custom_price: number
          id: string
          pickup_point_id: string
          test_id: string
        }
        Insert: {
          created_at?: string
          custom_price?: number
          id?: string
          pickup_point_id: string
          test_id: string
        }
        Update: {
          created_at?: string
          custom_price?: number
          id?: string
          pickup_point_id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_point_prices_pickup_point_id_fkey"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_point_prices_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_points: {
        Row: {
          address: string | null
          allow_all_tests: boolean
          billing_cycle: string
          billing_type: string
          contact_person: string | null
          created_at: string
          default_discount_pct: number
          id: string
          name: string
          phone: string | null
          report_footer_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          allow_all_tests?: boolean
          billing_cycle?: string
          billing_type?: string
          contact_person?: string | null
          created_at?: string
          default_discount_pct?: number
          id?: string
          name: string
          phone?: string | null
          report_footer_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          allow_all_tests?: boolean
          billing_cycle?: string
          billing_type?: string
          contact_person?: string | null
          created_at?: string
          default_discount_pct?: number
          id?: string
          name?: string
          phone?: string | null
          report_footer_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      profile_parameters: {
        Row: {
          created_at: string
          display_order: number
          id: string
          parameter_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          parameter_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          parameter_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_parameters_parameter_id_fkey"
            columns: ["parameter_id"]
            isOneToOne: false
            referencedRelation: "report_test_parameters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_parameters_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "report_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_departments: {
        Row: {
          created_at: string | null
          department_name: string
          display_order: number | null
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department_name: string
          display_order?: number | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department_name?: string
          display_order?: number | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      report_layout_settings: {
        Row: {
          bottom_margin_cm: number
          created_at: string | null
          id: string
          letterhead_pdf_path: string | null
          top_margin_cm: number
          top_margin_pct: number | null
          updated_at: string | null
        }
        Insert: {
          bottom_margin_cm?: number
          created_at?: string | null
          id?: string
          letterhead_pdf_path?: string | null
          top_margin_cm?: number
          top_margin_pct?: number | null
          updated_at?: string | null
        }
        Update: {
          bottom_margin_cm?: number
          created_at?: string | null
          id?: string
          letterhead_pdf_path?: string | null
          top_margin_cm?: number
          top_margin_pct?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      report_link_events: {
        Row: {
          event_type: string
          id: string
          ip_hash: string | null
          metadata: Json | null
          occurred_at: string
          session_id: string | null
          token: string
          user_agent: string | null
        }
        Insert: {
          event_type: string
          id?: string
          ip_hash?: string | null
          metadata?: Json | null
          occurred_at?: string
          session_id?: string | null
          token: string
          user_agent?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          ip_hash?: string | null
          metadata?: Json | null
          occurred_at?: string
          session_id?: string | null
          token?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      report_link_sessions: {
        Row: {
          id: string
          last_heartbeat_at: string
          session_id: string
          started_at: string
          token: string
          total_dwell_seconds: number
        }
        Insert: {
          id?: string
          last_heartbeat_at?: string
          session_id: string
          started_at?: string
          token: string
          total_dwell_seconds?: number
        }
        Update: {
          id?: string
          last_heartbeat_at?: string
          session_id?: string
          started_at?: string
          token?: string
          total_dwell_seconds?: number
        }
        Relationships: []
      }
      report_profiles: {
        Row: {
          analyzer: string | null
          created_at: string | null
          department_id: string | null
          display_order: number | null
          enable_test_grouping: boolean | null
          force_single_page: boolean | null
          id: string
          interpretation: string | null
          is_outsourced: boolean | null
          method: string | null
          outsourced_caption: string | null
          profile_name: string
          remarks: string | null
          sample_type: string | null
          updated_at: string | null
        }
        Insert: {
          analyzer?: string | null
          created_at?: string | null
          department_id?: string | null
          display_order?: number | null
          enable_test_grouping?: boolean | null
          force_single_page?: boolean | null
          id?: string
          interpretation?: string | null
          is_outsourced?: boolean | null
          method?: string | null
          outsourced_caption?: string | null
          profile_name: string
          remarks?: string | null
          sample_type?: string | null
          updated_at?: string | null
        }
        Update: {
          analyzer?: string | null
          created_at?: string | null
          department_id?: string | null
          display_order?: number | null
          enable_test_grouping?: boolean | null
          force_single_page?: boolean | null
          id?: string
          interpretation?: string | null
          is_outsourced?: boolean | null
          method?: string | null
          outsourced_caption?: string | null
          profile_name?: string
          remarks?: string | null
          sample_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "report_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      report_share_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          invoice_number: string | null
          registration_id: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          invoice_number?: string | null
          registration_id: string
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          invoice_number?: string | null
          registration_id?: string
          token?: string
        }
        Relationships: []
      }
      report_templates: {
        Row: {
          created_at: string | null
          id: string
          template_config: Json | null
          template_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          template_config?: Json | null
          template_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          template_config?: Json | null
          template_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      report_test_parameters: {
        Row: {
          analyzer: string | null
          calculation_formula: Json | null
          created_at: string | null
          custom_sample_suffix: string | null
          custom_sample_suffix_enabled: boolean
          department_id: string | null
          display_order: number | null
          id: string
          interpretation: string | null
          is_active: boolean
          is_calculated: boolean
          is_outsourced: boolean | null
          machine_id: string | null
          machine_name: string | null
          method: string | null
          normal_range_high: number | null
          normal_range_low: number | null
          normal_range_text: string | null
          outsourced_caption: string | null
          param_code: string | null
          parameter_description: string | null
          parameter_name: string
          profile_id: string | null
          same_for_all_ages: boolean
          same_for_gender: boolean
          sample_type: string | null
          send_for_interface: boolean
          store_for_analytics: boolean | null
          test_name: string | null
          unit: string | null
          unit_conversion_enabled: boolean
          unit_conversion_operator: string
          unit_conversion_value: number | null
          updated_at: string | null
          use_global_normal_range: boolean
        }
        Insert: {
          analyzer?: string | null
          calculation_formula?: Json | null
          created_at?: string | null
          custom_sample_suffix?: string | null
          custom_sample_suffix_enabled?: boolean
          department_id?: string | null
          display_order?: number | null
          id?: string
          interpretation?: string | null
          is_active?: boolean
          is_calculated?: boolean
          is_outsourced?: boolean | null
          machine_id?: string | null
          machine_name?: string | null
          method?: string | null
          normal_range_high?: number | null
          normal_range_low?: number | null
          normal_range_text?: string | null
          outsourced_caption?: string | null
          param_code?: string | null
          parameter_description?: string | null
          parameter_name: string
          profile_id?: string | null
          same_for_all_ages?: boolean
          same_for_gender?: boolean
          sample_type?: string | null
          send_for_interface?: boolean
          store_for_analytics?: boolean | null
          test_name?: string | null
          unit?: string | null
          unit_conversion_enabled?: boolean
          unit_conversion_operator?: string
          unit_conversion_value?: number | null
          updated_at?: string | null
          use_global_normal_range?: boolean
        }
        Update: {
          analyzer?: string | null
          calculation_formula?: Json | null
          created_at?: string | null
          custom_sample_suffix?: string | null
          custom_sample_suffix_enabled?: boolean
          department_id?: string | null
          display_order?: number | null
          id?: string
          interpretation?: string | null
          is_active?: boolean
          is_calculated?: boolean
          is_outsourced?: boolean | null
          machine_id?: string | null
          machine_name?: string | null
          method?: string | null
          normal_range_high?: number | null
          normal_range_low?: number | null
          normal_range_text?: string | null
          outsourced_caption?: string | null
          param_code?: string | null
          parameter_description?: string | null
          parameter_name?: string
          profile_id?: string | null
          same_for_all_ages?: boolean
          same_for_gender?: boolean
          sample_type?: string | null
          send_for_interface?: boolean
          store_for_analytics?: boolean | null
          test_name?: string | null
          unit?: string | null
          unit_conversion_enabled?: boolean
          unit_conversion_operator?: string
          unit_conversion_value?: number | null
          updated_at?: string | null
          use_global_normal_range?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "report_test_parameters_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "report_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_test_parameters_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "report_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_tube_counter: {
        Row: {
          date_key: string
          last_sequence: number
        }
        Insert: {
          date_key: string
          last_sequence?: number
        }
        Update: {
          date_key?: string
          last_sequence?: number
        }
        Relationships: []
      }
      sample_tubes: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          collected_at: string | null
          collected_by: string | null
          created_at: string
          id: string
          registration_id: string
          sample_type: string | null
          sample_uid: string
          status: string
          suffix: string | null
          test_ids: Json
          test_names: Json
          tube_color: string | null
          tube_type: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          id?: string
          registration_id: string
          sample_type?: string | null
          sample_uid: string
          status?: string
          suffix?: string | null
          test_ids?: Json
          test_names?: Json
          tube_color?: string | null
          tube_type?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          collected_at?: string | null
          collected_by?: string | null
          created_at?: string
          id?: string
          registration_id?: string
          sample_type?: string | null
          sample_uid?: string
          status?: string
          suffix?: string | null
          test_ids?: Json
          test_names?: Json
          tube_color?: string | null
          tube_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sample_tubes_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "patient_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_price_list_items: {
        Row: {
          created_at: string
          custom_price: number
          id: string
          price_list_id: string
          test_id: string
        }
        Insert: {
          created_at?: string
          custom_price?: number
          id?: string
          price_list_id: string
          test_id: string
        }
        Update: {
          created_at?: string
          custom_price?: number
          id?: string
          price_list_id?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "standard_price_list_items_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "standard_price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_price_lists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      test_parameters: {
        Row: {
          created_at: string | null
          display_order: number | null
          id: string
          is_subheader: boolean
          parameter_id: string | null
          subheader_text: string | null
          test_id: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_subheader?: boolean
          parameter_id?: string | null
          subheader_text?: string | null
          test_id: string
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_subheader?: boolean
          parameter_id?: string | null
          subheader_text?: string | null
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_parameters_parameter_id_fkey"
            columns: ["parameter_id"]
            isOneToOne: false
            referencedRelation: "report_test_parameters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_parameters_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_sample_tubes: {
        Row: {
          created_at: string
          display_order: number
          id: string
          sample_type: string | null
          test_id: string
          tube_color: string | null
          tube_value: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          sample_type?: string | null
          test_id: string
          tube_color?: string | null
          tube_value: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          sample_type?: string | null
          test_id?: string
          tube_color?: string | null
          tube_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_sample_tubes_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      tests: {
        Row: {
          bold_in_report: boolean
          created_at: string
          dedicated_page: boolean
          department_id: string | null
          description: string | null
          discount_applicable: boolean
          display_name: string | null
          fasting_required: boolean
          fit_to_page: boolean
          id: string
          incentive_allowed: boolean
          incentive_amount: number
          instrument_name: string | null
          interpretation: string | null
          is_active: boolean
          is_outsourced: boolean
          is_single_parameter: boolean
          machine_id: string | null
          machine_name: string | null
          method: string | null
          outsourced_caption: string | null
          price: number
          report_display_order: number | null
          sample_tube: string | null
          sample_type: string | null
          show_in_report: boolean
          test_code: string | null
          test_name: string
          tube_color: string | null
          updated_at: string
        }
        Insert: {
          bold_in_report?: boolean
          created_at?: string
          dedicated_page?: boolean
          department_id?: string | null
          description?: string | null
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          fit_to_page?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          instrument_name?: string | null
          interpretation?: string | null
          is_active?: boolean
          is_outsourced?: boolean
          is_single_parameter?: boolean
          machine_id?: string | null
          machine_name?: string | null
          method?: string | null
          outsourced_caption?: string | null
          price?: number
          report_display_order?: number | null
          sample_tube?: string | null
          sample_type?: string | null
          show_in_report?: boolean
          test_code?: string | null
          test_name: string
          tube_color?: string | null
          updated_at?: string
        }
        Update: {
          bold_in_report?: boolean
          created_at?: string
          dedicated_page?: boolean
          department_id?: string | null
          description?: string | null
          discount_applicable?: boolean
          display_name?: string | null
          fasting_required?: boolean
          fit_to_page?: boolean
          id?: string
          incentive_allowed?: boolean
          incentive_amount?: number
          instrument_name?: string | null
          interpretation?: string | null
          is_active?: boolean
          is_outsourced?: boolean
          is_single_parameter?: boolean
          machine_id?: string | null
          machine_name?: string | null
          method?: string | null
          outsourced_caption?: string | null
          price?: number
          report_display_order?: number | null
          sample_tube?: string | null
          sample_type?: string | null
          show_in_report?: boolean
          test_code?: string | null
          test_name?: string
          tube_color?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tests_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "report_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      umr_counter: {
        Row: {
          counter_key: string
          last_sequence: number
        }
        Insert: {
          counter_key?: string
          last_sequence?: number
        }
        Update: {
          counter_key?: string
          last_sequence?: number
        }
        Relationships: []
      }
      webhook_messages: {
        Row: {
          created_at: string
          delivery_status: string | null
          direction: string
          error_info: Json | null
          id: string
          is_read: boolean
          location_lat: number | null
          location_lng: number | null
          media_url: string | null
          message: string | null
          message_id: string | null
          message_type: string | null
          raw_payload: Json | null
          sender_name: string | null
          sender_number: string | null
          status: string | null
        }
        Insert: {
          created_at?: string
          delivery_status?: string | null
          direction?: string
          error_info?: Json | null
          id?: string
          is_read?: boolean
          location_lat?: number | null
          location_lng?: number | null
          media_url?: string | null
          message?: string | null
          message_id?: string | null
          message_type?: string | null
          raw_payload?: Json | null
          sender_name?: string | null
          sender_number?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string
          delivery_status?: string | null
          direction?: string
          error_info?: Json | null
          id?: string
          is_read?: boolean
          location_lat?: number | null
          location_lng?: number | null
          media_url?: string | null
          message?: string | null
          message_id?: string | null
          message_type?: string | null
          raw_payload?: Json | null
          sender_name?: string | null
          sender_number?: string | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_all_whatsapp_chats: { Args: never; Returns: number }
      generate_invoice_number: { Args: never; Returns: string }
      generate_sample_uid: { Args: never; Returns: string }
      generate_umr_number: { Args: never; Returns: string }
      get_all_patient_registrations: {
        Args: { p_search?: string }
        Returns: {
          address: string
          bill_cancelled: boolean
          cancelled_tests: Json
          created_at: string
          discount_amount: number
          dob: string
          doctor_name: string
          due_amount: number
          email: string
          final_amount: number
          gender: string
          gross_amount: number
          home_visit_charges: number
          id: string
          invoice_number: string
          mobile_number: string
          net_amount: number
          paid_amount: number
          patient_name: string
          payments: Json
          refund_amount: number
          refund_date: string
          refund_mode: string
          status: string
          tests: Json
          title: string
          umr_number: string
          visit_type: string
        }[]
      }
      get_cloud_usage_stats: { Args: never; Returns: Json }
      get_patient_registrations_count: {
        Args: { p_search?: string }
        Returns: number
      }
      get_patient_registrations_paginated: {
        Args: { p_page?: number; p_page_size?: number; p_search?: string }
        Returns: {
          address: string
          bill_cancelled: boolean
          cancelled_tests: Json
          created_at: string
          discount_amount: number
          dob: string
          doctor_name: string
          due_amount: number
          email: string
          final_amount: number
          gender: string
          global_discount_type: string
          global_discount_value: number
          gross_amount: number
          home_visit_charges: number
          id: string
          invoice_number: string
          mobile_number: string
          net_amount: number
          paid_amount: number
          patient_name: string
          payments: Json
          pickup_point_id: string
          refund_amount: number
          refund_date: string
          refund_mode: string
          status: string
          tests: Json
          title: string
          umr_number: string
          visit_type: string
        }[]
      }
      get_wa_chat_messages: {
        Args: { p_limit?: number; p_mobile_10: string; p_offset?: number }
        Returns: {
          delivery_status: string
          direction: string
          error_info: Json
          id: string
          location_lat: number
          location_lng: number
          media_url: string
          message: string
          message_id: string
          message_type: string
          source: string
          ts: string
        }[]
      }
      get_wa_contacts_paginated: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_unread_only?: boolean
        }
        Returns: {
          contact_name: string
          last_message: string
          last_time: string
          mobile: string
          profile_name: string
          unread_count: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
