import { supabase } from "@/integrations/supabase/client";

export interface Combo {
  id: string;
  combo_code: string | null;
  combo_name: string;
  display_name: string | null;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  bold_in_report: boolean;
  show_in_report: boolean;
  incentive_allowed: boolean;
  incentive_amount: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ComboTestLink {
  id: string;
  combo_id: string;
  test_id: string;
  display_order: number;
  test_name?: string;
  test_code?: string;
  price?: number;
}

export interface ComboProfileLink {
  id: string;
  combo_id: string;
  profile_id: string;
  display_order: number;
  profile_name?: string;
  profile_code?: string;
  price?: number;
}

export const getCombos = async (): Promise<Combo[]> => {
  const { data, error } = await (supabase as any).from("combos").select("*").order("combo_name");
  if (error) throw new Error(error.message);
  return (data || []) as Combo[];
};

export const saveCombo = async (
  payload: Omit<Combo, "id" | "combo_code" | "created_at" | "updated_at">,
  editingId?: string,
) => {
  if (editingId) {
    const { error } = await (supabase as any).from("combos").update(payload).eq("id", editingId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await (supabase as any).from("combos").insert(payload);
    if (error) throw new Error(error.message);
  }
};

export const deleteCombo = async (id: string) => {
  const { error } = await (supabase as any).from("combos").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

export const getComboTests = async (comboId: string): Promise<ComboTestLink[]> => {
  const { data, error } = await (supabase as any)
    .from("combo_tests")
    .select("id, combo_id, test_id, display_order, tests(test_name, test_code, price)")
    .eq("combo_id", comboId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return (data || []).map((d: any) => ({
    id: d.id,
    combo_id: d.combo_id,
    test_id: d.test_id,
    display_order: d.display_order,
    test_name: d.tests?.test_name,
    test_code: d.tests?.test_code,
    price: d.tests?.price,
  }));
};

export const linkTestToCombo = async (comboId: string, testId: string, displayOrder: number) => {
  const { error } = await (supabase as any).from("combo_tests").insert({
    combo_id: comboId, test_id: testId, display_order: displayOrder,
  });
  if (error) throw new Error(error.message);
};

export const unlinkTestFromCombo = async (id: string) => {
  const { error } = await (supabase as any).from("combo_tests").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

export const getComboProfiles = async (comboId: string): Promise<ComboProfileLink[]> => {
  const { data, error } = await (supabase as any)
    .from("combo_profiles")
    .select("id, combo_id, profile_id, display_order, billing_profiles(profile_name, profile_code, price)")
    .eq("combo_id", comboId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return (data || []).map((d: any) => ({
    id: d.id,
    combo_id: d.combo_id,
    profile_id: d.profile_id,
    display_order: d.display_order,
    profile_name: d.billing_profiles?.profile_name,
    profile_code: d.billing_profiles?.profile_code,
    price: d.billing_profiles?.price,
  }));
};

export const linkProfileToCombo = async (comboId: string, profileId: string, displayOrder: number) => {
  const { error } = await (supabase as any).from("combo_profiles").insert({
    combo_id: comboId, profile_id: profileId, display_order: displayOrder,
  });
  if (error) throw new Error(error.message);
};

export const unlinkProfileFromCombo = async (id: string) => {
  const { error } = await (supabase as any).from("combo_profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
};
