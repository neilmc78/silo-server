import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";

import { useLanguageNamesLoaded } from "@/lib/languageNamesLoader";
import {
  OverlayIcon,
  WORDMARK_TEXT,
  badgeShowsIcon,
  getPreset,
  orderedOverlaysForPosition,
} from "@/lib/overlays";
import { cn } from "@/lib/utils";
import type {
  BadgePart,
  CardOverlayPrefs,
  OverlayData,
  OverlayDef,
  OverlayIconId,
  OverlayPosition,
  OverlayPreset,
  OverlayShadow,
  OverlaySize,
} from "@/lib/overlays";

// How much bigger or smaller than the preset's own each size draws a badge.
const SIZE_SCALE: Record<OverlaySize, number> = {
  small: 0.85,
  medium: 1,
  large: 1.2,
  xlarge: 1.45,
};

// scaledPreset is the preset with its badge geometry multiplied by the size.
// Edge insets stay put: a bigger badge still sits the same distance from the
// poster's edge.
function scaledPreset(preset: OverlayPreset, size: OverlaySize | undefined): OverlayPreset {
  const scale = SIZE_SCALE[size ?? "medium"];
  if (scale === 1) return preset;
  return {
    ...preset,
    fontSize: preset.fontSize * scale,
    paddingInline: preset.paddingInline * scale,
    paddingBlock: preset.paddingBlock * scale,
    iconSize: preset.iconSize * scale,
    iconGap: preset.iconGap * scale,
    stackGap: preset.stackGap * scale,
  };
}

// Corner stacks render at most this many badges; anything further down the
// user's order is dropped rather than colliding with the opposite corner.
const MAX_BADGES_PER_CORNER = 3;

// The desktop Home carousel's measured 185px overlay layer is the visual
// reference, including when the host card has its standard 1px border.
const POSTER_REFERENCE_WIDTH = 185;
const EDGE_INSET = 8;
const EDGE_GAP = 8;

const POSTER_VARS = {
  edgeInset: "--card-overlay-edge-inset",
  edgeGap: "--card-overlay-edge-gap",
  stackGap: "--card-overlay-stack-gap",
  fontSize: "--card-overlay-font-size",
  paddingInline: "--card-overlay-padding-inline",
  paddingBlock: "--card-overlay-padding-block",
  borderRadius: "--card-overlay-border-radius",
  borderWidth: "--card-overlay-border-width",
  borderLeftWidth: "--card-overlay-border-left-width",
  iconSize: "--card-overlay-icon-size",
  iconGap: "--card-overlay-icon-gap",
  textShadowX: "--card-overlay-text-shadow-x",
  textShadowY: "--card-overlay-text-shadow-y",
  textShadowBlur: "--card-overlay-text-shadow-blur",
  boxShadowX: "--card-overlay-box-shadow-x",
  boxShadowY: "--card-overlay-box-shadow-y",
  boxShadowBlur: "--card-overlay-box-shadow-blur",
  boxShadowSpread: "--card-overlay-box-shadow-spread",
} as const;

type ScalingMode = "container" | "legacy" | "fixed";

function overlayLength(pixels: number, mode: ScalingMode, legacyVariable: string): string {
  if (mode === "fixed") return `${pixels}px`;
  if (mode === "legacy") return `var(${legacyVariable}, ${pixels}px)`;
  return `${Number(((pixels / POSTER_REFERENCE_WIDTH) * 100).toFixed(6))}cqi`;
}

// Every poster card asks on every render, so the answer is cached. It is keyed
// to the `CSS` object so a replaced global (as in tests) is asked again.
let containerQueryUnitsSupport: { css: typeof CSS; supported: boolean } | null = null;

function supportsContainerQueryUnits(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  if (containerQueryUnitsSupport?.css !== CSS) {
    containerQueryUnitsSupport = { css: CSS, supported: CSS.supports("width", "1cqi") };
  }
  return containerQueryUnitsSupport.supported;
}

function setLegacyLength(element: HTMLElement, variable: string, pixels: number, scale: number) {
  element.style.setProperty(variable, `${Number((pixels * scale).toFixed(4))}px`);
}

