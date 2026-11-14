import { useId } from "react";
import { Check, SlidersHorizontal } from "lucide-react";

import { BadgeImagesControl } from "@/components/overlays/settings/BadgeImagesControl";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import {
  ACCENT_PALETTE,
  getOverlayDef,
  getPreset,
  POSITION_OPTIONS,
  type CardOverlayPrefs,
  type OverlayId,
  type OverlayImage,
  type OverlayItemConfig,
  type OverlayPosition,
} from "@/lib/overlays";
import { cn } from "@/lib/utils";

// Positions on the poster artwork, which doesn't mirror (CardOverlays.tsx).
/* eslint-disable silo/no-physical-direction -- places on the artwork, not the layout */
const POSITION_CLASSES: Record<OverlayPosition, string> = {
  "top-left": "top-1 left-1 h-4 w-5",
  "top-center": "top-1 left-1/2 h-4 w-5 -translate-x-1/2",
  "left-edge": "top-1/2 left-0 h-7 w-3 -translate-y-1/2 rounded-l-none",
  "right-edge": "top-1/2 right-0 h-7 w-3 -translate-y-1/2 rounded-r-none",
  "bottom-left": "bottom-1 left-1 h-4 w-5",
  "bottom-center": "bottom-1 left-1/2 h-4 w-5 -translate-x-1/2",
  "bottom-right": "bottom-1 right-1 h-4 w-5",
};
/* eslint-enable silo/no-physical-direction -- end of the artwork positions */

interface BadgeAdjustProps {
  overlayId: OverlayId;
  prefs: CardOverlayPrefs;
  shortcutsOn: boolean;
  images: readonly OverlayImage[];
  supportsStyles: boolean;
  onChange: (next: Partial<OverlayItemConfig>) => void;
  triggerClassName?: string;
}

/** Where one badge sits, its color, its icon, and its images, behind one button. */
export function BadgeAdjust({
  overlayId,
  prefs,
  shortcutsOn,
  images,
  supportsStyles,
  onChange,
  triggerClassName,
}: BadgeAdjustProps) {
  const t = useT();
  const def = getOverlayDef(overlayId);
  const iconSwitchId = useId();
  if (!def) return null;
  const config = prefs.items[overlayId];
  const showIcon = !!def.iconCapable && (config.showIcon ?? getPreset(prefs.preset).preferIcon);
  const color = config.accentColor;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "focus-visible:ring-ring flex h-8 items-center rounded-e-full border-s px-2 transition-colors focus-visible:ring-2 focus-visible:outline-none",
            triggerClassName,
          )}
          aria-label={t("web.settings.cardOverlay.adjustLabel", { badge: def.label })}
          title={t("web.settings.cardOverlay.adjust")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-80 space-y-4 overflow-y-auto p-4">
        <p className="text-sm font-semibold">{def.label}</p>

        <div className="flex items-start gap-4">
          <div
            role="radiogroup"
            aria-label={t("web.settings.cardOverlay.position")}
            className="bg-muted/50 border-border/70 relative aspect-[2/3] w-20 shrink-0 rounded-md border"
          >
            {/* The top-right corner is the watch-status indicator's. */}
            <span
              aria-hidden="true"
              // eslint-disable-next-line silo/no-physical-direction -- a corner of the artwork
              className="border-foreground/25 absolute top-1 right-1 h-3.5 w-3.5 rounded-full border border-dashed"
            />
            {POSITION_OPTIONS.map((option) => {
              const active = config.position === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => onChange({ position: option.value })}
                  className={cn(
                    "focus-visible:ring-ring absolute rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    POSITION_CLASSES[option.value],
                    active ? "bg-primary" : "bg-foreground/15 hover:bg-foreground/30",
                  )}
                />
              );
            })}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("web.settings.cardOverlay.position")}</p>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              {t("web.settings.cardOverlay.positionHint")}
            </p>
            {shortcutsOn && config.position.startsWith("bottom") ? (
              <p className="text-muted-foreground text-[13px] leading-relaxed">
                {t("web.settings.cardOverlay.positionShortcutsHint")}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("web.settings.cardOverlay.color")}</p>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-label={t("web.settings.cardOverlay.color")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={!color}
              onClick={() => onChange({ accentColor: undefined })}
              className={cn(
                "border-border text-muted-foreground hover:text-foreground focus-visible:ring-ring h-7 rounded-full border px-2.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none",
                !color && "border-primary text-foreground",
              )}
            >
              {t("web.settings.cardOverlay.colorDefault")}
            </button>
            {ACCENT_PALETTE.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                role="radio"
                aria-checked={color === swatch.value}
                aria-label={swatch.label}
                title={swatch.label}
                onClick={() => onChange({ accentColor: swatch.value })}
                className="border-border/40 focus-visible:ring-ring relative h-7 w-7 rounded-full border focus-visible:ring-2 focus-visible:outline-none"
                style={{ background: swatch.value }}
              >
                {color === swatch.value ? (
                  <Check
                    aria-hidden="true"
                    className="absolute inset-0 m-auto h-3.5 w-3.5"
                    style={{ color: swatch.value === "#ffffff" ? "black" : "white" }}
                  />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {def.iconCapable ? (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={iconSwitchId} className="text-sm font-medium">
              {t("web.settings.cardOverlay.showIcon")}
            </Label>
            <Switch
              id={iconSwitchId}
              checked={showIcon}
              onCheckedChange={(checked) => onChange({ showIcon: checked })}
            />
          </div>
        ) : null}

        {/* Shown while the badge still names an image, even one since
            deleted, so the reference can be cleared. */}
        {supportsStyles && (images.length > 0 || config.image || config.valueImages) ? (
          <BadgeImagesControl def={def} config={config} images={images} onChange={onChange} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
