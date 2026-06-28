"use client";

import { Children, useState, type ReactNode } from "react";

/**
 * Incremental "Näita rohkem" pagination for a result section.
 *
 * Renders its children (already server-rendered result cards) in batches:
 * `batchSize` are shown initially, and each click reveals the next batch,
 * then the next, until everything is visible. The button disappears when no more
 * items remain.
 *
 * Reset on filter/search change is handled by the caller giving this component a
 * `key` derived from the active query — a new query remounts it, so the visible
 * count starts fresh instead of carrying over from the previous result set.
 */
export default function LoadMore({
  children,
  batchSize = 3,
  initialVisibleCount,
  label = "Näita rohkem",
}: {
  children: ReactNode;
  batchSize?: number;
  initialVisibleCount?: number;
  label?: string;
}) {
  const all = Children.toArray(children);
  const initialVisible = initialVisibleCount ?? batchSize;
  const [visible, setVisible] = useState(() => Math.min(initialVisible, all.length));

  const shown = all.slice(0, visible);
  const remaining = all.length - visible;
  return (
    <>
      {shown}
      {remaining > 0 && (
        <button
          type="button"
          className="btn btn-secondary load-more-btn"
          onClick={() => setVisible((v) => Math.min(v + batchSize, all.length))}
        >
          {label}
        </button>
      )}
    </>
  );
}
