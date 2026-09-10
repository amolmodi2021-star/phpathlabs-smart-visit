import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { exportToExcel } from "@/lib/excel";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { patientDisplayName } from "@/lib/patientDisplayName";
import {
  buildIncentiveCatalog,
  payoutBucketNet,
  registrationHvc,
  registrationIncentiveDetails,
  registrationPayoutBucket,
} from "@/lib/phleboPayout";

interface PhleboExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Earned lines count toward totals. Hold/deducted show 0 in amount columns (audit text in Status). */
function lineAmounts(
  bucket: "earned" | "hold" | "deducted" | "none",
  hvcAbs: number,
  incAbs: number,
): { hvc: number; inc: number; total: number; auditHvc: number; auditInc: number } {
  const hvc = Math.abs(Number(hvcAbs) || 0);
  const inc = Math.abs(Number(incAbs) || 0);
  if (bucket === "earned") {
    return { hvc, inc, total: hvc + inc, auditHvc: hvc, auditInc: inc };
  }
  // Do not put negatives (or positives) into sum columns — that would under/over-count payable.
  return { hvc: 0, inc: 0, total: 0, auditHvc: hvc, auditInc: inc };
}

const PhleboExportDialog = ({ open, onOpenChange }: PhleboExportDialogProps) => {
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loading, setLoading] = useState(false);

  const monthOptions = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(now, i);
      return { value: format(d, "yyyy-MM"), label: format(d, "MMMM yyyy") };
    });
  }, []);

  const handleExport = async () => {
    if (!selectedMonth) {
      toast.error("Please select a month");
      return;
    }

    setLoading(true);
    try {
      const [year, month] = selectedMonth.split("-").map(Number);
      const monthDate = new Date(year, month - 1, 1);
      const start = format(startOfMonth(monthDate), "yyyy-MM-dd");
      const end = format(endOfMonth(monthDate), "yyyy-MM-dd");
      const monthLabel = format(monthDate, "MMMM yyyy");

      const { data: visits } = await supabase
        .from("home_visits")
        .select("id, estimate_id, phlebotomist_id, visit_date, address, status")
        .in("status", ["Completed", "Registered"])
        .gte("visit_date", start)
        .lte("visit_date", end)
        .order("visit_date", { ascending: true });

      if (!visits || visits.length === 0) {
        toast.error("No registered home visits found for " + monthLabel);
        setLoading(false);
        return;
      }

      const visitIds = visits.map((v) => v.id);
      const phleboIds = [...new Set(visits.filter((v) => v.phlebotomist_id).map((v) => v.phlebotomist_id!))];

      const [regsRes, phleboRes, testsRes, checkupsRes, profilesRes, combosRes] = await Promise.all([
        supabase
          .from("patient_registrations")
          .select(
            "id, home_visit_id, home_visit_charges, due_amount, bill_cancelled, patient_name, title, gender, invoice_number, umr_number, mobile_number, tests, cancelled_tests",
          )
          .in("home_visit_id", visitIds),
        supabase.from("phlebotomists").select("id, name").in("id", phleboIds),
        supabase.from("tests").select("id, test_name, incentive_allowed, incentive_amount"),
        supabase.from("health_checkups").select("id, health_checkup_name, incentive_allowed, incentive_amount"),
        supabase.from("billing_profiles").select("id, profile_name, incentive_allowed, incentive_amount"),
        (supabase as any).from("combos").select("id, combo_name, incentive_allowed, incentive_amount"),
      ]);

      const registrations = regsRes.data || [];
      if (registrations.length === 0) {
        toast.error("No registered patients found for " + monthLabel);
        setLoading(false);
        return;
      }

      const visitMap: Record<string, (typeof visits)[0]> = {};
      visits.forEach((v) => {
        visitMap[v.id] = v;
      });

      const phleboMap: Record<string, string> = {};
      (phleboRes.data || []).forEach((p) => {
        phleboMap[p.id] = p.name;
      });

      const catalog = buildIncentiveCatalog([
        {
          rows: (testsRes.data || []).map((t) => ({
            id: t.id,
            name: t.test_name,
            incentive_allowed: t.incentive_allowed,
            incentive_amount: t.incentive_amount,
          })),
        },
        {
          rows: (checkupsRes.data || []).map((c: any) => ({
            id: c.id,
            name: `${c.health_checkup_name} (Package)`,
            incentive_allowed: c.incentive_allowed,
            incentive_amount: c.incentive_amount,
          })),
        },
        {
          rows: (profilesRes.data || []).map((p: any) => ({
            id: p.id,
            name: `${p.profile_name} (Profile)`,
            incentive_allowed: p.incentive_allowed,
            incentive_amount: p.incentive_amount,
          })),
        },
        {
          rows: (combosRes.data || []).map((c: any) => ({
            id: c.id,
            name: `${c.combo_name} (Combo)`,
            incentive_allowed: c.incentive_allowed,
            incentive_amount: c.incentive_amount,
          })),
        },
      ]);

      type RowReg = (typeof registrations)[0];
      const grouped: Record<string, RowReg[]> = {};
      for (const reg of registrations) {
        const visit = visitMap[reg.home_visit_id || ""];
        if (!visit) continue;
        const pid = visit.phlebotomist_id || "unassigned";
        if (!grouped[pid]) grouped[pid] = [];
        grouped[pid].push(reg);
      }

      const rows: Record<string, unknown>[] = [];
      let grandEarnedIncentive = 0;
      let grandEarnedHvc = 0;
      let grandEarnedTotal = 0;
      let grandEarned = 0;
      let grandDeductedAbs = 0;
      let grandHoldAbs = 0;

      const sortedPhleboIds = Object.keys(grouped).sort((a, b) =>
        (phleboMap[a] || "Unassigned").localeCompare(phleboMap[b] || "Unassigned"),
      );

      for (const pid of sortedPhleboIds) {
        const regs = grouped[pid].sort((a, b) => {
          const va = visitMap[a.home_visit_id || ""]?.visit_date || "";
          const vb = visitMap[b.home_visit_id || ""]?.visit_date || "";
          if (va !== vb) return va.localeCompare(vb);
          return String(a.invoice_number || "").localeCompare(String(b.invoice_number || ""));
        });
        const phleboName = phleboMap[pid] || "Unassigned";

        const hvcBuckets = { earned: 0, hold: 0, deducted: 0 };
        const incBuckets = { earned: 0, hold: 0, deducted: 0 };

        rows.push({
          Phlebotomist: phleboName,
          "Visit Date": "",
          "Invoice #": "",
          "Patient Name": "",
          Address: "",
          "Incentive Test Name": "",
          "Incentive Amount": "",
          "Home Visit Charge": "",
          Status: "",
          "Total Amount": "",
        });

        for (const reg of regs) {
          const visit = visitMap[reg.home_visit_id || ""];
          if (!visit) continue;

          const hvcAbs = registrationHvc(reg);
          const inc = registrationIncentiveDetails(reg, catalog);
          const bucket = registrationPayoutBucket(reg);
          const amounts = lineAmounts(bucket, hvcAbs, inc.total);

          const statusLabel =
            bucket === "deducted"
              ? `Deducted (bill cancelled) | HVC ${amounts.auditHvc} | Inc ${amounts.auditInc}`
              : bucket === "hold"
                ? `On Hold (due) | HVC ${amounts.auditHvc} | Inc ${amounts.auditInc}`
                : "Earned";

          const dd = String(visit.visit_date || "").split("-");
          const formattedDate = dd.length === 3 ? `${dd[2]}-${dd[1]}-${dd[0]}` : visit.visit_date;

          rows.push({
            Phlebotomist: "",
            "Visit Date": formattedDate,
            "Invoice #": reg.invoice_number || "",
            "Patient Name": patientDisplayName(reg),
            Address: visit.address || "",
            "Incentive Test Name": inc.names.join(", ") || "-",
            "Incentive Amount": amounts.inc,
            "Home Visit Charge": amounts.hvc,
            Status: statusLabel,
            "Total Amount": amounts.total,
          });

          if (bucket === "earned") {
            hvcBuckets.earned += hvcAbs;
            incBuckets.earned += inc.total;
          } else if (bucket === "deducted") {
            hvcBuckets.deducted += hvcAbs;
            incBuckets.deducted += inc.total;
          } else if (bucket === "hold") {
            hvcBuckets.hold += hvcAbs;
            incBuckets.hold += inc.total;
          }
        }

        // Net payable = earned only. Hold/deducted are listed for audit, not subtracted again.
        const holdAbs = hvcBuckets.hold + incBuckets.hold;
        const deductedAbs = hvcBuckets.deducted + incBuckets.deducted;
        const earnedHvc = hvcBuckets.earned;
        const earnedInc = incBuckets.earned;
        const netPayable = payoutBucketNet({
          earned: earnedHvc + earnedInc,
          hold: holdAbs,
          deducted: deductedAbs,
        });

        rows.push({
          Phlebotomist: "",
          "Visit Date": "",
          "Invoice #": "",
          "Patient Name": "",
          Address: "",
          "Incentive Test Name": `${phleboName} TOTAL`,
          "Incentive Amount": earnedInc,
          "Home Visit Charge": earnedHvc,
          Status: `Net Payable ${netPayable} | Hold ${holdAbs} | Deducted ${deductedAbs}`,
          "Total Amount": netPayable,
        });
        rows.push({
          Phlebotomist: "",
          "Visit Date": "",
          "Invoice #": "",
          "Patient Name": "",
          Address: "",
          "Incentive Test Name": "",
          "Incentive Amount": "",
          "Home Visit Charge": "",
          Status: "",
          "Total Amount": "",
        });

        grandEarnedIncentive += earnedInc;
        grandEarnedHvc += earnedHvc;
        grandEarnedTotal += netPayable;
        grandEarned += earnedHvc + earnedInc;
        grandDeductedAbs += deductedAbs;
        grandHoldAbs += holdAbs;
      }

      const grandNetPayable = payoutBucketNet({
        earned: grandEarned,
        hold: grandHoldAbs,
        deducted: grandDeductedAbs,
      });

      rows.push({
        Phlebotomist: "",
        "Visit Date": "",
        "Invoice #": "",
        "Patient Name": "",
        Address: "",
        "Incentive Test Name": "GRAND TOTAL",
        "Incentive Amount": grandEarnedIncentive,
        "Home Visit Charge": grandEarnedHvc,
        Status: `Net Payable ${grandNetPayable} | Hold ${grandHoldAbs} | Deducted ${grandDeductedAbs}`,
        "Total Amount": grandEarnedTotal,
      });

      exportToExcel(rows, `Phlebo_Report_${monthLabel.replace(" ", "_")}`);
      toast.success("Report downloaded successfully");
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download Phlebo Report</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Select Month</Label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger>
                <SelectValue placeholder="Choose month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            One row per registered patient. Net Payable / column totals = earned only. On Hold and Deducted rows show ₹0 in amount columns (details in Status) so they are not subtracted twice.
          </p>
          <Button className="w-full" onClick={handleExport} disabled={loading}>
            <Download className="h-4 w-4 mr-2" />
            {loading ? "Generating..." : "Download Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PhleboExportDialog;