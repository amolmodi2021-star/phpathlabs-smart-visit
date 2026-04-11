import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type TableName = "home_visits" | "estimates" | "estimate_tests" | "tests" | "phlebotomists" | "message_templates" | "abnormal_history" | "phlebotomist_leaves" | "outsourced_test_snips" | "patient_results" | "patient_registrations" | "sample_tubes" | "message_send_log";

export function useRealtimeSync(table: TableName, queryKeys: string[]) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`realtime-${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          queryKeys.forEach((key) => {
            queryClient.invalidateQueries({ queryKey: [key] });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, queryClient, ...queryKeys]);
}
