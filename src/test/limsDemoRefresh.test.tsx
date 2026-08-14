// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import type { PropsWithChildren } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    from: vi.fn(() => ({ select })),
    select,
    eq,
    maybeSingle,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: supabaseMock.from,
  },
}));

import { InterfaceLogEntry } from "@/pages/LimsDemo";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const Wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const toggleDetails = (details: HTMLDetailsElement, open: boolean) => {
  Object.defineProperty(details, "open", {
    configurable: true,
    value: open,
  });
  fireEvent(details, new Event("toggle", { bubbles: true }));
};

beforeEach(() => {
  queryClient.clear();
  supabaseMock.maybeSingle.mockResolvedValue({
    data: {
      request_body: { sample_id: "S-1", results: [{ code: "HB", value: "13.5" }] },
      response_body: { success: true, mapped: 1 },
    },
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LimsDemo refresh strategy", () => {
  it("contains no automatic polling or Realtime replacement", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/pages/LimsDemo.tsx"),
      "utf8",
    );

    expect(source).not.toContain("refetchInterval");
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("POLL_MS");
    expect(source).not.toContain("useRealtimeSync");
    expect(source).toContain(
      '.select("id, sample_id, direction, event_type, created_at, machine_id")',
    );
    expect(source).toContain(
      '.select("id, sample_id, machine_code, machine_id, result_value, unit, flag, received_at")',
    );
  });

  it("loads one log payload on demand and reuses it when reopened", async () => {
    const log = {
      id: "log-1",
      sample_id: "S-1",
      direction: "incoming",
      event_type: "submit_results",
      created_at: "2026-08-13T20:00:00.000Z",
      machine_id: "M-1",
    };

    render(<InterfaceLogEntry log={log} />, { wrapper: Wrapper });

    expect(supabaseMock.from).not.toHaveBeenCalled();

    const details = screen
      .getByText("Request / Response")
      .closest("details") as HTMLDetailsElement;

    act(() => toggleDetails(details, true));

    await waitFor(() => {
      expect(supabaseMock.maybeSingle).toHaveBeenCalledTimes(1);
    });
    expect(supabaseMock.from).toHaveBeenCalledWith("lims_interface_logs");
    expect(supabaseMock.select).toHaveBeenCalledWith(
      "request_body, response_body",
    );
    expect(supabaseMock.eq).toHaveBeenCalledWith("id", "log-1");
    expect(await screen.findByText(/"sample_id": "S-1"/)).toBeInTheDocument();
    expect(screen.getByText(/"mapped": 1/)).toBeInTheDocument();

    act(() => toggleDetails(details, false));
    act(() => toggleDetails(details, true));

    await waitFor(() => {
      expect(supabaseMock.maybeSingle).toHaveBeenCalledTimes(1);
    });
  });
});
