import type { FileVersion, PlaybackVariant } from "@/api/types";
import type { Translate } from "@/i18n";
import { buildQualitySummary, sortByResolution } from "./VersionFlyout";
import { playbackEditions } from "./versionRankingUtils";

// The editions a movie card's play button offers, built the way the detail
// page's edition dropdown (VersionDropdown) builds its own.
export interface EditionOption {
  id: string;
  label: string;
  defaultVersion: FileVersion;
  versions: FileVersion[];
}

// hasEditionChoice reports whether the options are worth asking about: more
// than one edition, at least one of them named, with distinct labels.
export function hasEditionChoice(options: EditionOption[]): boolean {
  return (
    options.length > 1 &&
    options.some((option) => option.id) &&
    new Set(options.map((option) => option.label.toLowerCase())).size > 1
  );
}

export function buildEditionOptions(
  t: Translate,
  playbackVariants: PlaybackVariant[] | undefined,
  versions: FileVersion[],
): EditionOption[] {
  const editions = playbackEditions(versions, playbackVariants);
  const hasNamedEditions = editions.some((edition) => edition.key);
  return editions.flatMap((edition) => {
    const sorted = sortByResolution(edition.versions);
    const defaultVersion = sorted[0];
    if (!defaultVersion) return [];
    return [
      {
        id: edition.key,
        label:
          edition.raw?.trim() ||
          (edition.key
            ? humanizeEditionKey(edition.key)
            : t(
                hasNamedEditions
                  ? "web.detail.versions.standardEdition"
                  : "web.detail.versions.editionFallback",
              )),
        defaultVersion,
        versions: sorted,
      },
    ];
  });
}

export function humanizeEditionKey(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) =>
      part.toLowerCase() === "imax" ? "IMAX" : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

export function buildEditionDetail(t: Translate, option: EditionOption): string {
  const parts: string[] = [];
  if (option.versions.length > 1) {
    parts.push(
      t("web.detail.versions.versionCount", {
        count: option.versions.length,
        count_text: option.versions.length,
      }),
    );
  }
  const defaultSummary = buildQualitySummary(option.defaultVersion);
  if (defaultSummary) parts.push(defaultSummary);
  return parts.join(" · ");
}
