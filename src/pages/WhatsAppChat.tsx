import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowLeft, Search, Check, CheckCheck, X, MapPin, Image as ImageIcon, MessageCircle, Info, Filter, Send, Paperclip, FileText, Loader2, AlertCircle, MailOpen } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { extractMessageId } from "@/lib/messageLog";

// Normalize to 10 digit number
const norm10 = (n: string) => (n || "").replace(/\D/g, "").slice(-10);

const formatTime = (d: string) => {
  try {
    const dt = parseISO(d);
    if (isToday(dt)) return format(dt, "hh:mm a");
    if (isYesterday(dt)) return "Yesterday";
    return format(dt, "dd/MM/yyyy");
  } catch { return ""; }
};

const formatDayHeader = (d: string) => {
  try {
    const dt = parseISO(d);
    if (isToday(dt)) return "Today";
    if (isYesterday(dt)) return "Yesterday";
    return format(dt, "dd MMMM yyyy");
  } catch { return d; }
};

const formatFullTimestamp = (d: string) => {
  try {
    return format(parseISO(d), "dd-MM-yyyy hh:mm a");
  } catch { return ""; }
};

// localStorage helpers for read tracking
// Mark all inbound messages from a mobile as read in the database
const markConversationRead = async (mobile: string) => {
  const mobile10 = mobile.replace(/\D/g, "").slice(-10);
  if (!mobile10) return;
  await supabase
    .from("webhook_messages")
    .update({ is_read: true } as any)
    .eq("direction", "inbound")
    .eq("is_read", false)
    .like("sender_number", `%${mobile10}`);
};

