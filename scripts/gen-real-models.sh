#!/bin/bash
# Генерация фото реальных моделей (v1.5): 5 кроватей + 5 диванов, единый студийный стиль
OUT="/home/z/my-project/public/catalog"
mkdir -p "$OUT"

STYLE="professional furniture product photography for a premium furniture catalog, soft diffused studio lighting, light warm grey seamless studio background, subtle soft shadow, no text, no watermark, no people, no logos, photorealistic, high detail"

gen() {
  local file="$1"; shift
  local prompt="$1"; shift
  if [ -s "$OUT/$file.jpg" ]; then echo "skip $file"; return; fi
  z-ai image -p "$prompt, $STYLE" -o "$OUT/$file.jpg" -s 1344x768 >/dev/null 2>&1 \
    && echo "OK  $file" || echo "FAIL $file"
}

# Кровати (5 моделей)
gen bed-alfa-1 "Elegant upholstered double bed with tall vertical channel-tufted headboard in deep emerald green velvet fabric, low wide body, thin metal legs, front view"
gen bed-mira-1 "Modern upholstered double bed with rounded soft headboard in warm grey velvet fabric, neat proportions, front three-quarter view"
gen bed-simple-1 "Minimalist upholstered double bed with straight low headboard in light beige fabric, clean scandinavian lines, front view"
gen bed-extra-1 "Luxurious double bed with extra tall quilted headboard in dark graphite grey velvet fabric, imposing silhouette, front view"
gen bed-pola-1 "Contemporary upholstered bed with softly curved headboard in dusty blue fabric, slim base, front three-quarter view"

# Диваны (5 моделей)
gen sofa-magni-1 "Compact straight two-seater sofa in deep teal velvet fabric, straight lines, low wooden legs, front three-quarter view"
gen sofa-magni-2 "Corner sofa in deep teal velvet fabric with anatomical mattress seat, chaise section, three-quarter view"
gen sofa-trenton-1 "Straight three-seater sofa in warm beige velour fabric with plush cushions and built-in topper, front view"
gen sofa-karina-1 "Classic sofa in soft grey fabric with traditional rectangular armrests, straight silhouette, front three-quarter view"
gen sofa-loko-1 "Large corner sofa in dark graphite grey fabric, generous sleeping area, modern urban style, three-quarter view"
gen sofa-nika-1 "Elegant straight sofa in muted sage green fabric with soft rounded armrests and decorative pillows, front view"

echo "DONE"
