import sharp from "sharp";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const source = await readFile("desktop/assets/icon.svg", "utf8");
await mkdir("public/icons", { recursive: true });
await writeFile("public/icons/relay.svg", source);
for (const size of [192, 512]) {
  await sharp(Buffer.from(source))
    .resize(size, size)
    .png()
    .toFile(`public/icons/relay-${size}.png`);
}
await sharp(Buffer.from(source.replace(' rx="56"', "")))
  .resize(512, 512)
  .png()
  .toFile("public/icons/relay-maskable-512.png");
await sharp(Buffer.from(source.replace(' rx="56"', "")))
  .resize(180, 180)
  .png()
  .toFile("public/icons/apple-touch-icon.png");
console.log(
  "Generated Relay icons at 192, 512, maskable 512, and Apple 180 pixels.",
);
