import { supabase } from "@/integrations/supabase/client";

export interface SelectableTestItem {
  id: string;
  test_name: string;
  test_code: string | null;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  incentive_allowed: boolean;
  incentive_amount: number;
  item_type: "test" | "package" | "profile";
}

/**
 * Returns a unified list of Tests + Health Check-Ups + Profiles for selection dropdowns.
 */
export const getAllSelectableTests = async (): Promise<SelectableTestItem[]> => {
  const [testsRes, checkupsRes, profilesRes] = await Promise.all([
    supabase.from("tests").select("id, test_name, test_code, price, fasting_required, discount_applicable, incentive_allowed, incentive_amount").eq("is_active", true).order("test_name"),
    supabase.from("health_checkups").select("id, health_checkup_name, health_checkup_code, price, fasting_required, discount_applicable, incentive_allowed, incentive_amount").eq("is_active", true).order("health_checkup_name"),
    supabase.from("billing_profiles").select("id, profile_name, profile_code, price, fasting_required, discount_applicable, incentive_allowed, incentive_amount").eq("is_active", true).order("profile_name"),
  ]);

  const tests: SelectableTestItem[] = (testsRes.data || []).map((t: any) => ({
    id: t.id, test_name: t.test_name, test_code: t.test_code, price: Number(t.price),
    fasting_required: t.fasting_required, discount_applicable: t.discount_applicable,
    incentive_allowed: t.incentive_allowed, incentive_amount: Number(t.incentive_amount),
    item_type: "test" as const,
  }));

  const checkups: SelectableTestItem[] = (checkupsRes.data || []).map((c: any) => ({
    id: c.id, test_name: c.health_checkup_name, test_code: c.health_checkup_code, price: Number(c.price),
    fasting_required: c.fasting_required, discount_applicable: c.discount_applicable,
    incentive_allowed: c.incentive_allowed, incentive_amount: Number(c.incentive_amount),
    item_type: "package" as const,
  }));

  const profiles: SelectableTestItem[] = (profilesRes.data || []).map((p: any) => ({
    id: p.id, test_name: p.profile_name, test_code: p.profile_code, price: Number(p.price),
    fasting_required: p.fasting_required, discount_applicable: p.discount_applicable,
    incentive_allowed: p.incentive_allowed, incentive_amount: Number(p.incentive_amount),
    item_type: "profile" as const,
  }));

  return [...tests, ...checkups, ...profiles].sort((a, b) => a.test_name.localeCompare(b.test_name));
};
