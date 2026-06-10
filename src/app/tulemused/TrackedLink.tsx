"use client";

/**
 * External source link that logs a click to /api/click before opening.
 * Uses keepalive so the request survives navigation.
 */
export default function TrackedLink({
  href,
  sessionId,
  contentItemId,
  topicGroupId,
  className,
  children,
}: {
  href: string;
  sessionId: string | null;
  contentItemId?: string;
  topicGroupId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  function logClick() {
    if (!sessionId) return;
    try {
      fetch("/api/click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, contentItemId, topicGroupId }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Analytics must never break the user flow.
    }
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={logClick} className={className}>
      {children}
    </a>
  );
}
