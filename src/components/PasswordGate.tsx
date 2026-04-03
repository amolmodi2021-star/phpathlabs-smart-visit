import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { toast } from "sonner";

const GATE_PASSWORD = "9819111107";

interface PasswordGateProps {
  title: string;
  children: React.ReactNode;
}

const PasswordGate = ({ title, children }: PasswordGateProps) => {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (password === GATE_PASSWORD) {
      setUnlocked(true);
      setPassword("");
    } else {
      toast.error("Incorrect password");
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>{title}</CardTitle>
          <p className="text-sm text-muted-foreground">Enter password to access this section</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="Enter password"
              autoFocus
            />
          </div>
          <Button className="w-full" onClick={handleSubmit}>Unlock</Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default PasswordGate;
