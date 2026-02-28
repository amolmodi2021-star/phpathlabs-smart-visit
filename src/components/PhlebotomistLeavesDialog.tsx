import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { format, parseISO } from "date-fns";

const DAYS_OF_WEEK = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  phlebotomist: any;
}

const PhlebotomistLeavesDialog = ({ open, onClose, phlebotomist }: Props) => {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [reason, setReason] = useState("");
  const [localWeeklyOff, setLocalWeeklyOff] = useState<number[]>([]);
  const [initialized, setInitialized] = useState<string | null>(null);

  // Sync local state when dialog opens for a different phlebotomist
  if (phlebotomist?.id && phlebotomist.id !== initialized) {
    setLocalWeeklyOff(phlebotomist.weekly_off_days || []);
    setInitialized(phlebotomist.id);
  }

  const weeklyOffDays = localWeeklyOff;

  const { data: leaves = [] } = useQuery({
    queryKey: ["phlebotomist_leaves", phlebotomist?.id],
    queryFn: async () => {
      if (!phlebotomist?.id) return [];
      const { data } = await supabase
        .from("phlebotomist_leaves")
        .select("*")
        .eq("phlebotomist_id", phlebotomist.id)
        .gte("leave_date", format(new Date(), "yyyy-MM-dd"))
        .order("leave_date");
      return data || [];
    },
    enabled: !!phlebotomist?.id,
  });

  const addLeaveMutation = useMutation({
    mutationFn: async (date: Date) => {
      const { error } = await supabase.from("phlebotomist_leaves").insert({
        phlebotomist_id: phlebotomist.id,
        leave_date: format(date, "yyyy-MM-dd"),
        reason: reason || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phlebotomist_leaves", phlebotomist?.id] });
      toast.success("Leave added");
      setSelectedDate(undefined);
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteLeaveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("phlebotomist_leaves").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phlebotomist_leaves", phlebotomist?.id] });
      toast.success("Leave removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleWeeklyOff = useMutation({
    mutationFn: async (day: number) => {
      // Single day only: toggle off if same, otherwise set to just this day
      const updated = localWeeklyOff.includes(day) ? [] : [day];
      setLocalWeeklyOff(updated); // Immediate UI update
      const { error } = await supabase
        .from("phlebotomists")
        .update({ weekly_off_days: updated })
        .eq("id", phlebotomist.id);
      if (error) throw error;
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phlebotomists"] });
      toast.success("Weekly off updated");
    },
    onError: (e: Error) => {
      // Revert on error
      setLocalWeeklyOff(phlebotomist.weekly_off_days || []);
      toast.error(e.message);
    },
  });

  const leaveDates = leaves.map((l: any) => parseISO(l.leave_date));

  const isLeaveDate = (date: Date) =>
    leaveDates.some((d) => format(d, "yyyy-MM-dd") === format(date, "yyyy-MM-dd"));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{phlebotomist?.name} – Availability</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Weekly Off Days */}
          <div>
            <Label className="text-sm font-semibold">Weekly Off Day</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Select the day when this phlebotomist has a recurring weekly off. Only one day allowed.
            </p>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const isSelected = weeklyOffDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleWeeklyOff.mutate(day.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      isSelected
                        ? "bg-destructive text-destructive-foreground border-destructive"
                        : "bg-muted text-muted-foreground border-border hover:bg-accent"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calendar for specific leaves */}
          <div>
            <Label className="text-sm font-semibold">Mark Specific Leave Dates</Label>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
              modifiers={{ leave: leaveDates }}
              modifiersClassNames={{ leave: "bg-destructive/20 text-destructive font-bold" }}
              className="p-3 pointer-events-auto mt-1"
            />
            {selectedDate && !isLeaveDate(selectedDate) && (
              <div className="flex gap-2 mt-2">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => addLeaveMutation.mutate(selectedDate)}
                  disabled={addLeaveMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </div>
            )}
          </div>

          {/* Upcoming Leaves List */}
          {leaves.length > 0 && (
            <div>
              <Label className="text-sm font-semibold">Upcoming Leaves</Label>
              <div className="space-y-1 mt-1">
                {leaves.map((l: any) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between rounded-md border px-3 py-1.5"
                  >
                    <div>
                      <span className="text-sm font-medium">
                        {format(parseISO(l.leave_date), "dd MMM yyyy (EEEE)")}
                      </span>
                      {l.reason && (
                        <span className="text-xs text-muted-foreground ml-2">
                          – {l.reason}
                        </span>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteLeaveMutation.mutate(l.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PhlebotomistLeavesDialog;
