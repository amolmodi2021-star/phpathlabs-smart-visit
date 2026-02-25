import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "@/lib/auth";
import {
  FileText, LayoutDashboard, Home, Users, TestTubes, MessageSquare,
  Menu, X, LogOut, FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Create Estimate", icon: FileText },
  { to: "/dashboard", label: "Estimate Dashboard", icon: LayoutDashboard },
  { to: "/home-visits", label: "Home Visits", icon: Home },
  { to: "/phlebotomists", label: "Phlebotomists", icon: Users },
  { to: "/tests", label: "Test Management", icon: TestTubes },
  { to: "/templates", label: "Message Templates", icon: MessageSquare },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
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
        {/* Sidebar - desktop */}
        <aside className="hidden md:flex w-56 flex-col border-r bg-card min-h-[calc(100vh-3.5rem)] sticky top-14">
          <nav className="flex-1 p-3 space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
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
          </nav>
        </aside>

        {/* Mobile nav */}
        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-foreground/20" onClick={() => setOpen(false)} />
            <aside className="absolute left-0 top-14 bottom-0 w-64 bg-card border-r p-3 space-y-1 animate-fade-in">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </aside>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 p-4 md:p-6 max-w-full overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
