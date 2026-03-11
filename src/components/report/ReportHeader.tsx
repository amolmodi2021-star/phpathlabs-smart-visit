import { supabase } from "@/integrations/supabase/client";

interface ReportHeaderProps {
  extracted: any;
}

const ReportHeader = ({ extracted }: ReportHeaderProps) => {
  return (
    <div className="border-b border-gray-300 pb-3 mb-4 px-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
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
  );
};

export default ReportHeader;
