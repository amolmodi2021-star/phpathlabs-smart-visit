import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Download } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

interface TestResult {
  department?: string;
  profile_name?: string;
  test_name?: string;
  parameter_name: string;
  result_value: string;
  unit?: string;
  normal_range_low?: string;
  normal_range_high?: string;
  normal_range_text?: string;
  flag?: string;
}

interface TrendData {
  parameter_name: string;
  data: { date: string; value: number }[];
  low?: number;
  high?: number;
  unit?: string;
}

const ViewReport = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [extracted, setExtracted] = useState<any>(null);
  const [pathologist, setPathologist] = useState<any>(null);
  const [trends, setTrends] = useState<TrendData[]>([]);

  useEffect(() => { loadReport(); }, [reportId]);

  const loadReport = async () => {
    setLoading(true);
    const { data: ext } = await supabase.from("extracted_report_data").select("*").eq("report_id", reportId).single();
    if (!ext) { setLoading(false); return; }
    setExtracted(ext);

    // Load pathologist signature
    if (ext.pathologist_name) {
      const { data: sig } = await supabase.from("pathologist_signatures").select("*")
        .ilike("pathologist_name", `%${ext.pathologist_name}%`).maybeSingle();
      if (sig) setPathologist(sig);
    }

    // Load trends for analytics parameters
    if (ext.umr_id) {
      const results = (ext.test_results as TestResult[]) || [];
      const paramNames = results.map((r) => r.parameter_name);
      const { data: history } = await supabase.from("test_result_history")
        .select("*").eq("umr_id", ext.umr_id).in("parameter_name", paramNames)
        .order("test_date", { ascending: true });

      if (history && history.length > 0) {
        const grouped: Record<string, TrendData> = {};
        history.forEach((h: any) => {
          if (!grouped[h.parameter_name]) {
            grouped[h.parameter_name] = {
              parameter_name: h.parameter_name,
              data: [],
              low: h.normal_range_low,
              high: h.normal_range_high,
              unit: h.unit,
            };
          }
          grouped[h.parameter_name].data.push({
            date: new Date(h.test_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
            value: h.result_value,
          });
        });
        setTrends(Object.values(grouped).filter((t) => t.data.length >= 2));
      }
    }
    setLoading(false);
  };

  const handlePrint = () => window.print();

  if (loading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!extracted) return <div className="p-8 text-center">Report not found.</div>;

  const results = (extracted.test_results as unknown as TestResult[]) || [];
  const abnormalResults = results.filter((r) => r.flag === "H" || r.flag === "L");

  // Group by department then profile
  const grouped: Record<string, Record<string, TestResult[]>> = {};
  results.forEach((r) => {
    const dept = r.department || "General";
    const prof = r.profile_name || "_individual";
    if (!grouped[dept]) grouped[dept] = {};
    if (!grouped[dept][prof]) grouped[dept][prof] = [];
    grouped[dept][prof].push(r);
  });

  // Profile detection: only show profile header if >=2 params
  const shouldShowProfile = (params: TestResult[]) => params.length >= 2;

  const signatureUrl = pathologist?.signature_image_path
    ? supabase.storage.from("signatures").getPublicUrl(pathologist.signature_image_path).data.publicUrl
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={() => navigate("/reports")}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <Button size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />Print / Save PDF</Button>
      </div>

      <div ref={printRef} className="bg-white text-black print:text-black mx-auto max-w-[210mm] print:max-w-none" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        {/* Report Header */}
        <div className="border-b-2 border-blue-600 pb-4 mb-4 px-6 pt-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-blue-800">PH PATH LABS</h1>
            <p className="text-xs text-gray-500 mt-1">Advanced Diagnostic Centre</p>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div className="space-y-1">
              <p><span className="font-semibold">Patient Name:</span> {extracted.patient_name}</p>
              <p><span className="font-semibold">Age / Gender:</span> {extracted.age} / {extracted.gender}</p>
              <p><span className="font-semibold">UMR No:</span> {extracted.umr_id}</p>
            </div>
            <div className="space-y-1 text-right">
              <p><span className="font-semibold">Ref. Doctor:</span> {extracted.ref_doctor || "SELF"}</p>
              <p><span className="font-semibold">Collection Date:</span> {extracted.collection_date}</p>
              <p><span className="font-semibold">Report Date:</span> {extracted.report_date}</p>
            </div>
          </div>
        </div>

        <div className="px-6 space-y-6">
          {/* Abnormal Summary */}
          {abnormalResults.length > 0 && (
            <div className="border border-red-200 rounded-lg p-4 bg-red-50 print:break-inside-avoid">
              <h2 className="text-base font-bold text-red-700 mb-2 border-b border-red-200 pb-1">⚠ Abnormal Results Summary</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-red-600">
                    <th className="py-1">Test</th>
                    <th className="py-1">Result</th>
                    <th className="py-1">Unit</th>
                    <th className="py-1">Range</th>
                    <th className="py-1">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {abnormalResults.map((r, i) => (
                    <tr key={i} className="text-red-800 font-semibold">
                      <td className="py-0.5">{r.parameter_name}</td>
                      <td className="py-0.5">{r.result_value}</td>
                      <td className="py-0.5">{r.unit}</td>
                      <td className="py-0.5">{r.normal_range_text || `${r.normal_range_low || ""}-${r.normal_range_high || ""}`}</td>
                      <td className="py-0.5"><span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-xs">{r.flag}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Main Report - Department wise */}
          {Object.entries(grouped).map(([dept, profiles]) => (
            <div key={dept} className="print:break-inside-avoid">
              <div className="bg-blue-600 text-white px-3 py-1.5 rounded-t font-semibold text-sm">{dept}</div>
              <div className="border border-t-0 rounded-b">
                {Object.entries(profiles).map(([profName, params]) => (
                  <div key={profName} className="print:break-inside-avoid">
                    {profName !== "_individual" && shouldShowProfile(params) && (
                      <div className="bg-blue-50 px-3 py-1 font-semibold text-sm text-blue-800 border-b">{profName}</div>
                    )}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b">
                          <th className="text-left py-1 px-3 w-[35%]">Parameter</th>
                          <th className="text-center py-1 w-[15%]">Result</th>
                          <th className="text-center py-1 w-[10%]">Unit</th>
                          <th className="text-center py-1 w-[25%]">Reference Range</th>
                          <th className="text-center py-1 w-[10%]">Flag</th>
                        </tr>
                      </thead>
                      <tbody>
                        {params.map((r, i) => {
                          const isAbnormal = r.flag === "H" || r.flag === "L";
                          return (
                            <tr key={i} className={`border-b border-gray-100 ${isAbnormal ? "bg-red-50" : ""}`}>
                              <td className="py-1 px-3">{r.parameter_name}</td>
                              <td className={`py-1 text-center font-semibold ${isAbnormal ? "text-red-600 font-bold" : ""}`}>{r.result_value}</td>
                              <td className="py-1 text-center text-gray-600">{r.unit}</td>
                              <td className="py-1 text-center text-gray-600">{r.normal_range_text || `${r.normal_range_low || ""} - ${r.normal_range_high || ""}`}</td>
                              <td className="py-1 text-center">
                                {isAbnormal && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-xs font-bold">{r.flag}</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Historical Trends */}
          {trends.length > 0 && (
            <div className="print:break-before-page">
              <h2 className="text-base font-bold text-blue-800 mb-3 border-b-2 border-blue-200 pb-1">Historical Trends</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
                {trends.slice(0, 6).map((trend) => (
                  <div key={trend.parameter_name} className="border rounded-lg p-3 print:break-inside-avoid">
                    <h3 className="text-sm font-semibold mb-1">{trend.parameter_name} {trend.unit && <span className="text-xs text-gray-500">({trend.unit})</span>}</h3>
                    <ResponsiveContainer width="100%" height={150}>
                      <LineChart data={trend.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: "#2563eb" }} />
                        {trend.high && <ReferenceLine y={trend.high} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "High", fontSize: 9, fill: "#ef4444" }} />}
                        {trend.low && <ReferenceLine y={trend.low} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Low", fontSize: 9, fill: "#f59e0b" }} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pathologist Signature */}
          <div className="mt-8 pt-4 border-t flex justify-end print:break-inside-avoid">
            <div className="text-center">
              {signatureUrl && <img src={signatureUrl} alt="Signature" className="h-16 mx-auto mb-1" />}
              <p className="font-semibold text-sm">{pathologist?.pathologist_name || extracted.pathologist_name}</p>
              {pathologist?.qualification && <p className="text-xs text-gray-500">{pathologist.qualification}</p>}
              {pathologist?.designation && <p className="text-xs text-gray-500">{pathologist.designation}</p>}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 border-t pt-2 px-6 pb-4 text-center text-xs text-gray-400">
          <p>This is a computer generated report. | Generated by PH Path Labs Report System</p>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #root { visibility: visible; }
          .print\\:hidden { display: none !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .print\\:break-before-page { break-before: page; }
          @page { margin: 10mm; size: A4; }
        }
      `}</style>
    </div>
  );
};

export default ViewReport;
