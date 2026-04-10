import { supabase } from "@/integrations/supabase/client";

export interface TestItem {
  id: string;
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  description: string | null;
  incentive_allowed: boolean;
  incentive_amount: number;
  test_code?: string | null;
  display_name?: string | null;
  bold_in_report?: boolean;
  show_in_report?: boolean;
  is_single_parameter?: boolean;
  instrument_name?: string | null;
  method?: string | null;
  sample_type?: string | null;
  interpretation?: string | null;
  is_active?: boolean;
  fit_to_page?: boolean;
  dedicated_page?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface SaveTestPayload {
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  description: string;
  incentive_allowed: boolean;
  incentive_amount: number;
}

// Simple retry wrapper for transient network errors
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isNetwork =
        (err instanceof TypeError && err.message.includes("Failed to fetch")) ||
        (err instanceof DOMException && err.name === "AbortError");
      if (!isNetwork || attempt === retries) throw err;
      console.warn(`Network error, retrying in ${delayMs}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Unreachable");
}

export const getTests = async (): Promise<TestItem[]> => {
  return withRetry(async () => {
    const { data, error } = await supabase.from("tests").select("*").order("test_name");
    if (error) throw new Error(error.message);
    return (data || []) as TestItem[];
  });
};

export const saveTest = async (payload: SaveTestPayload, editingId?: string) => {
  return withRetry(async () => {
    if (editingId) {
      const { error } = await supabase.from("tests").update(payload as any).eq("id", editingId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("tests").insert(payload as any);
      if (error) throw new Error(error.message);
    }
  });
};

export const deleteTest = async (id: string) => {
  return withRetry(async () => {
    const { error } = await supabase.from("tests").delete().eq("id", id);
    if (error) throw new Error(error.message);
  });
};

export const bulkInsertTests = async (tests: SaveTestPayload[]) => {
  return withRetry(async () => {
    const { error } = await supabase.from("tests").insert(tests as any);
    if (error) throw new Error(error.message);
  });
};

// ── Test-Parameter junction helpers ──

export interface TestParameterLink {
  id: string;
  test_id: string;
  parameter_id: string;
  display_order: number;
  is_subheader: boolean;
  subheader_text: string | null;
  parameter_name?: string;
  param_code?: string;
  unit?: string;
  normal_range_low?: number | null;
  normal_range_high?: number | null;
  normal_range_text?: string | null;
}

export const getTestParameters = async (testId: string): Promise<TestParameterLink[]> => {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from("test_parameters")
      .select("id, test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(parameter_name, param_code, unit, normal_range_low, normal_range_high, normal_range_text)")
      .eq("test_id", testId)
      .order("display_order");
    if (error) throw new Error(error.message);
    return (data || []).map((d: any) => ({
      id: d.id,
      test_id: d.test_id,
      parameter_id: d.parameter_id,
      display_order: d.display_order,
      is_subheader: d.is_subheader ?? false,
      subheader_text: d.subheader_text ?? null,
      parameter_name: d.report_test_parameters?.parameter_name,
      param_code: d.report_test_parameters?.param_code,
      unit: d.report_test_parameters?.unit,
      normal_range_low: d.report_test_parameters?.normal_range_low,
      normal_range_high: d.report_test_parameters?.normal_range_high,
      normal_range_text: d.report_test_parameters?.normal_range_text,
    }));
  });
};

export const linkParameterToTest = async (testId: string, parameterId: string, displayOrder: number) => {
  return withRetry(async () => {
    const { error } = await supabase.from("test_parameters").insert({
      test_id: testId,
      parameter_id: parameterId,
      display_order: displayOrder,
    } as any);
    if (error) throw new Error(error.message);
  });
};

export const unlinkParameterFromTest = async (id: string) => {
  return withRetry(async () => {
    const { error } = await supabase.from("test_parameters").delete().eq("id", id);
    if (error) throw new Error(error.message);
  });
};

export const searchParameters = async (query: string) => {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from("report_test_parameters")
      .select("id, parameter_name, param_code, unit, normal_range_low, normal_range_high, normal_range_text")
      .ilike("parameter_name", `%${query}%`)
      .order("parameter_name")
      .limit(20);
    if (error) throw new Error(error.message);
    return data || [];
  });
};

export const addSubheaderToTest = async (testId: string, text: string, displayOrder: number) => {
  return withRetry(async () => {
    const { error } = await supabase.from("test_parameters").insert({
      test_id: testId,
      parameter_id: null,
      display_order: displayOrder,
      is_subheader: true,
      subheader_text: text,
    } as any);
    if (error) throw new Error(error.message);
  });
};

export const updateSubheaderText = async (id: string, text: string) => {
  return withRetry(async () => {
    const { error } = await supabase.from("test_parameters").update({ subheader_text: text } as any).eq("id", id);
    if (error) throw new Error(error.message);
  });
};

export const reorderTestParameters = async (items: { id: string; display_order: number }[]) => {
  return withRetry(async () => {
    for (const item of items) {
      const { error } = await supabase
        .from("test_parameters")
        .update({ display_order: item.display_order } as any)
        .eq("id", item.id);
      if (error) throw new Error(error.message);
    }
  });
};
