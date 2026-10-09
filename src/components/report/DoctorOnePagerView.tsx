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

function parseFinding(line: string): { label: string; value: string; flag: string; range: string } {
  const text = line.replace(/\s+/g, " ").trim();
  const match = text.match(/^(.*)\s+(\d+(?:\.\d+)?)\s+(\S+)(?:\s+\((?:Ref\s+)?([^)]+)\))?\s+(HH|LL|H|L|N|A|X)$/i);
  if (!match) return { label: text, value: "", flag: "", range: "" };
  return {
    label: match[1].trim(),
    value: `${match[2]} ${match[3]}`,
    range: String(match[4] || "").trim(),
    flag: match[5].toUpperCase(),
  };
}

function rangeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function referenceIndex(results: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of results || []) {
    const range = String(row?.reference_range || "").trim();
    if (!range) continue;
    for (const raw of [row?.parameter_name, row?.param_code, row?.test_name]) {
      const key = rangeKey(String(raw || ""));
      if (key && !map.has(key)) map.set(key, range);
    }
  }
  return map;
}

function lookupRange(label: string, index: Map<string, string>): string {
  const key = rangeKey(label);
  if (!key) return "";
  if (index.has(key)) return index.get(key) || "";
  let best = "";
  let bestLen = 0;
  for (const [candidate, range] of index) {
    if (candidate.length < 3) continue;
    if ((key.includes(candidate) || candidate.includes(key)) && candidate.length > bestLen) {
      best = range;
      bestLen = candidate.length;
    }
  }
  return best;
}

function flagStyle(flag: string): { color: string; background: string } | null {
  if (flag === "H" || flag === "HH" || flag === "A") return { color: "#991b1b", background: "#fee2e2" };
  if (flag === "L" || flag === "LL") return { color: "#9a3412", background: "#ffedd5" };
  if (flag === "N") return { color: "#64748b", background: "#f8fafc" };
  return null;
}

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

  const ranges = referenceIndex(Array.isArray(report?.test_results) ? report.test_results : []);
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
          <div style={{ margin: "6px 0 8px", background: "#1e3a8a", color: "#ffffff", fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "center", padding: "4px 8px" }}>
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
            <div className="flex-1 min-h-0 overflow-hidden" style={{ fontSize: "12px", lineHeight: 1.4 }}>
              <Section title="Clinical snapshot">
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderLeft: "3px solid #1e3a8a", padding: "6px 8px" }}>
                  {summary.overall_clinical_snapshot || "No dominant pattern was identified from the available results."}
                </div>
              </Section>

              {summary.clinical_patterns.length > 0 && (
                <Section title="Key clinical patterns">
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {summary.clinical_patterns.map((pattern, i) => (
                      <PatternCard key={i} pattern={pattern} ranges={ranges} />
                    ))}
                  </div>
                </Section>
              )}

              {changeLines.length > 0 && (
                <Section title="Significant changes">
                  <BulletList items={changeLines} />
                </Section>
              )}

              {summary.important_isolated_findings.length > 0 && (
                <Section title="Isolated findings">
                  <BulletList items={summary.important_isolated_findings} />
                </Section>
              )}

              {summary.suggested_follow_up.length > 0 && (
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
                </Section>
              )}

              {summary.points_for_clinical_review.length > 0 && (
                <Section title="Points for clinical review">
                  <BulletList items={summary.points_for_clinical_review} numbered />
                </Section>
              )}
            </div>
          )}

          <div style={{ marginTop: "auto", paddingTop: "6px", borderTop: "1px solid #e2e8f0", fontSize: "8px", lineHeight: 1.35, color: "#64748b" }}>
            {DISCLAIMER}
          </div>
        </div>
      </div>
    </div>
  );
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: "9px" }}>
      <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#1e3a8a", borderBottom: "1px solid #cbd5e1", marginBottom: "5px", paddingBottom: "2px" }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function PatternCard({
  pattern,
  ranges,
}: {
  pattern: DoctorOnePagerSummary["clinical_patterns"][number];
  ranges: Map<string, string>;
}) {
  const status = STATUS_STYLE[pattern.status] || STATUS_STYLE.INDETERMINATE;
  return (
    <div style={{ border: "1px solid #e2e8f0", borderLeft: "3px solid #1e3a8a", padding: "6px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <strong style={{ fontSize: "13px" }}>{pattern.pattern_name}</strong>
        <span style={{ flexShrink: 0, fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", color: status.color, background: status.background, border: `1px solid ${status.border}`, borderRadius: "999px", padding: "1px 6px" }}>
          {pattern.status}
        </span>
      </div>
      {pattern.current_findings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1px", marginBottom: "4px" }}>
          {pattern.current_findings.map((line, i) => {
            const item = parseFinding(line);
            const range = item.range || lookupRange(item.label, ranges);
            const tone = flagStyle(item.flag);
            const abnormal = item.flag === "H" || item.flag === "HH" || item.flag === "L" || item.flag === "LL" || item.flag === "A";
            if (!item.value) return <div key={i}>{line}</div>;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto auto", columnGap: "8px", alignItems: "baseline", background: abnormal ? "#fff7f7" : "transparent", padding: "1px 3px" }}>
                <span style={{ fontWeight: abnormal ? 600 : 400 }}>{item.label}</span>
                <span style={{ fontWeight: abnormal ? 700 : 400, textAlign: "right", whiteSpace: "nowrap" }}>{item.value}</span>
                <span style={{ color: "#475569", textAlign: "right", whiteSpace: "nowrap" }}>{range ? `Ref ${range}` : ""}</span>
                <span style={{ justifySelf: "end", minWidth: "16px", textAlign: "center", fontSize: "9px", fontWeight: 700, color: tone?.color || "#64748b", background: abnormal ? (tone?.background || "transparent") : "transparent", borderRadius: "2px", padding: "0 3px" }}>
                  {item.flag === "N" ? "" : item.flag}
                </span>
              </div>
            );
          })}
        </div>
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