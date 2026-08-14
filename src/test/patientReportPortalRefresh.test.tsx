// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  token: "portal-token-1",
  navigate: vi.fn(),
}));

const portalMock = vi.hoisted(() => ({
  lookupShareLink: vi.fn(),
  fetchPortalBundle: vi.fn(),
  logEvent: vi.fn().mockResolvedValue(undefined),
  startSession: vi.fn().mockResolvedValue(undefined),
  heartbeatSession: vi.fn().mockResolvedValue(undefined),
  newSessionId: vi.fn(() => "session-1"),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useParams: () => ({ token: routerMock.token }),
    useNavigate: () => routerMock.navigate,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

vi.mock("@/lib/reportShareLinks", () => portalMock);

import PatientReportPortal from "@/pages/PatientReportPortal";

const registration = {
  id: "registration-1",
  invoice_number: "INV-1",
  patient_name: "Portal Patient",
  mobile_number: "9876543210",
  umr_number: "UMR-1",
  dob: "1990-01-01",
  due_amount: 100,
  created_at: "2026-08-14T04:00:00.000Z",
  tests: [{ test_id: "test-1", test_name: "CBC" }],
  cancelled_tests: [],
  status: "results_entered",
  bill_cancelled: false,
};

const bundle = {
  aggregated: [],
  results: [
    {
      registration_id: "registration-1",
      test_id: "test-1",
      status: "approved",
      entered_at: "2026-08-14T04:10:00.000Z",
      verified_at: "2026-08-14T04:20:00.000Z",
      approved_at: "2026-08-14T04:30:00.000Z",
    },
  ],
  tubes: [
    {
      registration_id: "registration-1",
      test_ids: ["test-1"],
      collected_at: "2026-08-14T04:05:00.000Z",
      accepted_at: "2026-08-14T04:08:00.000Z",
    },
  ],
  snips: [],
  tests: [{ id: "test-1", test_name: "CBC", department_id: "department-1" }],
  departments: [
    { id: "department-1", department_name: "Haematology", display_order: 1 },
  ],
  previous: [
    {
      id: "previous-1",
      registration_id: "registration-old",
      invoice_number: "INV-OLD",
      registration_date: "2026-07-01T04:00:00.000Z",
      approval_date: "2026-07-01T06:00:00.000Z",
      test_results: [{ test_id: "test-old" }],
    },
  ],
};

const flushEffects = async () => {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T05:00:00.000Z"));
  routerMock.token = "portal-token-1";
  localStorage.clear();
  localStorage.setItem(
    "ph_portal_verified_portal-token-1",
    String(Date.now()),
  );
  portalMock.lookupShareLink.mockImplementation(async (token: string) => ({
    expired: false,
    link: {
      token,
      expires_at: "2026-08-20T00:00:00.000Z",
    },
    registration,
  }));
  portalMock.fetchPortalBundle.mockResolvedValue(bundle);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PatientReportPortal manual status refresh", () => {
  it("loads once, remains idle for five minutes, and keeps the heartbeat", async () => {
    render(<PatientReportPortal />);
    await flushEffects();

    expect(portalMock.fetchPortalBundle).toHaveBeenCalledTimes(1);
    expect(portalMock.fetchPortalBundle).toHaveBeenCalledWith("portal-token-1");
    expect(screen.getByText("CBC")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Previous Reports")).toBeInTheDocument();
    expect(screen.getByText("Payment pending: ₹100")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    await flushEffects();

    expect(portalMock.fetchPortalBundle).toHaveBeenCalledTimes(1);
    expect(portalMock.heartbeatSession).toHaveBeenCalledTimes(30);
    expect(portalMock.heartbeatSession).toHaveBeenLastCalledWith("session-1", 10);
  });

  it("shows refresh progress and prevents rapid duplicate requests", async () => {
    render(<PatientReportPortal />);
    await flushEffects();

    let resolveRefresh!: (value: typeof bundle) => void;
    const pendingRefresh = new Promise<typeof bundle>((resolve) => {
      resolveRefresh = resolve;
    });
    portalMock.fetchPortalBundle.mockImplementationOnce(() => pendingRefresh);

    const refreshButton = screen.getByRole("button", {
      name: "Refresh Status",
    });
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);

    expect(portalMock.fetchPortalBundle).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "Refreshing…" }),
    ).toBeDisabled();

    await act(async () => {
      resolveRefresh(bundle);
      await pendingRefresh;
    });
    await flushEffects();

    expect(
      screen.getByRole("button", { name: "Refresh Status" }),
    ).toBeEnabled();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it("loads exactly once for a changed route token", async () => {
    const view = render(<PatientReportPortal />);
    await flushEffects();
    expect(portalMock.fetchPortalBundle).toHaveBeenCalledTimes(1);

    routerMock.token = "portal-token-2";
    localStorage.setItem(
      "ph_portal_verified_portal-token-2",
      String(Date.now()),
    );
    view.rerender(<PatientReportPortal />);
    await flushEffects();

    expect(portalMock.lookupShareLink).toHaveBeenCalledWith("portal-token-2");
    expect(portalMock.fetchPortalBundle).toHaveBeenCalledTimes(2);
    expect(portalMock.fetchPortalBundle).toHaveBeenLastCalledWith(
      "portal-token-2",
    );
  });

  it("contains no automatic portal bundle polling timer", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/pages/PatientReportPortal.tsx"),
      "utf8",
    );

    expect(source).not.toContain("120_000");
    expect(source).not.toContain("120000");
    expect(source.match(/setInterval/g)).toHaveLength(1);
    expect(source).toContain("heartbeatSession(sid, 10)");
    expect(source).toContain("}, 10_000);");
  });
});
