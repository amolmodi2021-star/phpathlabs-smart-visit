import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, CheckCircle, Eye, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import EditAndRegisterHomeVisitDialog from "@/components/lims/EditAndRegisterHomeVisitDialog";
import { logPaymentTransaction } from "@/lib/paymentTransactions";

const CompletedHomeVisits = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [reviewVisit, setReviewVisit] = useState<any>(null);
  const [editVisit, setEditVisit] = useState<any>(null);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__chvSearchTimeout);
    (window as any).__chvSearchTimeout = setTimeout(() => setDebouncedSearch(val), 400);
  };

  // Fetch completed home visits with estimate details
  const { data: completedVisits = [], isLoading } = useQuery({
    queryKey: ["completed_home_visits", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("home_visits")
        .select("*, estimates(*)")
        .in("status", ["Completed", "Registered"])
        .order("visit_date", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      let visits = (data || []) as any[];

      // Filter by search
      if (debouncedSearch) {
        const s = debouncedSearch.toLowerCase();
        visits = visits.filter((v: any) => {
          const e = v.estimates;
          return (
            e?.patient_name?.toLowerCase().includes(s) ||
            e?.whatsapp_number?.includes(s) ||
            e?.umr_number?.toLowerCase().includes(s)
          );
        });
      }

      return visits;
    },
  });

  // Fetch already registered home_visit_ids
  const { data: registeredIds = new Set() } = useQuery({
    queryKey: ["registered_home_visit_ids"],
    queryFn: async () => {
      const { data } = await supabase
        .from("patient_registrations")
        .select("home_visit_id")
        .not("home_visit_id", "is", null);
      return new Set((data || []).map((r: any) => r.home_visit_id));
    },
  });

  // Fetch estimate tests for review
  const { data: reviewTests = [] } = useQuery({
    queryKey: ["review_estimate_tests", reviewVisit?.estimate_id],
    enabled: !!reviewVisit?.estimate_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("estimate_tests")
        .select("*")
        .eq("estimate_id", reviewVisit.estimate_id);
      return (data || []) as any[];
    },
  });

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: async (visit: any) => {
      const e = visit.estimates;
      // Get estimate tests
      const { data: tests } = await supabase
        .from("estimate_tests")
        .select("*")
        .eq("estimate_id", visit.estimate_id);
      const testList = (tests || []).map((t: any) => ({
        test_id: t.test_id,
        test_name: t.test_name,
        price: t.price,
        discounted_price: t.discounted_price,
        discount_applicable: t.discount_applicable,
        fasting_required: t.fasting_required,
      }));

      const grossAmount = testList.reduce((s: number, t: any) => s + Number(t.price), 0);
      const netAmount = testList.reduce((s: number, t: any) => s + Number(t.discounted_price), 0);
      const homeCharges = Number(e.home_visit_charges || 0);
      const finalAmount = netAmount + homeCharges;
      const paidAmount = Number(visit.paid_amount || 0);
      const dueAmount = Math.max(0, finalAmount - paidAmount);

      // Parse payment modes from home visit
      const payments: any[] = [];
      if (visit.payment_mode) {
        const parts = visit.payment_mode.split(",").map((p: string) => p.trim());
        for (const part of parts) {
          const match = part.match(/^(.+?):\s*₹?(\d+(?:\.\d+)?)$/);
          if (match) {
            payments.push({ mode: match[1].trim(), amount: Number(match[2]) });
          }
        }
      }
      if (payments.length === 0 && paidAmount > 0) {
        payments.push({ mode: "Cash", amount: paidAmount });
      }

      // Generate invoice number
      const { data: invNum } = await supabase.rpc("generate_invoice_number");

      // Generate or reuse UMR
      let umrNumber = e.umr_number;
      if (!umrNumber) {
        const { data: umr } = await supabase.rpc("generate_umr_number");
        umrNumber = umr;
      }

      const { data: insertedReg, error } = await supabase.from("patient_registrations").insert({
        invoice_number: invNum,
        patient_name: e.patient_name || "",
        mobile_number: e.whatsapp_number || "",
        title: e.title || null,
        gender: e.gender || null,
        dob: e.dob || null,
        email: e.email || null,
        doctor_name: e.doctor_name || "SELF",
        umr_number: umrNumber,
        address: visit.address || "",
        visit_type: "home_visit",
        tests: testList,
        gross_amount: grossAmount,
        discount_amount: Number(e.discount_amount || 0),
        net_amount: netAmount,
        home_visit_charges: homeCharges,
        final_amount: finalAmount,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        payments: payments,
        status: "registered",
        home_visit_id: visit.id,
        global_discount_type: e.global_discount_type || null,
        global_discount_value: Number(e.global_discount_value || 0),
      } as any).select().single();

      if (error) throw error;

      // Log payment transaction (always, even when paid_amount = 0)
      if (insertedReg) {
        logPaymentTransaction({
          registration_id: (insertedReg as any).id,
          invoice_number: (insertedReg as any).invoice_number,
          patient_name: (insertedReg as any).patient_name,
          transaction_type: "registration_payment",
          direction: "in",
          payments,
          total_amount: paidAmount,
          gross_amount: grossAmount,
          discount_amount: Number(e.discount_amount || 0),
          final_amount: finalAmount,
          paid_amount: paidAmount,
          due_amount: dueAmount,
        });
      }

      // Update home_visits status to "Registered"
      const { error: statusError } = await supabase.from("home_visits").update({ status: "Registered" }).eq("id", visit.id);
      if (statusError) console.error("Failed to update home visit status:", statusError);
    },
    onSuccess: () => {
      toast.success("Home visit registered successfully!");
      qc.invalidateQueries({ queryKey: ["completed_home_visits"] });
      qc.invalidateQueries({ queryKey: ["home_visits"] });
      qc.invalidateQueries({ queryKey: ["registered_home_visit_ids"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations"] });
      qc.invalidateQueries({ queryKey: ["patient_registrations_count"] });
      setReviewVisit(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const pending = completedVisits.filter((v: any) => !(registeredIds as Set<string>).has(v.id));
  const registered = completedVisits.filter((v: any) => (registeredIds as Set<string>).has(v.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search by name, mobile, UMR..." className="pl-8" />
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        {pending.length} pending registration(s), {registered.length} already registered
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Visit Date</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
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
                      <div className="text-sm font-medium">{e?.title} {e?.patient_name}</div>
                      {e?.umr_number && <div className="text-xs text-muted-foreground">{e.umr_number}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{e?.whatsapp_number}</TableCell>
                    <TableCell className="text-xs">{v.visit_date ? format(new Date(v.visit_date), "dd-MM-yyyy") : "—"}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{v.address || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="text-sm font-medium">₹{e?.final_amount}</div>
                      {Number(v.due_amount) > 0 && <div className="text-xs text-destructive">Due: ₹{v.due_amount}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isRegistered ? "default" : "secondary"}>
                        {isRegistered ? "Registered" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Edit Visit"
                          disabled={isRegistered}
                          onClick={() => setEditVisit(v)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Review & Register"
                          disabled={isRegistered}
                          onClick={() => setReviewVisit(v)}
                        >
                          {isRegistered ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Eye className="h-4 w-4" />}
                        </Button>
                      </div>
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

      {/* Review & Register Dialog */}
      <Dialog open={!!reviewVisit} onOpenChange={o => !o && setReviewVisit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review & Register Home Visit</DialogTitle>
          </DialogHeader>
          {reviewVisit && (() => {
            const e = reviewVisit.estimates;
            const grossAmount = reviewTests.reduce((s: number, t: any) => s + Number(t.price), 0);
            const netAmount = reviewTests.reduce((s: number, t: any) => s + Number(t.discounted_price), 0);
            const homeCharges = Number(e?.home_visit_charges || 0);
            const finalAmount = netAmount + homeCharges;

            return (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="font-medium text-muted-foreground">Name:</span> {e?.title} {e?.patient_name}</div>
                  <div><span className="font-medium text-muted-foreground">Mobile:</span> {e?.whatsapp_number}</div>
                  <div><span className="font-medium text-muted-foreground">Gender:</span> {e?.gender || "—"}</div>
                  <div><span className="font-medium text-muted-foreground">DOB:</span> {e?.dob || "—"}</div>
                  <div><span className="font-medium text-muted-foreground">Doctor:</span> {e?.doctor_name || "SELF"}</div>
                  <div><span className="font-medium text-muted-foreground">Visit Date:</span> {reviewVisit.visit_date ? format(new Date(reviewVisit.visit_date), "dd-MM-yyyy") : "—"}</div>
                  <div className="col-span-2"><span className="font-medium text-muted-foreground">Address:</span> {reviewVisit.address}</div>
                </div>

                <div>
                  <span className="font-medium text-muted-foreground">Tests:</span>
                  <div className="mt-1 space-y-0.5">
                    {reviewTests.map((t: any) => (
                      <div key={t.id} className="text-xs flex justify-between">
                        <span>• {t.test_name}</span>
                        <span>₹{t.discounted_price} {Number(t.price) !== Number(t.discounted_price) && <span className="line-through text-muted-foreground ml-1">₹{t.price}</span>}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t pt-2 space-y-1 text-xs">
                  <div className="flex justify-between"><span>Gross Amount</span><span>₹{grossAmount}</span></div>
                  <div className="flex justify-between"><span>Discount</span><span>₹{Number(e?.discount_amount || 0)}</span></div>
                  <div className="flex justify-between"><span>Net Amount</span><span>₹{netAmount}</span></div>
                  <div className="flex justify-between"><span>Home Visit Charges</span><span>₹{homeCharges}</span></div>
                  <div className="flex justify-between font-medium text-sm"><span>Final Amount</span><span>₹{finalAmount}</span></div>
                  <div className="flex justify-between"><span>Paid</span><span>₹{reviewVisit.paid_amount}</span></div>
                  <div className="flex justify-between text-destructive"><span>Due</span><span>₹{Math.max(0, finalAmount - Number(reviewVisit.paid_amount || 0))}</span></div>
                  <div className="flex justify-between"><span>Payment Mode</span><span>{reviewVisit.payment_mode || "—"}</span></div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewVisit(null)}>Cancel</Button>
            <Button
              onClick={() => registerMutation.mutate(reviewVisit)}
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? "Registering..." : "Confirm & Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Edit & Register Home Visit Dialog */}
      <EditAndRegisterHomeVisitDialog
        visit={editVisit}
        open={!!editVisit}
        onClose={() => {
          setEditVisit(null);
          qc.invalidateQueries({ queryKey: ["completed_home_visits"] });
        }}
      />
    </div>
  );
};

export default CompletedHomeVisits;
