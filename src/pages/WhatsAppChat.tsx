import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { ArrowLeft, Search, Check, CheckCheck, X, MapPin, Image as ImageIcon, MessageCircle, Info, Filter, Send, Paperclip, FileText, Loader2, AlertCircle, MailOpen, ChevronUp, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import { Input } from "@/components/ui/input";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { extractMessageId } from "@/lib/messageLog";

const CONTACTS_PAGE_SIZE = 30;
const MESSAGES_PAGE_SIZE = 50;

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
}

export default function WhatsAppChat() {
  const isMobile = useIsMobile();
  const [selectedMobile, setSelectedMobile] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterUnread, setFilterUnread] = useState(false);
  const [manualUnreadMobiles, setManualUnreadMobiles] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem("wa-manual-unread-mobiles");
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const queryClient = useQueryClient();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Compose bar state
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const composeInputRef = useRef<HTMLInputElement>(null);

  // WA global settings
  const [waSettings, setWaSettings] = useState<Record<string, string>>({});

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ─── PAGINATED CONTACTS via RPC ───
  const {
    data: contactsData,
    fetchNextPage: fetchNextContacts,
    hasNextPage: hasMoreContacts,
    isFetchingNextPage: isFetchingMoreContacts,
  } = useInfiniteQuery({
    queryKey: ["wa-contacts", debouncedSearch, filterUnread],
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await supabase.rpc("get_wa_contacts_paginated", {
        p_search: debouncedSearch,
        p_offset: pageParam * CONTACTS_PAGE_SIZE,
        p_limit: CONTACTS_PAGE_SIZE,
        p_unread_only: filterUnread,
      });
      if (error) throw error;
      return (data || []) as Array<{
        mobile: string;
        contact_name: string;
        profile_name: string;
        last_message: string;
        last_time: string;
        unread_count: number;
      }>;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < CONTACTS_PAGE_SIZE) return undefined;
      return allPages.length;
    },
  });

  const contacts: ConversationContact[] = (contactsData?.pages ?? []).flat().map((c) => ({
    mobile: c.mobile,
    name: c.contact_name || "",
    profileName: c.profile_name || "",
    lastMessage: c.last_message || "",
    lastTime: c.last_time || "",
    unread: manualUnreadMobiles.has(c.mobile) && c.unread_count === 0 ? 1 : c.unread_count,
  }));

  const totalUnread = contacts.reduce((s, c) => s + c.unread, 0);

  // ─── PAGINATED MESSAGES via RPC ───
  const {
    data: messagesData,
    fetchNextPage: fetchOlderMessages,
    hasNextPage: hasOlderMessages,
    isFetchingNextPage: isFetchingOlderMessages,
  } = useInfiniteQuery({
    queryKey: ["wa-messages", selectedMobile],
    queryFn: async ({ pageParam = 0 }) => {
      if (!selectedMobile) return [];
      const { data, error } = await supabase.rpc("get_wa_chat_messages", {
        p_mobile_10: selectedMobile,
        p_limit: MESSAGES_PAGE_SIZE,
        p_offset: pageParam * MESSAGES_PAGE_SIZE,
      });
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        source: string;
        direction: string;
        message: string;
        message_type: string;
        media_url: string | null;
        location_lat: number | null;
        location_lng: number | null;
        delivery_status: string | null;
        error_info: any;
        message_id: string | null;
        ts: string;
      }>;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < MESSAGES_PAGE_SIZE) return undefined;
      return allPages.length;
    },
    enabled: !!selectedMobile,
  });

  // Flatten & reverse: RPC returns DESC, we need ASC for display
  const chatMessages: ChatMessage[] = (() => {
    const pages = messagesData?.pages ?? [];
    // pages[0] = newest, pages[N] = oldest. Reverse page order AND each page's internal order.
    const all = [...pages].reverse().flatMap((page) => [...page].reverse());
    return all.map((m) => ({
      id: m.id,
      source: m.source as "webhook" | "log",
      direction: m.direction as "inbound" | "outbound",
      message: m.message || "",
      messageType: m.message_type || "text",
      mediaUrl: m.media_url,
      locationLat: m.location_lat,
      locationLng: m.location_lng,
      deliveryStatus: m.delivery_status,
      errorInfo: m.error_info,
      timestamp: m.ts,
    }));
  })();

  // ─── REALTIME ───
  useEffect(() => {
    const channel = supabase
      .channel("wa-chat-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "webhook_messages" }, (payload) => {
        // Invalidate contacts to update last message & unread counts
        queryClient.invalidateQueries({ queryKey: ["wa-contacts"] });

        // If viewing a conversation, also refresh messages
        if (selectedMobile) {
          const newMsg = payload.new as any;
          if (newMsg?.sender_number && norm10(newMsg.sender_number) === selectedMobile) {
            queryClient.invalidateQueries({ queryKey: ["wa-messages", selectedMobile] });
          }
          // Also refresh for status updates on outbound
          if (payload.eventType === "UPDATE") {
            queryClient.invalidateQueries({ queryKey: ["wa-messages", selectedMobile] });
          }
        }

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

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    return () => { supabase.removeChannel(channel); };
  }, [queryClient, selectedMobile]);

  // Also subscribe to message_send_log changes
  useEffect(() => {
    const channel = supabase
      .channel("wa-chat-sendlog-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "message_send_log" }, () => {
        queryClient.invalidateQueries({ queryKey: ["wa-contacts"] });
        if (selectedMobile) {
          queryClient.invalidateQueries({ queryKey: ["wa-messages", selectedMobile] });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient, selectedMobile]);

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

  // Mark conversation as read when selected
  useEffect(() => {
    if (selectedMobile) {
      setManualUnreadMobiles((prev) => {
        const next = new Set(prev);
        next.delete(selectedMobile);
        return next;
      });
      markConversationRead(selectedMobile).then(() => {
        queryClient.invalidateQueries({ queryKey: ["wa-contacts"] });
      });
    }
  }, [selectedMobile, queryClient]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("wa-manual-unread-mobiles", JSON.stringify(Array.from(manualUnreadMobiles)));
  }, [manualUnreadMobiles]);

  // Auto-scroll to bottom on new messages (only first page load or new message)
  const prevMsgCount = useRef(0);
  useEffect(() => {
    if (!selectedMobile) return;
    const currentCount = chatMessages.length;
    // Scroll to bottom on initial load or when new messages arrive (count increases from first page)
    if (prevMsgCount.current === 0 || currentCount > prevMsgCount.current) {
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: prevMsgCount.current === 0 ? "auto" : "smooth" }), 50);
    }
    prevMsgCount.current = currentCount;
  }, [chatMessages.length, selectedMobile]);

  // Reset message count when switching conversations
  useEffect(() => {
    prevMsgCount.current = 0;
  }, [selectedMobile]);

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
          message_id: tempId,
          delivery_status: "pending",
        }).select("id").single(),
      ]);

      const { data: proxyRes, error } = await supabase.functions.invoke("whatsapp-proxy", {
        body: { apiBaseUrl: baseUrl, apiKey, authHeaderName, authHeaderPrefix, payload },
      });

      if (error) throw error;

      const messageId = extractMessageId(proxyRes) || "";

      if (messageId) {
        await Promise.all([
          supabase.from("webhook_messages").update({ message_id: messageId, delivery_status: "sent" }).eq("message_id", tempId),
          supabase.from("message_send_log").update({ message_id: messageId, delivery_status: "sent" } as any).eq("message_id", tempId),
        ]);
      } else {
        await Promise.all([
          supabase.from("webhook_messages").update({ delivery_status: "sent" }).eq("message_id", tempId),
          supabase.from("message_send_log").update({ delivery_status: "sent" } as any).eq("message_id", tempId),
        ]);
      }

      queryClient.invalidateQueries({ queryKey: ["wa-messages", selectedMobile] });
      queryClient.invalidateQueries({ queryKey: ["wa-contacts"] });
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
    const status = msg.deliveryStatus || "sent";

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

  // Infinite scroll handler for contacts
  const handleContactsScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100 && hasMoreContacts && !isFetchingMoreContacts) {
      fetchNextContacts();
    }
  }, [hasMoreContacts, isFetchingMoreContacts, fetchNextContacts]);

  // Contact list panel
  const contactListPanel = (
    <div className="flex flex-col h-full" style={{ backgroundColor: "#FFFFFF" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2" style={{ backgroundColor: "#075E54" }}>
        <MessageCircle className="h-5 w-5 text-white" />
        <h1 className="text-white font-semibold text-lg flex-1">Chats</h1>
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
        {filterUnread && (
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="secondary" className="text-[10px] gap-1 cursor-pointer" onClick={() => setFilterUnread(false)}>
              Unread only <X className="h-3 w-3" />
            </Badge>
          </div>
        )}
      </div>

      {/* Contact list with infinite scroll */}
      <div className="flex-1 overflow-y-auto" onScroll={handleContactsScroll}>
        {contacts.length === 0 && (
          <p className="text-center text-muted-foreground py-8 text-sm">
            {filterUnread ? "No unread conversations" : "No conversations yet"}
          </p>
        )}
        {contacts.map((c) => (
          <div
            key={c.mobile}
            onClick={() => setSelectedMobile(c.mobile)}
            className={`group flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-100 hover:bg-gray-50 transition-colors ${
              selectedMobile === c.mobile ? "bg-gray-100" : ""
            }`}
          >
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

            {c.unread === 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button className="shrink-0 p-1 rounded hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100">
                    <MailOpen className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={async () => {
                    setManualUnreadMobiles((prev) => new Set(prev).add(c.mobile));
                    await markConversationUnread(c.mobile);
                    queryClient.invalidateQueries({ queryKey: ["wa-contacts"] });
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
        {isFetchingMoreContacts && (
          <div className="flex justify-center py-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
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
        ref={chatScrollRef}
        className="flex-1 overflow-y-auto px-4 py-2"
        style={{ backgroundColor: "#ECE5DD", backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4cfc6' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
      >
        {/* Load older messages button */}
        {hasOlderMessages && (
          <div className="flex justify-center my-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchOlderMessages()}
              disabled={isFetchingOlderMessages}
              className="text-xs gap-1 rounded-full shadow-sm"
            >
              {isFetchingOlderMessages ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronUp className="h-3 w-3" />
              )}
              Load older messages
            </Button>
          </div>
        )}

        {dayGroups.map((group) => (
          <div key={group.date}>
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

  const emptyChat = (
    <div className="flex flex-col items-center justify-center h-full" style={{ backgroundColor: "#F0F2F5" }}>
      <MessageCircle className="h-16 w-16 text-muted-foreground mb-4" />
      <h2 className="text-xl font-light text-muted-foreground">WhatsApp Chat</h2>
      <p className="text-sm text-muted-foreground mt-2">Select a conversation to view messages</p>
    </div>
  );

  if (isMobile) {
    return (
      <div className="h-[calc(100vh-3.5rem)] -m-4 md:-m-6">
        {selectedMobile ? chatPanel : contactListPanel}
      </div>
    );
  }

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
