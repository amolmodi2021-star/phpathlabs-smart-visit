import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import { toast } from "sonner";

const normalizeMobile = (value: string) => value.replace(/\D/g, "").slice(-10);

/**
 * Hook to find abnormal history for a mobile number
 * and send it (unlimited times).
 */
export function useAbnormalHistory(mobiles: string[] = []) {
  const qc = useQueryClient();
  const normalizedMobiles = Array.from(new Set(mobiles.map((m) => normalizeMobile(String(m || ""))).filter((m) => m.length === 10)));

  const { data: allRecords = [] } = useQuery({
    queryKey: ["abnormal_history", normalizedMobiles],
    queryFn: async () => {
      if (normalizedMobiles.length === 0) return [];
      const { data } = await supabase
        .from("abnormal_history")
        .select("*")
        .in("mobile_number", normalizedMobiles);
      return data || [];
    },
  });

  const getForMobile = (mobile: string): any | null => {
    const normalized = normalizeMobile(String(mobile || ""));
    return allRecords.find((r: any) => normalizeMobile(String(r.mobile_number || "")) === normalized) || null;
  };

  const sendMutation = useMutation({
    mutationFn: async ({ id, mobile, message, context }: { id: string; mobile: string; message: string; context: string }) => {
      shareOnWhatsApp(mobile, message);
      logMessageSend(mobile, "", "Abnormal History");
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

  return { getForMobile, sendMutation };
}
