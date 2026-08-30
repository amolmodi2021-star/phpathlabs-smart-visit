import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate, useLocation } from "react-router-dom";
import { isAuthenticated, isTabAllowed, getFirstAllowedRoute, checkAuthEpochAndLogoutIfStale } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import CreateEstimate from "./pages/CreateEstimate";
import EstimateDashboard from "./pages/EstimateDashboard";
import Dashboard from "./pages/Dashboard";
import HomeVisits from "./pages/HomeVisits";
import PhlebotomistManagement from "./pages/PhlebotomistManagement";
import TestManagement from "./pages/TestManagement";
import MessageTemplates from "./pages/MessageTemplates";
import AbnormalHistory from "./pages/AbnormalHistory";
import PhleboDashboard from "./pages/PhleboDashboard";
import ReportDepartments from "./pages/ReportDepartments";
import ReportProfiles from "./pages/ReportProfiles";
import ReportParameters from "./pages/ReportParameters";
import SignatureManagement from "./pages/SignatureManagement";
import ReportLayoutSettings from "./pages/ReportLayoutSettings";
import LoyaltyCards from "./pages/LoyaltyCards";
import WhatsAppWebhook from "./pages/WhatsAppWebhook";
import Marketing from "./pages/Marketing";
// CRM module disabled (cost optimization 2026-04-28)
import LimsDemo from "./pages/LimsDemo";
import Lims from "./pages/Lims";
import Accounts from "./pages/Accounts";
import WhatsAppSettingsPage from "./pages/WhatsAppSettingsPage";
import WhatsAppChat from "./pages/WhatsAppChat";
import LimsReportView from "./pages/LimsReportView";
import UserManagement from "./pages/UserManagement";
import CloudUsage from "./pages/CloudUsage";
import ReportAnalytics from "./pages/ReportAnalytics";
import PatientReportPortal from "./pages/PatientReportPortal";
import NotFound from "./pages/NotFound";

// React Query global defaults — cache aggressively; Refresh / mutations refresh.
// Unopened modules never fetch; revisiting a tab reuses cache (no remount refetch).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60_000, // 10 min — treat data as fresh
      gcTime: 2 * 60 * 60_000, // 2 hr — keep cache after leaving a tab/module
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

/** Gate a page by tab permission (auth already checked by AuthenticatedShell). */
function TabGate({ route, children }: { route: string; children?: React.ReactNode }) {
  if (!isTabAllowed(route)) return <Navigate to={getFirstAllowedRoute()} replace />;
  return <>{children ?? null}</>;
}

/**
 * Single authenticated layout so the chrome (nav) is shared.
 * Page modules mount only via <Outlet /> when their route is opened —
 * nothing is kept alive / fetched in the background for unopened tabs.
 */
function AuthenticatedShell() {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

function LimsReportRouteGuard() {
  // Allow access with valid ?public=<token> for patient downloads, otherwise require auth
  const hasPublicToken = new URLSearchParams(window.location.search).get("public");
  if (hasPublicToken) return <LimsReportView />;
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  if (!isTabAllowed("/lims")) return <Navigate to={getFirstAllowedRoute()} replace />;
  return (
    <AppLayout>
      <LimsReportView />
    </AppLayout>
  );
}

function GlobalAuthEpochGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const stale = await checkAuthEpochAndLogoutIfStale();
      if (stale && !cancelled && location.pathname !== "/login") {
        navigate("/login", { replace: true });
      }
    };
    run();

    // `focus` is unreliable on mobile (tab resume from app switcher often
    // fires only `visibilitychange`). Listen for both.
    const onFocus = () => run();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    // Background fallback; Realtime handles prompt logout. Keep interval light for egress.
    const interval = window.setInterval(run, 5 * 60_000);

    // Realtime: instant logout when an admin bumps the epoch, no polling delay.
    const channel = supabase
      .channel("auth-epoch-watch")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings", filter: "setting_key=eq.auth_epoch" },
        () => run(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [navigate, location.pathname]);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <GlobalAuthEpochGuard />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/r/:token" element={<PatientReportPortal />} />

          <Route element={<AuthenticatedShell />}>
            <Route path="/" element={<TabGate route="/"><CreateEstimate /></TabGate>} />
            <Route path="/business-dashboard" element={<TabGate route="/business-dashboard"><Dashboard /></TabGate>} />
            <Route path="/dashboard" element={<TabGate route="/dashboard"><EstimateDashboard /></TabGate>} />
            <Route path="/home-visits" element={<TabGate route="/home-visits"><HomeVisits /></TabGate>} />
            <Route path="/phlebotomists" element={<TabGate route="/phlebotomists"><PhlebotomistManagement /></TabGate>} />
            <Route path="/tests" element={<TabGate route="/tests"><TestManagement /></TabGate>} />
            <Route path="/parameters" element={<TabGate route="/tests"><ReportParameters /></TabGate>} />
            <Route path="/departments" element={<TabGate route="/tests"><ReportDepartments /></TabGate>} />
            <Route path="/templates" element={<TabGate route="/templates"><MessageTemplates /></TabGate>} />
            <Route path="/abnormal-history" element={<TabGate route="/abnormal-history"><AbnormalHistory /></TabGate>} />
            <Route path="/phlebo-dashboard" element={<TabGate route="/phlebo-dashboard"><PhleboDashboard /></TabGate>} />
            <Route path="/loyalty-cards" element={<TabGate route="/loyalty-cards"><LoyaltyCards /></TabGate>} />
            <Route path="/marketing" element={<TabGate route="/marketing"><Marketing /></TabGate>} />
            <Route path="/lims" element={<TabGate route="/lims"><Lims /></TabGate>} />
            <Route path="/accounts" element={<TabGate route="/accounts"><Accounts /></TabGate>} />
            <Route path="/lims-demo" element={<TabGate route="/lims-demo"><LimsDemo /></TabGate>} />
            <Route path="/whatsapp-webhook" element={<TabGate route="/whatsapp-webhook"><WhatsAppWebhook /></TabGate>} />
            <Route path="/whatsapp-settings" element={<TabGate route="/whatsapp-settings"><WhatsAppSettingsPage /></TabGate>} />
            <Route path="/whatsapp-chat" element={<TabGate route="/whatsapp-chat"><WhatsAppChat /></TabGate>} />
            <Route path="/report-layout" element={<TabGate route="/report-layout"><ReportLayoutSettings /></TabGate>} />
            <Route path="/signature-management" element={<TabGate route="/signature-management"><SignatureManagement /></TabGate>} />
            <Route path="/users" element={<TabGate route="/users"><UserManagement /></TabGate>} />
            <Route path="/cloud-usage" element={<TabGate route="/cloud-usage"><CloudUsage /></TabGate>} />
            <Route path="/report-analytics" element={<TabGate route="/report-analytics"><ReportAnalytics /></TabGate>} />
            <Route path="*" element={<NotFound />} />
          </Route>

          <Route path="/lims/report/:registrationId" element={<LimsReportRouteGuard />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
