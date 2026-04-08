import { useMasterLookup } from "@/hooks/useMasterLookup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState } from "react";

interface Props {
  category: string;
  value: string;
  onChange: (value: string) => void;
  onMappedValue?: (mapped: string) => void;
  onMappedValue2?: (mapped: string) => void;
  placeholder?: string;
  className?: string;
}

export default function MasterLookupSelect({ category, value, onChange, onMappedValue, onMappedValue2, placeholder, className }: Props) {
  const { data: items = [] } = useMasterLookup(category);
  const [custom, setCustom] = useState(false);

  // If current value isn't in the list, show input mode
  const valueInList = items.some(i => i.value === value);

  if (custom || (value && !valueInList && items.length > 0)) {
    return (
      <div className="flex gap-1">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={className}
        />
        {items.length > 0 && (
          <button
            type="button"
            className="text-xs text-primary whitespace-nowrap px-2"
            onClick={() => setCustom(false)}
          >
            List
          </button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  return (
    <div className="flex gap-1">
      <Select
        value={value || undefined}
        onValueChange={(v) => {
          onChange(v);
          const item = items.find(i => i.value === v);
          if (onMappedValue && item?.mapped_value) onMappedValue(item.mapped_value);
          if (onMappedValue2 && item?.mapped_value_2) onMappedValue2(item.mapped_value_2);
        }}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder || "Select..."} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.value}>
              {item.value}
              {item.mapped_value && <span className="text-muted-foreground ml-1 text-xs">→ {item.mapped_value}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        className="text-xs text-muted-foreground whitespace-nowrap px-2 hover:text-primary"
        onClick={() => setCustom(true)}
      >
        Custom
      </button>
    </div>
  );
}
