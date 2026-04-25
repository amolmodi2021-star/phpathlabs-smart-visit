import { useEffect, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { logout, getCurrentUser, isTabAllowed, isActionAllowed, refreshCurrentUserPermissions, PERMISSIONS_UPDATED_EVENT } from "@/lib/auth";
import {
  FileText, LayoutDashboard, Home, Users, TestTubes, MessageSquare,
  Menu, X, LogOut, FlaskConical, AlertTriangle, BarChart3, CreditCard,
  Layers, PenTool, Zap, Webhook, Megaphone, Contact, Activity, Settings, Trash2, Loader2, UserCog, MessageCircle, KeyRound, Cloud, BarChart2,
} from "lucide-react";
import ChangePasswordDialog from "@/components/ChangePasswordDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHomeVisitNotifications } from "@/hooks/useHomeVisitNotifications";
import { useIsMobile } from "@/hooks/use-mobile";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const allNavItems = [
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
  { to: "/lims", label: "LIMS", icon: Activity },
  { to: "/report-analytics", label: "Report Analytics", icon: BarChart2 },
  { to: "/whatsapp-webhook", label: "WhatsApp Webhook", icon: Webhook },
  { to: "/whatsapp-settings", label: "WhatsApp Settings", icon: Settings },
  { to: "/whatsapp-chat", label: "WhatsApp Chat", icon: MessageCircle },
  { to: "/lims-demo", label: "LIMS Interface", icon: Webhook },
  { to: "/report-layout", label: "Report Layout", icon: Layers },
  { to: "/signature-management", label: "Doctor & Signatures", icon: PenTool },
  { to: "/users", label: "Users", icon: UserCog },
  { to: "/cloud-usage", label: "Cloud Usage", icon: Cloud },
];

const StorageCleanupButton = ({ onClick, rail = false }: { onClick?: () => void; rail?: boolean }) => {
  const [cleaning, setCleaning] = useState(false);

  const runCleanup = async () => {
    setCleaning(true);
    onClick?.();
    try {
      const [cardRes, snipRes] = await Promise.all([
        supabase.functions.invoke("cleanup-card-images", { body: { source: "manual" } }),
        supabase.functions.invoke("cleanup-outsourced-snips", { body: { source: "manual" } }),
      ]);

      const cardDeleted = cardRes.data?.deleted ?? 0;
      const snipDeleted = snipRes.data?.deleted ?? snipRes.data?.files_removed ?? 0;

      toast.success("Storage Cleanup Complete", {
        description: `Card images removed: ${cardDeleted} | Outsourced snips removed: ${snipDeleted}`,
      });
    } catch (err: any) {
      toast.error("Cleanup failed", { description: err.message });
    } finally {
      setCleaning(false);
    }
  };

  return (
    <button
      onClick={runCleanup}
      disabled={cleaning}
      title={rail ? "Storage Cleanup" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors w-full whitespace-nowrap",
        "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        cleaning && "opacity-50 cursor-not-allowed"
      )}
    >
      {cleaning ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Trash2 className="h-4 w-4 shrink-0" />}
      <span className={cn("transition-opacity duration-150", rail && "opacity-0 group-hover:opacity-100")}>Storage Cleanup</span>
    </button>
  );
};

const NavSection = ({ items, onClick, rail = false }: { items: typeof allNavItems; onClick?: () => void; rail?: boolean }) => (
  <>
    {items.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === "/" || item.to === "/reports"}
        onClick={onClick}
        title={rail ? item.label : undefined}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap",
            isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )
        }
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className={cn("transition-opacity duration-150", rail && "opacity-0 group-hover:opacity-100")}>{item.label}</span>
      </NavLink>
    ))}
  </>
);

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [permsVersion, setPermsVersion] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  useHomeVisitNotifications();

  // Refresh permissions on mount, route change, and window focus
  useEffect(() => {
    refreshCurrentUserPermissions();
  }, [location.pathname]);

  useEffect(() => {
    const onFocus = () => { refreshCurrentUserPermissions(); };
    const onPermsUpdated = () => setPermsVersion((v) => v + 1);
    window.addEventListener("focus", onFocus);
    window.addEventListener(PERMISSIONS_UPDATED_EVENT, onPermsUpdated);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(PERMISSIONS_UPDATED_EVENT, onPermsUpdated);
    };
  }, []);

  const user = getCurrentUser();
  const navItems = allNavItems.filter((item) => isTabAllowed(item.to));
  void permsVersion; // ensure recompute on permission changes

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b bg-card px-4" style={{ paddingTop: 'var(--sat, 0px)' }}>
        {isMobile && (
          <Button variant="ghost" size="icon" onClick={() => setOpen(!open)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <FlaskConical className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm">PH PathLabs</span>
        </div>
        {user && (
          <span className="text-xs text-muted-foreground hidden sm:block ml-2">
            {user.display_name || user.username}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setPwDialogOpen(true)} title="Change Password">
            <KeyRound className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <ChangePasswordDialog open={pwDialogOpen} onOpenChange={setPwDialogOpen} />

      <div className="flex">
        {!isMobile && (
          <aside className="group flex w-14 hover:w-56 shrink-0 flex-col border-r bg-card h-[calc(100vh-3.5rem)] sticky top-14 overflow-hidden transition-[width] duration-200 ease-out z-40">
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden sidebar-scroll">
              <NavSection items={navItems} rail />
              {isActionAllowed("storage_cleanup") && (
                <>
                  <Separator className="my-2" />
                  <StorageCleanupButton rail />
                </>
              )}
            </nav>
          </aside>
        )}

        {isMobile && open && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-foreground/20" onClick={() => setOpen(false)} />
            <aside className="absolute left-0 top-14 bottom-0 w-64 bg-card border-r p-3 space-y-1 animate-fade-in overflow-y-auto">
              <NavSection items={navItems} onClick={() => setOpen(false)} />
              {isActionAllowed("storage_cleanup") && (
                <>
                  <Separator className="my-2" />
                  <StorageCleanupButton onClick={() => setOpen(false)} />
                </>
              )}
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
