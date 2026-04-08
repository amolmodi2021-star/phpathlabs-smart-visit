import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LookupItem {
  id: string;
  category: string;
  value: string;
  display_order: number;
  is_active: boolean;
  mapped_value: string | null;
  mapped_value_2: string | null;
}

export function useMasterLookup(category: string) {
  return useQuery({
    queryKey: ["master_lookup", category],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_lookup")
        .select("*")
        .eq("category", category)
        .eq("is_active", true)
        .order("display_order")
        .order("value");
      if (error) throw error;
      return (data || []) as LookupItem[];
    },
  });
}
