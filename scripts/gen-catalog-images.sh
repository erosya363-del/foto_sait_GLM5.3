#!/bin/bash
# Генерация фото для фотокаталога Skovo Portal (единый студийный стиль)
OUT="/home/z/my-project/public/catalog"
mkdir -p "$OUT"

STYLE="professional furniture product photography for a premium furniture catalog, soft diffused studio lighting, light warm grey seamless studio background, subtle soft shadow, no text, no watermark, no people, photorealistic, high detail, 8k"

gen() {
  local file="$1"; shift
  local prompt="$1"; shift
  if [ -s "$OUT/$file.jpg" ]; then echo "skip $file"; return; fi
  z-ai image -p "$prompt, $STYLE" -o "$OUT/$file.jpg" -s 1344x768 >/dev/null 2>&1 \
    && echo "OK  $file" || echo "FAIL $file"
}

# Пачка 1 — кровати
gen bed-elisa-1 "Elegant upholstered double bed with tall soft quilted headboard in deep teal velvet fabric, wide low body, slim wooden legs, front view"
gen bed-elisa-2 "Elegant upholstered bed in deep teal velvet, three-quarter side angle view showing slim wooden legs and upholstered side rails"
gen bed-elisa-3 "Elegant teal velvet upholstered bed standing in bright modern furniture showroom interior, warm daylight from large windows"
gen bed-dom-1 "Classic double bed with very tall upholstered headboard in beige sand fabric with vertical channel stitching, brass legs, front view"
gen bed-dom-2 "Close-up detail of classic bed frame corner with beige sand fabric upholstery and brass leg, luxury furniture detail shot"
gen bed-bruno-1 "Minimalist double bed with lifting mechanism base upholstered in grey woven fabric, clean lines, front view"
wait

# Пачка 2 — диваны
gen sofa-ralf-1 "Large modular corner sofa in deep teal velvet fabric, chaise longue section, plush cushions, low profile, three-quarter view"
gen sofa-ralf-2 "Modular corner sofa in deep teal velvet unfolded into a spacious sleeping position, pulled out seat section"
gen sofa-ralf-3 "Single modular sofa seat section element in deep teal velvet fabric, individual module unit, side view"
gen sofa-tango-1 "Compact straight two-seater sofa in soft grey velour fabric with rounded armrests, front three-quarter view"
gen sofa-tango-2 "Close-up of grey velour sofa seat cushions with matching throw pillows, cozy fabric detail"
wait

# Пачка 3 — матрасы и кресла
gen mattress-1 "White memory foam mattress lying on wooden slatted bed base, white bedding corner turned down, bright studio"
gen mattress-2 "Close-up of white quilted mattress cover with diamond stitching pattern, fabric texture detail"
gen mattress-3 "Cutaway cross-section of pocket spring mattress showing individual springs and foam layers, technical product shot"
gen chair-1 "Compact cozy armchair in deep teal velvet with soft rounded armrests and wooden legs, three-quarter view"
gen chair-2 "Small armchair bed in light grey woven fabric with visible stitching, simple design, three-quarter view"
wait

# Пачка 4 — текстиль и прочее
gen pillow-1 "Two white orthopedic latex bed pillows stacked, perforated latex visible on one, clean studio shot"
gen duvet-1 "Neatly folded white lightweight duvet blanket with bamboo filling, soft fluffy texture, studio shot"
gen kpb-1 "Luxury bedding set with satin pillowcases and flat sheet neatly folded in a stack, sage green color, studio shot"
gen kpb-2 "Premium bedding set packaging box with folded satin bed sheets set, sage green and cream tones"
gen cover-1 "White waterproof mattress protector cover fitted on mattress corner showing elastic skirt, clean product shot"
gen ergo-1 "Modern adjustable electric bed base with metal frame, head and foot sections raised at an angle, wireless remote control on top"
gen ergo-2 "Sleek wireless remote control for adjustable bed base with memory buttons lying on white bedding, close-up"
wait

# Пачка 5 — текстуры тканей
gen texture-velvet "Extreme close-up macro of deep teal velvet upholstery fabric with soft folds and pile sheen, full frame texture"
gen texture-velvet-03 "Extreme close-up macro of dark graphite teal velvet upholstery fabric texture with soft drape folds, full frame"
gen texture-casanova "Extreme close-up macro of sand beige woven chenille upholstery fabric texture, full frame"
gen texture-rogozhka "Extreme close-up macro of grey linen weave upholstery fabric texture, natural basket weave pattern, full frame"
wait

echo "---- Итог ----"
for f in bed-elisa-1 bed-elisa-2 bed-elisa-3 bed-dom-1 bed-dom-2 bed-bruno-1 sofa-ralf-1 sofa-ralf-2 sofa-ralf-3 sofa-tango-1 sofa-tango-2 mattress-1 mattress-2 mattress-3 chair-1 chair-2 pillow-1 duvet-1 kpb-1 kpb-2 cover-1 ergo-1 ergo-2 texture-velvet texture-velvet-03 texture-casanova texture-rogozhka; do
  [ -s "$OUT/$f.jpg" ] && echo "have $f" || echo "MISSING $f"
done
