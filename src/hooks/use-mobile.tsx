import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(
    navigator.userAgent
  );
}

function checkMobile(): boolean {
  if (typeof window === "undefined") return false;

  const vpWidth = window.visualViewport?.width ?? window.innerWidth;
  const isSmallViewport = vpWidth < MOBILE_BREAKPOINT;
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const isMobileUA = isMobileDevice();

  // If viewport is small, always treat as mobile
  if (isSmallViewport) return true;

  // If it's a touch phone (coarse + mobile UA) but viewport is wide
  // (e.g. Chrome "Desktop site" just turned off but viewport not yet restored),
  // still treat as mobile
  if (isCoarsePointer && isMobileUA) return true;

  return false;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(checkMobile);

  React.useEffect(() => {
    const update = () => setIsMobile(checkMobile());

    // Standard resize / orientation
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    // Visual viewport (catches Chrome desktop-mode toggles)
    window.visualViewport?.addEventListener("resize", update);

    // Visibility change — re-check when user returns to tab
    const onVisibility = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // matchMedia listener as fallback
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", onVisibility);
      mql.removeEventListener("change", update);
    };
  }, []);

  return isMobile;
}
