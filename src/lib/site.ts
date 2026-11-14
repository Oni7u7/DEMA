/** The public address of the app — set NEXT_PUBLIC_APP_URL to the production domain. */
export const SITE = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
