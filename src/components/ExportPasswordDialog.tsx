import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { verifyExportPassword } from "@/lib/excel";
import { toast } from "sonner";

interface ExportPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const ExportPasswordDialog = ({ open, onOpenChange, onSuccess }: ExportPasswordDialogProps) => {
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (verifyExportPassword(password)) {
      setPassword("");
      onOpenChange(false);
      onSuccess();
    } else {
      toast.error("Incorrect password");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setPassword(""); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Enter Export Password</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Enter password to export"
              autoFocus
            />
          </div>
          <Button className="w-full" onClick={handleSubmit}>Export</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExportPasswordDialog;