const markConversationUnread = async (mobile: string) => {
  const mobile10 = mobile.replace(/\D/g, "").slice(-10);
  if (!mobile10) return;
  // Mark the latest inbound message as unread
  const { data } = await supabase
    .from("webhook_messages")
    .select("id")
    .eq("direction", "inbound")
    .like("sender_number", `%${mobile10}`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (data && data.length > 0) {
    await supabase
      .from("webhook_messages")
      .update({ is_read: false } as any)
      .eq("id", data[0].id);
  }
};

interface ConversationContact {
  mobile: string;
  name: string;
  profileName: string;
  lastMessage: string;
  lastTime: string;
  unread: number;
}

interface ChatMessage {
  id: string;
  source: "webhook" | "log";
  direction: "inbound" | "outbound";
  message: string;
  messageType: string;
  mediaUrl?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  deliveryStatus?: string | null;
  errorInfo?: any;
  timestamp: string;
  // For status tracking
  sentAt?: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export default function WhatsAppChat() {
  const isMobile = useIsMobile();
  const [selectedMobile, setSelectedMobile] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterUnread, setFilterUnread] = useState(false);
  const [manualUnreadMobiles, setManualUnreadMobiles] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Compose bar state
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const composeInputRef = useRef<HTMLInputElement>(null);

  // WA global settings
  const [waSettings, setWaSettings] = useState<Record<string, string>>({});

  // Fetch all webhook messages
  const { data: webhookMessages = [] } = useQuery({
    queryKey: ["wa-chat-webhook"],
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_messages")
        .select("id, sender_number, sender_name, message, direction, created_at, message_type, media_url, message_id, location_lat, location_lng, delivery_status, error_info, is_read")
        .order("created_at", { ascending: false })
        .limit(5000);
      return data || [];
    },
  });

  // Fetch all message_send_log
  const { data: sendLogs = [] } = useQuery({
    queryKey: ["wa-chat-sendlog"],
    queryFn: async () => {
      const { data } = await supabase
        .from("message_send_log")
        .select("id, mobile_number, patient_name, message_type, sent_at, message_content, message_id, delivery_status")
        .order("sent_at", { ascending: false })
        .limit(5000);
      return data || [];
    },
  });

  // Fetch CRM contacts for name resolution
  const { data: crmContacts = [] } = useQuery({
    queryKey: ["wa-chat-crm"],
    queryFn: async () => {
      const { data } = await supabase
        .from("crm_contacts")
        .select("mobile_number, patient_name, updated_at")
        .not("mobile_number", "is", null)
        .order("updated_at", { ascending: false })
        .limit(5000);
      return data || [];
    },
  });

  // Fetch estimates for name resolution
  const { data: estimates = [] } = useQuery({
    queryKey: ["wa-chat-estimates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("estimates")
        .select("whatsapp_number, patient_name, created_at")
        .not("patient_name", "is", null)
        .order("created_at", { ascending: false })
        .limit(2000);
      return data || [];
    },
  });

  // Realtime subscription for webhook_messages
  useEffect(() => {
    const channel = supabase
      .channel("wa-chat-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "webhook_messages" }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ["wa-chat-webhook"] });

        // Notification for inbound
        if (payload.eventType === "INSERT" && (payload.new as any)?.direction === "inbound") {
          const msg = payload.new as any;
          try {
            const audio = new Audio("/notification.mp3");
            audio.play().catch(() => {});
          } catch {}

          if (Notification.permission === "granted") {
            const senderName = msg.sender_name || norm10(msg.sender_number || "");
            const n = new Notification(`New message from ${senderName}`, {
              body: msg.message || "New message",
              icon: "/favicon.ico",
              tag: `wa-${norm10(msg.sender_number || "")}`,
            });
            n.onclick = () => {
              window.focus();
              setSelectedMobile(norm10(msg.sender_number || ""));
            };
          }
        }
      })
      .subscribe();

    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Also subscribe to message_send_log changes (INSERT + UPDATE for status)
  useEffect(() => {
    const channel = supabase
      .channel("wa-chat-sendlog-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "message_send_log" }, () => {
        queryClient.invalidateQueries({ queryKey: ["wa-chat-sendlog"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Load global WA settings
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .like("setting_key", "wa_global_%");
      if (!data) return;
      const m: Record<string, string> = {};
      data.forEach((r: any) => { m[r.setting_key] = r.setting_value; });
      setWaSettings(m);
    };
    load();
  }, []);

  // Mark conversation as read only when switching to it
  useEffect(() => {
    if (selectedMobile) {
      setManualUnreadMobiles((prev) => {
        const next = new Set(prev);
        next.delete(selectedMobile);
        return next;
      });
      markConversationRead(selectedMobile).then(() => {
        queryClient.invalidateQueries({ queryKey: ["wa-chat-webhook"] });
      });
    }
  }, [selectedMobile, queryClient]);

  // Build name resolution map: mobile -> name
  const nameMap = useCallback((): Map<string, string> => {
    const map = new Map<string, string>();

    // Estimates (lowest priority, add first so CRM overwrites)
    estimates.forEach((e: any) => {
      const m = norm10(e.whatsapp_number || "");
      if (m && e.patient_name && !map.has(m)) map.set(m, e.patient_name);
    });

    // CRM (highest priority, overwrites)
    crmContacts.forEach((c: any) => {
      const m = norm10(c.mobile_number || "");
      if (m && c.patient_name) map.set(m, c.patient_name);
    });

    return map;
  }, [crmContacts, estimates]);

  // Build profile name map from webhook
  const profileNameMap = useCallback((): Map<string, string> => {
    const map = new Map<string, string>();
    webhookMessages.forEach((m: any) => {
      const mobile = norm10(m.sender_number || "");
      if (mobile && m.sender_name && !map.has(mobile)) map.set(mobile, m.sender_name);
    });
    return map;
  }, [webhookMessages]);

  // Build contact list with unread counts
  const contacts: ConversationContact[] = useMemo(() => {
    const nMap = nameMap();
    const pMap = profileNameMap();
    const contactMap = new Map<string, ConversationContact>();

    // First pass: build contacts with latest message
    webhookMessages.forEach((m: any) => {
      const mobile = norm10(m.sender_number || "");
      if (!mobile) return;
      const existing = contactMap.get(mobile);
      if (!existing || m.created_at > existing.lastTime) {
        contactMap.set(mobile, {
          mobile,
          name: nMap.get(mobile) || "",
          profileName: pMap.get(mobile) || "",
          lastMessage: m.direction === "inbound" ? (m.message || "") : `You: ${m.message || ""}`,
          lastTime: m.created_at,
          unread: 0,
        });
      }
    });

    sendLogs.forEach((l: any) => {
      const mobile = norm10(l.mobile_number || "");
      if (!mobile) return;
      const existing = contactMap.get(mobile);
      const msgPreview = `You: ${l.message_type || "Message"} Sent`;
      if (!existing || l.sent_at > existing.lastTime) {
        contactMap.set(mobile, {
          mobile,
          name: nMap.get(mobile) || existing?.name || l.patient_name || "",
          profileName: existing?.profileName || "",
          lastMessage: msgPreview,
          lastTime: l.sent_at,
          unread: 0,
        });
      } else if (existing && !existing.name && l.patient_name) {
        existing.name = l.patient_name;
      }
    });

    // Second pass: count unread inbound messages per contact
    webhookMessages.forEach((m: any) => {
      if (m.direction !== "inbound") return;
      if (m.is_read) return;
      const mobile = norm10(m.sender_number || "");
      if (!mobile) return;
      const contact = contactMap.get(mobile);
      if (!contact) return;
      contact.unread += 1;
    });

    return Array.from(contactMap.values())
      .sort((a, b) => b.lastTime.localeCompare(a.lastTime));
  }, [webhookMessages, sendLogs, nameMap, profileNameMap]);

  // Total unread count for filter badge
  const totalUnread = useMemo(() => contacts.reduce((s, c) => s + c.unread, 0), [contacts]);

  // Filter contacts by search and unread filter
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (filterUnread && c.unread === 0) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return c.mobile.includes(s) || c.name.toLowerCase().includes(s) || c.profileName.toLowerCase().includes(s);
    });
  }, [contacts, search, filterUnread]);

  // Build messages for selected conversation
  const chatMessages: ChatMessage[] = useMemo(() => {
    if (!selectedMobile) return [];
    const msgs: ChatMessage[] = [];

    webhookMessages.forEach((m: any) => {
      if (norm10(m.sender_number || "") === selectedMobile) {
        msgs.push({
          id: m.id,
          source: "webhook",
          direction: m.direction === "inbound" ? "inbound" : "outbound",
          message: m.message || "",
          messageType: m.message_type || "text",
          mediaUrl: m.media_url,
          locationLat: m.location_lat,
          locationLng: m.location_lng,
          deliveryStatus: m.delivery_status,
          errorInfo: m.error_info,
          timestamp: m.created_at,
        });
      }
    });

    // Collect webhook message_ids to deduplicate against sendLogs
    const webhookMsgIds = new Set(
      webhookMessages.filter((m: any) => m.message_id).map((m: any) => m.message_id)
    );

    sendLogs.forEach((l: any) => {
      if (norm10(l.mobile_number || "") !== selectedMobile) return;
      // Skip if already represented in webhook_messages
      if (l.message_id && webhookMsgIds.has(l.message_id)) return;

      const logMsgType = (l.message_type || "").toLowerCase();
      let messageType = l.message_type || "log";
      let mediaUrl: string | undefined;
      const content = l.message_content || "";

      // Detect image/document messages from sendLog and extract media URL
      if (logMsgType.includes("image")) {
        messageType = "image";
        const urlMatch = content.match(/https?:\/\/\S+/);
        if (urlMatch) mediaUrl = urlMatch[0];
      } else if (logMsgType.includes("document")) {
        messageType = "document";
        const urlMatch = content.match(/https?:\/\/\S+/);
        if (urlMatch) mediaUrl = urlMatch[0];
      }

      msgs.push({
        id: l.id,
        source: "log",
        direction: "outbound",
        message: content || `${l.message_type || "Message"} Sent`,
        messageType,
        mediaUrl,
        deliveryStatus: l.delivery_status || "sent",
        timestamp: l.sent_at,
      });
    });

    msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return msgs;
  }, [selectedMobile, webhookMessages, sendLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (selectedMobile && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages.length, selectedMobile]);

  const selectedContact = contacts.find((c) => c.mobile === selectedMobile);
  const displayName = selectedContact?.name || selectedContact?.profileName || selectedMobile || "";

  // Group messages by day
  const dayGroups: { date: string; messages: ChatMessage[] }[] = [];
  chatMessages.forEach((m) => {
    const day = m.timestamp.slice(0, 10);
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.date === day) {
      last.messages.push(m);
    } else {
      dayGroups.push({ date: day, messages: [m] });
    }
  });

  // Send message helper
  const sendMessage = async (type: "text" | "image" | "document", body?: string, mediaUrl?: string, caption?: string) => {
    if (!selectedMobile) return;
    const baseUrl = waSettings["wa_global_baseUrl"] || "https://api.aoc-portal.com/v1/whatsapp";
    const apiKey = waSettings["wa_global_apiKey"];
    const authHeaderName = waSettings["wa_global_authHeaderName"] || "apikey";
    const authHeaderPrefix = waSettings["wa_global_authHeaderPrefix"] || "";
    const fromNumber = waSettings["wa_global_fromNumber"] || "";

    if (!apiKey) { toast.error("WhatsApp API key not configured. Go to WhatsApp Settings."); return; }
    if (!fromNumber) { toast.error("From number not configured. Go to WhatsApp Settings."); return; }

    const to = selectedMobile.length === 10 ? `+91${selectedMobile}` : `+${selectedMobile}`;
    
    let payload: any = {
      recipient_type: "individual",
      from: fromNumber,
      to,
      type,
    };
    if (type === "text") {
      payload.text = { body: body || "" };
    } else if (type === "image") {
      payload.image = { link: mediaUrl || "", caption: caption || "" };
    } else if (type === "document") {
      payload.document = { link: mediaUrl || "", caption: caption || "" };
    }

    setSending(true);
    try {
      const msgContent = type === "text" ? (body || "") : `[${type}] ${caption || mediaUrl || ""}`;
      const tempId = crypto.randomUUID();

      // Pre-insert rows with temp ID so webhook can find them when status arrives
      const [wmInsert, mslInsert] = await Promise.all([
        supabase.from("webhook_messages").insert({
          sender_number: `+91${selectedMobile}`,
          message: msgContent,
          direction: "outbound",
          message_type: type,
          media_url: type !== "text" ? mediaUrl : null,
          message_id: tempId,
          delivery_status: "pending",
        }).select("id").single(),
        supabase.from("message_send_log").insert({
          mobile_number: selectedMobile,
          patient_name: selectedContact?.name || selectedContact?.profileName || null,
          message_type: type === "text" ? "Chat Reply" : `Chat ${type.charAt(0).toUpperCase() + type.slice(1)}`,
          message_content: msgContent,
          message_id: tempId,
          delivery_status: "pending",
        }).select("id").single(),
      ]);

      const { data: proxyRes, error } = await supabase.functions.invoke("whatsapp-proxy", {
        body: { apiBaseUrl: baseUrl, apiKey, authHeaderName, authHeaderPrefix, payload },
      });

      if (error) throw error;

      const messageId = extractMessageId(proxyRes) || "";

      // Update rows with real message ID so webhook status updates match
      if (messageId) {
        await Promise.all([
          supabase.from("webhook_messages").update({ message_id: messageId, delivery_status: "sent" }).eq("message_id", tempId),
          supabase.from("message_send_log").update({ message_id: messageId, delivery_status: "sent" } as any).eq("message_id", tempId),
        ]);
      } else {
        // No message ID returned, just mark as sent
        await Promise.all([
          supabase.from("webhook_messages").update({ delivery_status: "sent" }).eq("message_id", tempId),
          supabase.from("message_send_log").update({ delivery_status: "sent" } as any).eq("message_id", tempId),
        ]);
      }

      queryClient.invalidateQueries({ queryKey: ["wa-chat-webhook"] });
      queryClient.invalidateQueries({ queryKey: ["wa-chat-sendlog"] });
      setComposeText("");
      toast.success("Message sent!");
    } catch (err: any) {
      toast.error("Failed to send: " + (err.message || "Unknown error"));
    } finally {
      setSending(false);
    }
  };

  const handleSendText = () => {
    if (!composeText.trim() || sending) return;
    sendMessage("text", composeText.trim());
  };

  const handleFileUpload = async (file: File, type: "image" | "document") => {
    setSending(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("chat-attachments").upload(path, file);
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from("chat-attachments").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const caption = type === "image" ? "" : file.name;
      await sendMessage(type, undefined, publicUrl, caption);
    } catch (err: any) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
      setSending(false);
    }
  };

  const getStatusLabel = (status: string | null | undefined) => {
    if (!status) return "Sent";
    switch (status) {
      case "read": return "Read";
      case "delivered": return "Delivered";
      case "failed": return "Failed";
      case "received": return "Received";
      default: return "Sent";
    }
  };

  const renderStatusTicks = (msg: ChatMessage) => {
    if (msg.direction !== "outbound") return null;
    const status = msg.deliveryStatus || (msg.source === "log" ? "sent" : "sent");

    if (status === "failed") {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <X className="h-3 w-3 text-red-500 inline ml-1" />
          </TooltipTrigger>
          <TooltipContent>
            {msg.errorInfo?.title || "Failed to deliver"}
          </TooltipContent>
        </Tooltip>
      );
    }
    if (status === "read") return <CheckCheck className="h-3 w-3 text-blue-500 inline ml-1" />;
    if (status === "delivered") return <CheckCheck className="h-3 w-3 text-muted-foreground inline ml-1" />;
    return <Check className="h-3 w-3 text-muted-foreground inline ml-1" />;
  };

  const renderMessageInfo = (msg: ChatMessage) => {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/5">
            <Info className="h-3 w-3 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3 text-xs" side="left">
          <div className="space-y-2">
            <p className="font-semibold text-sm mb-2">Message Info</p>
            {msg.direction === "outbound" ? (
              <>
                <div className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium">Sent</p>
                    <p className="text-muted-foreground">{formatFullTimestamp(msg.timestamp)}</p>
                  </div>
                </div>
                {(msg.deliveryStatus === "delivered" || msg.deliveryStatus === "read") && (
                  <div className="flex items-center gap-2">
                    <CheckCheck className="h-3 w-3 text-muted-foreground shrink-0" />
                    <div>
                      <p className="font-medium">Delivered</p>
                      <p className="text-muted-foreground">{formatFullTimestamp(msg.timestamp)}</p>
                    </div>
                  </div>
                )}
                {msg.deliveryStatus === "read" && (
                  <div className="flex items-center gap-2">
                    <CheckCheck className="h-3 w-3 text-blue-500 shrink-0" />
                    <div>
                      <p className="font-medium">Read</p>
                      <p className="text-muted-foreground">{formatFullTimestamp(msg.timestamp)}</p>
                    </div>
                  </div>
                )}
                {msg.deliveryStatus === "failed" && (
                  <div className="flex items-center gap-2">
                    <X className="h-3 w-3 text-red-500 shrink-0" />
                    <div>
                      <p className="font-medium text-red-600">Failed</p>
                      <p className="text-muted-foreground">{msg.errorInfo?.title || "Delivery failed"}</p>
                    </div>
                  </div>
                )}
                {!msg.deliveryStatus || msg.deliveryStatus === "sent" ? (
                  <p className="text-muted-foreground italic">Awaiting delivery confirmation</p>
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-green-600 shrink-0" />
                <div>
                  <p className="font-medium">Received</p>
                  <p className="text-muted-foreground">{formatFullTimestamp(msg.timestamp)}</p>
                </div>
              </div>
            )}
            <div className="pt-1 border-t mt-2">
              <p className="text-muted-foreground">Status: <span className="font-medium">{getStatusLabel(msg.deliveryStatus)}</span></p>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const renderMessageContent = (msg: ChatMessage) => {
    if (msg.messageType === "image" && msg.mediaUrl) {
      return (
        <div>
          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
            <img src={msg.mediaUrl} alt="Shared image" className="max-w-[200px] rounded-lg" />
          </a>
        </div>
      );
    }
    if (msg.messageType === "location" && msg.locationLat && msg.locationLng) {
      return (
        <a
          href={`https://www.google.com/maps?q=${msg.locationLat},${msg.locationLng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-blue-600 underline"
        >
          <MapPin className="h-4 w-4" /> View Location
        </a>
      );
    }
    if (msg.messageType === "button" || msg.messageType === "interactive") {
      return (
        <div className="flex items-center gap-1">
          <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-medium">
            {msg.message}
          </span>
        </div>
      );
    }
    if (msg.source === "log") {
      if (msg.message && msg.message !== `${msg.messageType} Sent`) {
        return (
          <div>
            <span className="text-[10px] font-medium opacity-60 uppercase">{msg.messageType}</span>
            <p className="whitespace-pre-wrap break-words text-sm mt-0.5">{msg.message}</p>
          </div>
        );
      }
      return (
        <span className="italic text-xs opacity-80">📤 {msg.message}</span>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{msg.message}</span>;
  };

  // Contact list panel
  const contactListPanel = (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#FFFFFF" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: "#075E54" }}>
        <MessageCircle className="h-5 w-5 text-white" />
        <h1 className="text-white font-semibold text-lg flex-1">Chats</h1>
        {/* Unread filter toggle */}
        <button
          onClick={() => setFilterUnread(!filterUnread)}
          className={`relative p-1.5 rounded-full transition-colors ${filterUnread ? "bg-white/20" : "hover:bg-white/10"}`}
          title={filterUnread ? "Show all chats" : "Show unread only"}
        >
          <Filter className="h-4 w-4 text-white" />
          {totalUnread > 0 && !filterUnread && (
            <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[9px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-0.5">
              {totalUnread}
            </span>
          )}
        </button>
      </div>

      {/* Search + filter indicator */}
      <div className="px-3 py-2" style={{ backgroundColor: "#F6F6F6" }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search or start new chat"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white border-0 rounded-full h-9 text-sm"
          />
        </div>
        {filterUnread && (
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="secondary" className="text-[10px] gap-1 cursor-pointer" onClick={() => setFilterUnread(false)}>
              Unread only <X className="h-3 w-3" />
            </Badge>
          </div>
        )}
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {filteredContacts.length === 0 && (
          <p className="text-center text-muted-foreground py-8 text-sm">
            {filterUnread ? "No unread conversations" : "No conversations yet"}
          </p>
        )}
        {filteredContacts.map((c) => (
          <div
            key={c.mobile}
            onClick={() => setSelectedMobile(c.mobile)}
            className={`group flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-gray-50 transition-colors ${
              selectedMobile === c.mobile ? "bg-gray-100" : ""
            }`}
          >
            {/* Avatar */}
            <div className="h-12 w-12 rounded-full flex items-center justify-center shrink-0 relative" style={{ backgroundColor: "#DFE5E7" }}>
              <span className="text-lg font-semibold" style={{ color: "#54656F" }}>
                {(c.name || c.profileName || c.mobile).charAt(0).toUpperCase()}
              </span>
              {c.unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-green-500 text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1 shadow">
                  {c.unread}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className={`font-medium text-sm truncate ${c.unread > 0 ? "font-bold" : ""}`}>
                  {c.name || c.profileName || c.mobile}
                </span>
                <span className={`text-xs whitespace-nowrap ml-2 ${c.unread > 0 ? "text-green-600 font-semibold" : "text-muted-foreground"}`}>
                  {formatTime(c.lastTime)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className={`text-xs truncate ${c.unread > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {c.lastMessage}
                </p>
              </div>
              {c.name && c.profileName && c.name !== c.profileName && (
                <p className="text-[10px] text-muted-foreground truncate">~{c.profileName}</p>
              )}
              {!c.name && !c.profileName && (
                <p className="text-[10px] text-muted-foreground">{c.mobile}</p>
              )}
              {c.name && (
                <p className="text-[10px] text-muted-foreground">{c.mobile}</p>
              )}
            </div>

            {/* Mark as unread button */}
            {c.unread === 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button className="shrink-0 p-1 rounded hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100">
                    <MailOpen className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={async () => {
                    await markConversationUnread(c.mobile);
                    queryClient.invalidateQueries({ queryKey: ["wa-chat-webhook"] });
                    toast.success("Marked as unread");
                  }}>
                    <MailOpen className="h-4 w-4 mr-2" />
                    Mark as unread
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // Chat panel
  const chatPanel = (
    <div className="flex flex-col h-full">
      {/* Chat header */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ backgroundColor: "#075E54" }}>
        {isMobile && (
          <button onClick={() => setSelectedMobile(null)}>
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
        )}
        <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "#DFE5E7" }}>
          <span className="font-semibold" style={{ color: "#54656F" }}>
            {displayName.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">{displayName}</p>
          {selectedContact?.name && selectedContact?.profileName && selectedContact.name !== selectedContact.profileName && (
            <p className="text-green-200 text-xs truncate">~{selectedContact.profileName}</p>
          )}
          <p className="text-green-200 text-xs">{selectedMobile}</p>
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-4 py-2"
        style={{ backgroundColor: "#ECE5DD", backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4cfc6' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
      >
        {dayGroups.map((group) => (
          <div key={group.date}>
            {/* Day header */}
            <div className="flex justify-center my-3">
              <span className="bg-white/80 text-xs text-muted-foreground px-3 py-1 rounded-lg shadow-sm">
                {formatDayHeader(group.date)}
              </span>
            </div>

            {group.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex mb-1 ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`group max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm text-sm relative ${
                    msg.direction === "outbound"
                      ? "rounded-tr-none"
                      : "rounded-tl-none"
                  } ${msg.deliveryStatus === "failed" ? "ring-1 ring-red-400" : ""}`}
                  style={{
                    backgroundColor: msg.direction === "outbound"
                      ? (msg.deliveryStatus === "failed" ? "#FEE2E2" : "#DCF8C6")
                      : "#FFFFFF",
                  }}
                >
                  {msg.deliveryStatus === "failed" && (
                    <div className="flex items-center gap-1 mb-1">
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 font-medium">
                        <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                        Failed
                      </Badge>
                    </div>
                  )}
                  {renderMessageContent(msg)}
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {(() => { try { return format(parseISO(msg.timestamp), "hh:mm a"); } catch { return ""; } })()}
                    </span>
                    {renderStatusTicks(msg)}
                    {renderMessageInfo(msg)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Compose bar */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ backgroundColor: "#F0F0F0" }}>
        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file, "image");
            e.target.value = "";
          }}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file, "document");
            e.target.value = "";
          }}
        />

        {/* Attachment button */}
        <Popover open={showAttachMenu} onOpenChange={setShowAttachMenu}>
          <PopoverTrigger asChild>
            <button
              className="p-2 rounded-full hover:bg-black/5 transition-colors"
              disabled={sending}
            >
              <Paperclip className="h-5 w-5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" side="top" align="start">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded hover:bg-accent transition-colors"
              onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
            >
              <ImageIcon className="h-4 w-4 text-purple-500" /> Image
            </button>
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded hover:bg-accent transition-colors"
              onClick={() => { docInputRef.current?.click(); setShowAttachMenu(false); }}
            >
              <FileText className="h-4 w-4 text-blue-500" /> Document
            </button>
          </PopoverContent>
        </Popover>

        {/* Text input */}
        <input
          ref={composeInputRef}
          type="text"
          placeholder="Type a message"
          value={composeText}
          onChange={(e) => setComposeText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
          disabled={sending}
          className="flex-1 rounded-full px-4 py-2 text-sm bg-white border-0 outline-none focus:ring-1 focus:ring-green-300"
        />

        {/* Send button */}
        <button
          onClick={handleSendText}
          disabled={sending || !composeText.trim()}
          className="p-2 rounded-full transition-colors disabled:opacity-40"
          style={{ backgroundColor: "#075E54" }}
        >
          {sending ? (
            <Loader2 className="h-5 w-5 text-white animate-spin" />
          ) : (
            <Send className="h-5 w-5 text-white" />
          )}
        </button>
      </div>
    </div>
  );

  // Empty state for desktop when no chat selected
  const emptyChat = (
    <div className="flex flex-col items-center justify-center h-full" style={{ backgroundColor: "#F0F2F5" }}>
      <MessageCircle className="h-16 w-16 text-muted-foreground mb-4" />
      <h2 className="text-xl font-light text-muted-foreground">WhatsApp Chat</h2>
      <p className="text-sm text-muted-foreground mt-2">Select a conversation to view messages</p>
    </div>
  );

  // Mobile: show one panel at a time
  if (isMobile) {
    return (
      <div className="h-[calc(100vh-3.5rem)] -m-4 md:-m-6">
        {selectedMobile ? chatPanel : contactListPanel}
      </div>
    );
  }

  // Desktop: two-panel layout
  return (
    <div className="h-[calc(100vh-3.5rem)] -m-4 md:-m-6 flex">
      <div className="w-[350px] border-r border-gray-200 flex flex-col">
        {contactListPanel}
      </div>
      <div className="flex-1 flex flex-col">
        {selectedMobile ? chatPanel : emptyChat}
      </div>
    </div>
  );
}
