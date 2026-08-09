import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, Plus, AlertTriangle } from "lucide-react";
import { format, parseISO, addDays, getDay } from "date-fns";
import { usePhlebotomistAvailability } from "@/hooks/usePhlebotomistAvailability";
import { patientDisplayName } from "@/lib/patientDisplayName";

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

interface ConflictVisit {
  id: string;
  visit_date: string;
  visit_time: string;
  address: string;
  estimate?: { patient_name: string | null; title?: string | null; gender?: string | null; whatsapp_number: string } | null;
}

const PhlebotomistLeavesDialog = ({ open, onClose, phlebotomist }: Props) => {
  const qc = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [reason, setReason] = useState("");
  const [localWeeklyOff, setLocalWeeklyOff] = useState<number[]>([]);
  const [initialized, setInitialized] = useState<string | null>(null);

  // Conflict states
  const [conflictVisits, setConflictVisits] = useState<ConflictVisit[]>([]);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: "weekly_off"; day: number } | { type: "leave"; date: Date } | null>(null);
  const [reassignMap, setReassignMap] = useState<Record<string, string>>({});

  if (phlebotomist?.id && phlebotomist.id !== initialized) {
    setLocalWeeklyOff(phlebotomist.weekly_off_days || []);
    setInitialized(phlebotomist.id);
  }

  const weeklyOffDays = localWeeklyOff;

  // Fetch all active phlebotomists for reassignment
  const { data: allPhlebotomists = [] } = useQuery({
    queryKey: ["phlebotomists"],
    queryFn: async () => {
      const { data } = await supabase.from("phlebotomists").select("*").order("name");
      return data || [];
    },
  });

  const { isAvailable, getUnavailableReason } = usePhlebotomistAvailability();

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

  // Check for conflicting visits on specific dates
  const checkConflicts = async (dates: string[]): Promise<ConflictVisit[]> => {
    if (!dates.length || !phlebotomist?.id) return [];
    const { data } = await supabase
      .from("home_visits")
      .select("id, visit_date, visit_time, address, estimate:estimates(patient_name, title, gender, whatsapp_number)")
      .eq("phlebotomist_id", phlebotomist.id)
      .in("visit_date", dates)
      .neq("status", "Cancelled");
    return (data || []) as unknown as ConflictVisit[];
  };

  // Get future dates for a given day of week (next 90 days)
  const getFutureDatesForDay = (dayOfWeek: number): string[] => {
    const dates: string[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 90; i++) {
      const d = addDays(today, i);
      if (getDay(d) === dayOfWeek) dates.push(format(d, "yyyy-MM-dd"));
    }
    return dates;
  };

  const handleWeeklyOffToggle = async (day: number) => {
    const wouldSet = !localWeeklyOff.includes(day);
    if (!wouldSet) {
      // Removing weekly off — no conflict
      toggleWeeklyOff.mutate(day);
      return;
    }
    // Check conflicts on all future occurrences of this day
    const dates = getFutureDatesForDay(day);
    const conflicts = await checkConflicts(dates);
    if (conflicts.length > 0) {
      setConflictVisits(conflicts);
      setPendingAction({ type: "weekly_off", day });
      setReassignMap({});
      setConflictOpen(true);
    } else {
      toggleWeeklyOff.mutate(day);
    }
  };

  const handleAddLeave = async (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const conflicts = await checkConflicts([dateStr]);
    if (conflicts.length > 0) {
      setConflictVisits(conflicts);
      setPendingAction({ type: "leave", date });
      setReassignMap({});
      setConflictOpen(true);
    } else {
      addLeaveMutation.mutate(date);
    }
  };

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
      const updated = localWeeklyOff.includes(day) ? [] : [day];
      setLocalWeeklyOff(updated);
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
      setLocalWeeklyOff(phlebotomist.weekly_off_days || []);
      toast.error(e.message);
    },
  });

  // Reassign all conflicting visits and then proceed with the pending action
  const reassignAndProceed = useMutation({
    mutationFn: async () => {
      // Check all conflicts have been reassigned
      const unassigned = conflictVisits.filter((v) => !reassignMap[v.id]);
      if (unassigned.length > 0) throw new Error("Please reassign all visits before proceeding.");

      // Reassign each visit
      for (const visit of conflictVisits) {
        const newPhlebId = reassignMap[visit.id];
        const { error } = await supabase
          .from("home_visits")
          .update({ phlebotomist_id: newPhlebId })
          .eq("id", visit.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      toast.success("Visits reassigned successfully");
      setConflictOpen(false);
      setConflictVisits([]);

      // Now proceed with the original action
      if (pendingAction?.type === "weekly_off") {
        toggleWeeklyOff.mutate(pendingAction.day);
      } else if (pendingAction?.type === "leave") {
        addLeaveMutation.mutate(pendingAction.date);
      }
      setPendingAction(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaveDates = leaves.map((l: any) => parseISO(l.leave_date));

  const isLeaveDate = (date: Date) =>
    leaveDates.some((d) => format(d, "yyyy-MM-dd") === format(date, "yyyy-MM-dd"));

  // Fetch existing visits for other phlebotomists on conflict dates to check time slot clashes
  const conflictDates = [...new Set(conflictVisits.map((v) => v.visit_date))];
  const { data: existingVisitsOnDates = [] } = useQuery({
    queryKey: ["existing_visits_conflict", conflictDates.join(",")],
    queryFn: async () => {
      if (!conflictDates.length) return [];
      const { data } = await supabase
        .from("home_visits")
        .select("id, phlebotomist_id, visit_date, visit_time")
        .in("visit_date", conflictDates)
        .neq("status", "Cancelled");
      return data || [];
    },
    enabled: conflictDates.length > 0 && conflictOpen,
  });

  // Available phlebotomists for reassignment (active, not current one)
  const getAvailablePhlebos = (visitDate: string) => {
    return allPhlebotomists.filter((p: any) => p.id !== phlebotomist?.id && p.status === "Active");
  };

  // Check if a phlebotomist already has a visit at the same time on the same date
  const hasTimeSlotConflict = (phlebId: string, visitDate: string, visitTime: string): boolean => {
    return existingVisitsOnDates.some(
      (ev: any) => ev.phlebotomist_id === phlebId && ev.visit_date === visitDate && ev.visit_time === visitTime
    );
  };

  return (
    <>
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
                      onClick={() => handleWeeklyOffToggle(day.value)}
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
                    onClick={() => handleAddLeave(selectedDate)}
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
                          {format(parseISO(l.leave_date), "dd-MM-yyyy (EEEE)")}
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

      {/* Conflict Reassignment Dialog */}
      <Dialog open={conflictOpen} onOpenChange={(o) => { if (!o) { setConflictOpen(false); setPendingAction(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Home Visits Assigned
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {phlebotomist?.name} has <strong>{conflictVisits.length}</strong> home visit(s) on the selected date(s). Please reassign them to another phlebotomist before proceeding.
          </p>
          <div className="space-y-3 mt-2">
            {conflictVisits.map((v) => {
              const availablePhlebos = getAvailablePhlebos(v.visit_date);
              return (
                <div key={v.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {format(parseISO(v.visit_date), "dd-MM-yyyy")} • {v.visit_time}
                      </p>
                      <p className="text-xs text-muted-foreground">{v.address}</p>
                      {(v.estimate as any)?.patient_name && (
                        <p className="text-xs font-medium mt-0.5">{patientDisplayName(v.estimate as any)}</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Reassign to</Label>
                    <Select
                      value={reassignMap[v.id] || ""}
                      onValueChange={(val) => setReassignMap((prev) => ({ ...prev, [v.id]: val }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select phlebotomist" />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePhlebos.map((p: any) => {
                          const unavailReason = getUnavailableReason(p, v.visit_date);
                          const timeConflict = hasTimeSlotConflict(p.id, v.visit_date, v.visit_time);
                          const disableReason = unavailReason || (timeConflict ? "Time slot occupied" : null);
                          return (
                            <SelectItem key={p.id} value={p.id} disabled={!!disableReason}>
                              {p.name}{disableReason ? ` (${disableReason})` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={() => { setConflictOpen(false); setPendingAction(null); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => reassignAndProceed.mutate()}
              disabled={reassignAndProceed.isPending || conflictVisits.some((v) => !reassignMap[v.id])}
            >
              Reassign & Proceed
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PhlebotomistLeavesDialog;
