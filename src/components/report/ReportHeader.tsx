interface ReportHeaderProps {
  extracted: any;
}

const formatDateTimeTo12Hr = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "-";
  // Replace 24hr time (HH:MM or HH:MM:SS) with 12hr format
  const timeRegex = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:hrs?)?/i;
  const match = dateStr.match(timeRegex);
  if (!match) return dateStr;
  
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const formattedTime = `${hours}:${minutes} ${period}`;
  
  return dateStr.replace(timeRegex, formattedTime);
};

const ReportHeader = ({ extracted }: ReportHeaderProps) => {
  return (
    <div className="border-b border-gray-300 pb-3 mb-4 px-6 text-black">
      <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-sm">
        {/* Left Column */}
        <div className="grid gap-y-0.5" style={{ gridTemplateColumns: '90px 1fr' }}>
          <span className="font-semibold">Patient Name</span><span>: {extracted.patient_name}</span>
          <span className="font-semibold">Age / Gender</span><span>: {extracted.age} / {extracted.gender}</span>
          <span className="font-semibold">UMR No</span><span>: {extracted.umr_id}</span>
          <span className="font-semibold">Location</span><span>: {extracted.location || "-"}</span>
        </div>
        {/* Right Column */}
        <div className="grid gap-y-0.5" style={{ gridTemplateColumns: '150px 1fr' }}>
          <span className="font-semibold">Ref. Doctor</span><span>: {extracted.ref_doctor || "SELF"}</span>
          <span className="font-semibold">Reg. Date</span><span>: {formatDateTimeTo12Hr(extracted.reg_date)}</span>
          <span className="font-semibold">Sample Coll. Date</span><span>: {formatDateTimeTo12Hr(extracted.sample_collection_date || extracted.collection_date)}</span>
          <span className="font-semibold">Authentication Date</span><span>: {formatDateTimeTo12Hr(extracted.authentication_date)}</span>
        </div>
      </div>
    </div>
  );
};

export default ReportHeader;
