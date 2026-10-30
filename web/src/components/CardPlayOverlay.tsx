import { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { useLocation } from "react-router";

import { MEDIA_CARD_CENTER_ACTION_CLASS } from "@/components/MediaCardArtwork";
import ViewTransitionLink from "@/components/ViewTransitionLink";
import { fetchCatalogItemDetail } from "@/hooks/queries/catalogRead";
import DetailPopover from "@/pages/ItemDetail/components/DetailPopover";
import {
  buildEditionDetail,
  buildEditionOptions,
  type EditionOption,
  hasEditionChoice,
} from "@/pages/ItemDetail/components/editionOptions";
import { buildMediaPlayHref, isVideoWatchHref } from "@/lib/mediaNavigation";
import { parseWatchHref } from "@/pages/watchRouteHelpers";
import { useWatchPlaybackController } from "@/playback/watchPlaybackContext";
import { cn } from "@/lib/utils";

interface CardPlayOverlayProps {
  contentId: string;
  title: string;
  type?: "movie" | "episode";
  libraryId?: number;
  size?: "standard" | "compact";
  onPlaybackStart?: () => void;
  /** Ask which edition to play when a movie has several. Off resumes as-is. */
  pickEdition?: boolean;
}

export default function CardPlayOverlay({
  contentId,
  title,
  type: mediaType = "episode",
  libraryId,
  size = "standard",
  onPlaybackStart,
  pickEdition = true,
}: CardPlayOverlayProps) {
  const location = useLocation();
  const playbackController = useWatchPlaybackController();
  const watchHref = buildMediaPlayHref({ contentId, type: mediaType, libraryId });
  // A movie with several named editions asks which one to play.
  const [editions, setEditions] = useState<EditionOption[] | null>(null);

  const play = useCallback(
    (fileId?: number) => {
      const parsed = parseWatchHref(watchHref);
      if (!parsed) return;
      onPlaybackStart?.();
      playbackController.startPlayback(
        {
          contentId: parsed.contentId,
          fileId: fileId ?? parsed.fileId,
          libraryId: parsed.libraryId,
          restart: parsed.restart,
          returnHref: `${location.pathname}${location.search}`,
        },
        "viewer",
      );
    },
    [location.pathname, location.search, onPlaybackStart, playbackController, watchHref],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.stopPropagation();
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        !isVideoWatchHref(watchHref)
      ) {
        return;
      }

      if (!parseWatchHref(watchHref)) return;

      event.preventDefault();
      if (mediaType !== "movie" || !pickEdition) {
        play();
        return;
      }
      void fetchCatalogItemDetail(contentId, libraryId).then(
        (item) => {
          const options = buildEditionOptions(item.playback_variants, item.versions);
          if (hasEditionChoice(options)) {
            setEditions(options);
          } else {
            play();
          }
        },
        // The picker is a convenience; without the detail, play as before.
        () => play(),
      );
    },
    [contentId, libraryId, mediaType, pickEdition, play, watchHref],
  );

  const link = (
    <ViewTransitionLink
      to={watchHref}
      onClick={handleClick}
      aria-label={`Play ${title}`}
      className={cn(
        MEDIA_CARD_CENTER_ACTION_CLASS,
        "pointer-events-auto",
        size === "compact" ? "h-6 w-6" : "h-9 w-9",
      )}
    >
      <Play
        className={cn("ml-px", size === "compact" ? "h-2.5 w-2.5" : "h-[15px] w-[15px]")}
        fill="currentColor"
      />
    </ViewTransitionLink>
  );

  return (
    <DetailPopover
      open={editions !== null}
      onOpenChange={(open) => {
        if (!open) setEditions(null);
      }}
      contentClassName="w-72 p-1.5"
      // Covers the same box the button is centred in, so the button keeps its
      // place and the picker opens under the card.
      triggerClassName="pointer-events-none absolute inset-0"
      trigger={link}
    >
      {/* The popover renders in a portal, but React still bubbles its events
          to the card around this button, which would open the item page. */}
      <div
        className="space-y-0.5"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {editions?.map((option) => {
          const detail = buildEditionDetail(option);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setEditions(null);
                play(option.defaultVersion.file_id);
              }}
              className="hover:bg-accent/50 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
            >
              <Play className="text-primary size-3.5 shrink-0" fill="currentColor" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{option.label}</div>
                {detail && <div className="text-muted-foreground truncate text-xs">{detail}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </DetailPopover>
  );
}
