import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface LinkedProfile {
  id: string;
  profile_id: string;
  display_order: number;
  profile_name?: string;
  profile_code?: string;
  price?: number;
}

interface Props {
  parentId: string;
  fetchLinks: (parentId: string) => Promise<LinkedProfile[]>;
  linkProfile: (parentId: string, profileId: string, order: number) => Promise<void>;
  unlinkProfile: (id: string) => Promise<void>;
}

const ProfileLinker = ({ parentId, fetchLinks, linkProfile, unlinkProfile }: Props) => {
  const [links, setLinks] = useState<LinkedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLinks(await fetchLinks(parentId));
    } catch (e: any) {
      toast.error("Failed to load linked profiles: " + e.message);
    }
    setLoading(false);
  }, [parentId, fetchLinks]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { data, error } = await supabase
        .from("billing_profiles")
        .select("id, profile_name, profile_code, price")
        .eq("is_active", true)
        .ilike("profile_name", `%${q}%`)
        .order("profile_name")
        .limit(20);
      if (error) throw new Error(error.message);
      const linkedIds = new Set(links.map((l) => l.profile_id));
      setSearchResults((data || []).filter((r: any) => !linkedIds.has(r.id)));
    } catch (e: any) { toast.error(e.message); }
    setSearching(false);
  };

  const handleLink = async (profileId: string) => {
    try {
      const nextOrder = links.length > 0 ? Math.max(...links.map((l) => l.display_order)) + 1 : 0;
      await linkProfile(parentId, profileId, nextOrder);
      setSearchQuery(""); setSearchResults([]);
      await load();
      toast.success("Profile linked");
    } catch (e: any) { toast.error("Link failed: " + e.message); }
  };

  const handleUnlink = async (linkId: string) => {
    try {
      await unlinkProfile(linkId);
      await load();
      toast.success("Removed");
    } catch (e: any) { toast.error("Remove failed: " + e.message); }
  };

  if (loading) {
    return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <Label className="font-semibold text-sm">Linked Profiles ({links.length})</Label>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowSearch(!showSearch)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Profile
        </Button>
      </div>

      {showSearch && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search profiles by name..." value={searchQuery} onChange={(e) => handleSearch(e.target.value)} autoFocus />
          </div>
          {searching && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin" /></div>}
          {searchResults.length > 0 && (
            <div className="border rounded-md max-h-40 overflow-y-auto">
              {searchResults.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm" onClick={() => handleLink(r.id)}>
                  <div>
                    <span className="font-medium">{r.profile_name}</span>
                    <span className="ml-2 text-xs text-muted-foreground font-mono">{r.profile_code}</span>
                    <span className="ml-2 text-xs text-muted-foreground">₹{r.price}</span>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-primary" />
                </div>
              ))}
            </div>
          )}
          {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No matching profiles found</p>
          )}
        </div>
      )}

      {links.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Profile Name</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="w-[60px] text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.profile_code}</TableCell>
                  <TableCell className="font-medium text-sm">{l.profile_name}</TableCell>
                  <TableCell className="text-sm">₹{l.price}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUnlink(l.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-2">
          No profiles linked. Use "Add Profile" to search and link profiles.
        </p>
      )}
    </div>
  );
};

export default ProfileLinker;
