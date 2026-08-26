import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserName } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, KeyRound, Loader2, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Status = {
  configured?: boolean;
  source?: "settings" | "env" | null;
  last4?: string | null;
  model_override?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  settings_configured?: boolean;
  env_configured?: boolean;
  error?: string;
};

export default function OpenAiSettingsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [modelOverride, setModelOverride] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("manage-openai-settings", {
      body: { action: "status" },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    setStatus(data as Status);
    if (data?.model_override) setModelOverride(String(data.model_override));
  }, []);

  useEffect(() => {
    void loadStatus().catch((e) => toast.error(e?.message || "Failed to load OpenAI status"));
  }, [loadStatus]);

  const invoke = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("manage-openai-settings", {
        body: { action, updated_by: getCurrentUserName(), ...extra },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (action === "save") {
        toast.success("OpenAI key saved");
        setApiKey("");
      } else if (action === "clear") {
        toast.success("Settings key cleared");
        setApiKey("");
      } else if (action === "test") {
        toast.success(data?.message || "OpenAI key is valid");
      }
      await loadStatus();
    } catch (e: any) {
      toast.error(e?.message || "Request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" />
          OpenAI API
        </CardTitle>
        <CardDescription>
          Used by the CBC smear AI tab (differential, morphology, malaria). The key is stored
          securely and is never shown in full after save. Edge env secret still works as a fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status:</span>
          {status?.configured ? (
            <>
              <Badge className="bg-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Configured
              </Badge>
              <span className="text-xs text-muted-foreground">
                via {status.source === "settings" ? "LIMS Settings" : "server env"}
                {status.last4 ? ` ? ????${status.last4}` : ""}
              </span>
            </>
          ) : (
            <Badge variant="outline">Not configured</Badge>
          )}
        </div>

        {(status?.updated_by || status?.updated_at) && (
          <p className="text-[11px] text-muted-foreground">
            Last saved
            {status.updated_by ? ` by ${status.updated_by}` : ""}
            {status.updated_at ? ` ? ${new Date(status.updated_at).toLocaleString()}` : ""}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="openai-key">OpenAI API key</Label>
          <div className="flex gap-2">
            <Input
              id="openai-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              placeholder={status?.configured ? `????${status.last4 || "****"} (enter new key to replace)` : "sk-..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="openai-model">CBC model override (optional)</Label>
          <Input
            id="openai-model"
            placeholder="e.g. gpt-5.6-sol (default if blank)"
            value={modelOverride}
            onChange={(e) => setModelOverride(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Leave blank to use the built-in fallback chain (gpt-5.6-sol ? gpt-5.4 ? gpt-4.1 ? gpt-4o).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!!busy || !apiKey.trim()}
            onClick={() => void invoke("save", { api_key: apiKey.trim(), model_override: modelOverride.trim() })}
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save key
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!!busy || !status?.configured}
            onClick={() => void invoke("test")}
          >
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Test key
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!!busy || !status?.settings_configured}
            onClick={() => void invoke("clear")}
          >
            {busy === "clear" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Clear settings key
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
