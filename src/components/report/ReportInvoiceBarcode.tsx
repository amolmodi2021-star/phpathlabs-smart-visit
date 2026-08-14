interface ReportInvoiceBarcodeProps {
  invoiceNumber: string | null | undefined;
  barcodePng: string | null;
}

/**
 * Invoice-number CODE128 for the report footer (left of signatures).
 * PNG img only — never a live canvas — so preview, PDF, and WhatsApp capture
 * can rasterize it. PDF export also restamps this PNG after JPEG capture.
 */
const ReportInvoiceBarcode = ({ invoiceNumber, barcodePng }: ReportInvoiceBarcodeProps) => {
  const label = String(invoiceNumber || "").trim();
  if (!barcodePng && !label) return null;
  return (
    <div
      data-report-barcode="1"
      className="flex-shrink-0"
      style={{
        minWidth: 120,
        textAlign: "left",
        background: "#ffffff",
        padding: "2px 4px",
        zIndex: 5,
        position: "relative",
      }}
    >
      {barcodePng ? (
        <img
          src={barcodePng}
          alt={label ? `Invoice ${label}` : "Invoice barcode"}
          style={{
            width: 170,
            height: 48,
            objectFit: "contain",
            objectPosition: "left bottom",
            display: "block",
            background: "#ffffff",
          }}
        />
      ) : (
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            color: "#111",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
};

export default ReportInvoiceBarcode;
