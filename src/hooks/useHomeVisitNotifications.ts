import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useHomeVisitNotifications(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    // Request notification permission on mount
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const channel = supabase
      .channel("home-visit-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "home_visits" },
        (payload) => {
          const visit = payload.new as any;
          const title = "🏠 New Home Visit Booked!";
          const body = `Visit on ${visit.visit_date} at ${visit.visit_time}\n📍 ${visit.address}`;

          // Play notification sound
          try {
            const audio = new Audio("/notification.mp3");
            audio.volume = 0.7;
            audio.play().catch(() => {});
          } catch {}

          // Show in-app toast
          toast.info(title, { description: body, duration: 8000 });

          // Show browser/system notification
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, {
              body,
              icon: "/favicon.ico",
              badge: "/favicon.ico",
              tag: `home-visit-${visit.id}`,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
