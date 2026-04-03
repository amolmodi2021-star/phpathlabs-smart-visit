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
      extracted_report_data: {
        Row: {
          accession_date: string | null
          age: string | null
          authentication_date: string | null
          collection_date: string | null
          created_at: string | null
          gender: string | null
          id: string
          location: string | null
          pathologist_name: string | null
          patient_name: string | null
          print_date: string | null
          ref_doctor: string | null
          reg_date: string | null
          reg_no: string | null
          report_date: string | null
          report_id: string | null
          sample_collection_date: string | null
          test_results: Json | null
          umr_id: string | null
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          accession_date?: string | null
          age?: string | null
          authentication_date?: string | null
          collection_date?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string
          location?: string | null
          pathologist_name?: string | null
          patient_name?: string | null
          print_date?: string | null
          ref_doctor?: string | null
          reg_date?: string | null
          reg_no?: string | null
          report_date?: string | null
          report_id?: string | null
          sample_collection_date?: string | null
          test_results?: Json | null
          umr_id?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          accession_date?: string | null
          age?: string | null
          authentication_date?: string | null
          collection_date?: string | null
          created_at?: string | null
          gender?: string | null
          id?: string
          location?: string | null
          pathologist_name?: string | null
          patient_name?: string | null
          print_date?: string | null
          ref_doctor?: string | null
          reg_date?: string | null
          reg_no?: string | null
          report_date?: string | null
          report_id?: string | null
          sample_collection_date?: string | null
          test_results?: Json | null
          umr_id?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "extracted_report_data_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "uploaded_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_corrections: {
        Row: {
          corrected_value: string | null
          created_at: string
          field_corrected: string
          id: string
          original_value: string | null
          parameter_name: string
        }
        Insert: {
          corrected_value?: string | null
          created_at?: string
          field_corrected: string
          id?: string
          original_value?: string | null
          parameter_name: string
        }
        Update: {
          corrected_value?: string | null
          created_at?: string
          field_corrected?: string
          id?: string
          original_value?: string | null
          parameter_name?: string
        }
        Relationships: []
      }
      generated_reports: {
        Row: {
          created_at: string | null
          generated_at: string | null
          id: string
          pathologist_id: string | null
          patient_name: string | null
          report_html: string | null
          report_id: string | null
          umr_id: string | null
        }
        Insert: {
          created_at?: string | null
          generated_at?: string | null
          id?: string
          pathologist_id?: string | null
          patient_name?: string | null
          report_html?: string | null
          report_id?: string | null
          umr_id?: string | null
        }
        Update: {
          created_at?: string | null
          generated_at?: string | null
          id?: string
          pathologist_id?: string | null
          patient_name?: string | null
          report_html?: string | null
          report_id?: string | null
          umr_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_reports_pathologist_id_fkey"
            columns: ["pathologist_id"]
            isOneToOne: false
            referencedRelation: "pathologist_signatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_reports_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "uploaded_reports"
            referencedColumns: ["id"]
          },
        ]
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
      loyalty_card_jobs: {
        Row: {
          created_at: string
          delay_ms: number
          excel_data: Json | null
          id: string
          queue_enabled: boolean
          sent_count: number
          status: string
          template_id: string | null
          total_cards: number
          whatsapp_template_name: string | null
          whatsapp_variables_mapping: Json | null
        }
        Insert: {
          created_at?: string
          delay_ms?: number
          excel_data?: Json | null
          id?: string
          queue_enabled?: boolean
          sent_count?: number
          status?: string
          template_id?: string | null
          total_cards?: number
          whatsapp_template_name?: string | null
          whatsapp_variables_mapping?: Json | null
        }
        Update: {
          created_at?: string
          delay_ms?: number
          excel_data?: Json | null
          id?: string
          queue_enabled?: boolean
          sent_count?: number
          status?: string
          template_id?: string | null
          total_cards?: number
          whatsapp_template_name?: string | null
          whatsapp_variables_mapping?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_card_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "loyalty_card_templates"
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
      loyalty_cards: {
        Row: {
          created_at: string
          discount: string | null
          expiry_date: string | null
          id: string
          image_url: string | null
          job_id: string | null
          mobile: string | null
          patient_name: string | null
          sent_at: string | null
          umr: string | null
          whatsapp_status: string
        }
        Insert: {
          created_at?: string
          discount?: string | null
          expiry_date?: string | null
          id?: string
          image_url?: string | null
          job_id?: string | null
          mobile?: string | null
          patient_name?: string | null
          sent_at?: string | null
          umr?: string | null
          whatsapp_status?: string
        }
        Update: {
          created_at?: string
          discount?: string | null
          expiry_date?: string | null
          id?: string
          image_url?: string | null
          job_id?: string | null
          mobile?: string | null
          patient_name?: string | null
          sent_at?: string | null
          umr?: string | null
          whatsapp_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_cards_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "loyalty_card_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          created_at: string
          delay_ms: number
          excel_data: Json | null
          failed_count: number
          id: string
          sent_count: number
          status: string
          template_id: string | null
          total_messages: number
          updated_at: string
          variable_mapping: Json | null
        }
        Insert: {
          created_at?: string
          delay_ms?: number
          excel_data?: Json | null
          failed_count?: number
          id?: string
          sent_count?: number
          status?: string
          template_id?: string | null
          total_messages?: number
          updated_at?: string
          variable_mapping?: Json | null
        }
        Update: {
          created_at?: string
          delay_ms?: number
          excel_data?: Json | null
          failed_count?: number
          id?: string
          sent_count?: number
          status?: string
          template_id?: string | null
          total_messages?: number
          updated_at?: string
          variable_mapping?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "marketing_templates"
            referencedColumns: ["id"]
          },
        ]
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
      pathologist_signatures: {
        Row: {
          created_at: string | null
          designation: string | null
          id: string
          pathologist_name: string
          qualification: string | null
          signature_image_path: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          designation?: string | null
          id?: string
          pathologist_name: string
          qualification?: string | null
          signature_image_path?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          designation?: string | null
          id?: string
          pathologist_name?: string
          qualification?: string | null
          signature_image_path?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      patient_master: {
        Row: {
          age: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          first_visit_date: string | null
          gender: string | null
          id: string
          last_visit_date: string | null
          mobile_number: string | null
          patient_name: string
          ref_doctor: string | null
          umr_id: string
          updated_at: string | null
        }
        Insert: {
          age?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_visit_date?: string | null
          gender?: string | null
          id?: string
          last_visit_date?: string | null
          mobile_number?: string | null
          patient_name: string
          ref_doctor?: string | null
          umr_id: string
          updated_at?: string | null
        }
        Update: {
          age?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_visit_date?: string | null
          gender?: string | null
          id?: string
          last_visit_date?: string | null
          mobile_number?: string | null
          patient_name?: string
          ref_doctor?: string | null
          umr_id?: string
          updated_at?: string | null
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
      raw_report_data: {
        Row: {
          id: string
          raw_json: Json | null
          report_id: string | null
          umr_id: string | null
          upload_date: string | null
        }
        Insert: {
          id?: string
          raw_json?: Json | null
          report_id?: string | null
          umr_id?: string | null
          upload_date?: string | null
        }
        Update: {
          id?: string
          raw_json?: Json | null
          report_id?: string | null
          umr_id?: string | null
          upload_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_report_data_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "uploaded_reports"
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
          updated_at: string | null
        }
        Insert: {
          bottom_margin_cm?: number
          created_at?: string | null
          id?: string
          letterhead_pdf_path?: string | null
          top_margin_cm?: number
          updated_at?: string | null
        }
        Update: {
          bottom_margin_cm?: number
          created_at?: string | null
          id?: string
          letterhead_pdf_path?: string | null
          top_margin_cm?: number
          updated_at?: string | null
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
          created_at: string | null
          department_id: string | null
          display_order: number | null
          id: string
          interpretation: string | null
          is_outsourced: boolean | null
          method: string | null
          normal_range_high: number | null
          normal_range_low: number | null
          normal_range_text: string | null
          outsourced_caption: string | null
          parameter_name: string
          profile_id: string | null
          sample_type: string | null
          store_for_analytics: boolean | null
          test_name: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          analyzer?: string | null
          created_at?: string | null
          department_id?: string | null
          display_order?: number | null
          id?: string
          interpretation?: string | null
          is_outsourced?: boolean | null
          method?: string | null
          normal_range_high?: number | null
          normal_range_low?: number | null
          normal_range_text?: string | null
          outsourced_caption?: string | null
          parameter_name: string
          profile_id?: string | null
          sample_type?: string | null
          store_for_analytics?: boolean | null
          test_name?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          analyzer?: string | null
          created_at?: string | null
          department_id?: string | null
          display_order?: number | null
          id?: string
          interpretation?: string | null
          is_outsourced?: boolean | null
          method?: string | null
          normal_range_high?: number | null
          normal_range_low?: number | null
          normal_range_text?: string | null
          outsourced_caption?: string | null
          parameter_name?: string
          profile_id?: string | null
          sample_type?: string | null
          store_for_analytics?: boolean | null
          test_name?: string | null
          unit?: string | null
          updated_at?: string | null
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
      test_result_history: {
        Row: {
          analyzer: string | null
          created_at: string | null
          department: string | null
          flag: string | null
          id: string
          method: string | null
          normal_range_high: number | null
          normal_range_low: number | null
          parameter_name: string
          profile_name: string | null
          report_id: string | null
          result_text: string | null
          result_value: number | null
          test_date: string | null
          test_name: string | null
          umr_id: string
          unit: string | null
        }
        Insert: {
          analyzer?: string | null
          created_at?: string | null
          department?: string | null
          flag?: string | null
          id?: string
          method?: string | null
          normal_range_high?: number | null
          normal_range_low?: number | null
          parameter_name: string
          profile_name?: string | null
          report_id?: string | null
          result_text?: string | null
          result_value?: number | null
          test_date?: string | null
          test_name?: string | null
          umr_id: string
          unit?: string | null
        }
        Update: {
          analyzer?: string | null
          created_at?: string | null
          department?: string | null
          flag?: string | null
          id?: string
          method?: string | null
          normal_range_high?: number | null
          normal_range_low?: number | null
          parameter_name?: string
          profile_name?: string | null
          report_id?: string | null
          result_text?: string | null
          result_value?: number | null
          test_date?: string | null
          test_name?: string | null
          umr_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "test_result_history_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "uploaded_reports"
            referencedColumns: ["id"]
          },
        ]
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
      uploaded_reports: {
        Row: {
          created_at: string | null
          file_name: string | null
          file_path: string
          id: string
          mobile_number: string | null
          patient_name: string | null
          reg_date: string | null
          reg_no: string | null
          status: string | null
          umr_id: string | null
          updated_at: string | null
          upload_time: string | null
        }
        Insert: {
          created_at?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          mobile_number?: string | null
          patient_name?: string | null
          reg_date?: string | null
          reg_no?: string | null
          status?: string | null
          umr_id?: string | null
          updated_at?: string | null
          upload_time?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          mobile_number?: string | null
          patient_name?: string | null
          reg_date?: string | null
          reg_no?: string | null
          status?: string | null
          umr_id?: string | null
          updated_at?: string | null
          upload_time?: string | null
        }
        Relationships: []
      }
      webhook_messages: {
        Row: {
          created_at: string
          direction: string
          id: string
          message: string | null
          raw_payload: Json | null
          sender_name: string | null
          sender_number: string | null
          status: string | null
        }
        Insert: {
          created_at?: string
          direction?: string
          id?: string
          message?: string | null
          raw_payload?: Json | null
          sender_name?: string | null
          sender_number?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          message?: string | null
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
