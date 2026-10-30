// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FileVersion, ItemDetail, PlaybackVariant } from "@/api/types";
import CardPlayOverlay from "./CardPlayOverlay";

const mocks = vi.hoisted(() => ({ startPlayback: vi.fn(), fetchCatalogItemDetail: vi.fn() }));

vi.mock("@/playback/watchPlaybackContext", () => ({
  useWatchPlaybackController: () => ({ startPlayback: mocks.startPlayback }),
}));

vi.mock("@/hooks/queries/catalogRead", () => ({
  fetchCatalogItemDetail: mocks.fetchCatalogItemDetail,
}));

function version(fileId: number, editionKey?: string): FileVersion {
  return {
    file_id: fileId,
    resolution: "1080p",
    codec_video: "hevc",
    edition_key: editionKey,
  } as FileVersion;
}

function variant(id: string, file: FileVersion, editionRaw?: string): PlaybackVariant {
  return {
    variant_id: id,
    edition_key: file.edition_key,
    edition_raw: editionRaw,
    part_count: 1,
    parts: [{ part_index: 0, default_file_id: file.file_id, versions: [file] }],
  } as PlaybackVariant;
}

function movieDetail(variants: PlaybackVariant[]): ItemDetail {
  return {
    playback_variants: variants,
    versions: variants.flatMap((v) => v.parts[0]!.versions),
  } as ItemDetail;
}

describe("CardPlayOverlay", () => {
  beforeEach(() => {
    mocks.startPlayback.mockReset();
    mocks.fetchCatalogItemDetail.mockReset();
  });

  it("starts resumable playback in place and preserves the return location", () => {
    render(
      <MemoryRouter initialEntries={["/home?profile=primary"]}>
        <CardPlayOverlay contentId="episode 1" title="Running Show" libraryId={12} />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Play Running Show" });
    expect(link).toHaveAttribute("href", "/watch/episode%201?libraryId=12");
    // Hover/focus reveal lives in the shared media-card-play-trigger rule
    // (app.css) rather than inline pointer-fine variants, so every card
    // surface reveals its play control the same way.
    expect(link.className).toContain("media-card-play-trigger");

    fireEvent.click(link);
    expect(mocks.startPlayback).toHaveBeenCalledWith(
      {
        contentId: "episode 1",
        fileId: undefined,
        libraryId: 12,
        restart: false,
        returnHref: "/home?profile=primary",
      },
      "viewer",
    );
  });

  it("leaves modified clicks to the watch link", () => {
    render(
      <MemoryRouter>
        <CardPlayOverlay contentId="episode-1" title="Running Show" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Play Running Show" }), { ctrlKey: true });
    expect(mocks.startPlayback).not.toHaveBeenCalled();
  });

  it("supports compact posters and notifies the containing surface before playback", async () => {
    mocks.fetchCatalogItemDetail.mockResolvedValue(movieDetail([variant("v1", version(1))]));
    const onPlaybackStart = vi.fn();
    const parentClick = vi.fn();
    render(
      <MemoryRouter>
        <div onClick={parentClick}>
          <CardPlayOverlay
            contentId="movie-1"
            title="Compact Movie"
            type="movie"
            size="compact"
            onPlaybackStart={onPlaybackStart}
          />
        </div>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Play Compact Movie" });
    expect(link).toHaveAttribute("href", "/watch/movie-1");
    expect(link.className).toContain("h-6 w-6");
    fireEvent.click(link);

    await waitFor(() => expect(onPlaybackStart).toHaveBeenCalledOnce());
    expect(parentClick).not.toHaveBeenCalled();
    expect(mocks.startPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: "movie-1", restart: false }),
      "viewer",
    );
  });

  it("asks which edition to play when a movie has several, and plays the one picked", async () => {
    mocks.fetchCatalogItemDetail.mockResolvedValue(
      movieDetail([
        variant("theatrical", version(1, "theatrical"), "Theatrical"),
        variant("dc", version(2, "directors_cut"), "Directors Cut"),
      ]),
    );
    render(
      <MemoryRouter>
        <CardPlayOverlay contentId="alien" title="Alien" type="movie" libraryId={3} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Play Alien" }));
    fireEvent.click(await screen.findByRole("button", { name: /Directors Cut/ }));

    expect(mocks.fetchCatalogItemDetail).toHaveBeenCalledWith("alien", 3);
    expect(mocks.startPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: "alien", fileId: 2, libraryId: 3 }),
      "viewer",
    );
  });

  it("resumes without asking when edition picking is off", () => {
    render(
      <MemoryRouter>
        <CardPlayOverlay contentId="alien" title="Alien" type="movie" pickEdition={false} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Play Alien" }));
    expect(mocks.fetchCatalogItemDetail).not.toHaveBeenCalled();
    expect(mocks.startPlayback).toHaveBeenCalledOnce();
  });
});
