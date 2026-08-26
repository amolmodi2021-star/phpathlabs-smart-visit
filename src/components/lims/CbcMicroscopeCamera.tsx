import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CbcMicroscopeCameraProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (blob: Blob) => void;
  remainingSlots: number;
}

const CbcMicroscopeCamera = ({
  open,
  onOpenChange,
  onCapture,
  remainingSlots,
}: CbcMicroscopeCameraProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e: any) {
        toast.error(e?.message || "Camera unavailable");
        onOpenChange(false);
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, onOpenChange, stopStream]);

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !ready || remainingSlots <= 0) return;
    setCapturing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("Capture failed");
      onCapture(blob);
    } catch (e: any) {
      toast.error(e?.message || "Capture failed");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-base">Microscope camera</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {remainingSlots} slot{remainingSlots === 1 ? "" : "s"} remaining
          </p>
        </DialogHeader>
        <div className="relative bg-black aspect-[4/3]">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center text-white/80">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 p-3 border-t">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleCapture}
            disabled={!ready || capturing || remainingSlots <= 0}
          >
            {capturing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Camera className="h-4 w-4 mr-1" />
            )}
            Capture
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CbcMicroscopeCamera;
