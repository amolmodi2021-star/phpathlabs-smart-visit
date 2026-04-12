import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function checkMobile(): boolean {
  if (typeof window === "undefined") return false;
  const vpWidth = window.visualViewport?.width ?? window.innerWidth;
  return vpWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(checkMobile);

  React.useEffect(() => {
    const update = () => setIsMobile(checkMobile());

    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    screen.orientation?.addEventListener("change", update);

    const onVisibility = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", update);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      screen.orientation?.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", onVisibility);
      mql.removeEventListener("change", update);
    };
  }, []);

  return isMobile;
}
