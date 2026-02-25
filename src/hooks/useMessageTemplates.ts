import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Templates {
  estimate_header: string;
  visit_confirmation_header: string;
  fasting_instructions: string;
  home_visit_disclaimer: string;
  footer_text: string;
}

const defaults: Templates = {
  estimate_header: "PH PathLabs - Estimate",
  visit_confirmation_header: "PH PathLabs - Visit Confirmation",
  fasting_instructions: "8 to 10 hours of fasting is required.",
  home_visit_disclaimer: "Home visit charges are not included and will be charged extra depending on your area of visit.",
  footer_text: "LabLine : 6356 55 66 99\nPH PathLabs - Vesu",
};

export function useMessageTemplates() {
  return useQuery({
    queryKey: ["message_templates"],
    queryFn: async () => {
      const { data } = await supabase.from("message_templates").select("*");
      if (!data || data.length === 0) return defaults;
      const map: Record<string, string> = {};
      data.forEach((r: any) => { map[r.template_key] = r.template_value; });
      return { ...defaults, ...map } as Templates;
    },
  });
}
