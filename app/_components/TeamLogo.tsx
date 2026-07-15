"use client";

import { useState } from "react";

/** Logo týmu z API-Football s graceful fallbackem (kolečko), pokud se nenačte. */
export function TeamLogo({
  src,
  alt,
  size = 28,
}: {
  src?: string;
  alt: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-border text-[10px] font-bold text-muted"
        style={{ width: size, height: size }}
        aria-hidden
      >
        {alt ? alt.slice(0, 2).toUpperCase() : "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
}
