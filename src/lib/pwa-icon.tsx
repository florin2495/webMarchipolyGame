import { ImageResponse } from "next/og";

// Opaque app icon: a white top hat over a little house on an indigo background.
// `inset` shrinks the artwork (maskable icons keep it inside the central 80%).
export function pwaIcon(px: number, inset = 1): ImageResponse {
  const s = px * inset * 0.62;
  return new ImageResponse(
    (
      <div
        style={{
          width: px,
          height: px,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4338ca",
        }}
      >
        <svg width={s} height={s} viewBox="0 0 100 100">
          <rect x="30" y="6" width="40" height="38" rx="4" fill="#fafaf9" />
          <rect x="30" y="34" width="40" height="7" fill="#f59e0b" />
          <rect x="14" y="42" width="72" height="8" rx="4" fill="#fafaf9" />
          <path d="M50 54 L84 78 L76 78 L76 98 L24 98 L24 78 L16 78 Z" fill="#fafaf9" />
          <rect x="44" y="82" width="12" height="16" fill="#4338ca" />
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
