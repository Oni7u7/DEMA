import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Una cuenta concreta es privada: solo la ve quien tiene el QR.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/g/"] },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
