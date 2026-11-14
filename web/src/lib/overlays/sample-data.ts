import type { MediaItemUserState } from "@/api/types";
import { t } from "@/i18n";
import type { OverlayData } from "./types";

// Sample OverlayData used by the settings preview cards so users can see how
// the configured overlays will actually look. Two variants — movie and show —
// because some overlays (show_status, edition) only render for one or the
// other in real data. A third, a requested title the library doesn't have
// yet, shows the request_status badge and its download bar.

export const SAMPLE_MOVIE_DATA: OverlayData = {
  kind: "movie",
  resolution: "2160p",
  hdr: "DV HDR10",
  audio: "Atmos",
  audio_channels: "7.1",
  video_codec: "H.265",
  container: "MKV",
  aspect_ratio: "2.39:1",
  release_type: "REMUX",
  edition: "Extended",
  multi_audio: true,
  multi_sub: true,
  rating_imdb: 8.7,
  rating_tmdb: 8.5,
  rating_rt_critic: 96,
  rating_rt_audience: 92,
  content_rating: "PG-13",
  advisory_age: 13,
  year: 2024,
  runtime: 148,
  original_language: "EN",
  studio: "A24",
  network: undefined,
  show_status: undefined,
  imdb_top_250: 42,
  rt_certified_fresh: true,
};

export const SAMPLE_SHOW_DATA: OverlayData = {
  ...SAMPLE_MOVIE_DATA,
  kind: "series",
  resolution: "1080p",
  hdr: "HDR10",
  edition: undefined,
  release_type: undefined,
  runtime: 55,
  studio: undefined,
  network: "HBO",
  show_status: "returning",
  rt_certified_fresh: false,
  imdb_top_250: null,
};

// A watchlist title outside the library: TMDB data only, no file badges.
export const SAMPLE_REQUEST_DATA: OverlayData = {
  rating_tmdb: 8.1,
  content_rating: "PG-13",
  year: 2026,
  get request_status() {
    return t("web.common.overlays.sampleDownloading", { percent: 43 });
  },
  request_status_icon: "download",
  request_status_attention: false,
  request_download_percent: 43,
};

/** The samples the settings preview offers. */
export type OverlayPreviewVariant = "movie" | "show" | "requested";

export const OVERLAY_PREVIEW_VARIANTS: readonly OverlayPreviewVariant[] = [
  "movie",
  "show",
  "requested",
];

export const OVERLAY_PREVIEW_SAMPLES: Readonly<Record<OverlayPreviewVariant, OverlayData>> = {
  movie: SAMPLE_MOVIE_DATA,
  show: SAMPLE_SHOW_DATA,
  requested: SAMPLE_REQUEST_DATA,
};

// The watch state each sample shows in its top-right status corner: a watched
// movie, a show with episodes left, and a title nobody has started.
export const OVERLAY_PREVIEW_WATCH_STATES: Readonly<
  Record<OverlayPreviewVariant, MediaItemUserState | undefined>
> = {
  movie: { played: true, is_favorite: false, in_watchlist: false },
  show: {
    played: false,
    is_favorite: false,
    in_watchlist: false,
    watched_count: 5,
    unplayed_count: 3,
  },
  requested: undefined,
};

// Values the preview's sample picker offers, in the API's own vocabulary, so
// every bundled logo and status colour can be tried on the sample posters.
// "" stands for none.
export const OVERLAY_SAMPLE_CHOICES = {
  resolution: ["2160p", "1080p", "720p", "480p"],
  hdr: ["DV HDR10", "DV", "HDR10+", "HDR10", "HDR", "HLG", ""],
  audio: ["Atmos", "TrueHD", "DTS-HD", "DTS", "EAC3", "AC3", "AAC", "FLAC"],
  audio_channels: ["7.1", "5.1", "Stereo"],
  edition: ["Extended", "IMAX", "Director's Cut", ""],
  show_status: ["returning", "ended", "cancelled", "upcoming"],
} as const satisfies Record<string, readonly string[]>;

export type OverlaySampleField = keyof typeof OVERLAY_SAMPLE_CHOICES;
export type OverlaySampleOverrides = Partial<Record<OverlaySampleField, string>>;

/** A sample with the picker's choices applied; titles outside the library keep theirs. */
export function withSampleOverrides(
  data: OverlayData,
  overrides: OverlaySampleOverrides,
): OverlayData {
  if (data === SAMPLE_REQUEST_DATA) return data;
  const next = { ...data };
  for (const [field, value] of Object.entries(overrides) as [OverlaySampleField, string][]) {
    next[field] = value === "" ? undefined : value;
  }
  return next;
}
