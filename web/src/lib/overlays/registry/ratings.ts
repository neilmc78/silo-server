import { formatOutOfTen, formatPercent } from "@/components/ratings/ratings";

import { overlayLogo } from "../logos";
import type { BadgePart, OverlayData, OverlayDef } from "../types";

// A rating badge carries its source's mark ("IMDb 8.5", "RT 93%") so a score
// is never shown without its source. With the badge's icon setting on, the
// source's logo replaces the text mark when one is bundled
// (web/src/assets/overlay-logos/ratings). The score itself is coloured by how
// good it is: dark text on a green, amber or red pill.
function ratingLabel(mark: string, value: number | null | undefined, max: 10 | 100): string | null {
  if (value == null) return null;
  return `${mark} ${max === 100 ? formatPercent(value) : formatOutOfTen(value)}`;
}

// Score colours: green from 7/10 (70%), amber from 5.5/10 (55%), red below.
export const SCORE_GOOD = "#5cb85c";
export const SCORE_FAIR = "#f5c518";
export const SCORE_POOR = "#e53935";

export function scoreColor(value: number, max: 10 | 100): string {
  const outOfTen = max === 100 ? value / 10 : value;
  if (outOfTen >= 7) return SCORE_GOOD;
  if (outOfTen >= 5.5) return SCORE_FAIR;
  return SCORE_POOR;
}

function ratingParts(
  source: string,
  mark: string,
  value: number | null | undefined,
  max: 10 | 100,
  useLogos: boolean,
): BadgePart[] | null {
  if (value == null) return null;
  const score: BadgePart = {
    kind: "text",
    text: max === 100 ? formatPercent(value) : formatOutOfTen(value),
    pill: scoreColor(value, max),
  };
  const logo = useLogos ? overlayLogo(`ratings/${source}`) : undefined;
  return [logo ? { kind: "logo", src: logo, alt: mark } : { kind: "text", text: mark }, score];
}

function rating(
  source: string,
  mark: string,
  pick: (d: OverlayData) => number | null | undefined,
  max: 10 | 100,
): Pick<OverlayDef, "getValue" | "getParts" | "iconCapable"> {
  return {
    iconCapable: true,
    getValue: (d) => ratingLabel(mark, pick(d), max),
    getParts: (d, useLogos) => ratingParts(source, mark, pick(d), max, useLogos),
  };
}

export const RATINGS_OVERLAYS: readonly OverlayDef[] = [
  {
    id: "rating_imdb",
    category: "ratings",
    label: "IMDb Rating",
    description: "IMDb score out of 10",
    defaultPosition: "top-right",
    defaultEnabled: false,
    defaultAccent: "#f5c518",
    ...rating("imdb", "IMDb", (d) => d.rating_imdb, 10),
  },
  {
    id: "rating_tmdb",
    category: "ratings",
    label: "TMDB Rating",
    description: "TMDB score out of 10",
    defaultPosition: "top-right",
    defaultEnabled: false,
    defaultAccent: "#01b4e4",
    ...rating("tmdb", "TMDB", (d) => d.rating_tmdb, 10),
  },
  {
    id: "rating_rt",
    category: "ratings",
    label: "RT Critics",
    description: "Rotten Tomatoes critic score, when an administrator shows it",
    defaultPosition: "top-right",
    defaultEnabled: false,
    defaultAccent: "#fa320a",
    ratingSource: "rt_critic",
    ...rating("rt_critic", "RT", (d) => d.rating_rt_critic, 100),
  },
  {
    id: "rating_rt_audience",
    category: "ratings",
    label: "RT Audience",
    description: "Rotten Tomatoes audience score, when an administrator shows it",
    defaultPosition: "top-right",
    defaultEnabled: false,
    defaultAccent: "#fa6400",
    ratingSource: "rt_audience",
    ...rating("rt_audience", "RT Audience", (d) => d.rating_rt_audience, 100),
  },
  {
    id: "content_rating",
    category: "ratings",
    label: "Age Rating",
    description: "Content rating (PG-13, TV-MA, R, etc.)",
    defaultPosition: "bottom-right",
    defaultEnabled: false,
    iconId: "shield",
    iconCapable: true,
    getValue: (d) => d.content_rating ?? null,
  },
  {
    id: "advisory_age",
    category: "ratings",
    label: "Advisory Age",
    description: "Recommended minimum viewer age, such as Common Sense Media's 13+",
    defaultPosition: "bottom-right",
    defaultEnabled: false,
    iconId: "users",
    iconCapable: true,
    introducedInManifest: 13,
    getValue: (d) => (d.advisory_age != null && d.advisory_age > 0 ? `${d.advisory_age}+` : null),
  },
];
