import RefreshButton from "@/components/lims/RefreshButton";
import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import PaginatedTableFooter from "@/components/ui/PaginatedTableFooter";
import { patientDisplayName } from "@/lib/patientDisplayName";

const PAGE_SIZE = 50;

/**
 * Read-only history of home visits that reached Completed/Registered.
 * Registration now happens from Home Visits → Completed (same New Registration form).
 */
const CompletedHomeVisits = () => {
  useLimsPipelineRealtime("completed_hv");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__chvSearchTimeout);
    (window as any).__chvSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const { data: pagedData, isLoading } = useQuery({
    queryKey: ["completed_home_visits", debouncedSearch, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from("home_visits")
        .select("*, estimates!inner(*), phlebotomists(name)", { count: "exact" })
        .in("status", ["Completed", "Registered"])
        .order("visit_date", { ascending: false })
        .range(from, to);

      if (debouncedSearch) {
        const s = debouncedSearch.trim();
        query = query.or(
          `patient_name.ilike.%${s}%,whatsapp_number.ilike.%${s}%`,
          { foreignTable: "estimates" }
        );
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data || []) as any[], total: count || 0 };
    },
    placeholderData: keepPreviousData,
  });

  const completedVisits = pagedData?.rows || [];
  const total = pagedData?.total || 0;

  const { data: registeredIds = new Set() } = useQuery({
    queryKey: ["registered_home_visit_ids"],
    queryFn: async () => {
      const { data } = await supabase
        .from("patient_registrations")
        .select("home_visit_id")
        .not("home_visit_id", "is", null);
      return new Set((data || []).map((r: any) => r.home_visit_id).filter(Boolean));
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Completed Home Visits</h2>
          <p className="text-sm text-muted-foreground">
            History only. Register patients from Home Visits by choosing Completed — that opens the main registration form.
          </p>
        </div>
        <RefreshButton queryKeys={[["completed_home_visits"], ["registered_home_visit_ids"]]} />
      </div>

      <Input
        placeholder="Search patient or mobile…"
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Visit Date</TableHead>
              <TableHead>Phlebo</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
            ) : completedVisits.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No completed home visits found</TableCell></TableRow>
            ) : completedVisits.map((v: any) => {
              const e = v.estimates;
              const isRegistered = (registeredIds as Set<string>).has(v.id) || v.status === "Registered";
              const isExpanded = expandedRow === v.id;

              return (
                <>
                  <TableRow
                    key={v.id}
                    className={`cursor-pointer ${isRegistered ? "opacity-60" : ""}`}
                    onClick={() => setExpandedRow(isExpanded ? null : v.id)}
                  >
                    <TableCell className="px-2">
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{patientDisplayName(e)}</div>
                    </TableCell>
                    <TableCell className="text-sm">{e?.whatsapp_number}</TableCell>
                    <TableCell className="text-xs">{v.visit_date ? format(new Date(v.visit_date), "dd-MM-yyyy") : "—"}</TableCell>
                    <TableCell className="text-xs font-medium">{v.phlebotomists?.name || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{v.address || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="text-sm font-medium">₹{e?.final_amount}</div>
                      {Number(v.due_amount) > 0 && <div className="text-xs text-destructive">Due: ₹{v.due_amount}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isRegistered ? "default" : "secondary"}>
                        {isRegistered ? "Registered" : v.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow key={`${v.id}-details`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={8} className="py-3 px-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="font-medium text-muted-foreground">Payment: </span>
                            <span>{v.payment_mode || "—"}</span>
                          </div>
                          <div className="space-y-1 text-xs">
                            <div><span className="font-medium text-muted-foreground">Doctor:</span> {e?.doctor_name || "—"}</div>
                            <div><span className="font-medium text-muted-foreground">Gender:</span> {e?.gender || "—"}</div>
                            <div><span className="font-medium text-muted-foreground">DOB:</span> {e?.dob || "—"}</div>
                            <div><span className="font-medium text-muted-foreground">Home Visit Charges:</span> ₹{e?.home_visit_charges || 0}</div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <PaginatedTableFooter page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  );
};

export default CompletedHomeVisits;
