import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { isAuthenticated, isTabAllowed, getFirstAllowedRoute } from "@/lib/auth";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import CreateEstimate from "./pages/CreateEstimate";
import EstimateDashboard from "./pages/EstimateDashboard";
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
import CRM from "./pages/CRM";
import LimsDemo from "./pages/LimsDemo";
import Lims from "./pages/Lims";
import WhatsAppSettingsPage from "./pages/WhatsAppSettingsPage";
import WhatsAppChat from "./pages/WhatsAppChat";
import LimsReportView from "./pages/LimsReportView";
import UserManagement from "./pages/UserManagement";
import CloudUsage from "./pages/CloudUsage";
import ReportAnalytics from "./pages/ReportAnalytics";
import PatientReportPortal from "./pages/PatientReportPortal";
import NotFound from "./pages/NotFound";

// React Query global defaults — tuned for low Lovable Cloud egress.
// Most lab data (tests, profiles, templates) tolerates a 1-min stale window;
// users get an explicit Refresh button on counters that need fresher data.
// `refetchOnWindowFocus` and `refetchOnReconnect` were causing storm-refetches
// on tab switches and brief network blips, with zero user-visible benefit.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function ProtectedRoute({ children, route }: { children: React.ReactNode; route?: string }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  if (route && !isTabAllowed(route)) return <Navigate to={getFirstAllowedRoute()} replace />;
  return <AppLayout>{children}</AppLayout>;
}

function LimsReportRouteGuard() {
  // Allow access with valid ?public=<token> for patient downloads, otherwise require auth
  const hasPublicToken = new URLSearchParams(window.location.search).get("public");
  if (hasPublicToken) return <LimsReportView />;
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  if (!isTabAllowed("/lims")) return <Navigate to={getFirstAllowedRoute()} replace />;
  return <AppLayout><LimsReportView /></AppLayout>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/r/:token" element={<PatientReportPortal />} />
          <Route path="/" element={<ProtectedRoute route="/"><CreateEstimate /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute route="/dashboard"><EstimateDashboard /></ProtectedRoute>} />
          <Route path="/home-visits" element={<ProtectedRoute route="/home-visits"><HomeVisits /></ProtectedRoute>} />
          <Route path="/phlebotomists" element={<ProtectedRoute route="/phlebotomists"><PhlebotomistManagement /></ProtectedRoute>} />
          <Route path="/tests" element={<ProtectedRoute route="/tests"><TestManagement /></ProtectedRoute>} />
          <Route path="/parameters" element={<ProtectedRoute route="/tests"><ReportParameters /></ProtectedRoute>} />
          <Route path="/departments" element={<ProtectedRoute route="/tests"><ReportDepartments /></ProtectedRoute>} />
          <Route path="/templates" element={<ProtectedRoute route="/templates"><MessageTemplates /></ProtectedRoute>} />
          <Route path="/abnormal-history" element={<ProtectedRoute route="/abnormal-history"><AbnormalHistory /></ProtectedRoute>} />
          <Route path="/phlebo-dashboard" element={<ProtectedRoute route="/phlebo-dashboard"><PhleboDashboard /></ProtectedRoute>} />
          <Route path="/loyalty-cards" element={<ProtectedRoute route="/loyalty-cards"><LoyaltyCards /></ProtectedRoute>} />
          <Route path="/marketing" element={<ProtectedRoute route="/marketing"><Marketing /></ProtectedRoute>} />
          <Route path="/crm" element={<ProtectedRoute route="/crm"><CRM /></ProtectedRoute>} />
          <Route path="/lims" element={<ProtectedRoute route="/lims"><Lims /></ProtectedRoute>} />
          <Route path="/lims-demo" element={<ProtectedRoute route="/lims-demo"><LimsDemo /></ProtectedRoute>} />
          <Route path="/whatsapp-webhook" element={<ProtectedRoute route="/whatsapp-webhook"><WhatsAppWebhook /></ProtectedRoute>} />
          <Route path="/whatsapp-settings" element={<ProtectedRoute route="/whatsapp-settings"><WhatsAppSettingsPage /></ProtectedRoute>} />
          <Route path="/whatsapp-chat" element={<ProtectedRoute route="/whatsapp-chat"><WhatsAppChat /></ProtectedRoute>} />
          <Route path="/report-layout" element={<ProtectedRoute route="/report-layout"><ReportLayoutSettings /></ProtectedRoute>} />
          <Route path="/signature-management" element={<ProtectedRoute route="/signature-management"><SignatureManagement /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute route="/users"><UserManagement /></ProtectedRoute>} />
          <Route path="/cloud-usage" element={<ProtectedRoute route="/cloud-usage"><CloudUsage /></ProtectedRoute>} />
          <Route path="/report-analytics" element={<ProtectedRoute route="/report-analytics"><ReportAnalytics /></ProtectedRoute>} />
          <Route path="/lims/report/:registrationId" element={<LimsReportRouteGuard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
