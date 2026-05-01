interface ReportSignatureBlockProps {
  signatureUrl: string | null;
  pathologistName: string;
  qualification?: string;
  designation?: string;
}

const ReportSignatureBlock = ({ signatureUrl, pathologistName, qualification, designation }: ReportSignatureBlockProps) => {
  return (
    <div className="pt-1 border-t flex justify-end print:break-inside-avoid">
      <div className="text-center" style={{ minWidth: 0 }}>
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
    </div>
  );
};

export default ReportSignatureBlock;
