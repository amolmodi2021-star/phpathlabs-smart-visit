import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff, Settings } from "lucide-react";

const PREFIX = "abnormal_wa_";

const CRMAbnormalWhatsAppSettings = () => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.aoc-portal.com/v1/whatsapp");
  const [apiKey, setApiKey] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("apikey");
  const [authHeaderPrefix, setAuthHeaderPrefix] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [mediaHeader, setMediaHeader] = useState(true);
  const [queueEnabled, setQueueEnabled] = useState(true);
  const [delayMs, setDelayMs] = useState(3000);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .like("setting_key", `${PREFIX}%`);
      if (!data) { setLoaded(true); return; }
      const m: Record<string, string> = {};
      data.forEach((r: any) => { m[r.setting_key] = r.setting_value; });
      if (m[`${PREFIX}baseUrl`]) setBaseUrl(m[`${PREFIX}baseUrl`]);
      if (m[`${PREFIX}apiKey`]) setApiKey(m[`${PREFIX}apiKey`]);
      if (m[`${PREFIX}authHeaderName`]) setAuthHeaderName(m[`${PREFIX}authHeaderName`]);
      if (m[`${PREFIX}authHeaderPrefix`]) setAuthHeaderPrefix(m[`${PREFIX}authHeaderPrefix`]);
      if (m[`${PREFIX}fromNumber`]) setFromNumber(m[`${PREFIX}fromNumber`]);
      if (m[`${PREFIX}campaignName`]) setCampaignName(m[`${PREFIX}campaignName`]);
      if (m[`${PREFIX}templateName`]) setTemplateName(m[`${PREFIX}templateName`]);
      if (m[`${PREFIX}mediaHeader`]) setMediaHeader(m[`${PREFIX}mediaHeader`] === "true");
      if (m[`${PREFIX}queueEnabled`]) setQueueEnabled(m[`${PREFIX}queueEnabled`] === "true");
      if (m[`${PREFIX}delayMs`]) setDelayMs(Number(m[`${PREFIX}delayMs`]));
      setLoaded(true);
    };
    load();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const settings: Record<string, string> = {
      [`${PREFIX}baseUrl`]: baseUrl,
      [`${PREFIX}apiKey`]: apiKey,
      [`${PREFIX}authHeaderName`]: authHeaderName,
      [`${PREFIX}authHeaderPrefix`]: authHeaderPrefix,
      [`${PREFIX}fromNumber`]: fromNumber,
      [`${PREFIX}campaignName`]: campaignName,
      [`${PREFIX}templateName`]: templateName,
      [`${PREFIX}mediaHeader`]: String(mediaHeader),
      [`${PREFIX}queueEnabled`]: String(queueEnabled),
      [`${PREFIX}delayMs`]: String(delayMs),
    };
    const timer = setTimeout(() => {
      Object.entries(settings).forEach(async ([key, value]) => {
        await supabase.from("app_settings").upsert(
          { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
          { onConflict: "setting_key" }
        );
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [baseUrl, apiKey, authHeaderName, authHeaderPrefix, fromNumber, campaignName, templateName, mediaHeader, queueEnabled, delayMs, loaded]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Abnormal Test Card — WhatsApp API Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            These settings are used exclusively for sending abnormal test cards. The approved WhatsApp template should have one body variable: <code className="bg-muted px-1 rounded">{"{{1}}"}</code> = Patient Name. The card image is sent as a media header.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">API Base URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.aoc-portal.com/v1/whatsapp" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Your API key" className="h-8 pr-8" />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Auth Header Name</Label>
              <Input value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="apikey" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Auth Header Prefix (optional)</Label>
              <Input value={authHeaderPrefix} onChange={(e) => setAuthHeaderPrefix(e.target.value)} placeholder="Bearer / Basic / empty" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">From Number</Label>
              <Input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Campaign Name</Label>
              <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="abnormal-cards" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Template Name (approved by WhatsApp)</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="abnormal_report_template" className="h-8" />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch checked={mediaHeader} onCheckedChange={setMediaHeader} />
              <Label className="text-xs">Include card image in media header</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={queueEnabled} onCheckedChange={setQueueEnabled} />
              <Label className="text-xs">Queue Mode</Label>
            </div>
            {queueEnabled && (
              <div className="flex items-center gap-2">
                <Label className="text-xs">Delay (ms)</Label>
                <Input type="number" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} className="w-24 h-8" min={500} step={500} />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Settings are auto-saved. Body variable <code className="bg-muted px-1 rounded">{"{{1}}"}</code> will be automatically mapped to the patient's name.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default CRMAbnormalWhatsAppSettings;
