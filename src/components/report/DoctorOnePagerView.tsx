import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { matchPatternResultRows, type DoctorOnePagerSummary } from "@/lib/doctorOnePagerGroups";
import { referencesForSummary } from "@/lib/doctorOnePagerSources";
import { toast } from "sonner";

const PAGE_W = 210;
const PAGE_H = 297;
const DISCLAIMER =
  "Laboratory summary for clinical review only. It's not a diagnosis or treatment advice. Refer to the original approved report.";

const STATUS_STYLE: Record<string, { color: string; background: string; border: string }> = {
  NEW: { color: "#9a3412", background: "#ffedd5", border: "#fdba74" },
  PERSISTENT: { color: "#1e40af", background: "#dbeafe", border: "#93c5fd" },
  WORSENING: { color: "#991b1b", background: "#fee2e2", border: "#fca5a5" },
  IMPROVING: { color: "#166534", background: "#dcfce7", border: "#86efac" },
  STABLE: { color: "#334155", background: "#f1f5f9", border: "#cbd5e1" },
  RESOLVED: { color: "#166534", background: "#dcfce7", border: "#86efac" },
  ISOLATED: { color: "#9a3412", background: "#ffedd5", border: "#fdba74" },
  INDETERMINATE: { color: "#475569", background: "#f1f5f9", border: "#cbd5e1" },
};


type Props = {
  report: any;
  letterheadUrl: string | null;
  topMarginCm: number;
  bottomMarginCm: number;
  onBack: () => void;
};

const DoctorOnePagerView = ({ report, letterheadUrl, topMarginCm, bottomMarginCm, onBack }: Props) => {
  const pagesRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<DoctorOnePagerSummary | null>(null);
  const [pageGroups, setPageGroups] = useState<number[][] | null>(null);
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
    const root = pagesRef.current;
    if (!root) return;
    const pages = Array.from(root.querySelectorAll<HTMLElement>("[data-doctor-page]"));
    if (!pages.length) return;
    setSaving(true);
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let i = 0; i < pages.length; i++) {
        const jpeg = await toJpeg(pages[i], { quality: 0.95, pixelRatio: 2, backgroundColor: "#ffffff" });
        if (i > 0) pdf.addPage();
        pdf.addImage(jpeg, "JPEG", 0, 0, PAGE_W, PAGE_H, undefined, "NONE");
      }
      const name = [report?.patient_name, report?.invoice_number, "Doctor summary"].filter(Boolean).join(" ");
      pdf.save(`${name}.pdf`);
    } catch (e: any) {
      toast.error(e?.message || "PDF failed");
    } finally {
      setSaving(false);
    }
  };

  const labResults = Array.isArray(report?.test_results) ? report.test_results : [];
  const topMm = (Number(topMarginCm) || 2.5) * 10;
  const bottomMm = Math.max(12, (Number(bottomMarginCm) || 1.2) * 10);
  const blocks = summary ? summaryBlocks(summary, labResults, changeLinesOf(summary)) : [];

  useLayoutEffect(() => {
    if (!summary || !measureRef.current) {
      setPageGroups(null);
      return;
    }
    const root = measureRef.current;
    const pagePx = root.querySelector<HTMLElement>("[data-ruler-page]")?.offsetHeight || 0;
    const topPx = root.querySelector<HTMLElement>("[data-ruler-top]")?.offsetHeight || 0;
    const bottomPx = root.querySelector<HTMLElement>("[data-ruler-bottom]")?.offsetHeight || 0;
    const chromePx = root.querySelector<HTMLElement>("[data-summary-chrome]")?.offsetHeight || 0;
    const disclaimerPx = root.querySelector<HTMLElement>("[data-summary-disclaimer]")?.offsetHeight || 0;
    const usable = pagePx - topPx - bottomPx - chromePx - disclaimerPx - 6;
    const heights = Array.from(root.querySelectorAll<HTMLElement>("[data-summary-block]")).map((el) => el.offsetHeight);
    const groups: number[][] = [];
    let current: number[] = [];
    let used = 0;
    heights.forEach((height, index) => {
      const next = current.length ? used + height : height;
      if (current.length > 0 && next > usable) {
        groups.push(current);
        current = [index];
        used = height;
      } else {
        current.push(index);
        used = next;
      }
    });
    if (current.length) groups.push(current);
    setPageGroups(groups.length ? groups : [[]]);
  }, [summary, topMm, bottomMm, blocks.length]);

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
          [data-doctor-page] {
            box-shadow: none !important;
            margin: 0 !important;
            break-after: page;
            page-break-after: always;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          [data-doctor-page]:last-child { break-after: auto; page-break-after: auto; }
          [data-report-letterhead] { display: none !important; }
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

      {(busy || (summary && !pageGroups)) && (
        <div className="bg-white shadow-lg mx-auto flex items-center justify-center gap-2 text-sm text-slate-500" style={{ width: `${PAGE_W}mm`, height: `${PAGE_H}mm` }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Preparing summary from current and previous results…
        </div>
      )}
      {!busy && error && (
        <div className="bg-white shadow-lg mx-auto text-sm text-red-700 p-6" style={{ width: `${PAGE_W}mm` }}>{error}</div>
      )}

      {summary && (
        <div
          ref={measureRef}
          aria-hidden
          style={{ position: "absolute", left: "-10000px", top: 0, width: "194mm", fontFamily: REPORT_CAPTURE_FONT, fontSize: "12px", lineHeight: 1.4, visibility: "hidden" }}
        >
          <div data-ruler-page style={{ height: `${PAGE_H}mm` }} />
          <div data-ruler-top style={{ height: `${topMm}mm` }} />
          <div data-ruler-bottom style={{ height: `${bottomMm}mm` }} />
          <div data-summary-chrome>
            <SummaryChrome report={report} />
          </div>
          {blocks.map((block, index) => (
            <div key={index} data-summary-block>{block}</div>
          ))}
          <div data-summary-disclaimer><DisclaimerLine /></div>
        </div>
      )}

      {summary && pageGroups && (
        <div ref={pagesRef} id="doctor-one-pager" className="flex flex-col items-center gap-4">
          {pageGroups.map((indexes, pageIndex) => (
            <SummarySheet key={pageIndex} report={report} letterheadUrl={letterheadUrl} topMm={topMm} bottomMm={bottomMm}>
              {indexes.map((index) => (
                <div key={index}>{blocks[index]}</div>
              ))}
            </SummarySheet>
          ))}
        </div>
      )}
    </div>
  );
};

