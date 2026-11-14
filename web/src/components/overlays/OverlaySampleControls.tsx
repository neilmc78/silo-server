import { FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/i18n";
import {
  getOverlayDef,
  OVERLAY_SAMPLE_CHOICES,
  type OverlayId,
  type OverlaySampleField,
  type OverlaySampleOverrides,
} from "@/lib/overlays";

// The badge whose name labels each sample field.
const FIELD_BADGE: Record<OverlaySampleField, OverlayId> = {
  resolution: "resolution",
  hdr: "hdr",
  audio: "audio",
  audio_channels: "audio_channels",
  edition: "edition",
  show_status: "show_status",
};

// Select items cannot hold "", so none travels as this.
const NONE = "__none__";

interface OverlaySampleControlsProps {
  value: OverlaySampleOverrides;
  onChange: (next: OverlaySampleOverrides) => void;
}

/**
 * Swaps the sample posters' file and status values, so every logo, label and
 * status colour can be tried in the preview. Nothing here is saved.
 */
export function OverlaySampleControls({ value, onChange }: OverlaySampleControlsProps) {
  const t = useT();
  const changed = Object.keys(value).length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
          {t("web.settings.cardOverlay.sample.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-4">
        <p className="text-muted-foreground text-[13px] leading-relaxed">
          {t("web.settings.cardOverlay.sample.hint")}
        </p>
        {(Object.keys(OVERLAY_SAMPLE_CHOICES) as OverlaySampleField[]).map((field) => {
          const def = getOverlayDef(FIELD_BADGE[field]);
          const label = def ? (def.shortLabel ?? def.label) : field;
          const current = value[field];
          return (
            <div key={field} className="flex items-center justify-between gap-3">
              <span className="text-sm">{label}</span>
              <Select
                value={current === undefined ? "" : current === "" ? NONE : current}
                onValueChange={(next) => onChange({ ...value, [field]: next === NONE ? "" : next })}
              >
                <SelectTrigger className="h-8 w-36" aria-label={label}>
                  <SelectValue placeholder={t("web.settings.cardOverlay.sample.asSample")} />
                </SelectTrigger>
                <SelectContent>
                  {OVERLAY_SAMPLE_CHOICES[field].map((choice) => (
                    <SelectItem key={choice || NONE} value={choice || NONE}>
                      {choice === ""
                        ? t("web.settings.cardOverlay.sample.none")
                        : field === "show_status"
                          ? (def?.getValue({ show_status: choice }) ?? choice)
                          : choice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={!changed}
          onClick={() => onChange({})}
        >
          {t("web.settings.cardOverlay.sample.reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
