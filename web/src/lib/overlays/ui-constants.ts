import {
  OVERLAY_CATEGORIES,
  type OverlayCategory,
  type OverlayPosition,
  type OverlaySize,
} from "./types";

// Shared UI metadata so user-facing and admin settings stay in sync. These
// labels are presentational only; the canonical enums live in types.ts.

export const POSITION_OPTIONS: { value: OverlayPosition; label: string }[] = [
  { value: "top-left", label: "Top Left" },
  { value: "top-center", label: "Top Centre" },
  { value: "top-right", label: "Top Right" },
  { value: "middle-left", label: "Middle Left" },
  { value: "middle-right", label: "Middle Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-center", label: "Bottom Centre" },
  { value: "bottom-right", label: "Bottom Right" },
];

export const SIZE_OPTIONS: { value: OverlaySize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra large" },
];

interface CategoryMeta {
  category: OverlayCategory;
  title: string;
  description: string;
}

export const CATEGORY_META: Record<OverlayCategory, CategoryMeta> = {
  tech: {
    category: "tech",
    title: "Media Info",
    description: "Technical details from your media files.",
  },
  ratings: {
    category: "ratings",
    title: "Ratings & Certifications",
    description: "Scores from external sources and content ratings.",
  },
  metadata: {
    category: "metadata",
    title: "Content Metadata",
    description: "Information about the content itself.",
  },
  ribbons: {
    category: "ribbons",
    title: "Status & Awards",
    description:
      "Series lifecycle, request status and award badges. Some require upcoming data sources.",
  },
};

// Iteration-friendly ordered list of category metadata.
export const CATEGORY_GROUPS: CategoryMeta[] = OVERLAY_CATEGORIES.map((c) => CATEGORY_META[c]);
