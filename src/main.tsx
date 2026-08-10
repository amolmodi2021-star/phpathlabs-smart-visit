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

// Drop any third-party "Edit with …" badge if an old host injects one.
const stripForeignBadges = () => {
  document.querySelectorAll(
    'a[href*="lovable.dev"], a[href*="lovable.app"], a[href*="lovableproject.com"], iframe[src*="lovable"], [data-lovable], #lovable-badge',
  ).forEach((el) => el.remove());
};
stripForeignBadges();
new MutationObserver(stripForeignBadges).observe(document.documentElement, { childList: true, subtree: true });

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

if (isInIframe) {
  navigator.serviceWorker?.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}
