interface ReportSignatureBlockProps {
  signatureUrl: string | null;
  pathologistName: string;
  qualification?: string;
  designation?: string;
  /** Omit the full-width border wrapper when nested in the report footer row. */
  embedded?: boolean;
}

const ReportSignatureBlock = ({ signatureUrl, pathologistName, qualification, designation, embedded }: ReportSignatureBlockProps) => {
  const inner = (
    <div className="text-center" style={{ minWidth: 0, flexShrink: 0 }}>
      {signatureUrl && <img src={signatureUrl} alt="Signature" className="h-8 mx-auto mb-0" />}
      <p
        className="font-semibold text-[10px] leading-tight"
        style={{ whiteSpace: "nowrap", overflow: "visible" }}
      >
        {pathologistName}
      </p>
      {qualification && <p className="text-[9px] text-gray-500 leading-tight" style={{ whiteSpace: "nowrap" }}>{qualification}</p>}
      {designation && <p className="text-[9px] text-gray-500 leading-tight" style={{ whiteSpace: "nowrap" }}>{designation}</p>}
    </div>
  );
  if (embedded) return inner;
  return (
    <div className="pt-1 border-t flex justify-end print:break-inside-avoid">
      {inner}
    </div>
  );
};

export default ReportSignatureBlock;