function SummaryChrome({ report }: { report: any }) {
  return (
    <>
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
      <div style={{ margin: "6px 0 8px", background: "#1e3a8a", color: "#ffffff", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center", padding: "4px 8px" }}>
        Doctor clinical summary
      </div>
    </>
  );
}

function DisclaimerLine() {
  return (
    <div style={{ paddingTop: "6px", borderTop: "1px solid #e2e8f0", fontSize: "8px", lineHeight: 1.35, color: "#64748b" }}>
      {DISCLAIMER}
    </div>
  );
}

function SummarySheet({
  report,
  letterheadUrl,
  topMm,
  bottomMm,
  children,
}: {
  report: any;
  letterheadUrl: string | null;
  topMm: number;
  bottomMm: number;
  children: ReactNode;
}) {
  return (
    <div
      data-doctor-page
      className="bg-white shadow-lg relative overflow-hidden"
      style={{ width: `${PAGE_W}mm`, height: `${PAGE_H}mm`, fontFamily: REPORT_CAPTURE_FONT, color: "#0f172a" }}
    >
      {letterheadUrl && (
        <img data-report-letterhead src={letterheadUrl} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ zIndex: 0 }} />
      )}
      <div
        className="relative h-full box-border flex flex-col"
        style={{ zIndex: 1, paddingTop: `${topMm}mm`, paddingBottom: `${bottomMm}mm`, paddingLeft: "8mm", paddingRight: "8mm" }}
      >
        <SummaryChrome report={report} />
        <div style={{ fontSize: "12px", lineHeight: 1.4 }}>{children}</div>
        <div style={{ marginTop: "auto" }}>
          <DisclaimerLine />
        </div>
      </div>
    </div>
  );
}

function changeLinesOf(summary: DoctorOnePagerSummary): string[] {
  const changes = summary.historical_changes;
  return [
    ...changes.new.map((t) => `New: ${t}`),
    ...changes.worsening.map((t) => `Worsening: ${t}`),
    ...changes.improving.map((t) => `Improving: ${t}`),
    ...changes.stable.map((t) => `Stable: ${t}`),
    ...changes.resolved.map((t) => `Resolved: ${t}`),
  ].slice(0, 5);
}

