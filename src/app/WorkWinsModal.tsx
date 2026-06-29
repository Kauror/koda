"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

export type HomepageWorkWin = {
  id: string;
  detailId: string;
  title: string;
  summary: string | null;
  displayDate: string | null;
};

const BATCH_SIZE = 7;

export default function WorkWinsModal({ items }: { items: HomepageWorkWin[] }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(BATCH_SIZE);
  const titleId = useId();
  const visibleItems = items.slice(0, visible);
  const remaining = items.length - visibleItems.length;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function openModal() {
    setVisible(BATCH_SIZE);
    setOpen(true);
  }

  return (
    <div className="workwins-browser">
      <button type="button" className="btn btn-secondary" onClick={openModal}>
        Vaata kõiki töövõite
      </button>
      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="modal-panel workwins-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id={titleId}>Kõik töövõidud</h2>
                <p>{items.length} töövõitu, uuemast vanemani</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Sulge">
                ×
              </button>
            </div>
            <ol className="workwins-list">
              {visibleItems.map((item) => (
                <li key={item.id} className="workwins-list-item">
                  <div className="workwins-list-main">
                    {item.displayDate && <span className="badge-date">{item.displayDate}</span>}
                    <h3>
                      <Link href={`/sisu/${encodeURIComponent(item.detailId)}`}>{item.title}</Link>
                    </h3>
                    {item.summary && <p>{item.summary}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {remaining > 0 && (
              <button
                type="button"
                className="btn btn-secondary load-more-btn"
                onClick={() => setVisible((value) => Math.min(value + BATCH_SIZE, items.length))}
              >
                Näita veel 7
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
