import { supabase } from "@/integrations/supabase/client";

export interface BillingProfile {
  id: string;
  profile_code: string | null;
  profile_name: string;
  display_name: string | null;
  price: number;
  department_id: string | null;
  fasting_required: boolean;
  discount_applicable: boolean;
  is_outsourced: boolean;
  bold_in_report: boolean;
  show_in_report: boolean;
  instrument_name: string | null;
  method: string | null;
  sample_type: string | null;
  interpretation: string | null;
  description: string | null;
  incentive_allowed: boolean;
  incentive_amount: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BillingProfileTestLink {
  id: string;
  profile_id: string;
  test_id: string;
  display_order: number;
  test_name?: string;
  test_code?: string;
  price?: number;
}

export const getBillingProfiles = async (): Promise<BillingProfile[]> => {
  const { data, error } = await supabase.from("billing_profiles").select("*").order("profile_name");
  if (error) throw new Error(error.message);
  return (data || []) as BillingProfile[];
};

export const saveBillingProfile = async (
  payload: Omit<BillingProfile, "id" | "profile_code" | "created_at" | "updated_at">,
  editingId?: string
) => {
  if (editingId) {
    const { error } = await supabase.from("billing_profiles").update(payload as any).eq("id", editingId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("billing_profiles").insert(payload as any);
    if (error) throw new Error(error.message);
  }
};

export const deleteBillingProfile = async (id: string) => {
  const { error } = await supabase.from("billing_profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

export const getBillingProfileTests = async (profileId: string): Promise<BillingProfileTestLink[]> => {
  const { data, error } = await supabase
    .from("billing_profile_tests")
    .select("id, profile_id, test_id, display_order, tests(test_name, test_code, price)")
    .eq("profile_id", profileId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return (data || []).map((d: any) => ({
    id: d.id,
    profile_id: d.profile_id,
    test_id: d.test_id,
    display_order: d.display_order,
    test_name: d.tests?.test_name,
    test_code: d.tests?.test_code,
    price: d.tests?.price,
  }));
};

export const linkTestToProfile = async (profileId: string, testId: string, displayOrder: number) => {
  const { error } = await supabase.from("billing_profile_tests").insert({
    profile_id: profileId,
    test_id: testId,
    display_order: displayOrder,
  } as any);
  if (error) throw new Error(error.message);
};

export const unlinkTestFromProfile = async (id: string) => {
  const { error } = await supabase.from("billing_profile_tests").delete().eq("id", id);
  if (error) throw new Error(error.message);
};
