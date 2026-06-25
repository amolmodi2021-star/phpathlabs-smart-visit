import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, RefreshCw, ArrowDownLeft, ArrowUpRight, Download, Trash2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { exportToExcel } from "@/lib/excel";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import PasswordGate from "@/components/PasswordGate";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

const WhatsAppWebhook = () => {
  const { toast } = useToast();
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [autoReplyMessage, setAutoReplyMessage] = useState(
    "Thank you for your message. We will get back to you shortly."
  );
  const [saving, setSaving] = useState(false);
  const [waMeUrl, setWaMeUrl] = useState("https://wa.me/+916356556699");
  const [maxAutoReplies, setMaxAutoReplies] = useState(0);
  const [autoReplyDelaySec, setAutoReplyDelaySec] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Load settings
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["webhook_auto_reply_enabled", "webhook_auto_reply_message", "webhook_wa_me_url", "webhook_max_auto_replies_24h", "webhook_auto_reply_delay_seconds"]);
      (data || []).forEach((s) => {
        if (s.setting_key === "webhook_auto_reply_enabled") setAutoReplyEnabled(s.setting_value !== "false");
        if (s.setting_key === "webhook_auto_reply_message") setAutoReplyMessage(s.setting_value);
        if (s.setting_key === "webhook_wa_me_url" && s.setting_value) setWaMeUrl(s.setting_value);
        if (s.setting_key === "webhook_max_auto_replies_24h") setMaxAutoReplies(Number(s.setting_value) || 0);
        if (s.setting_key === "webhook_auto_reply_delay_seconds") setAutoReplyDelaySec(Number(s.setting_value) || 0);
      });
    })();
  }, []);

  const saveSetting = useCallback(async (key: string, value: string) => {
    await supabase.from("app_settings").upsert(
      { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
      { onConflict: "setting_key" }
    );
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await Promise.all([
      saveSetting("webhook_auto_reply_enabled", String(autoReplyEnabled)),
      saveSetting("webhook_auto_reply_message", autoReplyMessage),
      saveSetting("webhook_wa_me_url", waMeUrl),
      saveSetting("webhook_max_auto_replies_24h", String(maxAutoReplies)),
    ]);
    setSaving(false);
    toast({ title: "Settings saved" });
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    toast({ title: "Webhook URL copied to clipboard" });
  };

  // Fetch message logs
  const { data: messages, refetch } = useQuery({
    queryKey: ["webhook_messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
  });

  // Get the customer number from raw_payload for outbound messages
  const getCustomerNumber = (msg: any) => {
    if (msg.direction === "outbound") {
      // For outbound, the recipient in the API response is the customer
      try {
        const payload = msg.raw_payload;
        if (payload?.response) {
          const res = typeof payload.response === "string" ? JSON.parse(payload.response) : payload.response;
          if (res?.data?.[0]?.recipient) {
            const num = res.data[0].recipient;
            return num.startsWith("+") ? num : `+${num}`;
          }
        }
      } catch {}
      // fallback to sender_number
      return msg.sender_number || "Unknown";
    }
    // For inbound, sender_number is the customer
    return msg.sender_number || "Unknown";
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = d.getHours();
    const min = String(d.getMinutes()).padStart(2, '0');
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    return `${dd}-${mm}-${yyyy} ${String(h12).padStart(2, '0')}:${min} ${ampm}`;
  };

  const handleExport = () => {
    if (!messages || messages.length === 0) return;
    const exportData = messages.map((msg: any) => ({
      "Direction": msg.direction,
      "Customer Number": getCustomerNumber(msg),
      "Sender Name": msg.sender_name || "",
      "Message": msg.message || "",
      "Status": msg.status || "",
      "Date": formatDate(msg.created_at),
    }));
    exportToExcel(exportData, "webhook_messages_log");
    toast({ title: "Exported successfully" });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!messages) return;
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m: any) => m.id)));
    }
  };

  const handleDeleteConfirmed = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    // Delete in batches
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      await supabase.from("webhook_messages").delete().in("id", batch);
    }
    setSelectedIds(new Set());
    refetch();
    toast({ title: `${ids.length} message(s) deleted` });
  };

  return (
    <PasswordGate title="WhatsApp Webhook">
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">WhatsApp Webhook</h1>

      {/* Endpoint Info */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Endpoint</CardTitle>
          <CardDescription>Configure this URL in your WhatsApp API provider's webhook settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Webhook URL (POST & GET)</Label>
            <div className="flex gap-2 mt-1">
              <Input value={WEBHOOK_URL} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyUrl}><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>Method:</strong> POST (inbound messages), GET (endpoint verification)</p>
            <p><strong>Content-Type:</strong> application/json</p>
            <p><strong>Authentication:</strong> None required (public endpoint)</p>
          </div>
          <div className="rounded-md border p-3 bg-muted/50">
            <p className="text-xs font-medium mb-1">Setup Instructions:</p>
            <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-1">
              <li>Copy the webhook URL above</li>
              <li>Go to your WhatsApp API provider dashboard (e.g., AOC Portal)</li>
              <li>Paste this URL in the webhook/callback URL field</li>
              <li>Set the HTTP method to POST</li>
              <li>Save and verify the endpoint</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Auto-Reply Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Auto-Reply Settings</CardTitle>
          <CardDescription>Configure the automatic reply and WhatsApp contact button.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={autoReplyEnabled} onCheckedChange={(v) => setAutoReplyEnabled(v)} />
            <Label>Enable Auto-Reply</Label>
          </div>
          <div>
            <Label>Auto-Reply Message</Label>
            <Textarea value={autoReplyMessage} onChange={(e) => setAutoReplyMessage(e.target.value)} rows={4} className="mt-1" placeholder="Enter the message to send as auto-reply..." />
          </div>
          <div>
            <Label>wa.me Contact URL (for quick chat button)</Label>
            <Input value={waMeUrl} onChange={(e) => setWaMeUrl(e.target.value)} placeholder="https://wa.me/+916356556699" className="mt-1" />
          </div>
          <div>
            <Label>Max auto-replies per number in 24 hours (0 = unlimited)</Label>
            <Input type="number" value={maxAutoReplies} onChange={(e) => setMaxAutoReplies(Number(e.target.value))} min={0} className="mt-1 w-40" placeholder="0" />
            <p className="text-xs text-muted-foreground mt-1">Limits how many auto-replies a single number receives within 24 hours. Set to 0 for unlimited.</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
            {waMeUrl && (
              <Button variant="outline" onClick={() => window.open(waMeUrl, "_blank")}>
                <ExternalLink className="h-4 w-4 mr-1" /> Open WhatsApp Chat
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Message Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Message Log</CardTitle>
              <CardDescription>Recent inbound and outbound webhook messages</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={!messages || messages.length === 0}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
              {selectedIds.size > 0 && (
                <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete ({selectedIds.size})
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!messages || messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages received yet.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Checkbox
                  checked={selectedIds.size === messages.length && messages.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
                <Label className="text-xs text-muted-foreground">Select All ({messages.length})</Label>
              </div>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {messages.map((msg: any) => (
                  <div key={msg.id} className="flex items-start gap-3 border rounded-md p-3 text-sm">
                    <Checkbox
                      checked={selectedIds.has(msg.id)}
                      onCheckedChange={() => toggleSelect(msg.id)}
                      className="mt-0.5"
                    />
                    {msg.direction === "inbound" ? (
                      <ArrowDownLeft className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {msg.direction === "inbound" ? (
                          <>
                            <span className="text-xs text-muted-foreground">From:</span>
                            <span className="font-medium">{msg.sender_name || getCustomerNumber(msg)}</span>
                            <span className="text-xs text-muted-foreground">{getCustomerNumber(msg)}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-muted-foreground">Replied to:</span>
                            <span className="font-medium">{msg.sender_name || getCustomerNumber(msg)}</span>
                            <span className="text-xs text-muted-foreground">{getCustomerNumber(msg)}</span>
                          </>
                        )}
                        <Badge variant={msg.direction === "inbound" ? "secondary" : "default"} className="text-xs">
                          {msg.direction}
                        </Badge>
                        {msg.status && (
                          <Badge variant={msg.status === "sent" ? "default" : "destructive"} className="text-xs">
                            {msg.status}
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1 break-all">{msg.message || "(no text)"}</p>
                      <p className="text-xs text-muted-foreground mt-1">{formatDate(msg.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <DeletePasswordDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onSuccess={handleDeleteConfirmed}
        description={`Delete ${selectedIds.size} selected message(s)? This action cannot be undone.`}
      />
    </div>
    </PasswordGate>
  );
};

export default WhatsAppWebhook;
