import type { Metadata } from "next";
import { NotFoundBody } from "@/components/NotFoundBody";

export const metadata: Metadata = {
  title: "Página no encontrada",
  alternates: { canonical: null },
  robots: { index: false },
};

export default function NotFound() {
  return <NotFoundBody />;
}
