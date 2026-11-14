import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cuadra",
    short_name: "Cuadra",
    description: "Divide la cuenta en la mesa y que cada quien pague su parte con CoDi.",
    lang: "es-MX",
    start_url: "/",
    display: "standalone",
    background_color: "#0e1319",
    theme_color: "#0e1319",
    icons: [
      { src: "/icon.png", sizes: "any", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
