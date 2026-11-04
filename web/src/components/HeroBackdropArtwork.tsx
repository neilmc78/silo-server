import { decodeThumbhash } from "@/lib/thumbhash";
import { imageIdentity, useImageLoaded } from "@/hooks/useImageLoaded";
import { cn } from "@/lib/utils";

interface HeroBackdropArtworkProps {
  backdropUrl?: string;
  backdropThumbhash?: string;
  className?: string;
}

/**
 * A hero's backdrop: the thumbhash placeholder first, then the image fading
 * in over it. The caller positions it and draws its own scrim on top.
 */
export function HeroBackdropArtwork({
  backdropUrl,
  backdropThumbhash,
  className,
}: HeroBackdropArtworkProps) {
  const { loaded, onLoad, onError } = useImageLoaded(backdropUrl);
  const placeholder = backdropThumbhash ? decodeThumbhash(backdropThumbhash) : "";
  if (!backdropUrl && !placeholder) return null;
  return (
    <div
      className={cn("hero-backdrop-artwork", className)}
      style={
        placeholder
          ? {
              backgroundImage: `url(${placeholder})`,
              backgroundSize: "cover",
              backgroundPosition: "center 20%",
            }
          : undefined
      }
    >
      {backdropUrl && (
        <img
          key={imageIdentity(backdropUrl)}
          src={backdropUrl}
          alt=""
          decoding="async"
          className={`h-full w-full object-cover object-[center_20%] transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}
