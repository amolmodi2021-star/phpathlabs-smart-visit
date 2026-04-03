import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Copy, RefreshCw, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

const WhatsAppWebhook = () => {
  const { toast } = useToast();
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [autoReplyMessage, setAutoReplyMessage] = useState(
    "Thank you for your message. We will get back to you shortly."
  );
  const [saving, setSaving] = useState(false);

  // Load settings
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .in("setting_key", ["webhook_auto_reply_enabled", "webhook_auto_reply_message"]);
      (data || []).forEach((s) => {
        if (s.setting_key === "webhook_auto_reply_enabled") setAutoReplyEnabled(s.setting_value !== "false");
        if (s.setting_key === "webhook_auto_reply_message") setAutoReplyMessage(s.setting_value);
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
        .from("webhook_messages" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">WhatsApp Webhook</h1>

      {/* Endpoint Info */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Endpoint</CardTitle>
          <CardDescription>
            Configure this URL in your WhatsApp API provider's webhook settings to receive inbound messages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Webhook URL (POST & GET)</Label>
            <div className="flex gap-2 mt-1">
              <Input value={WEBHOOK_URL} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyUrl}>
                <Copy className="h-4 w-4" />
              </Button>
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
          <CardDescription>
            Configure the automatic reply sent to every inbound WhatsApp message. Uses the same API credentials from WhatsApp API Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={autoReplyEnabled}
              onCheckedChange={(v) => setAutoReplyEnabled(v)}
            />
            <Label>Enable Auto-Reply</Label>
          </div>

          <div>
            <Label>Auto-Reply Message</Label>
            <Textarea
              value={autoReplyMessage}
              onChange={(e) => setAutoReplyMessage(e.target.value)}
              rows={4}
              className="mt-1"
              placeholder="Enter the message to send as auto-reply..."
            />
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Message Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Message Log</CardTitle>
              <CardDescription>Recent inbound and outbound webhook messages</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!messages || messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No messages received yet.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {messages.map((msg: any) => (
                <div key={msg.id} className="flex items-start gap-3 border rounded-md p-3 text-sm">
                  {msg.direction === "inbound" ? (
                    <ArrowDownLeft className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{msg.sender_name || msg.sender_number || "Unknown"}</span>
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
                    <p className="text-xs text-muted-foreground mt-1">
                      {(() => {
                        const d = new Date(msg.created_at);
                        const dd = String(d.getDate()).padStart(2, '0');
                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                        const yyyy = d.getFullYear();
                        const hh = d.getHours();
                        const min = String(d.getMinutes()).padStart(2, '0');
                        const ampm = hh >= 12 ? 'PM' : 'AM';
                        const h12 = hh % 12 || 12;
                        return `${dd}-${mm}-${yyyy} ${String(h12).padStart(2, '0')}:${min} ${ampm}`;
                      })()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WhatsAppWebhook;
