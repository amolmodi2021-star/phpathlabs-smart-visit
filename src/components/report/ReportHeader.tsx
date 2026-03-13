interface ReportHeaderProps {
  extracted: any;
}

const cleanDateTime = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "-";
  // Fix "AMPM" → determine correct AM/PM based on hour, or fix "3:47 AMPM" patterns
  return dateStr.replace(/(\d{1,2}):(\d{2})\s*AMPM/gi, (_, h, m) => {
    const hours = parseInt(h, 10);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${m} ${period}`;
  });
};

const formatDateTimeTo12Hr = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "-";
  const cleaned = cleanDateTime(dateStr);
  // Replace 24hr time (HH:MM or HH:MM:SS) with 12hr format
  const timeRegex = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:hrs?)?/i;
  const match = cleaned.match(timeRegex);
  if (!match) return cleaned;
  
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const formattedTime = `${hours}:${minutes} ${period}`;
  
  return cleaned.replace(timeRegex, formattedTime);
};

const ReportHeader = ({ extracted }: ReportHeaderProps) => {
  return (
    <div className="border-b border-gray-300 pb-3 mb-4 text-black" style={{ paddingLeft: '12mm', paddingRight: '6mm' }}>
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
          <span className="font-semibold">Sample Coll. Date</span><span>: {cleanDateTime(extracted.sample_collection_date || extracted.collection_date)}</span>
          <span className="font-semibold">Authentication Date</span><span>: {cleanDateTime(extracted.authentication_date)}</span>
        </div>
      </div>
    </div>
  );
};

export default ReportHeader;
