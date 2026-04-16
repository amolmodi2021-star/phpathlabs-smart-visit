import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Prevent mouse wheel from changing number input values
document.addEventListener("wheel", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "number") {
    target.blur();
  }
}, { passive: true });

createRoot(document.getElementById("root")!).render(<App />);

// --- PWA: unregister service workers in iframe / preview contexts ---
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (isPreviewHost || isInIframe) {
  navigator.serviceWorker?.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}
