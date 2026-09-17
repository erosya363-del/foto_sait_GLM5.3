/* Генерирует 1024×1024 AppIcon из public/logo-askona.png (sharp уже в проекте). */
import sharp from "sharp";
import { readFileSync, statSync } from "fs";

const src = "/home/z/my-project/public/logo-askona.png";
const dst = "/home/z/my-project/ios/AskonaApp/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon1024.png";

const meta = await sharp(src).metadata();
console.log("source:", meta.width, "x", meta.height, statSync(src).size, "bytes");

// Квадратный холст 1024×1024: логотип вписан с полями 96px,
// фон — фирменный тёмный изумруд сайта (manifest theme_color #10161a)
await sharp(src)
  .resize(1024, 1024, {
    fit: "contain",
    background: { r: 0x10, g: 0x16, b: 0x1a, alpha: 1 },
  })
  .png()
  .toFile(dst);

const out = await sharp(dst).metadata();
console.log("icon:", out.width, "x", out.height, "->", dst);