function shadowValue(
  shadow: OverlayShadow,
  mode: ScalingMode,
  variables: { x: string; y: string; blur: string; spread?: string },
): string {
  const lengths = [
    overlayLength(shadow.x, mode, variables.x),
    overlayLength(shadow.y, mode, variables.y),
    overlayLength(shadow.blur, mode, variables.blur),
  ];
  if (variables.spread) {
    lengths.push(overlayLength(shadow.spread ?? 0, mode, variables.spread));
  }
  return [...lengths, shadow.color].join(" ");
}

function applyLegacyPosterScale(
  element: HTMLElement,
  width: number,
  preset: OverlayPreset,
  borderRadius: number,
) {
  if (width <= 0) return;
  const scale = width / POSTER_REFERENCE_WIDTH;

  setLegacyLength(element, POSTER_VARS.edgeInset, EDGE_INSET, scale);
  setLegacyLength(element, POSTER_VARS.edgeGap, EDGE_GAP, scale);
  setLegacyLength(element, POSTER_VARS.stackGap, preset.stackGap, scale);
  setLegacyLength(element, POSTER_VARS.fontSize, preset.fontSize, scale);
  setLegacyLength(element, POSTER_VARS.paddingInline, preset.paddingInline, scale);
  setLegacyLength(element, POSTER_VARS.paddingBlock, preset.paddingBlock, scale);
  setLegacyLength(element, POSTER_VARS.iconSize, preset.iconSize, scale);
  setLegacyLength(element, POSTER_VARS.iconGap, preset.iconGap, scale);
  if (preset.borderRadius !== "full") {
    setLegacyLength(element, POSTER_VARS.borderRadius, borderRadius, scale);
  }
  if (preset.borderWidth !== undefined) {
    setLegacyLength(element, POSTER_VARS.borderWidth, preset.borderWidth, scale);
  }
  if (preset.borderLeftWidth !== undefined) {
    setLegacyLength(element, POSTER_VARS.borderLeftWidth, preset.borderLeftWidth, scale);
  }
  if (preset.textShadow) {
    setLegacyLength(element, POSTER_VARS.textShadowX, preset.textShadow.x, scale);
    setLegacyLength(element, POSTER_VARS.textShadowY, preset.textShadow.y, scale);
    setLegacyLength(element, POSTER_VARS.textShadowBlur, preset.textShadow.blur, scale);
  }
  if (preset.boxShadow) {
    setLegacyLength(element, POSTER_VARS.boxShadowX, preset.boxShadow.x, scale);
    setLegacyLength(element, POSTER_VARS.boxShadowY, preset.boxShadow.y, scale);
    setLegacyLength(element, POSTER_VARS.boxShadowBlur, preset.boxShadow.blur, scale);
    setLegacyLength(element, POSTER_VARS.boxShadowSpread, preset.boxShadow.spread ?? 0, scale);
  }
}

interface CardOverlaysProps {
  data: OverlayData;
  prefs: CardOverlayPrefs;
  variant?: "poster" | "wide";
  /**
   * Set by hosts that draw a watch-progress bar along the bottom of the
   * artwork (ContinueWatchingCard, EpisodeRow, SeasonEpisodeGrid). The bar
   * occupies the same edge strip as the bottom badge row, so the row rises
   * just clear of it; with no bar the badges stay flush in the corners.
   */
  hasProgressBar?: boolean;
}

interface ResolvedBadge {
  def: OverlayDef;
  label: string;
  accentColor: string | undefined;
  iconId: OverlayIconId | null;
  // Set for badges drawn from parts (a logo and a coloured score); they
  // replace the icon and label.
  parts: BadgePart[] | null;
}

function resolveBadge(
  def: OverlayDef,
  data: OverlayData,
  preset: OverlayPreset,
  itemAccent: string | undefined,
  itemShowIcon: boolean | undefined,
): ResolvedBadge | null {
  const label = def.getValue(data);
  if (!label) return null;
  const dynamicIcon = def.getIcon ? def.getIcon(data) : null;
  const candidateIcon = dynamicIcon ?? def.iconId ?? null;
  const wantsIcon = badgeShowsIcon(def, itemShowIcon, preset);
  const showIcon = wantsIcon && candidateIcon !== null;
  return {
    def,
    label,
    // The viewer's own accent wins; a data-driven accent (amber for a title
    // that needs attention) comes before the badge's default.
    accentColor: itemAccent ?? def.getAccent?.(data) ?? def.defaultAccent,
    iconId: showIcon ? candidateIcon : null,
    parts: def.getParts?.(data, wantsIcon) ?? null,
  };
}

