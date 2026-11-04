import { useLayoutEffect, useRef, useState } from "react";

/**
 * A collection's description under its title: clamped to three lines, with
 * a toggle when it runs longer.
 */
export function CollectionDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    // The web font and the page width both change where the text wraps.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [text, expanded]);

  return (
    <div className="max-w-[60ch] space-y-1">
      <p
        ref={ref}
        className={`page-subtitle text-sm whitespace-pre-line sm:text-base ${expanded ? "" : "line-clamp-3"}`}
      >
        {text}
      </p>
      {overflows || expanded ? (
        <button
          type="button"
          className="text-foreground text-sm font-medium underline-offset-4 hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}
