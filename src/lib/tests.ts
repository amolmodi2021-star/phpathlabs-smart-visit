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

export const getTests = async (): Promise<TestItem[]> => {
  const { data, error } = await supabase.from("tests").select("*").order("test_name");
  if (error) throw error;
  return (data || []) as TestItem[];
};

export const saveTest = async (payload: SaveTestPayload, editingId?: string) => {
  if (editingId) {
    const { error } = await supabase.from("tests").update(payload).eq("id", editingId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("tests").insert(payload);
  if (error) throw error;
};

export const deleteTest = async (id: string) => {
  const { error } = await supabase.from("tests").delete().eq("id", id);
  if (error) throw error;
};

export const bulkInsertTests = async (tests: SaveTestPayload[]) => {
  const { error } = await supabase.from("tests").insert(tests);
  if (error) throw error;
};
