import { supabase } from "@/integrations/supabase/client";

export interface HealthCheckup {
  id: string;
  health_checkup_code: string | null;
  health_checkup_name: string;
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

export interface HealthCheckupTestLink {
  id: string;
  health_checkup_id: string;
  test_id: string;
  display_order: number;
  test_name?: string;
  test_code?: string;
  price?: number;
}

export const getHealthCheckups = async (): Promise<HealthCheckup[]> => {
  const { data, error } = await supabase.from("health_checkups").select("*").order("health_checkup_name");
  if (error) throw new Error(error.message);
  return (data || []) as HealthCheckup[];
};

export const saveHealthCheckup = async (
  payload: Omit<HealthCheckup, "id" | "health_checkup_code" | "created_at" | "updated_at">,
  editingId?: string
) => {
  if (editingId) {
    const { error } = await supabase.from("health_checkups").update(payload as any).eq("id", editingId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("health_checkups").insert(payload as any);
    if (error) throw new Error(error.message);
  }
};

export const deleteHealthCheckup = async (id: string) => {
  const { error } = await supabase.from("health_checkups").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

export const getHealthCheckupTests = async (checkupId: string): Promise<HealthCheckupTestLink[]> => {
  const { data, error } = await supabase
    .from("health_checkup_tests")
    .select("id, health_checkup_id, test_id, display_order, tests(test_name, test_code, price)")
    .eq("health_checkup_id", checkupId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return (data || []).map((d: any) => ({
    id: d.id,
    health_checkup_id: d.health_checkup_id,
    test_id: d.test_id,
    display_order: d.display_order,
    test_name: d.tests?.test_name,
    test_code: d.tests?.test_code,
    price: d.tests?.price,
  }));
};

export const linkTestToCheckup = async (checkupId: string, testId: string, displayOrder: number) => {
  const { error } = await supabase.from("health_checkup_tests").insert({
    health_checkup_id: checkupId,
    test_id: testId,
    display_order: displayOrder,
  } as any);
  if (error) throw new Error(error.message);
};

export const unlinkTestFromCheckup = async (id: string) => {
  const { error } = await supabase.from("health_checkup_tests").delete().eq("id", id);
  if (error) throw new Error(error.message);
};

// Profile linking for health check-ups
export interface HealthCheckupProfileLink {
  id: string;
  health_checkup_id: string;
  profile_id: string;
  display_order: number;
  profile_name?: string;
  profile_code?: string;
  price?: number;
}

export const getHealthCheckupProfiles = async (checkupId: string): Promise<HealthCheckupProfileLink[]> => {
  const { data, error } = await supabase
    .from("health_checkup_profiles")
    .select("id, health_checkup_id, profile_id, display_order, billing_profiles(profile_name, profile_code, price)")
    .eq("health_checkup_id", checkupId)
    .order("display_order");
  if (error) throw new Error(error.message);
  return (data || []).map((d: any) => ({
    id: d.id,
    health_checkup_id: d.health_checkup_id,
    profile_id: d.profile_id,
    display_order: d.display_order,
    profile_name: d.billing_profiles?.profile_name,
    profile_code: d.billing_profiles?.profile_code,
    price: d.billing_profiles?.price,
  }));
};

export const linkProfileToCheckup = async (checkupId: string, profileId: string, displayOrder: number) => {
  const { error } = await supabase.from("health_checkup_profiles").insert({
    health_checkup_id: checkupId,
    profile_id: profileId,
    display_order: displayOrder,
  } as any);
  if (error) throw new Error(error.message);
};

export const unlinkProfileFromCheckup = async (id: string) => {
  const { error } = await supabase.from("health_checkup_profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
};
