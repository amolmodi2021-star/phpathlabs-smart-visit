import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { toast } from "sonner";

interface MessagePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
}

const MessagePreviewDialog = ({ open, onOpenChange, title, message }: MessagePreviewDialogProps) => {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Message copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <pre className="whitespace-pre-wrap text-sm bg-muted rounded-lg p-3 font-sans leading-relaxed">
          {message}
        </pre>
        <Button onClick={handleCopy} className="w-full">
          <Copy className="h-4 w-4 mr-2" />Copy Message
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default MessagePreviewDialog;
