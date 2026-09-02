import { createContext, useContext } from "react";

/**
 * LIMS sub-tabs use forceMount (keep state when switching). Without this flag,
 * every visited tab keeps React Query observers "active" and refetches on
 * invalidate — which can stall Loading until the user leaves and returns.
 *
 * Gate heavy queue queries with: enabled: useLimsTabActive() && ...
 */
export const LimsTabActiveContext = createContext(true);

export function useLimsTabActive(): boolean {
  return useContext(LimsTabActiveContext);
}