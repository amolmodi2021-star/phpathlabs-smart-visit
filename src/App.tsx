import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { isAuthenticated } from "@/lib/auth";
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
import ReportsDashboard from "./pages/ReportsDashboard";
import UploadReport from "./pages/UploadReport";
import ReviewReport from "./pages/ReviewReport";
import ViewReport from "./pages/ViewReport";
import ReportDepartments from "./pages/ReportDepartments";
import ReportProfiles from "./pages/ReportProfiles";
import ReportParameters from "./pages/ReportParameters";
import SignatureManagement from "./pages/SignatureManagement";
import ReportLayoutSettings from "./pages/ReportLayoutSettings";
import ExtractionCorrections from "./pages/ExtractionCorrections";
import DirectAI from "./pages/DirectAI";
import LoyaltyCards from "./pages/LoyaltyCards";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><CreateEstimate /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><EstimateDashboard /></ProtectedRoute>} />
          <Route path="/home-visits" element={<ProtectedRoute><HomeVisits /></ProtectedRoute>} />
          <Route path="/phlebotomists" element={<ProtectedRoute><PhlebotomistManagement /></ProtectedRoute>} />
          <Route path="/tests" element={<ProtectedRoute><TestManagement /></ProtectedRoute>} />
          <Route path="/templates" element={<ProtectedRoute><MessageTemplates /></ProtectedRoute>} />
          <Route path="/abnormal-history" element={<ProtectedRoute><AbnormalHistory /></ProtectedRoute>} />
          <Route path="/phlebo-dashboard" element={<ProtectedRoute><PhleboDashboard /></ProtectedRoute>} />
          {/* Report System routes archived — uncomment to restore */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
