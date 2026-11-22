import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marchipoly",
    short_name: "Marchipoly",
    description: "Joc de proprietăți între prieteni, pe telefon.",
    id: "/marchipoly/",
    start_url: "/marchipoly/",
    // "/" on purpose: leaving the game for the hub stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/marchipoly/pwa-icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/marchipoly/pwa-icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/marchipoly/pwa-icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
