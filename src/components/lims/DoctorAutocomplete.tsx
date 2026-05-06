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
  const [highlight, setHighlight] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<Doctor | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  // Reset highlight when list changes
  useEffect(() => { setHighlight(0); }, [value, open]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const { error } = await supabase.from("doctors").delete().eq("id", pendingDelete.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Doctor removed");
    qc.invalidateQueries({ queryKey: ["doctors"] });
    setPendingDelete(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const pick = filtered[highlight];
      if (pick) {
        e.preventDefault();
        onChange(pick.doctor_name);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`uppercase ${className || ""}`}
        autoComplete="off"
      />
      {open && filtered.length > 0 && !disabled && (
        <div ref={listRef} className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((d, idx) => (
            <div
              key={d.id}
              data-idx={idx}
              className={`flex items-center justify-between px-2 py-1.5 text-sm cursor-pointer group ${idx === highlight ? "bg-accent" : "hover:bg-accent"}`}
              onMouseEnter={() => setHighlight(idx)}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest("[data-del]")) return;
                e.preventDefault();
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
