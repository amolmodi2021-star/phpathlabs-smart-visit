import { format } from "date-fns";

interface LimsReportHeaderProps {
  patientName: string | null;
  title: string | null;
  gender: string | null;
  dob: string | null;
  umrNumber: string | null;
  doctorName: string | null;
  mobileNumber: string | null;
  email: string | null;
  address: string | null;
  invoiceNumber: string | null;
  registrationDate: string | null;
  sampleCollectionDate: string | null;
  approvalDate: string | null;
  printDate: string | null;
  visitType: string | null;
  isCompact?: boolean;
}

const formatDate = (d: string | null) => {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd-MMM-yyyy hh:mm a");
  } catch {
    return d;
  }
};

const calculateAge = (dob: string | null): string => {
  if (!dob) return "—";
  try {
    const birth = new Date(dob);
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
    if (years < 1) {
      const months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
      return `${months} months`;
    }
    return `${years} years`;
  } catch {
    return "—";
  }
};

const LimsReportHeader = ({
  patientName, title, gender, dob, umrNumber, doctorName,
  mobileNumber, invoiceNumber, registrationDate,
  sampleCollectionDate, approvalDate, printDate, visitType,
}: LimsReportHeaderProps) => {
  const age = calculateAge(dob);
  const displayName = [title, patientName].filter(Boolean).join(" ");

  return (
    <div className="border-b pb-1 mb-1" style={{ fontSize: "9px", lineHeight: "1.4" }}>
      <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
        <div><span className="font-semibold">Patient Name:</span> {displayName || "—"}</div>
        <div><span className="font-semibold">Age / Gender:</span> {age} / {gender || "—"}</div>
        <div><span className="font-semibold">UMR No:</span> {umrNumber || "—"}</div>

        <div><span className="font-semibold">Ref. Doctor:</span> {doctorName || "SELF"}</div>
        <div><span className="font-semibold">Invoice No:</span> {invoiceNumber || "—"}</div>
        <div><span className="font-semibold">Mobile:</span> {mobileNumber || "—"}</div>

        <div><span className="font-semibold">Reg. Date:</span> {formatDate(registrationDate)}</div>
        <div><span className="font-semibold">Collection:</span> {formatDate(sampleCollectionDate)}</div>
        <div><span className="font-semibold">Report Date:</span> {formatDate(approvalDate)}</div>
      </div>
    </div>
  );
};

export default LimsReportHeader;
