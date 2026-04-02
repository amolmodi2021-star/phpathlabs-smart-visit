import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Settings, FileText } from "lucide-react";

const WhatsAppSettings = () => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [waBaseUrl, setWaBaseUrl] = useState("https://api.aoc-portal.com/v1/whatsapp");
  const [waApiKey, setWaApiKey] = useState("");
  const [waAuthHeaderName, setWaAuthHeaderName] = useState("apikey");
  const [waAuthHeaderPrefix, setWaAuthHeaderPrefix] = useState("");
  const [waFromNumber, setWaFromNumber] = useState("");
  const [waCampaignName, setWaCampaignName] = useState("");
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waBodyMapping, setWaBodyMapping] = useState("");
  const [waMediaHeader, setWaMediaHeader] = useState(true);
  const [queueEnabled, setQueueEnabled] = useState(true);
  const [delayMs, setDelayMs] = useState(3000);
  const [waSettingsLoaded, setWaSettingsLoaded] = useState(false);

  // Load WA settings from DB
  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase.from("app_settings").select("setting_key, setting_value").like("setting_key", "loyalty_wa_%");
      if (!data) { setWaSettingsLoaded(true); return; }
      const map: Record<string, string> = {};
      data.forEach((r: any) => { map[r.setting_key] = r.setting_value; });
      if (map["loyalty_wa_baseUrl"]) setWaBaseUrl(map["loyalty_wa_baseUrl"]);
      if (map["loyalty_wa_apiKey"]) setWaApiKey(map["loyalty_wa_apiKey"]);
      if (map["loyalty_wa_authHeaderName"]) setWaAuthHeaderName(map["loyalty_wa_authHeaderName"]);
      if (map["loyalty_wa_authHeaderPrefix"]) setWaAuthHeaderPrefix(map["loyalty_wa_authHeaderPrefix"]);
      if (map["loyalty_wa_fromNumber"]) setWaFromNumber(map["loyalty_wa_fromNumber"]);
      if (map["loyalty_wa_campaignName"]) setWaCampaignName(map["loyalty_wa_campaignName"]);
      if (map["loyalty_wa_templateName"]) setWaTemplateName(map["loyalty_wa_templateName"]);
      if (map["loyalty_wa_bodyMapping"]) setWaBodyMapping(map["loyalty_wa_bodyMapping"]);
      if (map["loyalty_wa_mediaHeader"]) setWaMediaHeader(map["loyalty_wa_mediaHeader"] === "true");
      if (map["loyalty_wa_queueEnabled"]) setQueueEnabled(map["loyalty_wa_queueEnabled"] === "true");
      if (map["loyalty_wa_delayMs"]) setDelayMs(Number(map["loyalty_wa_delayMs"]));
      setWaSettingsLoaded(true);
    };
    loadSettings();
  }, []);

  // Save WA settings to database (debounced after load)
  useEffect(() => {
    if (!waSettingsLoaded) return;
    const settings: Record<string, string> = {
      loyalty_wa_baseUrl: waBaseUrl,
      loyalty_wa_apiKey: waApiKey,
      loyalty_wa_authHeaderName: waAuthHeaderName,
      loyalty_wa_authHeaderPrefix: waAuthHeaderPrefix,
      loyalty_wa_fromNumber: waFromNumber,
      loyalty_wa_campaignName: waCampaignName,
      loyalty_wa_templateName: waTemplateName,
      loyalty_wa_bodyMapping: waBodyMapping,
      loyalty_wa_mediaHeader: String(waMediaHeader),
      loyalty_wa_queueEnabled: String(queueEnabled),
      loyalty_wa_delayMs: String(delayMs),
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
  }, [waBaseUrl, waApiKey, waAuthHeaderName, waAuthHeaderPrefix, waFromNumber, waCampaignName, waTemplateName, waBodyMapping, waMediaHeader, queueEnabled, delayMs, waSettingsLoaded]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" />
            WhatsApp API Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">API Base URL</Label>
              <Input value={waBaseUrl} onChange={(e) => setWaBaseUrl(e.target.value)} placeholder="https://api.aoc-portal.com/v1/whatsapp" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input type={showApiKey ? "text" : "password"} value={waApiKey} onChange={(e) => setWaApiKey(e.target.value)} placeholder="Your API key" className="h-8 pr-8" />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Auth Header Name</Label>
              <Input value={waAuthHeaderName} onChange={(e) => setWaAuthHeaderName(e.target.value)} placeholder="apikey" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Auth Header Prefix (optional)</Label>
              <Input value={waAuthHeaderPrefix} onChange={(e) => setWaAuthHeaderPrefix(e.target.value)} placeholder="Bearer / Basic / empty" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">From Number</Label>
              <Input value={waFromNumber} onChange={(e) => setWaFromNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Campaign Name</Label>
              <Input value={waCampaignName} onChange={(e) => setWaCampaignName(e.target.value)} placeholder="loyalty-cards" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Template Name</Label>
              <Input value={waTemplateName} onChange={(e) => setWaTemplateName(e.target.value)} placeholder="template_name" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Body Variables Mapping (JSON)</Label>
              <Input value={waBodyMapping} onChange={(e) => setWaBodyMapping(e.target.value)} placeholder='{"1":"Name"}' className="h-8" />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch checked={waMediaHeader} onCheckedChange={setWaMediaHeader} />
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
          <p className="text-xs text-muted-foreground">Settings are auto-saved. Use the History tab to send WhatsApp messages.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default WhatsAppSettings;
