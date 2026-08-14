// @vitest-environment jsdom
import type { PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shortIdsKey } from "@/lib/queryKeys";

type NotifyPayload = { new?: { registration_id?: string | null } };
type NotifyCallback = (payload: NotifyPayload) => void;
type StatusCallback = (status: string) => void;

const realtimeMock = vi.hoisted(() => {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  return {
    channel,
    channelFactory: vi.fn(() => channel),
    removeChannel: vi.fn(),
    notifyCallback: undefined as NotifyCallback | undefined,
    statusCallback: undefined as StatusCallback | undefined,
    config: undefined as Record<string, unknown> | undefined,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: realtimeMock.channelFactory,
    removeChannel: realtimeMock.removeChannel,
  },
}));

import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";

const setDocumentHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
};

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
  setDocumentHidden(false);
  realtimeMock.notifyCallback = undefined;
  realtimeMock.statusCallback = undefined;
  realtimeMock.config = undefined;
  realtimeMock.channel.on.mockImplementation(
    (_type: string, config: Record<string, unknown>, callback: NotifyCallback) => {
      realtimeMock.config = config;
      realtimeMock.notifyCallback = callback;
      return realtimeMock.channel;
    },
  );
  realtimeMock.channel.subscribe.mockImplementation((callback: StatusCallback) => {
    realtimeMock.statusCallback = callback;
    return realtimeMock.channel;
  });
  realtimeMock.removeChannel.mockResolvedValue("ok");
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  setDocumentHidden(false);
});

describe("useLimsPipelineRealtime results notifier", () => {
  it("subscribes only to notifier inserts and batches duplicate registrations", () => {
    const queryClient = createQueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    const { rerender, unmount } = renderHook(
      ({ expanded, candidates }) =>
        useLimsPipelineRealtime("results", 750, {
          expandedRegistrationId: expanded,
          candidateRegistrationIds: candidates,
        }),
      {
        initialProps: { expanded: "reg-1", candidates: ["reg-1", "reg-2"] },
        wrapper: wrapperFor(queryClient),
      },
    );

    expect(realtimeMock.channelFactory).toHaveBeenCalledTimes(1);
    expect(realtimeMock.channelFactory).toHaveBeenCalledWith("lims-results-notify");
    expect(realtimeMock.config).toEqual({
      event: "INSERT",
      schema: "public",
      table: "lims_result_notify",
    });

    act(() => {
      realtimeMock.notifyCallback?.({ new: { registration_id: "reg-1" } });
      realtimeMock.notifyCallback?.({ new: { registration_id: "reg-1" } });
      realtimeMock.notifyCallback?.({ new: { registration_id: "reg-2" } });
      vi.advanceTimersByTime(749);
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        "patient_results_existing",
        shortIdsKey(["reg-1"], "re-d"),
      ],
      exact: true,
      refetchType: "active",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["results_accepted_count"],
      refetchType: "active",
    });

    rerender({ expanded: "reg-2", candidates: ["reg-1", "reg-2"] });
    expect(realtimeMock.channelFactory).toHaveBeenCalledTimes(1);

    unmount();
    expect(realtimeMock.removeChannel).toHaveBeenCalledTimes(1);
    expect(realtimeMock.removeChannel).toHaveBeenCalledWith(realtimeMock.channel);
  });

  it("does not reload expanded results for another patient", () => {
    const queryClient = createQueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    renderHook(
      () =>
        useLimsPipelineRealtime("results", 500, {
          expandedRegistrationId: "reg-1",
          candidateRegistrationIds: ["reg-1", "reg-2"],
        }),
      { wrapper: wrapperFor(queryClient) },
    );

    act(() => {
      realtimeMock.notifyCallback?.({ new: { registration_id: "reg-2" } });
      vi.advanceTimersByTime(500);
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["results_accepted_count"],
      refetchType: "active",
    });
  });

  it("ignores notifications unrelated to the expanded patient or current queue", () => {
    const queryClient = createQueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);

    renderHook(
      () =>
        useLimsPipelineRealtime("results", 500, {
          expandedRegistrationId: "reg-1",
          candidateRegistrationIds: ["reg-1"],
        }),
      { wrapper: wrapperFor(queryClient) },
    );

    act(() => {
      realtimeMock.notifyCallback?.({ new: { registration_id: "reg-other" } });
      vi.advanceTimersByTime(500);
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("performs one targeted catch-up after reconnect and visibility return", () => {
    const queryClient = createQueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    renderHook(
      () =>
        useLimsPipelineRealtime("results", 500, {
          expandedRegistrationId: "reg-1",
          candidateRegistrationIds: ["reg-1"],
        }),
      { wrapper: wrapperFor(queryClient) },
    );

    act(() => {
      realtimeMock.statusCallback?.("SUBSCRIBED");
      vi.advanceTimersByTime(500);
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      realtimeMock.statusCallback?.("CHANNEL_ERROR");
      realtimeMock.statusCallback?.("SUBSCRIBED");
      vi.advanceTimersByTime(500);
    });
    expect(invalidate).toHaveBeenCalledTimes(2);

    invalidate.mockClear();
    act(() => {
      realtimeMock.statusCallback?.("SUBSCRIBED");
      vi.advanceTimersByTime(500);
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      realtimeMock.notifyCallback?.({ new: { registration_id: "reg-1" } });
      vi.advanceTimersByTime(1_000);
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(500);
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(intervalSpy).not.toHaveBeenCalled();
  });
});
