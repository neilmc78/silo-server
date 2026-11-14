import { Check } from "lucide-react";

import { SettingsSubheading } from "@/components/settings/SettingsSubheading";
import { useT } from "@/i18n";
import {
  CATEGORY_GROUPS,
  OVERLAY_REGISTRY,
  overlaySuppressedBy,
  getOverlayDef,
  type CardOverlayPrefs,
  type OverlayDef,
  type OverlayImage,
  type OverlayItemConfig,
} from "@/lib/overlays";
import { cn } from "@/lib/utils";

import { BadgeAdjust } from "./BadgeAdjust";

interface BadgePillsProps {
  prefs: CardOverlayPrefs;
  onChange: (next: CardOverlayPrefs) => void;
  /** Whether a badge is offered here: supported by the server and its source shown. */
  isOffered: (def: OverlayDef) => boolean;
  shortcutsOn: boolean;
  images: readonly OverlayImage[];
  supportsStyles: boolean;
}

/**
 * Every badge as a toggle pill, grouped by category. A pill that is on carries
 * a button that opens its position, color, icon and image choices.
 */
export function BadgePills({
  prefs,
  onChange,
  isOffered,
  shortcutsOn,
  images,
  supportsStyles,
}: BadgePillsProps) {
  const t = useT();

  return (
    <div>
      {CATEGORY_GROUPS.map(({ category, title }) => {
        const overlays = OVERLAY_REGISTRY.filter((d) => d.category === category && isOffered(d));
        if (overlays.length === 0) return null;
        const onCount = overlays.filter((d) => prefs.items[d.id].enabled).length;
        return (
          <div key={category} className="min-w-0">
            <SettingsSubheading>
              <span className="flex items-baseline justify-between gap-3">
                <span>{title}</span>
                <span className="font-normal tracking-normal normal-case tabular-nums">
                  {onCount === 0
                    ? t("web.settings.cardOverlay.noneOn")
                    : t("web.settings.cardOverlay.someOn", { on: onCount, total: overlays.length })}
                </span>
              </span>
            </SettingsSubheading>
            <div className="flex flex-wrap gap-2 pt-1 pb-2">
              {overlays.map((def) => {
                const config = prefs.items[def.id];
                const update = (next: Partial<OverlayItemConfig>) =>
                  onChange({
                    ...prefs,
                    items: { ...prefs.items, [def.id]: { ...config, ...next } },
                  });
                const suppressedBy = config.enabled ? overlaySuppressedBy(def.id, prefs) : null;
                const suppressor = suppressedBy ? getOverlayDef(suppressedBy) : undefined;
                const hint = suppressedBy
                  ? t("web.settings.cardOverlay.suppressedHint", {
                      badge: suppressor ? (suppressor.shortLabel ?? suppressor.label) : "",
                    })
                  : def.availabilityNote;
                const on = config.enabled;
                return (
                  <div
                    key={def.id}
                    className={cn(
                      "inline-flex items-stretch rounded-full border text-sm transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                      suppressedBy && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={on}
                      title={[def.description, hint].filter(Boolean).join("\n")}
                      onClick={() => update({ enabled: !on })}
                      className={cn(
                        "focus-visible:ring-ring flex h-8 items-center gap-1.5 px-3 font-medium focus-visible:ring-2 focus-visible:outline-none",
                        on ? "rounded-s-full ps-2.5 pe-2" : "rounded-full",
                      )}
                    >
                      {on ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      {def.shortLabel ?? def.label}
                    </button>
                    {on ? (
                      <BadgeAdjust
                        overlayId={def.id}
                        prefs={prefs}
                        shortcutsOn={shortcutsOn}
                        images={images}
                        supportsStyles={supportsStyles}
                        onChange={update}
                        triggerClassName="border-primary-foreground/25 hover:bg-primary-foreground/15"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
