/**
 * COST OPTIMIZATION (2026-04-28): the abnormal_history hook is disabled.
 * It was producing 38 M sequential row reads. User confirmed the feature is
 * not in use. The hook keeps its public API so call sites compile, but it
 * issues zero database queries. Re-enable by restoring from git history.
 */
export function useAbnormalHistory(_mobiles: string[] = []) {
  return {
    getForMobile: (_mobile: string) => null as any | null,
    sendMutation: {
      mutate: (_args: { id: string; mobile: string; message: string; context: string }) => {},
      isPending: false,
    },
  };
}
