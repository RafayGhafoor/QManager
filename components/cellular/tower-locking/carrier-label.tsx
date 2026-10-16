import { Tag } from "@/components/ui/tag";
import type { CarrierOption } from "./simple-mode-utils";

interface CarrierLabelProps {
  opt: CarrierOption;
}

// Layout: [PCC/SCC] Band (EARFCN) RSRP dBm
export function CarrierLabel({ opt }: CarrierLabelProps) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      {/* PCC/SCC is carrier role metadata, not status: a neutral Tag. */}
      <Tag variant="neutral">{opt.type}</Tag>
      <span className="font-medium">{opt.band || "—"}</span>
      <span className="tabular-nums text-muted-foreground">({opt.earfcn})</span>
      {opt.rsrp !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {opt.rsrp} dBm
        </span>
      )}
    </span>
  );
}
