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

// The "separate layout for series" switch is the first switch the pills draw.
function separateSwitch(): HTMLElement {
  const [first] = screen.getAllByRole("switch");
  if (!first) throw new Error("no switch rendered");
  return first;
}

function lastChange(onChange: ReturnType<typeof renderPills>): CardOverlayPrefs {
  const next = onChange.mock.lastCall?.[0];
  if (!next) throw new Error("onChange was not called");
  return next;
}

describe("separate series layout switch", () => {
  it("keeps the series layout when switched off", () => {
    const base = buildDefaultPrefs();
    const series = {
      order: [],
      items: { ...base.items, year: { enabled: true, position: "top-left" as const } },
    };
    const onChange = renderPills({ ...base, series });
    fireEvent.click(separateSwitch());
    const next = lastChange(onChange);
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
    const next = lastChange(onChange);
    expect(next.series?.enabled).toBeUndefined();
    expect(next.series?.items.year.enabled).toBe(true);
  });
});
