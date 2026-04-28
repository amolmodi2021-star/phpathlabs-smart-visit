// Abnormal History page disabled (cost optimization 2026-04-28).
// Route exists but the page is a stub — no DB queries, no realtime.
const AbnormalHistory = () => (
  <div className="flex h-full items-center justify-center p-12">
    <div className="text-center text-muted-foreground">
      <h2 className="text-xl font-semibold mb-2">Abnormal History is disabled</h2>
      <p className="text-sm">This page has been turned off to reduce backend costs.</p>
    </div>
  </div>
);

export default AbnormalHistory;
