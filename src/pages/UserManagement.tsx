import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Edit2, Key, History, Copy, Trash2, Loader2, LogOut } from "lucide-react";
import { format } from "date-fns";
import { getCurrentUser, refreshCurrentUserPermissions, bumpAuthEpoch, logout } from "@/lib/auth";
import { getStoredAccessToken } from "@/integrations/supabase/client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useNavigate } from "react-router-dom";

async function invokeUserAuth(body: Record<string, unknown>) {
  const token = getStoredAccessToken();
  if (!token) {
    return { data: null as any, error: new Error("Session expired — please log out and sign in again") };
  }
  const res = await supabase.functions.invoke("user-auth", {
    body: { ...body, access_token: token },
    headers: {
      "x-ph-access-token": token,
    },
  });
  // Some Supabase clients report HTTP errors only on `error` while still parsing JSON into `data`.
  if (res.error) {
    let detail = res.error.message || "Request failed";
    try {
      const ctx = (res.error as any)?.context;
      if (ctx && typeof ctx.json === "function") {
        const payload = await ctx.json();
        if (payload?.error) detail = payload.error;
      } else if (res.data?.error) {
        detail = String(res.data.error);
      }
    } catch {
      if (res.data?.error) detail = String(res.data.error);
    }
    return { data: res.data, error: new Error(detail) };
  }
  if (res.data?.error) {
    return { data: res.data, error: new Error(String(res.data.error)) };
  }
  return { data: res.data, error: null as Error | null };
}

// All available tabs and their sections
const ALL_TABS = [
  { route: "/", label: "Create Estimate" },
  { route: "/business-dashboard", label: "Dashboard" },
  { route: "/dashboard", label: "Estimate Dashboard" },
  { route: "/home-visits", label: "Home Visits" },
  { route: "/phlebotomists", label: "Phlebotomists" },
  { route: "/tests", label: "Test Management" },
  { route: "/templates", label: "Message Templates" },
  { route: "/abnormal-history", label: "Abnormal History" },
  { route: "/phlebo-dashboard", label: "Phlebo Dashboard" },
  { route: "/loyalty-cards", label: "Loyalty Cards" },
  {
    route: "/marketing", label: "Marketing",
    sections: [
      { key: "send", label: "Send Messages" },
      { key: "automated", label: "Automated" },
      { key: "retry", label: "Retry" },
      { key: "log", label: "Message Log" },
      { key: "new", label: "New Numbers" },
    ],
  },
  {
    route: "/crm", label: "CRM",
    sections: [
      { key: "contacts", label: "Contacts" },
      { key: "import", label: "Import Data" },
      { key: "review", label: "Review & Approve" },
      { key: "abnormal", label: "Abnormal Tests" },
      { key: "card-designer", label: "Card Designer" },
      { key: "blacklist", label: "Blacklist" },
      { key: "sequences", label: "Sequences" },
      { key: "settings", label: "Settings" },
    ],
  },
  {
    route: "/lims", label: "LIMS",
    sections: [
      { key: "register", label: "New Registration" },
      { key: "patients", label: "Registered Patients" },
      { key: "sample_collection", label: "Sample Collection" },
      { key: "sample_acceptance", label: "Sample Acceptance" },
      { key: "results", label: "Results" },
      { key: "verification", label: "Result Verification" },
      { key: "doctor_approval", label: "Doctor Approval" },
      { key: "dispatch", label: "Dispatch" },
      { key: "workflow", label: "Workflow" },
      { key: "cbc", label: "CBC" },
      { key: "due_payments", label: "Due Payments" },
      { key: "bad_debts", label: "Bad Debts" },
      { key: "billing", label: "Billing" },
      { key: "daily_report", label: "Daily Report" },
      { key: "accounts", label: "Accounts" },
      { key: "completed_hv", label: "Completed Home Visits" },
      { key: "settings", label: "Settings" },
    ],
  },
  { route: "/whatsapp-webhook", label: "WhatsApp Webhook" },
  { route: "/whatsapp-settings", label: "WhatsApp Settings" },
  { route: "/whatsapp-chat", label: "WhatsApp Chat" },
  { route: "/lims-demo", label: "LIMS Interface" },
  { route: "/report-layout", label: "Report Layout" },
  { route: "/signature-management", label: "Doctor & Signatures" },
  { route: "/report-analytics", label: "Report Analytics" },
  { route: "/cloud-usage", label: "Cloud Usage" },
  { route: "/users", label: "Users" },
];

