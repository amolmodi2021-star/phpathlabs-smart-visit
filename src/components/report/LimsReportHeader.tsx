import { format } from "date-fns";
import { formatPatientDisplayName } from "@/lib/patientDisplayName";
import { formatPatientAge } from "@/lib/patientAge";

interface LimsReportHeaderProps {
  patientName: string | null;
  title: string | null;
  gender: string | null;
  dob: string | null;
  /** Pickup-point free-text age when DOB is absent. */
  ageText?: string | null;
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

const formatVisitType = (visitType: string | null): string => {
  switch (visitType) {
    case "home_visit":
      return "Home Visit";
    case "lab_visit":
      return "Lab Visit";
    case "pickup_point":
      return "Pickup Point";
    default:
      return visitType ? visitType.replace(/_/g, " ") : "—";
  }
};

const LimsReportHeader = ({
  patientName, title, gender, dob, ageText, umrNumber, doctorName,
  mobileNumber, invoiceNumber, registrationDate,
  sampleCollectionDate, approvalDate, printDate, visitType,
}: LimsReportHeaderProps) => {
  // Prefer frozen snapshot age_text; else DOB age as of approval (not today).
  const age = formatPatientAge({
    dob,
    ageText,
    asOf: approvalDate || registrationDate || null,
  });
  const displayName = formatPatientDisplayName(title, patientName, gender);

  return (
    <div className="border-b pb-1 mb-1" style={{ fontSize: "13px", lineHeight: "1.5" }}>
      {/* Full-width patient name — no side fields so long names fit */}
      <div style={{ overflowWrap: "anywhere", wordBreak: "break-word", marginBottom: "2px" }}>
        <span className="font-semibold">Patient Name:</span> {displayName}
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
        <div><span className="font-semibold">Visit Type:</span> {formatVisitType(visitType)}</div>
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
