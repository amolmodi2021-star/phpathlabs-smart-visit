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

const TESTS_CACHE_KEY = "ph_pathlabs_tests_cache";

const sortByName = (items: TestItem[]) =>
  [...items].sort((a, b) => a.test_name.localeCompare(b.test_name));

const readCachedTests = (): TestItem[] => {
  try {
    const raw = localStorage.getItem(TESTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortByName(parsed) : [];
  } catch {
    return [];
  }
};

const writeCachedTests = (tests: TestItem[]) => {
  localStorage.setItem(TESTS_CACHE_KEY, JSON.stringify(sortByName(tests)));
};

export const getTestsWithFallback = async (): Promise<TestItem[]> => {
  try {
    const { data, error } = await supabase.from("tests").select("*").order("test_name");
    if (error) throw error;
    const tests = (data || []) as TestItem[];
    writeCachedTests(tests);
    return tests;
  } catch {
    return readCachedTests();
  }
};

export const saveTestWithFallback = async (payload: SaveTestPayload, editingId?: string) => {
  try {
    if (editingId) {
      const { data, error } = await supabase
        .from("tests")
        .update(payload)
        .eq("id", editingId)
        .select("*")
        .single();
      if (error) throw error;

      const cached = readCachedTests();
      writeCachedTests(cached.map((t) => (t.id === editingId ? ({ ...t, ...data } as TestItem) : t)));
      return;
    }

    const { data, error } = await supabase.from("tests").insert(payload).select("*").single();
    if (error) throw error;

    const cached = readCachedTests();
    writeCachedTests([...cached.filter((t) => t.id !== data.id), data as TestItem]);
  } catch {
    const cached = readCachedTests();

    if (editingId) {
      writeCachedTests(cached.map((t) => (t.id === editingId ? { ...t, ...payload } : t)));
      return;
    }

    writeCachedTests([
      ...cached,
      {
        id: crypto.randomUUID(),
        ...payload,
      },
    ]);
  }
};

export const deleteTestWithFallback = async (id: string) => {
  try {
    const { error } = await supabase.from("tests").delete().eq("id", id);
    if (error) throw error;
  } catch {
    // no-op, cache cleanup below still applies
  }

  const cached = readCachedTests();
  writeCachedTests(cached.filter((t) => t.id !== id));
};

export const bulkInsertTestsWithFallback = async (tests: SaveTestPayload[]) => {
  try {
    const { data, error } = await supabase.from("tests").insert(tests).select("*");
    if (error) throw error;

    const cached = readCachedTests();
    const merged = [...cached, ...((data || []) as TestItem[])].reduce<TestItem[]>((acc, item) => {
      if (!acc.find((x) => x.id === item.id)) acc.push(item);
      return acc;
    }, []);
    writeCachedTests(merged);
    return;
  } catch {
    const cached = readCachedTests();
    const locals: TestItem[] = tests.map((t) => ({
      id: crypto.randomUUID(),
      ...t,
      description: t.description || "",
    }));
    writeCachedTests([...cached, ...locals]);
  }
};