const ALL_ACTIONS = [
  { key: "storage_cleanup", label: "Storage Cleanup" },
  { key: "clear_data", label: "Reset (Factory Reset LIMS)" },
];

interface AppRole {
  id: string;
  role_name: string;
  description: string | null;
  permissions: any;
  created_at: string;
}

interface AppUserRow {
  id: string;
  username: string;
  display_name: string | null;
  role_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const UserManagement = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("users");
  const [users, setUsers] = useState<AppUserRow[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [logoutAllLoading, setLogoutAllLoading] = useState(false);

  const handleLogoutAll = async () => {
    setLogoutAllLoading(true);
    try {
      await bumpAuthEpoch();
      toast.success("All users will be signed out shortly. You will be signed out now.");
      // Sign the current admin out immediately too.
      logout();
      setTimeout(() => navigate("/login", { replace: true }), 600);
    } catch (e: any) {
      toast.error(e?.message || "Failed to sign out all users");
    } finally {
      setLogoutAllLoading(false);
    }
  };

  // User dialog state
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUserRow | null>(null);
  const [userForm, setUserForm] = useState({ username: "", display_name: "", password: "", role_id: "", is_active: true, can_approve_as_doctor: false });

  // Password reset dialog
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Login history dialog
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyUserId, setHistoryUserId] = useState("");
  const [loginHistory, setLoginHistory] = useState<any[]>([]);

