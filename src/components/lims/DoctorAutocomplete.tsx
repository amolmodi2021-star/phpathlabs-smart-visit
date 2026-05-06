import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

interface Doctor {
  id: string;
  doctor_name: string;
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export default function DoctorAutocomplete({ value, onChange, disabled, placeholder = "SELF", className }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Doctor | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data: doctors = [] } = useQuery({
    queryKey: ["doctors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, doctor_name")
        .order("doctor_name");
      if (error) throw error;
      return (data || []) as Doctor[];
    },
  });

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = (value || "").trim().toUpperCase();
    if (!q) return doctors.slice(0, 50);
    return doctors.filter(d => d.doctor_name.toUpperCase().includes(q)).slice(0, 50);
  }, [doctors, value]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const { error } = await supabase.from("doctors").delete().eq("id", pendingDelete.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Doctor removed");
    qc.invalidateQueries({ queryKey: ["doctors"] });
    setPendingDelete(null);
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={`uppercase ${className || ""}`}
        autoComplete="off"
      />
      {open && filtered.length > 0 && !disabled && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between px-2 py-1.5 hover:bg-accent text-sm cursor-pointer group"
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest("[data-del]")) return;
                onChange(d.doctor_name);
                setOpen(false);
              }}
            >
              <span>{d.doctor_name}</span>
              <button
                data-del
                type="button"
                className="opacity-0 group-hover:opacity-100 text-destructive p-1"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setPendingDelete(d); }}
                title="Delete from history"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <DeletePasswordDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        onSuccess={handleDelete}
        description={pendingDelete ? `Remove "${pendingDelete.doctor_name}" from doctor history? Existing registrations and reports will not be affected.` : undefined}
      />
    </div>
  );
}

/**
 * Add a doctor to the master list if not already present (case-insensitive).
 * Skips empty / SELF.
 */
export async function ensureDoctor(name?: string | null) {
  const cleaned = (name || "").trim().toUpperCase();
  if (!cleaned || cleaned === "SELF") return;
  try {
    await supabase.from("doctors").insert({ doctor_name: cleaned } as any);
  } catch {
    // ignore unique violation
  }
}