// A wordmark icon (HDR10, ATMOS, ...) spells its text as the mark itself; when
// the label says the same thing, showing both reads "HDR10 HDR10".
function labelRedundantWithIcon(badge: ResolvedBadge): boolean {
  if (!badge.iconId) return false;
  const mark = WORDMARK_TEXT[badge.iconId];
  return mark !== undefined && mark.toLowerCase() === badge.label.trim().toLowerCase();
}

// Text on a score pill: near-black reads on green, amber and red alike.
const SCORE_PILL_TEXT = "#111111";

// Logos are cropped tight to their artwork, so they are drawn at about the
// height of the text's capitals rather than its full line, and follow the
// preset and the size setting.
function BadgeParts({ parts, shadow }: { parts: BadgePart[]; shadow?: OverlayShadow }) {
  // A transparent-background style (Minimal) lifts its text off the poster
  // with a shadow; tinted logos get the same lift.
  const lift = shadow
    ? `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color})`
    : undefined;
  return parts.map((part, i) => {
    if (part.kind === "logo" && part.tint) {
      // The hidden image sizes the slot to the logo's proportions; the mask
      // paints its shape in the badge's text colour.
      return (
        <span key={i} role="img" aria-label={part.alt} className="relative block min-w-0">
          <img
            src={part.src}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="invisible block h-[0.8em] w-auto max-w-full object-contain"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              backgroundColor: "currentColor",
              maskImage: `url("${part.src}")`,
              maskSize: "contain",
              maskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskImage: `url("${part.src}")`,
              WebkitMaskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              filter: lift,
            }}
          />
        </span>
      );
    }
    if (part.kind === "logo") {
      return (
        <img
          key={i}
          src={part.src}
          alt={part.alt}
          draggable={false}
          className="block h-[0.8em] w-auto max-w-full min-w-0 object-contain object-left"
        />
      );
    }
    return (
      <span
        key={i}
        className={cn(
          i === parts.length - 1 ? "truncate" : "shrink-0",
          part.pill && "rounded-[0.3em] px-[0.35em] font-bold [text-shadow:none]",
        )}
        style={
          part.pill
            ? { backgroundColor: part.pill, color: SCORE_PILL_TEXT }
            : part.color
              ? { color: part.color }
              : undefined
        }
      >
        {part.text}
      </span>
    );
  });
}

