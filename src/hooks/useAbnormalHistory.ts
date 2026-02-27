import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { toast } from "sonner";

/**
 * Hook to check if a mobile number has unsent abnormal history
 * and provide a function to send it.
 */
export function useAbnormalHistory() {
  const qc = useQueryClient();

  const { data: allRecords = [] } = useQuery({
    queryKey: ["abnormal_history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("abnormal_history")
        .select("*")
        .eq("sent", false);
      return data || [];
    },
  });

  const getUnsentForMobile = (mobile: string): any | null => {
    const normalized = mobile.replace(/\D/g, "").slice(-10);
    return allRecords.find((r: any) => r.mobile_number === normalized) || null;
  };

  const sendMutation = useMutation({
    mutationFn: async ({ id, mobile, message, context }: { id: string; mobile: string; message: string; context: string }) => {
      shareOnWhatsApp(mobile, message);
      const { error } = await supabase
        .from("abnormal_history")
        .update({ sent: true, sent_at: new Date().toISOString(), sent_context: context })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["abnormal_history"] });
      toast.success("Abnormal history sent");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { getUnsentForMobile, sendMutation };
}
