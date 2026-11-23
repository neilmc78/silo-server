import { OverlayPreviewCard } from "@/components/overlays/OverlayPreviewCard";
import { useT, type MessageKey } from "@/i18n";
import {
  seriesLayoutActive,
  type CardOverlayPrefs,
  type OverlayCardKind,
  type OverlayPreviewVariant,
  type OverlaySampleOverrides,
} from "@/lib/overlays";
import type { PosterSize } from "@/lib/uiCustomization";
import { cn } from "@/lib/utils";

// The samples shown side by side, and the layout each draws: the requested
// title has no kind, so it uses the movies layout.
const SAMPLES: readonly { variant: OverlayPreviewVariant; kind?: OverlayCardKind }[] = [
  { variant: "movie", kind: "movie" },
  { variant: "show", kind: "series" },
  { variant: "requested" },
];

const LABELS: Record<OverlayPreviewVariant, MessageKey> = {
  movie: "web.common.overlays.previewVariant.movie",
  show: "web.common.overlays.previewVariant.show",
  requested: "web.common.overlays.previewVariant.requested",
};

interface OverlayPreviewRowProps {
  prefs: CardOverlayPrefs;
  posterSize: PosterSize;
  sampleOverrides: OverlaySampleOverrides;
  /** The layout the badge pills edit. */
  layoutKind: OverlayCardKind;
  onLayoutKindChange: (kind: OverlayCardKind) => void;
}

/**
 * Every sample poster at once: a movie, a series and a requested title, each
 * drawn with the layout it gets. While series share the movies layout the
 * series poster is greyed out to say so. With separate layouts, the poster of
 * the layout being edited is ringed, and picking the movie or series poster
 * picks that layout.
 */
export function OverlayPreviewRow({
  prefs,
  posterSize,
  sampleOverrides,
  layoutKind,
  onLayoutKindChange,
}: OverlayPreviewRowProps) {
  const t = useT();
  const separate = seriesLayoutActive(prefs);
  const editingKind: OverlayCardKind = separate ? layoutKind : "movie";
  return (
    <div className="mt-3 flex flex-wrap items-start justify-center gap-4 pb-1">
      {SAMPLES.map(({ variant, kind }) => {
        const inherited = kind === "series" && !separate;
        const editing = separate && kind !== undefined && kind === editingKind;
        const card = (
          <>
            <span
              className={cn(
                "text-xs font-medium",
                editing ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {t(LABELS[variant])}
            </span>
            <OverlayPreviewCard
              prefs={prefs}
              posterSize={posterSize}
              variant={variant}
              sampleOverrides={sampleOverrides}
              muted={inherited}
              className={cn(
                "rounded-xl",
                editing && "ring-primary ring-offset-background ring-2 ring-offset-2",
              )}
            />
            {inherited ? (
              <span className="text-muted-foreground max-w-[140px] text-center text-[0.6875rem] leading-snug">
                {t("web.settings.cardOverlay.layout.inherited")}
              </span>
            ) : null}
          </>
        );
        return separate && kind !== undefined ? (
          <button
            key={variant}
            type="button"
            aria-pressed={editing}
            onClick={() => onLayoutKindChange(kind)}
            className="focus-visible:ring-ring flex flex-col items-center gap-1.5 rounded-xl focus-visible:ring-2 focus-visible:outline-none"
          >
            {card}
          </button>
        ) : (
          <div key={variant} className="flex flex-col items-center gap-1.5">
            {card}
          </div>
        );
      })}
    </div>
  );
}
