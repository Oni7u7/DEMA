import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dividir una cuenta",
  description: "Abre una cuenta, enseña el QR en la mesa y que cada quien pague su parte con CoDi.",
  alternates: { canonical: "/nuevo" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
