import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";

/**
 * Returns a function that checks if a phlebotomist is available on a given date.
 * Checks both specific leave dates and weekly off days.
 */
export function usePhlebotomistAvailability() {
  const { data: leaves = [] } = useQuery({
    queryKey: ["phlebotomist_leaves", "all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("phlebotomist_leaves")
        .select("phlebotomist_id, leave_date")
        .gte("leave_date", format(new Date(), "yyyy-MM-dd"));
      return data || [];
    },
  });

  const isAvailable = (phlebotomist: any, dateStr: string): boolean => {
    if (!dateStr || !phlebotomist) return true;

    // Check weekly off days
    const weeklyOff: number[] = phlebotomist.weekly_off_days || [];
    if (weeklyOff.length > 0) {
      const date = parseISO(dateStr);
      const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      if (weeklyOff.includes(dayOfWeek)) return false;
    }

    // Check specific leave dates
    const hasLeave = leaves.some(
      (l: any) => l.phlebotomist_id === phlebotomist.id && l.leave_date === dateStr
    );
    if (hasLeave) return false;

    return true;
  };

  const getUnavailableReason = (phlebotomist: any, dateStr: string): string | null => {
    if (!dateStr || !phlebotomist) return null;

    const weeklyOff: number[] = phlebotomist.weekly_off_days || [];
    if (weeklyOff.length > 0) {
      const date = parseISO(dateStr);
      const dayOfWeek = date.getDay();
      if (weeklyOff.includes(dayOfWeek)) return "Weekly off";
    }

    const hasLeave = leaves.some(
      (l: any) => l.phlebotomist_id === phlebotomist.id && l.leave_date === dateStr
    );
    if (hasLeave) return "On leave";

    return null;
  };

  return { isAvailable, getUnavailableReason };
}
