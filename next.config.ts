import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: lets a second "person" open the table from 127.0.0.1 while the
  // first uses localhost — two origins, two separate seats on one machine.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
