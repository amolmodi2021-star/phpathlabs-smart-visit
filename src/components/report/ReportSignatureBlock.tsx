interface ReportSignatureBlockProps {
  signatureUrl: string | null;
  pathologistName: string;
  qualification?: string;
  designation?: string;
}

const ReportSignatureBlock = ({ signatureUrl, pathologistName, qualification, designation }: ReportSignatureBlockProps) => {
  return (
    <div className="mt-8 pt-4 border-t flex justify-end print:break-inside-avoid">
      <div className="text-center">
        {signatureUrl && <img src={signatureUrl} alt="Signature" className="h-16 mx-auto mb-1" />}
        <p className="font-semibold text-sm">{pathologistName}</p>
        {qualification && <p className="text-xs text-gray-500">{qualification}</p>}
        {designation && <p className="text-xs text-gray-500">{designation}</p>}
      </div>
    </div>
  );
};

export default ReportSignatureBlock;
