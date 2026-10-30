import { memo, useMemo, useState } from "react";
import { Check, ChevronDown, Disc3, Layers3 } from "lucide-react";

import type { FileVersion, PlaybackVariant } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { videoRangeLabel } from "@/lib/videoRange";
import DetailPopover from "./DetailPopover";
import {
  buildEditionDetail,
  buildEditionOptions,
  type EditionOption,
  hasEditionChoice,
} from "./editionOptions";
import { buildDetailLine, buildQualitySummary, sortByResolution } from "./VersionFlyout";

interface VersionDropdownProps {
  versions: FileVersion[];
  playbackVariants?: PlaybackVariant[];
  selectedVersion: FileVersion | null;
  onSelectVersion: (version: FileVersion) => void;
}

function VersionDropdown({
  versions,
  playbackVariants,
  selectedVersion,
  onSelectVersion,
}: VersionDropdownProps) {
  const [editionOpen, setEditionOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);

  const sorted = useMemo(() => sortByResolution(versions), [versions]);
  const editionOptions = useMemo(
    () => buildEditionOptions(playbackVariants, versions),
    [playbackVariants, versions],
  );

  const showEditionDropdown = hasEditionChoice(editionOptions);

  const selectedEdition = showEditionDropdown
    ? resolveSelectedEditionOption(editionOptions, selectedVersion)
    : null;
  const activeVersions = selectedEdition?.versions ?? sorted;
  const activeVersion =
    selectedVersion ?? selectedEdition?.defaultVersion ?? activeVersions[0] ?? null;
  const showVersionDropdown = activeVersions.length > 1;

  if (!showEditionDropdown && !showVersionDropdown) {
    return null;
  }

  return (
    <>
      {showEditionDropdown && selectedEdition ? (
        <DetailPopover
          open={editionOpen}
          onOpenChange={setEditionOpen}
          contentClassName="w-72 p-1.5"
          trigger={
            <Button
              variant="glass"
              className="h-8 max-w-full min-w-0 shrink gap-1.5 rounded-full px-3 text-xs font-medium"
            >
              <Layers3 className="size-3.5" />
              Edition
              <span className="text-muted-foreground max-w-44 truncate text-[0.6875rem] font-normal sm:max-w-64">
                {selectedEdition.label}
              </span>
              <ChevronDown className="text-muted-foreground size-3" />
            </Button>
          }
        >
          <div className="space-y-0.5">
            {editionOptions.map((option) => {
              const isSelected = option.id === selectedEdition.id;
              const detail = buildEditionDetail(option);

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onSelectVersion(option.defaultVersion);
                    setEditionOpen(false);
                    setVersionOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{option.label}</div>
                    {detail && (
                      <div className="text-muted-foreground truncate text-xs">{detail}</div>
                    )}
                  </div>
                  {isSelected && <Check className="text-primary size-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </DetailPopover>
      ) : null}

      {showVersionDropdown ? (
        <DetailPopover
          open={versionOpen}
          onOpenChange={setVersionOpen}
          contentClassName="w-80 p-1.5"
          trigger={
            <Button
              variant="glass"
              className="h-8 max-w-full min-w-0 shrink gap-1.5 rounded-full px-3 text-xs font-medium"
            >
              <Disc3 className="size-3.5" />
              Version
              <span className="text-muted-foreground max-w-44 truncate text-[0.6875rem] font-normal sm:max-w-64">
                {activeVersion ? buildVersionTriggerSummary(activeVersion) : ""}
              </span>
              <ChevronDown className="text-muted-foreground size-3" />
            </Button>
          }
        >
          <div className="space-y-0.5">
            {activeVersions.map((version) => {
              const isSelected = version.file_id === activeVersion?.file_id;
              const summary = buildQualitySummary(version);
              const detail = buildDetailLine(version);
              const rangeLabel = videoRangeLabel(version);

              return (
                <button
                  key={version.file_id}
                  type="button"
                  onClick={() => {
                    onSelectVersion(version);
                    setVersionOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {summary || `Version ${version.file_id}`}
                      </span>
                      {rangeLabel ? (
                        <Badge
                          variant="secondary"
                          className="px-1.5 py-0 text-[0.625rem] uppercase"
                        >
                          {rangeLabel}
                        </Badge>
                      ) : null}
                    </div>
                    {detail && (
                      <span className="text-muted-foreground block truncate text-xs">{detail}</span>
                    )}
                  </div>
                  {isSelected && <Check className="text-primary size-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </DetailPopover>
      ) : null}
    </>
  );
}

export default memo(VersionDropdown);

function buildVersionTriggerSummary(version: FileVersion): string {
  return buildQualitySummary(version) || buildDetailLine(version) || `Version ${version.file_id}`;
}

function resolveSelectedEditionOption(
  editionOptions: EditionOption[],
  selectedVersion: FileVersion | null,
): EditionOption | null {
  if (editionOptions.length === 0) {
    return null;
  }

  if (selectedVersion) {
    const matching = editionOptions.find((option) =>
      option.variant.parts.some((part) =>
        part.versions.some((candidate) => candidate.file_id === selectedVersion.file_id),
      ),
    );
    if (matching) {
      return matching;
    }
  }

  return editionOptions[0] ?? null;
}
