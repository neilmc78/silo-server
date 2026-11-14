import CardOverlays from "./CardOverlays";
import CardWatchStatus from "./CardWatchStatus";
import { OVERLAY_PREVIEW_ART } from "./previewArt";
import { RequestDownloadBar } from "./RequestDownloadBar";
import {
  OVERLAY_PREVIEW_SAMPLES,
  OVERLAY_PREVIEW_WATCH_STATES,
  requestDownloadBarPercent,
  withSampleOverrides,
  type CardOverlayPrefs,
  type OverlayPreviewVariant,
  type OverlaySampleOverrides,
} from "@/lib/overlays";
import { carouselCardWidthClasses, type PosterSize } from "@/lib/uiCustomization";

/**
 * Which sample item the preview stands in for. Picked by
 * <OverlayPreviewVariantToggle />. "requested" is a watchlist title the
 * library doesn't have yet, downloading.
 */
export type { OverlayPreviewVariant };

interface OverlayPreviewCardProps {
  prefs: CardOverlayPrefs;
  variant?: OverlayPreviewVariant;
  /** The poster size to draw at; the card is as wide as a home-row card. */
  posterSize?: PosterSize;
  showPosterOverlays?: boolean;
  /** Values swapped into the sample to try badges with. */
  sampleOverrides?: OverlaySampleOverrides;
}

// Preview used by the admin defaults editor. Renders a 2:3 sample poster with the actual <CardOverlays /> renderer on top of it,
// fed sample data, at the width a home-row card draws at so badges show at
// their real size.
export function OverlayPreviewCard({
  prefs,
  variant = "movie",
  posterSize = "standard",
  showPosterOverlays = true,
  sampleOverrides = {},
}: OverlayPreviewCardProps) {
  const data = withSampleOverrides(OVERLAY_PREVIEW_SAMPLES[variant], sampleOverrides);
  const downloadPercent = showPosterOverlays ? requestDownloadBarPercent(data, prefs) : null;
  return (
    <div className={`mx-auto ${carouselCardWidthClasses(posterSize)}`}>
      <div className="bg-muted/40 relative aspect-[2/3] overflow-hidden rounded-xl border">
        <img
          src={OVERLAY_PREVIEW_ART[variant]}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {downloadPercent !== null ? <RequestDownloadBar percent={downloadPercent} /> : null}
        {showPosterOverlays ? (
          <CardOverlays data={data} prefs={prefs} hasProgressBar={downloadPercent !== null} />
        ) : null}
        <CardWatchStatus userState={OVERLAY_PREVIEW_WATCH_STATES[variant]} />
      </div>
    </div>
  );
}
