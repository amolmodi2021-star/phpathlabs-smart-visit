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
