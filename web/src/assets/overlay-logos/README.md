# Poster badge logos

Logos drawn on poster badges, bundled at build time by `src/lib/overlays/logos.ts`. A badge shows a logo when its **icon** setting is on and the file exists here; without the file it keeps its text. Files can be `.svg`, `.png` or `.webp`. Logos are drawn about as tall as the badge's text, so a wide, tightly cropped image with a transparent background works best.

## `ratings/`

| File | Badge |
|---|---|
| `imdb` | IMDb rating |
| `tmdb` | TMDB rating |
| `rt_critic` | Rotten Tomatoes critics |
| `rt_audience` | Rotten Tomatoes audience |

## `formats/`

| File | Shown for |
|---|---|
| `dolby-vision` | Dolby Vision (HDR badge, and the combined resolution + HDR badge) |
| `hdr10plus` | HDR10+ |
| `hlg` | HLG |
| `hdr` | HDR10 and other HDR |
| `dolby-atmos` | Dolby Atmos (audio badge) |
| `dolby-truehd` | Dolby TrueHD |
| `dolby-digital-plus` | Dolby Digital Plus (E-AC-3) |
| `dolby-digital` | Dolby Digital (AC-3) |
| `dts-hd` | DTS-HD and DTS:X |
| `dts` | DTS |
| `aac` | AAC |
| `flac` | FLAC |
| `imax` | Editions named IMAX (edition badge) |

A value made of two formats, such as Dolby Vision with HDR10+, needs both files; with either missing the badge keeps its text.

## Sources

- `ratings/`: from the Scryer project's overlay assets.
- `formats/`: from [jmxd/Kometa](https://github.com/jmxd/Kometa) (`overlays/images`), cropped to the artwork. That repository states no licence. The marks belong to Dolby, DTS, IMAX and the HDR10+ licensing body.

