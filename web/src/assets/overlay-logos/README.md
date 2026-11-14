# Poster badge logos

Logos drawn on poster badges, bundled at build time by `src/lib/overlays/logos.ts`. A badge draws them only after the viewer turns on that badge's **Show icon** setting; a preset that prefers icons does not turn them on. A format with no file here keeps its text inside the badge. Files can be `.svg`, `.png` or `.webp`, and are drawn about as tall as the badge's icons, so a wide, tightly cropped image with a transparent background works best.

## `ratings/`

Each rating badge draws the source logo and the score on a pill coloured by how good it is (green, amber, red).

| File          | Badge                    |
| ------------- | ------------------------ |
| `imdb`        | IMDb rating              |
| `tmdb`        | TMDB rating              |
| `rt_critic`   | Rotten Tomatoes critics  |
| `rt_audience` | Rotten Tomatoes audience |

## `formats/`

The mapping from badge values to files is `FORMAT_LOGOS` in `src/lib/overlays/registry/tech.ts`.

| File                 | Shown for                                                  |
| -------------------- | ---------------------------------------------------------- |
| `dolby-vision`       | Dolby Vision (alone, also for DV with an HDR10 base layer) |
| `hdr10plus`          | HDR10+                                                     |
| `hdr`                | HDR10 and other HDR                                        |
| `dolby-atmos`        | Atmos                                                      |
| `dolby-truehd`       | TrueHD                                                     |
| `dolby-digital-plus` | EAC3 (Dolby Digital Plus)                                  |
| `dts-hd`             | DTS-HD                                                     |
| `imax`               | Editions named IMAX (edition badge)                        |

## Sources

- `ratings/`: from the Scryer project's overlay assets.
- `formats/`: from [jmxd/Kometa](https://github.com/jmxd/Kometa) (`overlays/images`), cropped to the artwork. That repository states no licence. The marks belong to Dolby, DTS, IMAX and the HDR10+ licensing body.