function summaryBlocks(
  summary: DoctorOnePagerSummary,
  labResults: any[],
  changeLines: string[],
): ReactNode[] {
  const blocks: ReactNode[] = [];
  blocks.push(
    <Section title="Clinical snapshot">
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderLeft: "3px solid #1e3a8a", padding: "6px 8px" }}>
        {summary.overall_clinical_snapshot || "No dominant pattern was identified from the available results."}
      </div>
    </Section>,
  );
  summary.clinical_patterns.forEach((pattern, index) => {
    blocks.push(
      <div style={{ paddingBottom: "8px" }}>
        {index === 0 && <SectionTitle>Key clinical patterns</SectionTitle>}
        <PatternCard pattern={pattern} results={labResults} />
      </div>,
    );
  });
  if (changeLines.length > 0) {
    blocks.push(
      <Section title="Significant changes">
        <BulletList items={changeLines} />
      </Section>,
    );
  }
  if (summary.important_isolated_findings.length > 0) {
    blocks.push(
      <Section title="Isolated findings">
        <BulletList items={summary.important_isolated_findings} />
      </Section>,
    );
  }
  if (summary.suggested_follow_up.length > 0) {
    blocks.push(
      <Section title="Suggested follow-up tests">
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          {summary.suggested_follow_up.map((item, i) => (
            <div key={i}>
              <strong>{item.test}</strong>
              {item.when ? <span> — {item.when}</span> : null}
              {item.note ? <span style={{ color: "#334155" }}>. {item.note}</span> : null}
            </div>
          ))}
        </div>
      </Section>,
    );
  }
  if (summary.points_for_clinical_review.length > 0) {
    blocks.push(
      <Section title="Points for clinical review">
        <BulletList items={summary.points_for_clinical_review} numbered />
      </Section>,
    );
  }
  const references = referencesForSummary(summary);
  if (references.length > 0) {
    blocks.push(
      <Section title="References">
        <div style={{ fontSize: "11px", color: "#334155", marginBottom: "4px" }}>
          Clinical comments on this page follow these published sources.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {references.map((ref) => (
            <div key={ref.id}>
              <a href={ref.url} target="_blank" rel="noopener noreferrer" style={{ color: "#1d4ed8", textDecoration: "underline" }}>
                {ref.title}
              </a>
              <div style={{ fontSize: "10px", color: "#1e40af", wordBreak: "break-all" }}>{ref.url}</div>
            </div>
          ))}
        </div>
      </Section>,
    );
  }
  return blocks;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#1e3a8a", borderBottom: "1px solid #cbd5e1", marginBottom: "5px", paddingBottom: "2px" }}>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ paddingBottom: "9px" }}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

function PatternCard({
  pattern,
  results,
}: {
  pattern: DoctorOnePagerSummary["clinical_patterns"][number];
  results: any[];
}) {
  const status = STATUS_STYLE[pattern.status] || STATUS_STYLE.INDETERMINATE;
  const rows = matchPatternResultRows(pattern.current_findings, pattern.related_parameters_considered, results);
  return (
    <div style={{ border: "1px solid #e2e8f0", borderLeft: "3px solid #1e3a8a", padding: "6px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <strong style={{ fontSize: "13px" }}>{pattern.pattern_name}</strong>
        <span style={{ flexShrink: 0, fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", color: status.color, background: status.background, border: `1px solid ${status.border}`, borderRadius: "999px", padding: "1px 6px" }}>
          {pattern.status}
        </span>
      </div>
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginBottom: "4px", fontSize: "11px" }}>
          <thead>
            <tr style={{ color: "#64748b", borderBottom: "1px solid #cbd5e1" }}>
              <th style={{ textAlign: "left", width: "32%", fontWeight: 600, padding: "2px 4px" }}>Parameter</th>
              <th style={{ textAlign: "center", width: "18%", fontWeight: 600, padding: "2px 4px" }}>Result</th>
              <th style={{ textAlign: "left", width: "38%", fontWeight: 600, padding: "2px 4px" }}>Reference Range</th>
              <th style={{ textAlign: "center", width: "12%", fontWeight: 600, padding: "2px 4px" }}>Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const high = row.flag === "H" || row.flag === "HH";
              const low = row.flag === "L" || row.flag === "LL";
              const abnormal = high || low;
              return (
                <tr key={row.parameter_name} style={{ borderBottom: "1px solid #f1f5f9", background: abnormal ? "#fef2f2" : "transparent", verticalAlign: "top" }}>
                  <td style={{ padding: "3px 4px", fontWeight: abnormal ? 700 : 400, color: abnormal ? "#dc2626" : "#0f172a" }}>{row.parameter_name}</td>
                  <td style={{ padding: "3px 4px", textAlign: "center", fontWeight: abnormal ? 700 : 400, color: abnormal ? "#dc2626" : "#0f172a", whiteSpace: "nowrap" }}>
                    {row.result_value}{row.unit ? ` ${row.unit}` : ""}
                  </td>
                  <td style={{ padding: "3px 4px", color: "#334155", whiteSpace: "pre-line", lineHeight: 1.25 }}>{row.reference_range}</td>
                  <td style={{ padding: "3px 4px", textAlign: "center", fontWeight: 700, color: high ? "#dc2626" : low ? "#2563eb" : "#64748b" }}>
                    {high ? "HIGH" : low ? "LOW" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {pattern.integrated_interpretation && <div>{pattern.integrated_interpretation}</div>}
      {pattern.historical_context && (
        <div style={{ marginTop: "2px", color: "#475569" }}><strong>History: </strong>{pattern.historical_context}</div>
      )}
    </div>
  );
}

function BulletList({ items, numbered }: { items: string[]; numbered?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {items.map((line, i) => (
        <div key={i} style={{ display: "flex", gap: "6px" }}>
          <span style={{ flexShrink: 0, width: "12px", color: "#1e3a8a", fontWeight: 700 }}>{numbered ? `${i + 1}.` : "•"}</span>
          <span>{line}</span>
        </div>
      ))}
    </div>
  );
}

export default DoctorOnePagerView;