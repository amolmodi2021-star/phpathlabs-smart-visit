import { supabase } from "@/integrations/supabase/client";

export interface TestItem {
  id: string;
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  description: string | null;
  created_at?: string;
  updated_at?: string;
}

interface SaveTestPayload {
  test_name: string;
  price: number;
  fasting_required: boolean;
  discount_applicable: boolean;
  description: string;
}

const isNetworkError = (err: unknown): boolean => {
  if (err instanceof TypeError && err.message.includes("Failed to fetch")) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  return false;
};

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, timeoutMs = 12000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const result = await fn();
      clearTimeout(timer);
      return result;
    } catch (err) {
      lastError = err;
      if (!isNetworkError(err)) throw err; // non-network error, don't retry
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); // exponential backoff
      }
    }
  }
  throw new Error("Network issue connecting to database. Please check your connection and retry.");
}

export const getTests = async (): Promise<TestItem[]> => {
  return withRetry(async () => {
    const { data, error } = await supabase.from("tests").select("*").order("test_name");
    if (error) throw error;
    return (data || []) as TestItem[];
  });
};

export const saveTest = async (payload: SaveTestPayload, editingId?: string) => {
  return withRetry(async () => {
    if (editingId) {
      const { error } = await supabase.from("tests").update(payload).eq("id", editingId);
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from("tests").insert(payload);
    if (error) throw error;
  });
};

export const deleteTest = async (id: string) => {
  return withRetry(async () => {
    const { error } = await supabase.from("tests").delete().eq("id", id);
    if (error) throw error;
  });
};

export const bulkInsertTests = async (tests: SaveTestPayload[]) => {
  return withRetry(async () => {
    const { error } = await supabase.from("tests").insert(tests);
    if (error) throw error;
  });
};
