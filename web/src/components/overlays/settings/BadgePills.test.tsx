import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildDefaultPrefs, type CardOverlayPrefs } from "@/lib/overlays";

import { BadgePills } from "./BadgePills";

function renderPills(prefs: CardOverlayPrefs) {
  const onChange = vi.fn<(next: CardOverlayPrefs) => void>();
  render(
    <BadgePills
      prefs={prefs}
      onChange={onChange}
      isOffered={() => true}
      shortcutsOn={false}
      images={[]}
      supportsStyles
      kind="series"
      onKindChange={() => {}}
    />,
  );
  return onChange;
}

const separateSwitch = () => screen.getAllByRole("switch")[0];

describe("separate series layout switch", () => {
  it("keeps the series layout when switched off", () => {
    const base = buildDefaultPrefs();
    const series = {
      order: [],
      items: { ...base.items, year: { enabled: true, position: "top-left" as const } },
    };
    const onChange = renderPills({ ...base, series });
    fireEvent.click(separateSwitch());
    const next = onChange.mock.calls[0][0];
    expect(next.series?.enabled).toBe(false);
    expect(next.series?.items.year.enabled).toBe(true);
  });

  it("restores the kept layout when switched back on", () => {
    const base = buildDefaultPrefs();
    const series = {
      enabled: false as const,
      order: [],
      items: { ...base.items, year: { enabled: true, position: "top-left" as const } },
    };
    const onChange = renderPills({ ...base, series });
    fireEvent.click(separateSwitch());
    const next = onChange.mock.calls[0][0];
    expect(next.series?.enabled).toBeUndefined();
    expect(next.series?.items.year.enabled).toBe(true);
  });
});
