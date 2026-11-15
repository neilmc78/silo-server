import { useId } from "react";
import { Check } from "lucide-react";

import { ChoiceButtons } from "@/components/settings/ChoiceButtons";
import { SettingsSubheading } from "@/components/settings/SettingsSubheading";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import {
  CATEGORY_GROUPS,
  OVERLAY_REGISTRY,
  overlaySuppressedBy,
  getOverlayDef,
  layoutPrefsFor,
  withLayoutEdit,
  type CardOverlayPrefs,
  type OverlayCardKind,
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
  /** The layout being edited: movies' (the shared one) or series'. */
  kind: OverlayCardKind;
  onKindChange: (kind: OverlayCardKind) => void;
}

/**
 * Every badge as a toggle pill, grouped by category. A pill that is on carries
 * a button that opens its position, order, color, icon and image choices.
 * Series can have a layout of their own; the pills then edit whichever
 * layout is picked.
 */
export function BadgePills({
  prefs,
  onChange,
  isOffered,
  shortcutsOn,
  images,
  supportsStyles,
  kind,
  onKindChange,
}: BadgePillsProps) {
  const t = useT();
  const seriesSwitchId = useId();
  const separate = prefs.series !== undefined;
  const editing: OverlayCardKind = separate ? kind : "movie";
  const layout = layoutPrefsFor(prefs, editing);
  const commit = (next: CardOverlayPrefs) => onChange(withLayoutEdit(prefs, editing, next));

  const setSeparate = (on: boolean) => {
    if (on) {
      // Series start from the layout movies use, so nothing moves until edited.
      onChange({ ...prefs, series: { order: [...prefs.order], items: { ...prefs.items } } });
      onKindChange("series");
    } else {
      const { series: _series, ...rest } = prefs;
      onChange(rest);
      onKindChange("movie");
    }
  };

  return (
    <div>
      <div className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor={seriesSwitchId} className="text-sm font-medium">
              {t("web.settings.cardOverlay.layout.separate")}
            </Label>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              {t("web.settings.cardOverlay.layout.separateHint")}
            </p>
          </div>
          <Switch id={seriesSwitchId} checked={separate} onCheckedChange={setSeparate} />
        </div>
        {separate ? (
          <ChoiceButtons
            label={t("web.settings.cardOverlay.layout.editing")}
            value={editing}
            options={[
              { value: "movie", label: t("web.settings.cardOverlay.layout.movies") },
              { value: "series", label: t("web.settings.cardOverlay.layout.series") },
            ]}
            onChange={onKindChange}
          />
        ) : null}
      </div>
      {CATEGORY_GROUPS.map(({ category, title }) => {
        const overlays = OVERLAY_REGISTRY.filter((d) => d.category === category && isOffered(d));
        if (overlays.length === 0) return null;
        const onCount = overlays.filter((d) => layout.items[d.id].enabled).length;
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
                const config = layout.items[def.id];
                const update = (next: Partial<OverlayItemConfig>) =>
                  commit({
                    ...layout,
                    items: { ...layout.items, [def.id]: { ...config, ...next } },
                  });
                const suppressedBy = config.enabled ? overlaySuppressedBy(def.id, layout) : null;
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
                        prefs={layout}
                        shortcutsOn={shortcutsOn}
                        images={images}
                        supportsStyles={supportsStyles}
                        onChange={update}
                        onOrderChange={(order) => commit({ ...layout, order })}
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
