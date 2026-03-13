import { useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Underline, List, ListOrdered, ImagePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

const RichTextEditor = ({ value, onChange }: RichTextEditorProps) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  // Only set innerHTML when value changes externally (not from typing)
  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const exec = useCallback((command: string, val?: string) => {
    document.execCommand(command, false, val);
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleInput = () => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleImageUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const path = `interpretations/${Date.now()}_${file.name}`;
      const { error } = await supabase.storage.from("report-uploads").upload(path, file);
      if (error) return;
      const { data } = supabase.storage.from("report-uploads").getPublicUrl(path);
      exec("insertImage", data.publicUrl);
    };
    input.click();
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="flex gap-0.5 p-1.5 border-b bg-muted/30 flex-wrap">
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => { e.preventDefault(); exec("italic"); }}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}>
          <Underline className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}>
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => { e.preventDefault(); exec("insertOrderedList"); }}>
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onMouseDown={(e) => { e.preventDefault(); handleImageUpload(); }}>
          <ImagePlus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        className="min-h-[100px] max-h-[200px] overflow-y-auto p-3 text-sm focus:outline-none prose prose-sm max-w-none"
        onInput={handleInput}
        onBlur={handleInput}
      />
    </div>
  );
};

export default RichTextEditor;
