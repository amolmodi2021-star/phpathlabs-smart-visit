import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
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
        <DialogHeader>
          <DialogTitle>Enter Export Password</DialogTitle>
          <DialogDescription className="sr-only">Enter the export password to download the file.</DialogDescription>
        </DialogHeader>
        {/* autoComplete="off" + hidden dummy input prevents browsers/password managers
            from auto-filling stored usernames into other text fields on the page. */}
        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
          <input type="text" name="username" autoComplete="username" value="" readOnly tabIndex={-1} style={{ display: "none" }} />
          <div>
            <Label htmlFor="export-password">Password</Label>
            <Input
              id="export-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password to export"
              autoFocus
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              data-form-type="other"
              name="export-password"
            />
          </div>
          <Button type="submit" className="w-full">Export</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ExportPasswordDialog;
