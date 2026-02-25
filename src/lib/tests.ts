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

function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes("Failed to fetch")) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as any).message || "";
    if (msg.includes("Failed to fetch") || msg.includes("Failed to send")) return true;
  }
  return false;
}

// Primary: edge function. Fallback: direct SDK.
async function invokeEdge(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("tests-crud", { body });
  if (error) throw new Error(error.message || "Edge function error");
  if (data?.error) throw new Error(data.error);
  return data;
}

// ─── Direct SDK fallback ───

async function directList(): Promise<TestItem[]> {
  const { data, error } = await supabase.from("tests").select("*").order("test_name");
  if (error) throw new Error(error.message);
  return (data || []) as TestItem[];
}

async function directCreate(payload: SaveTestPayload) {
  const { error } = await supabase.from("tests").insert(payload as any);
  if (error) throw new Error(error.message);
}

async function directUpdate(payload: SaveTestPayload, id: string) {
  const { error } = await supabase.from("tests").update(payload as any).eq("id", id);
  if (error) throw new Error(error.message);
}

async function directDelete(id: string) {
  const { error } = await supabase.from("tests").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

async function directBulkInsert(tests: SaveTestPayload[]) {
  const { error } = await supabase.from("tests").insert(tests as any);
  if (error) throw new Error(error.message);
}

// ─── Public API with edge-first, SDK-fallback ───

export const getTests = async (): Promise<TestItem[]> => {
  try {
    const result = await invokeEdge({ action: "list" });
    return (result?.data || []) as TestItem[];
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn("Edge function unreachable, falling back to direct DB");
      return directList();
    }
    throw err;
  }
};

export const saveTest = async (payload: SaveTestPayload, editingId?: string) => {
  try {
    if (editingId) {
      await invokeEdge({ action: "update", payload, id: editingId });
    } else {
      await invokeEdge({ action: "create", payload });
    }
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn("Edge function unreachable, falling back to direct DB");
      if (editingId) {
        await directUpdate(payload, editingId);
      } else {
        await directCreate(payload);
      }
      return;
    }
    throw err;
  }
};

export const deleteTest = async (id: string) => {
  try {
    await invokeEdge({ action: "delete", id });
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn("Edge function unreachable, falling back to direct DB");
      await directDelete(id);
      return;
    }
    throw err;
  }
};

export const bulkInsertTests = async (tests: SaveTestPayload[]) => {
  try {
    await invokeEdge({ action: "bulk_insert", payload: tests });
  } catch (err) {
    if (isNetworkError(err)) {
      console.warn("Edge function unreachable, falling back to direct DB");
      await directBulkInsert(tests);
      return;
    }
    throw err;
  }
};

export const checkConnection = async (): Promise<boolean> => {
  try {
    await getTests();
    return true;
  } catch {
    return false;
  }
};
