import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Loader2, Search, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
  getTestParameters,
  linkParameterToTest,
  unlinkParameterFromTest,
  searchParameters,
  TestParameterLink,
} from "@/lib/tests";

interface Props {
  testId: string;
  testName: string;
}

const TestParameterManager = ({ testId, testName }: Props) => {
  const [links, setLinks] = useState<TestParameterLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getTestParameters(testId);
      setLinks(data);
    } catch (e: any) {
      toast.error("Failed to load parameters: " + e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [testId]);

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchParameters(q);
      // Filter out already linked parameters
      const linkedIds = new Set(links.map((l) => l.parameter_id));
      setSearchResults(results.filter((r: any) => !linkedIds.has(r.id)));
    } catch (e: any) {
      toast.error(e.message);
    }
    setSearching(false);
  };

  const handleLink = async (paramId: string) => {
    try {
      const nextOrder = links.length > 0 ? Math.max(...links.map((l) => l.display_order)) + 1 : 0;
      await linkParameterToTest(testId, paramId, nextOrder);
      setSearchQuery("");
      setSearchResults([]);
      await load();
      toast.success("Parameter linked");
    } catch (e: any) {
      toast.error("Link failed: " + e.message);
    }
  };

  const handleUnlink = async (linkId: string) => {
    try {
      await unlinkParameterFromTest(linkId);
      await load();
      toast.success("Parameter removed");
    } catch (e: any) {
      toast.error("Remove failed: " + e.message);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <Label className="font-semibold text-sm">
          Linked Parameters ({links.length})
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowSearch(!showSearch)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Parameter
        </Button>
      </div>

      {showSearch && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search parameters by name..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              autoFocus
            />
          </div>
          {searching && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}
          {searchResults.length > 0 && (
            <div className="border rounded-md max-h-40 overflow-y-auto">
              {searchResults.map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm"
                  onClick={() => handleLink(r.id)}
                >
                  <div>
                    <span className="font-medium">{r.parameter_name}</span>
                    <span className="ml-2 text-xs text-muted-foreground font-mono">
                      {r.param_code}
                    </span>
                    {r.unit && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({r.unit})
                      </span>
                    )}
                  </div>
                  <Plus className="h-3.5 w-3.5 text-primary" />
                </div>
              ))}
            </div>
          )}
          {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No matching parameters found
            </p>
          )}
        </div>
      )}

      {links.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Parameter</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Normal Range</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.param_code}</TableCell>
                  <TableCell className="font-medium text-sm">{l.parameter_name}</TableCell>
                  <TableCell className="text-sm">{l.unit || "-"}</TableCell>
                  <TableCell className="text-sm">
                    {l.normal_range_text
                      ? l.normal_range_text
                      : l.normal_range_low != null && l.normal_range_high != null
                      ? `${l.normal_range_low} - ${l.normal_range_high}`
                      : "-"}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => handleUnlink(l.id)}
                    >
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
          No parameters linked. Use "Add Parameter" to search and link from master list.
        </p>
      )}
    </div>
  );
};

export default TestParameterManager;
