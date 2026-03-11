interface ReportHeaderProps {
  extracted: any;
}

const ReportHeader = ({ extracted }: ReportHeaderProps) => {
  return (
    <div className="border-b border-gray-300 pb-3 mb-4 px-6 text-black">
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm">
        <p><span className="font-semibold">Patient Name:</span> {extracted.patient_name}</p>
        <p className="text-right"><span className="font-semibold">Ref. Doctor:</span> {extracted.ref_doctor || "SELF"}</p>
        <p><span className="font-semibold">Age / Gender:</span> {extracted.age} / {extracted.gender}</p>
        <p className="text-right"><span className="font-semibold">Reg. Date:</span> {extracted.reg_date || "-"}</p>
        <p><span className="font-semibold">UMR No:</span> {extracted.umr_id}</p>
        <p className="text-right"><span className="font-semibold">Sample Coll. Date:</span> {extracted.sample_collection_date || extracted.collection_date || "-"}</p>
        <p><span className="font-semibold">Location:</span> {extracted.location || "-"}</p>
        <p className="text-right"><span className="font-semibold">Authentication Date:</span> {extracted.authentication_date || "-"}</p>
      </div>
    </div>
  );
};

export default ReportHeader;