  // Role dialog state
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<AppRole | null>(null);
  const [roleForm, setRoleForm] = useState({ role_name: "", description: "", permissions: {} as any });

  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        invokeUserAuth({ action: "list_users" }),
        supabase.from("app_roles").select("*").order("created_at"),
      ]);
      if (usersRes.error) {
        // Fallback to direct table read if edge list fails (older deploy / offline).
        const { data, error } = await supabase
          .from("app_users")
          .select("id, username, display_name, role_id, is_active, last_login_at, created_at, can_approve_as_doctor")
          .order("created_at");
        if (error) throw usersRes.error;
        setUsers((data as any[]) || []);
      } else {
        setUsers((usersRes.data?.users as any[]) || []);
      }
      if (rolesRes.error) throw rolesRes.error;
      setRoles((rolesRes.data as any[]) || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  // ===================== USER CRUD =====================

  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ username: "", display_name: "", password: "", role_id: "", is_active: true, can_approve_as_doctor: false });
    setUserDialogOpen(true);
  };

  const openEditUser = (u: AppUserRow) => {
    setEditingUser(u);
    setUserForm({ username: u.username, display_name: u.display_name || "", password: "", role_id: u.role_id || "", is_active: u.is_active, can_approve_as_doctor: (u as any).can_approve_as_doctor === true });
    setUserDialogOpen(true);
  };

  const saveUser = async () => {
    setSaving(true);
    try {
      if (editingUser) {
        const res = await invokeUserAuth({
          action: "update_user",
          user_id: editingUser.id,
          display_name: userForm.display_name,
          role_id: userForm.role_id || null,
          is_active: userForm.is_active,
          can_approve_as_doctor: userForm.can_approve_as_doctor,
        });
        if (res.error) throw res.error;
        toast.success("User updated");
      } else {
        if (!userForm.username || !userForm.password) {
          toast.error("Username and password required");
          setSaving(false);
          return;
        }
        const res = await invokeUserAuth({
          action: "create_user",
          username: userForm.username,
          password: userForm.password,
          display_name: userForm.display_name,
          role_id: userForm.role_id || null,
          is_active: userForm.is_active,
          can_approve_as_doctor: userForm.can_approve_as_doctor,
        });
        if (res.error) throw res.error;
        if (!res.data?.user) throw new Error("User was not created");
        toast.success(`User created: ${res.data.user.username}`);
      }
      setUserDialogOpen(false);
      await fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to save user");
    } finally {
      setSaving(false);
    }
  };

  const toggleUserActive = async (u: AppUserRow) => {
    if (u.username === "PHPATHLABS") { toast.error("Cannot deactivate admin user"); return; }
    const res = await invokeUserAuth({
      action: "update_user",
      user_id: u.id,
      is_active: !u.is_active,
    });
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    await fetchData();
  };

  const openResetPassword = (userId: string) => {
    setResetUserId(userId);
    setNewPassword("");
    setResetDialogOpen(true);
  };

  const resetPassword = async () => {
    if (!newPassword) { toast.error("Enter new password"); return; }
    setSaving(true);
    const res = await invokeUserAuth({
      action: "reset_password",
      user_id: resetUserId,
      new_password: newPassword,
    });
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success("Password reset successfully");
    setResetDialogOpen(false);
  };

  const openHistory = async (userId: string) => {
    setHistoryUserId(userId);
    setHistoryDialogOpen(true);
    const { data } = await supabase.from("app_user_login_history").select("*").eq("user_id", userId).order("login_at", { ascending: false }).limit(50);
    setLoginHistory(data || []);
  };

  // ===================== ROLE CRUD =====================

  const buildDefaultPerms = (): any => {
    const tabs: any = {};
    ALL_TABS.forEach((t) => {
      if (t.sections) {
        tabs[t.route] = { enabled: true, sections: t.sections.map((s) => s.key) };
      } else {
        tabs[t.route] = true;
      }
    });
    return { tabs };
  };

  const openAddRole = () => {
    setEditingRole(null);
    setRoleForm({ role_name: "", description: "", permissions: buildDefaultPerms() });
    setRoleDialogOpen(true);
  };

  const openEditRole = (r: AppRole) => {
    setEditingRole(r);
    setRoleForm({ role_name: r.role_name, description: r.description || "", permissions: r.permissions || buildDefaultPerms() });
    setRoleDialogOpen(true);
  };

  const duplicateRole = (r: AppRole) => {
    setEditingRole(null);
    setRoleForm({ role_name: r.role_name + " (Copy)", description: r.description || "", permissions: JSON.parse(JSON.stringify(r.permissions)) });
    setRoleDialogOpen(true);
  };

  const saveRole = async () => {
    if (!roleForm.role_name.trim()) { toast.error("Role name required"); return; }
    setSaving(true);
    try {
      let savedRoleId: string | null = null;
      if (editingRole) {
        await supabase.from("app_roles").update({
          role_name: roleForm.role_name,
          description: roleForm.description,
          permissions: roleForm.permissions,
        }).eq("id", editingRole.id);
        savedRoleId = editingRole.id;
        toast.success("Role updated");
      } else {
        const { error } = await supabase.from("app_roles").insert({
          role_name: roleForm.role_name,
          description: roleForm.description,
          permissions: roleForm.permissions,
        });
        if (error) { toast.error(error.message); setSaving(false); return; }
        toast.success("Role created");
      }
      setRoleDialogOpen(false);
      fetchData();

      // If the edited role belongs to the current user, refresh permissions immediately
      const currentUser = getCurrentUser();
      if (savedRoleId && currentUser?.role_id === savedRoleId) {
        await refreshCurrentUserPermissions();
        toast.success("Permissions updated — sidebar refreshed");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (r: AppRole) => {
    const usersWithRole = users.filter((u) => u.role_id === r.id);
    if (usersWithRole.length > 0) { toast.error(`Cannot delete — ${usersWithRole.length} user(s) assigned`); return; }
    await supabase.from("app_roles").delete().eq("id", r.id);
    toast.success("Role deleted");
    fetchData();
  };

  // ===================== PERMISSION UI HELPERS =====================

  const isTabEnabled = (route: string): boolean => {
    const tabs = roleForm.permissions?.tabs || {};
    const v = tabs[route];
    if (v === undefined) return false;
    if (typeof v === "boolean") return v;
    return v?.enabled === true;
  };

  const toggleTab = (route: string, hasSections: boolean) => {
    const perms = { ...roleForm.permissions };
    const tabs = { ...perms.tabs };
    const current = isTabEnabled(route);
    const tabDef = ALL_TABS.find((t) => t.route === route);
    if (hasSections && tabDef?.sections) {
      tabs[route] = current ? { enabled: false, sections: [] } : { enabled: true, sections: tabDef.sections.map((s) => s.key) };
    } else {
      tabs[route] = !current;
    }
    perms.tabs = tabs;
    setRoleForm({ ...roleForm, permissions: perms });
  };

  const isSectionEnabled = (route: string, sectionKey: string): boolean => {
    const v = roleForm.permissions?.tabs?.[route];
    if (typeof v !== "object" || !v) return false;
    return Array.isArray(v.sections) && v.sections.includes(sectionKey);
  };

  const toggleSection = (route: string, sectionKey: string) => {
    const perms = { ...roleForm.permissions };
    const tabs = { ...perms.tabs };
    const current = tabs[route] || { enabled: false, sections: [] };
    const sections = Array.isArray(current.sections) ? [...current.sections] : [];
    if (sections.includes(sectionKey)) {
      const filtered = sections.filter((s: string) => s !== sectionKey);
      tabs[route] = { enabled: filtered.length > 0, sections: filtered };
    } else {
      sections.push(sectionKey);
      tabs[route] = { enabled: true, sections };
    }
    perms.tabs = tabs;
    setRoleForm({ ...roleForm, permissions: perms });
  };

  const getRoleName = (roleId: string | null) => {
    if (!roleId) return "—";
    return roles.find((r) => r.id === roleId)?.role_name || "—";
  };

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-bold">User Management</h1>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="users">User List</TabsTrigger>
          <TabsTrigger value="roles">Roles & Rights</TabsTrigger>
        </TabsList>

        {/* ======================== USER LIST TAB ======================== */}
        <TabsContent value="users">
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={logoutAllLoading}>
                    {logoutAllLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <LogOut className="h-4 w-4 mr-1" />}
                    Logout All Users
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Sign out every active session?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will immediately invalidate every signed-in session on every device — including your own and the super-admin account.
                      Everyone will need to sign in again. Continue?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLogoutAll}>Yes, log everyone out</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button onClick={openAddUser} size="sm"><Plus className="h-4 w-4 mr-1" />Add User</Button>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Display Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.username}</TableCell>
                      <TableCell>{u.display_name || "—"}</TableCell>
                      <TableCell><Badge variant="outline">{getRoleName(u.role_id)}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={u.is_active ? "default" : "secondary"} className="cursor-pointer" onClick={() => toggleUserActive(u)}>
                          {u.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.last_login_at ? format(new Date(u.last_login_at), "dd/MM/yy HH:mm") : "Never"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditUser(u)} title="Edit"><Edit2 className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openResetPassword(u.id)} title="Reset Password"><Key className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openHistory(u.id)} title="Login History"><History className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ======================== ROLES TAB ======================== */}
        <TabsContent value="roles">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={openAddRole} size="sm"><Plus className="h-4 w-4 mr-1" />Add Role</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {roles.map((r) => {
                const assignedCount = users.filter((u) => u.role_id === r.id).length;
                const tabPerms = r.permissions?.tabs || {};
                const enabledCount = Object.values(tabPerms).filter((v: any) => v === true || v?.enabled === true).length;
                return (
                  <Card key={r.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{r.role_name}</CardTitle>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditRole(r)}><Edit2 className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => duplicateRole(r)}><Copy className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteRole(r)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-2">{r.description || "No description"}</p>
                      <div className="flex gap-2 text-xs">
                        <Badge variant="outline">{enabledCount} tabs</Badge>
                        <Badge variant="secondary">{assignedCount} user(s)</Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ======================== ADD/EDIT USER DIALOG ======================== */}
      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Username</Label>
              <Input
                value={userForm.username}
                onChange={(e) => setUserForm({ ...userForm, username: e.target.value.toUpperCase() })}
                disabled={!!editingUser}
                placeholder="e.g. RECEPTIONIST1"
                className="uppercase"
              />
            </div>
            <div className="space-y-1">
              <Label>Display Name</Label>
              <Input value={userForm.display_name} onChange={(e) => setUserForm({ ...userForm, display_name: e.target.value })} placeholder="Full name" />
            </div>
            {!editingUser && (
              <div className="space-y-1">
                <Label>Password</Label>
                <Input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
              </div>
            )}
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={userForm.role_id} onValueChange={(v) => setUserForm({ ...userForm, role_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.role_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={userForm.is_active} onCheckedChange={(v) => setUserForm({ ...userForm, is_active: v })} />
              <Label>Active</Label>
            </div>
            <div className="flex items-start gap-2 rounded-md border p-3 bg-muted/20">
              <Switch
                checked={userForm.can_approve_as_doctor}
                onCheckedChange={(v) => setUserForm({ ...userForm, can_approve_as_doctor: v })}
              />
              <div className="space-y-0.5">
                <Label className="cursor-pointer">Allow approving on behalf of doctors</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, this user (without their own pathologist signature) can approve reports by selecting an active doctor's signature at approval time.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveUser} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}{editingUser ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================== RESET PASSWORD DIALOG ======================== */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset Password</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={resetPassword} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================== LOGIN HISTORY DIALOG ======================== */}
      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Login History</DialogTitle></DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loginHistory.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No login history</TableCell></TableRow>}
                {loginHistory.map((h: any) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs">{format(new Date(h.login_at), "dd/MM/yy HH:mm:ss")}</TableCell>
                    <TableCell className="text-xs">{h.ip_address}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* ======================== ADD/EDIT ROLE DIALOG ======================== */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Edit Role" : "Add Role"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Role Name</Label>
                <Input value={roleForm.role_name} onChange={(e) => setRoleForm({ ...roleForm, role_name: e.target.value })} placeholder="e.g. Receptionist" />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} placeholder="Brief description" />
              </div>
            </div>

            <div>
              <Label className="text-base font-semibold">Tab & Section Permissions</Label>
              <div className="mt-2 space-y-1 border rounded-md p-3 max-h-[40vh] overflow-y-auto">
                {ALL_TABS.map((tab) => {
                  const hasSections = !!tab.sections && tab.sections.length > 0;
                  const enabled = isTabEnabled(tab.route);
                  return (
                    <div key={tab.route} className="py-1">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={enabled}
                          onCheckedChange={() => toggleTab(tab.route, hasSections)}
                        />
                        <span className="text-sm font-medium">{tab.label}</span>
                        <span className="text-xs text-muted-foreground">{tab.route}</span>
                      </div>
                      {hasSections && enabled && (
                        <div className="ml-6 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          {tab.sections!.map((s) => (
                            <label key={s.key} className="flex items-center gap-1.5 text-xs">
                              <Checkbox
                                checked={isSectionEnabled(tab.route, s.key)}
                                onCheckedChange={() => toggleSection(tab.route, s.key)}
                              />
                              {s.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-base font-semibold">Action Permissions</Label>
              <div className="mt-2 space-y-1 border rounded-md p-3">
                {ALL_ACTIONS.map((action) => {
                  const checked = roleForm.permissions?.actions?.[action.key] === true;
                  return (
                    <label key={action.key} className="flex items-center gap-2 py-1">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          const perms = { ...roleForm.permissions };
                          const actions = { ...(perms.actions || {}) };
                          actions[action.key] = !checked;
                          perms.actions = actions;
                          setRoleForm({ ...roleForm, permissions: perms });
                        }}
                      />
                      <span className="text-sm font-medium">{action.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveRole} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}{editingRole ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
