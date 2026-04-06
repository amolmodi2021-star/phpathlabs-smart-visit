import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "@/lib/auth";
import {
  FileText, LayoutDashboard, Home, Users, TestTubes, MessageSquare,
  Menu, X, LogOut, FlaskConical, AlertTriangle, BarChart3, CreditCard,
  FileUp, ClipboardList, Building2, Layers, Microscope, PenTool, BookOpen, Zap, Webhook, Megaphone, Contact, Activity, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHomeVisitNotifications } from "@/hooks/useHomeVisitNotifications";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { to: "/", label: "Create Estimate", icon: FileText },
  { to: "/dashboard", label: "Estimate Dashboard", icon: LayoutDashboard },
  { to: "/home-visits", label: "Home Visits", icon: Home },
  { to: "/phlebotomists", label: "Phlebotomists", icon: Users },
  { to: "/tests", label: "Test Management", icon: TestTubes },
  { to: "/templates", label: "Message Templates", icon: MessageSquare },
  { to: "/abnormal-history", label: "Abnormal History", icon: AlertTriangle },
  { to: "/phlebo-dashboard", label: "Phlebo Dashboard", icon: BarChart3 },
  { to: "/loyalty-cards", label: "Loyalty Cards", icon: CreditCard },
  { to: "/marketing", label: "Marketing", icon: Megaphone },
  { to: "/crm", label: "CRM", icon: Contact },
  { to: "/lims-demo", label: "LIMS Interface", icon: Activity },
  { to: "/whatsapp-webhook", label: "WhatsApp Webhook", icon: Webhook },
  { to: "/whatsapp-settings", label: "WhatsApp Settings", icon: Settings },
];

// Report System modules archived — uncomment to restore
// const reportNavItems = [
//   { to: "/reports", label: "Reports Dashboard", icon: ClipboardList },
//   { to: "/reports/upload", label: "Upload Report", icon: FileUp },
//   { to: "/report-admin/departments", label: "Departments", icon: Building2 },
//   { to: "/report-admin/profiles", label: "Profiles", icon: Layers },
//   { to: "/report-admin/parameters", label: "Parameters", icon: Microscope },
//   { to: "/report-admin/signatures", label: "Signatures", icon: PenTool },
//   { to: "/report-admin/layout", label: "Report Layout", icon: Layers },
//   { to: "/report-admin/corrections", label: "AI Corrections", icon: BookOpen },
//   { to: "/direct-ai", label: "Direct AI", icon: Zap },
// ];

const NavSection = ({ items, onClick }: { items: typeof navItems; onClick?: () => void }) => (
  <>
    {items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === "/" || item.to === "/reports"}
        onClick={onClick}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )
        }
      >
        <item.icon className="h-4 w-4" />
        {item.label}
      </NavLink>
    ))}
  </>
);

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  useHomeVisitNotifications();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b bg-card px-4">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(!open)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <FlaskConical className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm">PH PathLabs</span>
        </div>
        <div className="ml-auto">
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-card h-[calc(100vh-3.5rem)] sticky top-14 overflow-hidden">
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            <NavSection items={navItems} />
          </nav>
        </aside>

        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-foreground/20" onClick={() => setOpen(false)} />
            <aside className="absolute left-0 top-14 bottom-0 w-64 bg-card border-r p-3 space-y-1 animate-fade-in overflow-y-auto">
              <NavSection items={navItems} onClick={() => setOpen(false)} />
            </aside>
          </div>
        )}

        <main className="flex-1 p-4 md:p-6 max-w-full overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
