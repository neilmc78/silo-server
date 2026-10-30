import type { FileVersion, PlaybackVariant } from "@/api/types";
import { sortPlaybackVariantsByEditionPreference } from "./versionRankingUtils";
import { buildQualitySummary, sortByResolution } from "./VersionFlyout";

export interface EditionOption {
  id: string;
  label: string;
  variant: PlaybackVariant;
  defaultVersion: FileVersion;
  versions: FileVersion[];
}

// hasEditionChoice reports whether the options are worth offering as a choice:
// more than one edition, at least one of them named, with distinct labels.
export function hasEditionChoice(options: EditionOption[]): boolean {
  return (
    options.length > 1 &&
    new Set(options.map((option) => option.label.toLowerCase())).size > 1 &&
    options.some((option) => option.variant.edition_key)
  );
}

export function buildEditionOptions(
  playbackVariants: PlaybackVariant[] | undefined,
  versions: FileVersion[],
): EditionOption[] {
  if (!playbackVariants || playbackVariants.length === 0) {
    return [];
  }

  const orderedVariants = sortPlaybackVariantsByEditionPreference(playbackVariants);
  const hasNamedEditions = orderedVariants.some((variant) => variant.edition_key);

  return orderedVariants
    .map((variant) => {
      const firstPart = [...(variant.parts ?? [])].sort((a, b) => a.part_index - b.part_index)[0];
      if (!firstPart) {
        return null;
      }

      const partVersions = sortByResolution([...(firstPart.versions ?? [])]);
      const defaultVersion =
        (firstPart.default_file_id != null
          ? versions.find((version) => version.file_id === firstPart.default_file_id)
          : undefined) ?? partVersions[0];
      if (!defaultVersion) {
        return null;
      }

      return {
        id: variant.variant_id,
        label: buildEditionLabel(variant, hasNamedEditions),
        variant,
        defaultVersion,
        versions: partVersions,
      };
    })
    .filter((entry): entry is EditionOption => !!entry);
}

function buildEditionLabel(variant: PlaybackVariant, hasNamedEditions: boolean): string {
  if (variant.edition_raw?.trim()) {
    return variant.edition_raw.trim();
  }
  if (variant.edition_key?.trim()) {
    return humanizeEditionKey(variant.edition_key);
  }
  return hasNamedEditions ? "Standard" : "Edition";
}

export function humanizeEditionKey(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "imax") {
        return "IMAX";
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

export function buildEditionDetail(option: EditionOption): string {
  const parts: string[] = [];
  if (option.versions.length > 1) {
    parts.push(`${option.versions.length} versions`);
  }

  const defaultSummary = buildQualitySummary(option.defaultVersion);
  if (defaultSummary) {
    parts.push(defaultSummary);
  }

  return parts.join(" · ");
}