function BadgeStack({
  badges,
  align,
  preset,
  scalingMode,
}: {
  badges: ResolvedBadge[];
  align: "start" | "center" | "end";
  preset: OverlayPreset;
  scalingMode: ScalingMode;
}) {
  const length = (pixels: number, legacyVariable: string) =>
    overlayLength(pixels, scalingMode, legacyVariable);
  const borderRadiusVariable = preset.borderRadiusVariable ?? "--radius-sm";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        align === "start" && "items-start",
        align === "center" && "items-center",
        align === "end" && "items-end",
        preset.gapClass,
      )}
      style={{ gap: length(preset.stackGap, POSTER_VARS.stackGap) }}
    >
      {badges.map((badge) => {
        const geometry: CSSProperties = {
          columnGap: length(preset.iconGap, POSTER_VARS.iconGap),
          paddingInline: length(preset.paddingInline, POSTER_VARS.paddingInline),
          paddingBlock: length(preset.paddingBlock, POSTER_VARS.paddingBlock),
          // The inline size beats the preset's rem class, so it carries the
          // text size itself: browser default and in-app scale (#1796).
          fontSize: `calc(${length(preset.fontSize, POSTER_VARS.fontSize)} * var(--ui-root-text-ratio, 1))`,
          borderRadius:
            preset.borderRadius === "full"
              ? "9999px"
              : scalingMode === "fixed"
                ? `var(${borderRadiusVariable}, ${preset.borderRadius}px)`
                : `var(${POSTER_VARS.borderRadius}, var(${borderRadiusVariable}, ${preset.borderRadius}px))`,
        };
        if (preset.borderWidth !== undefined) {
          geometry.borderWidth = length(preset.borderWidth, POSTER_VARS.borderWidth);
        }
        if (preset.borderLeftWidth !== undefined && badge.accentColor !== undefined) {
          geometry.borderLeftWidth = length(preset.borderLeftWidth, POSTER_VARS.borderLeftWidth);
        }
        if (preset.textShadow) {
          geometry.textShadow = shadowValue(preset.textShadow, scalingMode, {
            x: POSTER_VARS.textShadowX,
            y: POSTER_VARS.textShadowY,
            blur: POSTER_VARS.textShadowBlur,
          });
        }
        if (preset.boxShadow) {
          geometry.boxShadow = shadowValue(preset.boxShadow, scalingMode, {
            x: POSTER_VARS.boxShadowX,
            y: POSTER_VARS.boxShadowY,
            blur: POSTER_VARS.boxShadowBlur,
            spread: POSTER_VARS.boxShadowSpread,
          });
        }

        return (
          <span
            key={badge.def.id}
            data-overlay-badge
            className={`inline-flex max-w-full items-center gap-1 ${preset.badgeClass}`}
            style={{ ...preset.badgeStyle(badge.accentColor), ...geometry }}
          >
            {badge.parts ? (
              <BadgeParts parts={badge.parts} shadow={preset.textShadow} />
            ) : (
              <>
                {badge.iconId && (
                  <OverlayIcon
                    iconId={badge.iconId}
                    size={preset.iconSize}
                    cssSize={length(preset.iconSize, POSTER_VARS.iconSize)}
                    className="shrink-0"
                  />
                )}
                {!labelRedundantWithIcon(badge) && <span className="truncate">{badge.label}</span>}
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}

// Each card edge renders as ONE three-column grid row holding the left,
// centre and right stacks. The side columns share the width left over by the
// centre (minmax(0,1fr) + truncate), so wide badges shrink instead of
// overlapping, and the centre stays centred however full either side is.
// Every stack stretches to its column so its badges (logos included) shrink
// to fit rather than spilling into the next column.
const EDGE_ROW_CLASS =
  "pointer-events-none absolute inset-x-2 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] gap-2";
//
// Stacking contract with the card quick actions (watched/favorite bottom-left,
// more-menu bottom-right; web/src/components/MediaItemMenu.tsx): this whole
// layer paints at z-10 inside the artwork box, the action wrappers paint at
// z-20 as siblings of the artwork link in the same stacking context, so the
// actions always cover overlay badges. That is by design — badges sit flush in
// all four corners and the actions (hover-revealed on fine pointers,
// persistent on coarse ones) render on top of them. The layer is
// pointer-events-none end to end, so a badge can never swallow a click aimed
// at an action underneath it.
export default function CardOverlays({
  data,
  prefs,
  variant = "poster",
  hasProgressBar = false,
}: CardOverlaysProps) {
  // The language badge resolves names from lazily loaded data and stays empty
  // until it arrives; this re-renders the card when it does. Cards without the
  // badge skip the re-render.
  useLanguageNamesLoaded(prefs.items.original_language?.enabled === true);
  const preset = useMemo(
    () => scaledPreset(getPreset(prefs.preset), prefs.size),
    [prefs.preset, prefs.size],
  );
  const resolve = (pos: OverlayPosition): ResolvedBadge[] =>
    orderedOverlaysForPosition(prefs, pos)
      .map((def) => {
        const config = prefs.items[def.id];
        return resolveBadge(def, data, preset, config?.accentColor, config?.showIcon);
      })
      .filter((badge): badge is ResolvedBadge => badge !== null)
      .slice(0, MAX_BADGES_PER_CORNER);

  const topLeft = resolve("top-left");
  const topCenter = resolve("top-center");
  const topRight = resolve("top-right");
  const middleLeft = resolve("middle-left");
  const middleRight = resolve("middle-right");
  const bottomLeft = resolve("bottom-left");
  const bottomCenter = resolve("bottom-center");
  const bottomRight = resolve("bottom-right");
  const wide = variant === "wide";
  const scalingMode: ScalingMode = wide
    ? "fixed"
    : supportsContainerQueryUnits()
      ? "container"
      : "legacy";
  const layerRef = useRef<HTMLDivElement>(null);
  const edgeInset = overlayLength(EDGE_INSET, scalingMode, POSTER_VARS.edgeInset);
  const edgeGap = overlayLength(EDGE_GAP, scalingMode, POSTER_VARS.edgeGap);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const roundedPoster = scalingMode !== "fixed" && preset.borderRadius !== "full";
    if (!layer || (scalingMode !== "legacy" && !roundedPoster)) {
      return;
    }

    let baseBorderRadius = preset.borderRadius === "full" ? 0 : preset.borderRadius;
    if (roundedPoster) {
      layer.style.removeProperty(POSTER_VARS.borderRadius);
      const badge = layer.querySelector<HTMLElement>("[data-overlay-badge]");
      if (badge) {
        const measured = Number.parseFloat(getComputedStyle(badge).borderTopLeftRadius);
        if (Number.isFinite(measured)) baseBorderRadius = measured;
      }
    }

    if (typeof ResizeObserver === "undefined") return;
    const update = (width: number) => {
      if (scalingMode === "legacy") {
        applyLegacyPosterScale(layer, width, preset, baseBorderRadius);
      } else {
        setLegacyLength(
          layer,
          POSTER_VARS.borderRadius,
          baseBorderRadius,
          width / POSTER_REFERENCE_WIDTH,
        );
      }
    };
    update(layer.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(layer);
    return () => observer.disconnect();
  }, [preset, scalingMode]);

  return (
    <div
      ref={layerRef}
      data-card-overlays={variant}
      className="@container/card-overlays pointer-events-none absolute inset-0 z-10"
    >
      {(topLeft.length > 0 || topCenter.length > 0 || topRight.length > 0) && (
        <div
          data-overlay-edge="top"
          className={cn(EDGE_ROW_CLASS, "top-2 items-start")}
          style={{ top: edgeInset, right: edgeInset, left: edgeInset, gap: edgeGap }}
        >
          <BadgeStack badges={topLeft} align="start" preset={preset} scalingMode={scalingMode} />
          <BadgeStack badges={topCenter} align="center" preset={preset} scalingMode={scalingMode} />
          <BadgeStack badges={topRight} align="end" preset={preset} scalingMode={scalingMode} />
        </div>
      )}
      {(middleLeft.length > 0 || middleRight.length > 0) && (
        /* The middle row sits on the poster's vertical centre, with the same
           three columns as the edges so its sides cannot overlap. */
        <div
          data-overlay-edge="middle"
          className={cn(EDGE_ROW_CLASS, "top-1/2 -translate-y-1/2 items-center")}
          style={{ right: edgeInset, left: edgeInset, gap: edgeGap }}
        >
          <BadgeStack badges={middleLeft} align="start" preset={preset} scalingMode={scalingMode} />
          <div />
          <BadgeStack badges={middleRight} align="end" preset={preset} scalingMode={scalingMode} />
        </div>
      )}
      {(bottomLeft.length > 0 || bottomCenter.length > 0 || bottomRight.length > 0) && (
        /* Bottom badges anchor flush in the corners with the same inset as the
           top row; card actions cover them by design (see above). The single
           exception is a watch-progress bar, which lives in this same edge
           strip and would be cut in half by a flush badge, so hosts that draw
           one lift the row by one edge step. */
        <div
          data-overlay-edge="bottom"
          className={cn(EDGE_ROW_CLASS, "bottom-2 items-end", hasProgressBar && "mb-2")}
          style={{ right: edgeInset, bottom: edgeInset, left: edgeInset, gap: edgeGap }}
        >
          <BadgeStack badges={bottomLeft} align="start" preset={preset} scalingMode={scalingMode} />
          <BadgeStack
            badges={bottomCenter}
            align="center"
            preset={preset}
            scalingMode={scalingMode}
          />
          <BadgeStack badges={bottomRight} align="end" preset={preset} scalingMode={scalingMode} />
        </div>
      )}
    </div>
  );
}
