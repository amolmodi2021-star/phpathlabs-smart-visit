import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowLeft, Search, Check, CheckCheck, X, MapPin, Image as ImageIcon, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
}

export default function WhatsAppChat() {
  const isMobile = useIsMobile();
  const [selectedMobile, setSelectedMobile] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch all webhook messages
  const { data: webhookMessages = [] } = useQuery({
    queryKey: ["wa-chat-webhook"],
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_messages")
        .select("id, sender_number, sender_name, message, direction, created_at, message_type, media_url, message_id, location_lat, location_lng, delivery_status, error_info")
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
        .select("id, mobile_number, patient_name, message_type, sent_at")
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

  // Also subscribe to message_send_log changes
  useEffect(() => {
    const channel = supabase
      .channel("wa-chat-sendlog-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_send_log" }, () => {
        queryClient.invalidateQueries({ queryKey: ["wa-chat-sendlog"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

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

  // Build contact list
  const contacts: ConversationContact[] = (() => {
    const nMap = nameMap();
    const pMap = profileNameMap();
    const contactMap = new Map<string, ConversationContact>();

    // Process webhook messages
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
          unread: (existing?.unread || 0) + (m.direction === "inbound" ? 0 : 0),
        });
      }
    });

    // Process send logs
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
          unread: existing?.unread || 0,
        });
      } else if (existing && !existing.name && l.patient_name) {
        existing.name = l.patient_name;
      }
    });

    return Array.from(contactMap.values())
      .sort((a, b) => b.lastTime.localeCompare(a.lastTime));
  })();

  // Filter contacts by search
  const filteredContacts = contacts.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return c.mobile.includes(s) || c.name.toLowerCase().includes(s) || c.profileName.toLowerCase().includes(s);
  });

  // Build messages for selected conversation
  const chatMessages: ChatMessage[] = (() => {
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

    sendLogs.forEach((l: any) => {
      if (norm10(l.mobile_number || "") === selectedMobile) {
        msgs.push({
          id: l.id,
          source: "log",
          direction: "outbound",
          message: `${l.message_type || "Message"} Sent`,
          messageType: "log",
          timestamp: l.sent_at,
        });
      }
    });

    msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return msgs;
  })();

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
      </div>

      {/* Search */}
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
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {filteredContacts.length === 0 && (
          <p className="text-center text-muted-foreground py-8 text-sm">No conversations yet</p>
        )}
        {filteredContacts.map((c) => (
          <div
            key={c.mobile}
            onClick={() => setSelectedMobile(c.mobile)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-gray-50 transition-colors ${
              selectedMobile === c.mobile ? "bg-gray-100" : ""
            }`}
          >
            {/* Avatar */}
            <div className="h-12 w-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "#DFE5E7" }}>
              <span className="text-lg font-semibold" style={{ color: "#54656F" }}>
                {(c.name || c.profileName || c.mobile).charAt(0).toUpperCase()}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm truncate">
                  {c.name || c.profileName || c.mobile}
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                  {formatTime(c.lastTime)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground truncate">
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
                  className={`max-w-[75%] px-3 py-1.5 rounded-lg shadow-sm text-sm relative ${
                    msg.direction === "outbound"
                      ? "rounded-tr-none"
                      : "rounded-tl-none"
                  }`}
                  style={{
                    backgroundColor: msg.direction === "outbound" ? "#DCF8C6" : "#FFFFFF",
                  }}
                >
                  {renderMessageContent(msg)}
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {(() => { try { return format(parseISO(msg.timestamp), "hh:mm a"); } catch { return ""; } })()}
                    </span>
                    {renderStatusTicks(msg)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
        <div ref={chatEndRef} />
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
