interface ReportInvoiceBarcodeProps {
  invoiceNumber: string | null | undefined;
  barcodePng: string | null;
}

/**
 * Invoice-number CODE128 for the report footer, left of signatures.
 * Bars only — no human-readable digits under the image — so preview and PDF match.
 */
const ReportInvoiceBarcode = ({ invoiceNumber, barcodePng }: ReportInvoiceBarcodeProps) => {
  const label = String(invoiceNumber || "").trim();
  if (!barcodePng) return null;
  return (
    <div
      data-report-barcode="1"
      className="flex-shrink-0"
      style={{
        textAlign: "left",
        background: "#ffffff",
        padding: "1px 2px 0 0",
        lineHeight: 1,
      }}
    >
      <img
        src={barcodePng}
        alt={label ? `Invoice ${label}` : "Invoice barcode"}
        style={{
          height: 28,
          width: "auto",
          maxWidth: 150,
          display: "block",
          background: "#ffffff",
        }}
      />
    </div>
  );
};

export default ReportInvoiceBarcode;
