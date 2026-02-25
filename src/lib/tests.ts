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

async function invoke(body: Record<string, unknown>) {
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("tests-crud", {
        body,
      });

      if (error) throw new Error(error.message || "Request failed");
      if (data?.error) throw new Error(data.error);
      return data;
    } catch (err: any) {
      lastError = err;
      const isNetwork =
        (err instanceof TypeError && err.message.includes("Failed to fetch")) ||
        (err instanceof DOMException && err.name === "AbortError") ||
        err?.message?.includes("Failed to fetch");

      if (!isNetwork) throw err;
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw new Error("Network issue connecting to database. Please check your connection and retry.");
}

export const getTests = async (): Promise<TestItem[]> => {
  const result = await invoke({ action: "list" });
  return (result?.data || []) as TestItem[];
};

export const saveTest = async (payload: SaveTestPayload, editingId?: string) => {
  if (editingId) {
    await invoke({ action: "update", payload, id: editingId });
  } else {
    await invoke({ action: "create", payload });
  }
};

export const deleteTest = async (id: string) => {
  await invoke({ action: "delete", id });
};

export const bulkInsertTests = async (tests: SaveTestPayload[]) => {
  await invoke({ action: "bulk_insert", payload: tests });
};
