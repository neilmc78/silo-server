// Logo artwork for poster badges, bundled from web/src/assets/overlay-logos.
// A logo is keyed by its path under that folder without the extension, such
// as "ratings/imdb" or "formats/hdr10plus". A key with no file falls back to
// the badge's text.
const files = import.meta.glob("../../assets/overlay-logos/**/*.{svg,png,webp}", {
  eager: true,
  query: "?no-inline",
  import: "default",
}) as Record<string, string>;

const LOGOS = new Map<string, string>(
  Object.entries(files).map(([path, url]) => [
    path.replace(/^.*\/overlay-logos\//, "").replace(/\.(svg|png|webp)$/, ""),
    url,
  ]),
);

/** The bundled URL of a logo, or undefined when no file provides it. */
export function overlayLogo(key: string): string | undefined {
  return LOGOS.get(key);
}

// A rating's colour by how good it is, as a fraction of the scale's top.
export function scoreColor(fraction: number): string {
  if (fraction >= 0.75) return "#21c46b";
  if (fraction >= 0.6) return "#f5c518";
  return "#ef4b4b";
}
