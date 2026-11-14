import movieArt from "@/assets/overlay-preview/movie.svg?no-inline";
import requestedArt from "@/assets/overlay-preview/requested.svg?no-inline";
import showArt from "@/assets/overlay-preview/show.svg?no-inline";
import type { OverlayPreviewVariant } from "@/lib/overlays";

/**
 * Made-up poster art for the badge previews, so badges show against artwork
 * rather than a blank card. The titles match the preview samples and are not
 * anyone's real library.
 */
export const OVERLAY_PREVIEW_ART: Record<OverlayPreviewVariant, string> = {
  movie: movieArt,
  show: showArt,
  requested: requestedArt,
};
