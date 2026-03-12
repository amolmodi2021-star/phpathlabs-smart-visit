interface ReportSignatureBlockProps {
  signatureUrl: string | null;
  pathologistName: string;
  qualification?: string;
  designation?: string;
}

const ReportSignatureBlock = ({ signatureUrl, pathologistName, qualification, designation }: ReportSignatureBlockProps) => {
  return (
    <div className="pt-2 border-t flex justify-end print:break-inside-avoid">
      <div className="text-center">
        {signatureUrl && <img src={signatureUrl} alt="Signature" className="h-10 mx-auto mb-0.5" />}
        <p className="font-semibold text-xs">{pathologistName}</p>
        {qualification && <p className="text-[10px] text-gray-500 leading-tight">{qualification}</p>}
        {designation && <p className="text-[10px] text-gray-500 leading-tight">{designation}</p>}
      </div>
    </div>
  );
};

export default ReportSignatureBlock;
