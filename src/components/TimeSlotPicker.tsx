import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone } from "lucide-react";
import { useState } from "react";

// Generate time slots from 06:00 to 20:00 in 30-min intervals
const TIME_SLOTS: { value: string; label: string }[] = [];
for (let h = 6; h <= 20; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 20 && m > 0) break; // stop at 08:00 PM
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const value = `${hh}:${mm}`;
    const h12 = h % 12 || 12;
    const ampm = h >= 12 ? "PM" : "AM";
    const label = `${h12}:${mm} ${ampm}`;
    TIME_SLOTS.push({ value, label });
  }
}

interface OccupiedInfo {
  patient_name: string;
  whatsapp_number: string;
  address: string;
}

interface TimeSlotPickerProps {
  date: string;
  phlebotomistId: string;
  selectedTime: string;
  onSelectTime: (time: string) => void;
  /** Optional: exclude this visit ID from occupied check (for editing) */
  excludeVisitId?: string;
}

const TimeSlotPicker = ({ date, phlebotomistId, selectedTime, onSelectTime, excludeVisitId }: TimeSlotPickerProps) => {
  const [occupiedPopup, setOccupiedPopup] = useState<OccupiedInfo | null>(null);

  // Fetch occupied slots for this phlebotomist + date
  const { data: occupiedSlots = {} } = useQuery({
    queryKey: ["occupied_slots", phlebotomistId, date],
    queryFn: async () => {
      if (!phlebotomistId || !date) return {};
      const { data } = await supabase
        .from("home_visits")
        .select("id, visit_time, address, estimates(patient_name, whatsapp_number)")
        .eq("phlebotomist_id", phlebotomistId)
        .eq("visit_date", date)
        .neq("status", "Cancelled");

      const map: Record<string, OccupiedInfo> = {};
      (data || []).forEach((v: any) => {
        if (excludeVisitId && v.id === excludeVisitId) return;
        map[v.visit_time] = {
          patient_name: v.estimates?.patient_name || "Unknown",
          whatsapp_number: v.estimates?.whatsapp_number || "",
          address: v.address || "",
        };
      });
      return map;
    },
    enabled: !!phlebotomistId && !!date,
  });

  if (!date || !phlebotomistId) {
    return <p className="text-xs text-muted-foreground">Select date & phlebotomist to see available slots</p>;
  }

  const handleSlotClick = (slot: { value: string; label: string }) => {
    const occupied = occupiedSlots[slot.value];
    if (occupied) {
      setOccupiedPopup(occupied);
    } else {
      onSelectTime(slot.value);
    }
  };

  return (
    <>
      <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
        {TIME_SLOTS.map((slot) => {
          const isOccupied = !!occupiedSlots[slot.value];
          const isSelected = selectedTime === slot.value;
          return (
            <button
              key={slot.value}
              type="button"
              onClick={() => handleSlotClick(slot)}
              className={`px-1 py-1.5 rounded text-xs font-medium border transition-colors ${
                isOccupied
                  ? "bg-destructive text-destructive-foreground border-destructive cursor-pointer"
                  : isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:bg-accent"
              }`}
            >
              {slot.label}
            </button>
          );
        })}
      </div>

      {/* Occupied slot details popup */}
      <Dialog open={!!occupiedPopup} onOpenChange={(o) => !o && setOccupiedPopup(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Slot Already Booked</DialogTitle></DialogHeader>
          {occupiedPopup && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{occupiedPopup.patient_name}</p>
                <p className="text-xs text-muted-foreground mt-1">{occupiedPopup.address}</p>
              </div>
              <div className="flex items-center gap-2">
                <a href={`tel:${occupiedPopup.whatsapp_number}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Phone className="h-3.5 w-3.5" />
                  {occupiedPopup.whatsapp_number}
                </a>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setOccupiedPopup(null)}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TimeSlotPicker;
