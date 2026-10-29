import { cp, access } from "node:fs/promises";
await access(".next/standalone/server.js");
await cp("public", ".next/standalone/public", { recursive: true, force: true });
await cp(".next/static", ".next/standalone/.next/static", {
  recursive: true,
  force: true,
});
console.log(
  "Prepared standalone server with public PWA assets and Next.js static files.",
);
