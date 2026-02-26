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
