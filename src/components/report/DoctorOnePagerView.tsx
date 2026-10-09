import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { toJpeg } from "html-to-image";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import LimsReportHeader from "@/components/report/LimsReportHeader";
import { REPORT_CAPTURE_FONT } from "@/lib/htmlCaptureFonts";
import {
  loadPriorVisitsForOnePager,
  requestDoctorOnePager,
} from "@/lib/doctorOnePager";
import type { DoctorOnePagerSummary } from "@/lib/doctorOnePagerGroups";
import { toast } from "sonner";

const PAGE_W = 210;
const PAGE_H = 297;
const DISCLAIMER =
  "AI-assisted laboratory summary for clinical review only. Not a diagnosis or treatment advice. Refer to the original verified report.";

const STATUS_COLOR: Record<string, string> = {
  NEW: "#b45309",
  PERSISTENT: "#1d4ed8",
  WORSENING: "#b91c1c",
  IMPROVING: "#15803d",
  STABLE: "#334155",
  RESOLVED: "#15803d",
  ISOLATED: "#b45309",
  INDETERMINATE: "#64748b",
};

type Props = {
  report: any;
  letterheadUrl: string | null;
  topMarginCm: number;
  bottomMarginCm: number;
  onBack: () => void;
};

const DoctorOnePagerView = ({ report, letterheadUrl, topMarginCm, bottomMarginCm, onBack }: Props) => {
  const pageRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<DoctorOnePagerSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reportRef = useRef(report);
  useEffect(() => {
    const currentReport = reportRef.current;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const current = Array.isArray(currentReport?.test_results) ? currentReport.test_results : [];
        let priorVisits: Awaited<ReturnType<typeof loadPriorVisitsForOnePager>> = [];
        try {
          priorVisits = await loadPriorVisitsForOnePager(currentReport?.umr_number, currentReport?.registration_id);
        } catch (historyErr) {
          console.warn("doctor summary history skipped", historyErr);
        }
        const next = await requestDoctorOnePager({ current, priorVisits });
        if (!cancelled) setSummary(next);
      } catch (e: any) {
        const message = e?.message || "Could not prepare the doctor summary";
        if (!cancelled) {
          setError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const printPage = () => {
    document.body.classList.add("lims-report-printing");
    const cleanup = () => {
      document.body.classList.remove("lims-report-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  const downloadPdf = async () => {
    const el = pageRef.current;
    if (!el) return;
    setSaving(true);
    try {
      const jpeg = await toJpeg(el, { quality: 0.95, pixelRatio: 2, backgroundColor: "#ffffff" });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      pdf.addImage(jpeg, "JPEG", 0, 0, PAGE_W, PAGE_H, undefined, "NONE");
      const name = [report?.patient_name, report?.invoice_number, "Doctor summary"].filter(Boolean).join(" ");
      pdf.save(`${name}.pdf`);
    } catch (e: any) {
      toast.error(e?.message || "PDF failed");
    } finally {
      setSaving(false);
    }
  };

  const topMm = (Number(topMarginCm) || 2.5) * 10;
  const bottomMm = Math.max(8, (Number(bottomMarginCm) || 1.2) * 10);
  const changes = summary?.historical_changes;
  const changeLines = changes
    ? [
        ...changes.new.map((t) => `New: ${t}`),
        ...changes.worsening.map((t) => `Worsening: ${t}`),
        ...changes.improving.map((t) => `Improving: ${t}`),
        ...changes.stable.map((t) => `Stable: ${t}`),
        ...changes.resolved.map((t) => `Resolved: ${t}`),
      ].slice(0, 5)
    : [];

  return (
    <div className="p-2 sm:p-4 space-y-3 print:p-0">
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          .doctor-toolbar { display: none !important; }
          body.lims-report-printing aside,
          body.lims-report-printing nav,
          body.lims-report-printing header,
          body.lims-report-printing .print\\:hidden { display: none !important; }
          #doctor-one-pager {
            box-shadow: none !important;
            margin: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          #doctor-one-pager [data-report-letterhead] { display: none !important; }
        }
      `}</style>
      <div className="doctor-toolbar flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to report
        </Button>
        <h1 className="text-sm sm:text-lg font-bold flex-1 min-w-0 truncate">Doctor clinical summary</h1>
        <Button size="sm" variant="outline" onClick={printPage} disabled={busy || !!error}>
          <Printer className="h-4 w-4 mr-1" /> Print
        </Button>
        <Button size="sm" onClick={downloadPdf} disabled={busy || !!error || saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          PDF
        </Button>
      </div>

      <div
        id="doctor-one-pager"
        ref={pageRef}
        className="bg-white shadow-lg relative overflow-hidden mx-auto"
        style={{
          width: `${PAGE_W}mm`,
          height: `${PAGE_H}mm`,
          fontFamily: REPORT_CAPTURE_FONT,
          color: "#0f172a",
        }}
      >
        {letterheadUrl && (
          <img data-report-letterhead src={letterheadUrl} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ zIndex: 0 }} />
        )}
        <div
          className="relative h-full box-border flex flex-col"
          style={{ zIndex: 1, paddingTop: `${topMm}mm`, paddingBottom: `${bottomMm}mm`, paddingLeft: "8mm", paddingRight: "8mm" }}
        >
          <LimsReportHeader
            patientName={report.patient_name}
            title={report.title}
            gender={report.gender}
            dob={report.dob}
            ageText={report.age_text ?? null}
            umrNumber={report.umr_number}
            doctorName={report.doctor_name}
            mobileNumber={report.mobile_number}
            email={report.email}
            address={report.address}
            invoiceNumber={report.invoice_number}
            registrationDate={report.registration_date}
            sampleCollectionDate={report.sample_collection_date}
            approvalDate={report.approval_date}
            printDate={report.print_date}
            visitType={report.visit_type}
          />
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#1e3a8a", margin: "4px 0 6px" }}>
            Doctor clinical summary
          </div>

          {busy && (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Preparing summary from current and previous results…
            </div>
          )}
          {!busy && error && (
            <div className="flex-1 text-sm text-red-700 pt-4">{error}</div>
          )}
          {!busy && summary && (
            <div className="flex-1 min-h-0 overflow-hidden" style={{ fontSize: "10.5px", lineHeight: 1.35 }}>
              <Section title="Clinical snapshot">
                <p style={{ margin: 0 }}>{summary.overall_clinical_snapshot || "No dominant pattern was identified from the available results."}</p>
              </Section>

              {summary.clinical_patterns.length > 0 && (
                <Section title="Key clinical patterns">
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {summary.clinical_patterns.map((pattern, i) => (
                      <div key={i} style={{ borderLeft: "3px solid #1d4ed8", paddingLeft: "6px" }}>
                        <div style={{ display: "flex", gap: "6px", alignItems: "baseline", flexWrap: "wrap" }}>
                          <strong>{pattern.pattern_name}</strong>
                          <span style={{ fontSize: "9px", fontWeight: 700, color: STATUS_COLOR[pattern.status] || "#64748b" }}>{pattern.status}</span>
                        </div>
                        {pattern.current_findings.length > 0 && (
                          <div style={{ color: "#0f172a" }}>{pattern.current_findings.join("  ·  ")}</div>
                        )}
                        {pattern.integrated_interpretation && <div>{pattern.integrated_interpretation}</div>}
                        {pattern.historical_context && (
                          <div style={{ color: "#334155" }}><strong>History: </strong>{pattern.historical_context}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {changeLines.length > 0 && (
                <Section title="Significant changes">
                  <ul style={{ margin: 0, paddingLeft: "14px" }}>
                    {changeLines.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </Section>
              )}

              {summary.important_isolated_findings.length > 0 && (
                <Section title="Isolated findings">
                  <ul style={{ margin: 0, paddingLeft: "14px" }}>
                    {summary.important_isolated_findings.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </Section>
              )}

              {summary.points_for_clinical_review.length > 0 && (
                <Section title="Points for clinical review">
                  <ul style={{ margin: 0, paddingLeft: "14px" }}>
                    {summary.points_for_clinical_review.map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </Section>
              )}
            </div>
          )}

          <div style={{ marginTop: "auto", paddingTop: "6px", fontSize: "8px", lineHeight: 1.3, color: "#475569" }}>
            {DISCLAIMER}
          </div>
        </div>
      </div>
    </div>
  );
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: "7px" }}>
      <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#1e3a8a", borderBottom: "1px solid #cbd5e1", marginBottom: "3px" }}>
        {title}
      </div>
      {children}
    </section>
  );
}

export default DoctorOnePagerView;