import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const DELETE_PASSWORD = "9819111107";

interface DeletePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  description?: string;
}

const DeletePasswordDialog = ({ open, onOpenChange, onSuccess, description }: DeletePasswordDialogProps) => {
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (password === DELETE_PASSWORD) {
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
        <DialogHeader><DialogTitle>Enter Password to Delete</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Enter password to confirm deletion"
              autoFocus
            />
          </div>
          <Button className="w-full" variant="destructive" onClick={handleSubmit}>Confirm Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DeletePasswordDialog;
