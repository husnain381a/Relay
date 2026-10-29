import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Relay",
    short_name: "Relay",
    description:
      "A shared workspace for team conversations, project channels, threads, and files. Available on the web and as an installable app.",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    background_color: "#faf9f6",
    theme_color: "#302845",
    categories: ["productivity", "business", "social"],
    prefer_related_applications: false,
    icons: [
      {
        src: "/icons/relay-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/relay-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/relay-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
