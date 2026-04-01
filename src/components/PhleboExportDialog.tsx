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

interface PhleboExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PhleboExportDialog = ({ open, onOpenChange }: PhleboExportDialogProps) => {
  const [selectedMonth, setSelectedMonth] = useState("");
  const [loading, setLoading] = useState(false);

  // Generate last 12 months options
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

      // Fetch completed visits for the month
      const { data: visits } = await supabase
        .from("home_visits")
        .select("id, estimate_id, phlebotomist_id, visit_date, address, status")
        .eq("status", "Completed")
        .gte("visit_date", start)
        .lte("visit_date", end)
        .order("visit_date", { ascending: true });

      if (!visits || visits.length === 0) {
        toast.error("No completed visits found for " + monthLabel);
        setLoading(false);
        return;
      }

      const estimateIds = [...new Set(visits.map((v) => v.estimate_id))];
      const phleboIds = [...new Set(visits.filter((v) => v.phlebotomist_id).map((v) => v.phlebotomist_id!))];

      // Fetch all related data in parallel
      const [estimatesRes, phleboRes, estTestsRes, testsRes] = await Promise.all([
        supabase.from("estimates").select("id, patient_name, home_visit_charges").in("id", estimateIds),
        supabase.from("phlebotomists").select("id, name").in("id", phleboIds),
        supabase.from("estimate_tests").select("estimate_id, test_id, test_name").in("estimate_id", estimateIds),
        supabase.from("tests").select("id, test_name, incentive_allowed, incentive_amount"),
      ]);

      const estimateMap: Record<string, { patient_name: string; home_visit_charges: number }> = {};
      (estimatesRes.data || []).forEach((e) => {
        estimateMap[e.id] = { patient_name: e.patient_name || "", home_visit_charges: Number(e.home_visit_charges) || 0 };
      });

      const phleboMap: Record<string, string> = {};
      (phleboRes.data || []).forEach((p) => { phleboMap[p.id] = p.name; });

      const testIncentiveMap: Record<string, { name: string; amount: number }> = {};
      (testsRes.data || []).forEach((t) => {
        if (t.incentive_allowed) testIncentiveMap[t.id] = { name: t.test_name, amount: Number(t.incentive_amount) || 0 };
      });

      // Map estimate -> incentive test names and total incentive
      const estimateIncentiveMap: Record<string, { names: string[]; total: number }> = {};
      (estTestsRes.data || []).forEach((et) => {
        const inc = testIncentiveMap[et.test_id];
        if (inc) {
          if (!estimateIncentiveMap[et.estimate_id]) estimateIncentiveMap[et.estimate_id] = { names: [], total: 0 };
          estimateIncentiveMap[et.estimate_id].names.push(inc.name);
          estimateIncentiveMap[et.estimate_id].total += inc.amount;
        }
      });

      // Group visits by phlebotomist
      const grouped: Record<string, typeof visits> = {};
      visits.forEach((v) => {
        const pid = v.phlebotomist_id || "unassigned";
        if (!grouped[pid]) grouped[pid] = [];
        grouped[pid].push(v);
      });

      // Build rows
      const rows: Record<string, unknown>[] = [];
      let grandTotalIncentive = 0;
      let grandTotalHomeVisit = 0;
      let grandTotal = 0;

      const sortedPhleboIds = Object.keys(grouped).sort((a, b) => (phleboMap[a] || "Unassigned").localeCompare(phleboMap[b] || "Unassigned"));

      for (const pid of sortedPhleboIds) {
        const pVisits = grouped[pid];
        const phleboName = phleboMap[pid] || "Unassigned";
        let phleboIncentiveTotal = 0;
        let phleboHomeVisitTotal = 0;

        // Add phlebotomist header
        rows.push({ "Phlebotomist": phleboName, "Visit Date": "", "Patient Name": "", "Address": "", "Incentive Test Name": "", "Incentive Amount": "", "Home Visit Charge": "", "Total Amount": "" });

        for (const v of pVisits) {
          const est = estimateMap[v.estimate_id] || { patient_name: "", home_visit_charges: 0 };
          const incData = estimateIncentiveMap[v.estimate_id] || { names: [], total: 0 };
          const homeCharge = est.home_visit_charges;
          const incAmount = incData.total;
          const totalAmt = homeCharge + incAmount;

          const dd = v.visit_date.split("-");
          const formattedDate = `${dd[2]}-${dd[1]}-${dd[0]}`;

          rows.push({
            "Phlebotomist": "",
            "Visit Date": formattedDate,
            "Patient Name": est.patient_name,
            "Address": v.address,
            "Incentive Test Name": incData.names.join(", "),
            "Incentive Amount": incAmount,
            "Home Visit Charge": homeCharge,
            "Total Amount": totalAmt,
          });

          phleboIncentiveTotal += incAmount;
          phleboHomeVisitTotal += homeCharge;
        }

        const phleboTotal = phleboIncentiveTotal + phleboHomeVisitTotal;
        rows.push({
          "Phlebotomist": "",
          "Visit Date": "",
          "Patient Name": "",
          "Address": "",
          "Incentive Test Name": `${phleboName} Total`,
          "Incentive Amount": phleboIncentiveTotal,
          "Home Visit Charge": phleboHomeVisitTotal,
          "Total Amount": phleboTotal,
        });
        rows.push({ "Phlebotomist": "", "Visit Date": "", "Patient Name": "", "Address": "", "Incentive Test Name": "", "Incentive Amount": "", "Home Visit Charge": "", "Total Amount": "" });

        grandTotalIncentive += phleboIncentiveTotal;
        grandTotalHomeVisit += phleboHomeVisitTotal;
        grandTotal += phleboTotal;
      }

      rows.push({
        "Phlebotomist": "",
        "Visit Date": "",
        "Patient Name": "",
        "Address": "",
        "Incentive Test Name": "GRAND TOTAL",
        "Incentive Amount": grandTotalIncentive,
        "Home Visit Charge": grandTotalHomeVisit,
        "Total Amount": grandTotal,
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
        <DialogHeader><DialogTitle>Download Phlebo Report</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Select Month</Label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger><SelectValue placeholder="Choose month" /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
