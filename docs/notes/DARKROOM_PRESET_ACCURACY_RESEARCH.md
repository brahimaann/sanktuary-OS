# Research & Accuracy Specification: Darkroom Color Grading & Vintage Camera Emulation

> **Prompt for Gemini / AI Research Agent**
> 
> *Copy and paste this entire document into Gemini to research, calibrate, and derive photometrically accurate color science, physical sensor emulations, and GLSL shader code for Sanktuary OS Darkroom.*

---

## Objective

We are developing **Darkroom**, a retro-modern parametric image grading and camera emulation suite inside **Sanktuary OS** (a web-based creative operating system built in React, TypeScript, and WebGL). 

Our current implementation uses fast GLSL fragment shader approximations for 18 presets (spanning underground "Swag" aesthetics, cinematic "Goth" chemical processes, and authentic "Vintage Cameras"), plus physical sensor modules (CCD bloom/smear, JPEG DCT block degradation, glitch, and sensor grain).

While the interactive pipeline is functional, **the presets currently rely on basic heuristic approximations** (e.g., simple `overlay()`, `smoothstep()`, or arbitrary color multipliers). 

**Your task is to conduct deep colorimetric, photographic, and computer graphics research to replace these approximations with authentic, mathematically verified equations, spectral response curves, and production-grade GLSL code.**

---

## 1. Technical Architecture & Constraints

- **Execution Environment**: WebGL 1.0 / 2.0 Fragment Shader running in real time (60+ FPS) on desktop and mobile browsers.
- **Precision**: `precision highp float;`
- **Color Pipeline**:
  - Input texture: sRGB 8-bit encoded image (`sampler2D img`, coordinates `varying vec2 uv;`).
  - Screen output: `gl_FragColor` clamped to `[0.0, 1.0]`.
  - Shader uniforms currently supplied:
    ```glsl
    uniform sampler2D img;
    uniform vec2 res;
    uniform int preset;
    uniform float amount, contrast, warmth, fade, vignette, grain;
    uniform float bloomAmount, bloomTint, lensReflection, ccdNoise;
    uniform int blurMode;
    uniform float blurRadius;
    uniform int glitchMode;
    uniform float glitchAmount;
    uniform float jpegRes, jpegQual, uNoise, uSharpen, uPixel2x, uTime;
    ```
- **Performance Requirement**:
  - Prefer **analytical closed-form equations** (cubic splines, polynomial transfer functions, rational functions, matrix transformations) that can run per-pixel without requiring multiple extra texture lookups.
  - Where 1D or 3D LUTs (Look-Up Tables) are genuinely necessary for photochemical fidelity, specify the exact $33\times 33\times 33$ or $64\times 64\times 64$ LUT data format or polynomial approximation.

---

## 2. Current Shader Implementation Reference

Below is the current GLSL shader code in `src/apps/Darkroom.tsx`:

```glsl
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 overlay(vec3 a, vec3 b) { return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a)); }

// Current preset implementations (Lines 375-436 of Darkroom.tsx):
vec3 graded = c;
if (preset == 1) { // Nashville
  graded = overlay(c, vec3(0.9, 0.8, 0.6));
  graded = mix(graded, vec3(luma(graded)), 0.15) * vec3(1.1, 1.0, 0.9);
  graded = (graded - 0.5) * 1.1 + 0.5;
} else if (preset == 2) { // Chief Keef
  graded = pow(c, vec3(0.85)) * 1.2;
  float Y = luma(graded);
  graded = mix(vec3(Y), graded, 1.45);
  graded = (graded - 0.5) * 1.25 + 0.55;
} else if (preset == 3) { // Nuke (deep fried)
  graded = (c - 0.45) * 2.2 + 0.5;
  graded = floor(graded * 8.0) / 7.0;
  graded = mix(graded, vec3(1.0, 0.2, 0.1), 0.15);
} else if (preset == 4) { // Phreshboy
  graded = mix(c, vec3(c.r * 1.1, c.g * 0.92, c.b * 1.2), 0.7);
  graded.b += 0.05;
  graded = (graded - 0.5) * 1.12 + 0.5;
} else if (preset == 5) { // Sepia
  float Y = luma(c);
  graded = vec3(Y * 1.15, Y * 0.95, Y * 0.75);
} else if (preset == 6) { // 2014
  graded = c * 0.9 + 0.07;
  graded = mix(graded, vec3(luma(graded)), 0.2) * vec3(1.08, 1.02, 0.92);
} else if (preset == 7) { // $$$
  graded = mix(c, vec3(c.r * 0.85, c.g * 1.2, c.b * 0.9), 0.5);
  graded = (graded - 0.5) * 1.2 + 0.5;
} else if (preset == 8) { // Pandora
  graded = mix(c, vec3(0.2, 0.8, 1.0) * luma(c), 0.35);
  graded = mix(graded, vec3(0.9, 0.3, 0.8), smoothstep(0.6, 1.0, luma(c)) * 0.4);
} else if (preset == 9) { // Bleach Bypass
  vec3 b = overlay(c, vec3(luma(c)));
  graded = mix(b, vec3(luma(b)), 0.45);
  graded = (graded - 0.5) * 1.15 + 0.5;
} else if (preset == 10) { // Silver B&W
  graded = vec3(smoothstep(0.04, 0.96, luma(c)));
} else if (preset == 11) { // Cross Process
  graded = vec3(smoothstep(0.05, 0.95, c.r), pow(c.g, 0.9) * 1.05, c.b * 0.7 + 0.12);
} else if (preset == 12) { // Faded Print
  graded = c * 0.85 + 0.08;
  graded = mix(graded, vec3(luma(graded)), 0.25) * vec3(1.05, 1.0, 0.92);
} else if (preset == 13) { // Teal & Orange
  graded = mix(c, mix(vec3(0.0, 0.35, 0.45), vec3(1.0, 0.6, 0.3), luma(c)), 0.35);
} else if (preset == 14) { // Noir
  float Y = luma(c);
  graded = vec3(smoothstep(0.15, 0.85, Y));
} else if (preset == 15) { // Nokia 3310 / N-Gage
  vec3 q = floor(c * 15.0) / 15.0;
  float dither = (hash(st * res) - 0.5) * 0.1;
  graded = q + dither;
} else if (preset == 16) { // 1/4" Camcorder
  float lines = sin(st.y * res.y * 3.14159) * 0.15;
  graded = c * (1.0 - lines) * vec3(1.05, 1.0, 0.95);
} else if (preset == 17) { // iPhone 3GS
  graded = pow(c, vec3(0.92)) * vec3(1.02, 1.0, 0.98);
  graded = (graded - 0.5) * 1.08 + 0.5;
} else if (preset == 18) { // 🧠🧼 Brainwash
  graded = pow(c, vec3(0.75)) * 1.35;
  graded = mix(vec3(luma(graded)), graded, 1.6);
  graded = (graded - 0.5) * 1.3 + 0.55;
}
```

---

## 3. Presets to Research & Calibrate

Please research and provide mathematically accurate models for each of the following 18 presets:

### Category A: Swag Presets (Underground / Y2K / Nostalgia)

1. **Preset 1 — Nashville**:
   - *Target Aesthetic*: The authentic early Instagram "Nashville" filter (circa 2011–2012).
   - *Known Characteristics*: Warm pastel tone, lifted magenta/cyan shadows, washed low-contrast midtones, peach/cream highlights, gentle vignette, and channel-separated tone curves.
   - *Research Need*: Exact per-channel cubic spline / Bézier control points (R, G, B curve tables) or equivalent polynomial coefficients that faithfully reproduce original Instagram Nashville.

2. **Preset 2 — Chief Keef**:
   - *Target Aesthetic*: Early 2010s Chicago Drill mixtape cover and video still photography (DJ Kenn / DGainz / early Keef videos circa *Bang*, *Back from the Dead*).
   - *Known Characteristics*: Harsh direct on-camera Xenon flash, steep inverse-square falloff, aggressive oversaturation in skin tones and primary colors, clipped specular hot spots, crushed deep background shadows.
   - *Research Need*: A physical direct-flash lighting falloff model + non-linear saturation booster that mimics direct flash photography against dark interiors.

3. **Preset 3 — Nuke (Deep Fried)**:
   - *Target Aesthetic*: Memetic "deep-fried" image degradation.
   - *Known Characteristics*: Multi-generation extreme unsharp masking, high-contrast dynamic range clipping, severe 8-bit color quantization banding, high color saturation shifts toward red/yellow, and lossy JPEG block artifacts.
   - *Research Need*: Shader formulation that emulates extreme iterative unsharp masking + color gamut clipping without looking like a simple threshold filter.

4. **Preset 4 — Phreshboy**:
   - *Target Aesthetic*: Underground 2020s VIP / hyper-stylized rap / Tumblr visual style.
   - *Known Characteristics*: Cool cyan/magenta balance, lifted toe, subtle glow in skin tones, high micro-contrast, cold shadows with soft lilac/lavender highlight tint.
   - *Research Need*: Exact color balance matrices and shadow/midtone/highlight split toning formulas.

5. **Preset 5 — Sepia**:
   - *Target Aesthetic*: Authentic 19th-century photographic silver bromide print toned with sodium sulfide (not a simple yellow-brown multiplier).
   - *Known Characteristics*: Chemical replacement of metallic silver with silver sulfide ($Ag_2S$), density-dependent hue shift (shadows retain cool brown/dark tones, midtones are warm golden-brown, paper highlights retain fiber base warmth).
   - *Research Need*: Accurate density-dependent color transformation matrix or polynomial transfer function based on historical photographic chemistry.

6. **Preset 6 — 2014**:
   - *Target Aesthetic*: Peak VSCO Cam era (presets M5, F2, A6) that defined Tumblr and early VSCO culture in 2014.
   - *Known Characteristics*: Distinct "matte" finish (blacks lifted to ~10–15% RGB), muted highlight roll-off, warm golden/amber midtone shift, desaturated greens and blues.
   - *Research Need*: Specific lift-gamma-gain and selective hue-saturation curves to achieve the signature matte photographic look.

7. **Preset 7 — $$$**:
   - *Target Aesthetic*: Analog currency engraving, banknote intaglio print, and financial document aesthetic.
   - *Known Characteristics*: Micro-line intaglio printing contrast, distinct banknote green/cyan ink formulation, cotton-linen rag paper substrate coloration, sharp edge crispness.
   - *Research Need*: Spectral green/olive tint transfer curves and fine contrast curves inspired by US Federal Reserve Note and vintage banknote inks.

8. **Preset 8 — Pandora**:
   - *Target Aesthetic*: Dreamy, ethereal Y2K iridescent dream cast (cyan/violet split tone).
   - *Known Characteristics*: Deep shadows shifted to indigo/violet, highlights blooming into luminous cyan/aqua, soft contrast roll-off with high perceptual vibrance.
   - *Research Need*: Smooth luminance-mapped dual-tone gradient mapping with perceptual color preservation (e.g., using Oklab or modified HSL color space).

---

### Category B: Goth Presets (Darkroom & Photochemical Film Emulations)

9. **Preset 9 — Bleach Bypass (Skip Bleach / ENR / CCE)**:
   - *Target Aesthetic*: Motion picture photochemical laboratory technique where the bleaching step is skipped or reduced during C-41 / ECN-2 development.
   - *Known Characteristics*: Retained metallic silver emulsion superimposed over chromogenic color dye images. High contrast, crushed shadows, severely reduced color saturation (~40–60%), sharp gritty grain structure, blown silvery highlights (*Saving Private Ryan*, *Fight Club*, *Se7en*).
   - *Research Need*: Exact mathematical model for retained silver density superimposed on subtractive CMY dye layers in linear vs sRGB space.

10. **Preset 10 — Silver B&W**:
    - *Target Aesthetic*: Classic fine-art gelatin silver print (Kodak Tri-X 400 or Ilford HP5 Plus developed in Kodak D-76).
    - *Known Characteristics*: Panchromatic spectral sensitivity (human eye vs film response curves), rich midtone gradation, characteristic D-Log-E characteristic curve (toe, linear region, shoulder), deep D-max blacks.
    - *Research Need*: Spectral weighting coefficients for panchromatic film ($R, G, B \to Y$) and analytical Hurter-Driffield (H&D) sensitometric curve equation.

11. **Preset 11 — Cross Process (X-Pro)**:
    - *Target Aesthetic*: Photochemical cross-processing: developing reversal slide film (E-6) in negative chemistry (C-41), or color negative film (C-41) in slide chemistry (E-6).
    - *Known Characteristics*: Extreme contrast increase, unpredictable color cross-talk (shadows veer toward green/cyan, highlights veer toward yellow/magenta), erratic saturation, compressed dynamic range.
    - *Research Need*: Per-channel sensitometric response curves matching Kodak Ektachrome cross-processed in C-41 chemistry.

12. **Preset 12 — Faded Print**:
    - *Target Aesthetic*: Aged photographic print from the 1970s–1980s that has suffered dark-storage or light-induced photochemical dye fading.
    - *Known Characteristics*: Cyan dyes fade significantly faster than magenta and yellow dyes, leading to a strong red/magenta cast in shadows and midtones; black point is lifted and oxidized; paper support yellows.
    - *Research Need*: Photographic conservation research data on Arrhenius dye-fading rates in chromogenic prints (Kodacolor / Agfacolor) formulated as GLSL curves.

13. **Preset 13 — Teal & Orange**:
    - *Target Aesthetic*: Modern cinematic complementary color grading (Hollywood blockbuster standard) derived from 2-color Technicolor and modern digital intermediate LUTs.
    - *Known Characteristics*: Shadows pushed toward teal/cyan ($\approx 190^\circ$ hue), highlights and midtones pushed toward warm orange/amber ($\approx 35^\circ$ hue), with an explicit **skin tone protection axis** (I-axis on YIQ/vectorscope: $\approx 123^\circ$) so human faces do not turn blue or radioactive orange.
    - *Research Need*: Accurate color-wheel rotation or 3D color vector projection that applies complementary split-toning while preserving human skin tones along the melanin line.

14. **Preset 14 — Noir**:
    - *Target Aesthetic*: 1940s–1950s Film Noir chiaroscuro photography (John Alton, Nicholas Musuraca).
    - *Known Characteristics*: Hard directional key light, deep crushed pitch blacks (almost zero shadow fill), steep transition across midtones, silver nitrate film spectral response (orthochromatic or early panchromatic with blue sensitivity bias).
    - *Research Need*: S-curve equation with steep gamma ($\gamma \approx 2.2–2.8$) and low-end clipping paired with historical film spectral weights.

---

### Category C: 1-Click Vintage Cameras (Hardware & Sensor Emulation)

15. **Preset 15 — Nokia 3310 / 7650 / N-Gage**:
    - *Target Aesthetic*: Early camera phones (Nokia 7650, 3650, 6600, Sony Ericsson T610) with CIF ($352\times 288$) or VGA ($640\times 480$) sensors.
    - *Known Characteristics*: 
      - Tiny 1/4" or 1/5" CMOS sensor (e.g. OmniVision OV7620).
      - Severe fixed-pattern noise (FPN) and Bayer color filter demosaicing artifacts.
      - 12-bit RGB444 or 16-bit RGB565 color quantization with ordered Bayer matrix dithering.
      - Strong edge-ringing from primitive unsharp mask filters implemented in early ARM7/ARM9 DSPs.
    - *Research Need*: Precise Bayer dither matrix ($4\times 4$ or $8\times 8$), RGB565 / RGB444 quantization formula, and early DSP edge-enhancement algorithm.

16. **Preset 16 — 1/4" Camcorder (Sony Handycam / Hi8 / MiniDV)**:
    - *Target Aesthetic*: Late 90s / early 2000s consumer camcorder (Sony DCR-TRV series, Panasonic NV series) with 1/4" or 1/6" interlaced CCD sensor.
    - *Known Characteristics*:
      - Interlaced field scanlines (alternating odd/even field latency).
      - Analog composite video bandwidth limitations (NTSC/PAL color subcarrier chroma blurring: horizontal chroma resolution much lower than luma).
      - Slight warm tape saturation and vertical CCD smear on bright point lights.
    - *Research Need*: Accurate NTSC/PAL YIQ horizontal chroma subcarrier low-pass filtering and interlaced scanline comb structure.

17. **Preset 17 — iPhone 3GS**:
    - *Target Aesthetic*: iPhone 3GS (2009) camera output.
    - *Hardware Specifications*: OmniVision OV3640 3.15-megapixel 1/4" CMOS sensor, $f/2.8$ fixed-aperture 3.85mm plastic 3-element lens, Apple A4 / Samsung S5PC100 ISP.
    - *Known Characteristics*:
      - Softness toward corners due to plastic lens field curvature.
      - Distinct highlight clipping behavior (early ISP knee curve that clips skies into cyan-tinted white).
      - Smudged noise reduction in shadows with fine chroma speckle.
      - Moderate barrel distortion and slight purple/magenta fringing along high-contrast backlit edges.
    - *Research Need*: Mathematical model of the OV3640 ISP tone curve, chromatic aberration dispersion, and corner optical MTF roll-off.

18. **Preset 18 — 🧠🧼 Brainwash (Y2K Digicam)**:
    - *Target Aesthetic*: Early 2000s pocket digicam (Casio Exilim EX-S1, Sony Cyber-shot DSC-P series, Canon Digital IXUS).
    - *Known Characteristics*:
      - Small CCD sensor with high base ISO noise.
      - Harsh direct Xenon tube flash with sharp spherical shadows.
      - Over-saturated primary colors (CCD color filter dyes tuned for vibrant consumer appeal).
      - Blown highlight clipping with vertical streak blooming (CCD vertical transfer gate bleed).
    - *Research Need*: CCD vertical bleed artifact model + high-saturation punchy color response matrix.

---

## 4. Physical Sensor & Optical Simulation Modules

In addition to the 18 presets, research and validate equations for these optical modules in `Darkroom.tsx`:

1. **CCD Bloom & Vertical Smear**:
   - In Interline Transfer CCD sensors, high-intensity photons penetrate deep into the silicon and generate electrons directly within the vertical charge-coupled transfer registers, creating bright vertical streaks across the entire column.
   - *Research Need*: Accurate GLSL formulation for vertical column bleeding and halo blooming around saturated highlights ($Y > 0.95$).

2. **JPEG DCT Quantization Artifacts**:
   - The current shader uses a simple grid `floor(c * qSteps) / qSteps`.
   - *Research Need*: A fast WebGL shader approximation of $8\times 8$ Discrete Cosine Transform (DCT) block quantization, high-frequency ringing (Gibbs phenomenon), and 4:2:0 chroma subsampling.

3. **Photographic Grain & Sensor Noise**:
   - The current shader uses simple pseudo-random noise `hash(st * res + uTime)`.
   - *Research Need*: 
     - Film grain: Non-linear film grain distribution (grain is strongest in midtones, suppressed in pure shadows and saturated highlights; modeled by Poisson or Gaussian variance $\sigma(Y) \propto \sqrt{Y(1-Y)}$).
     - CMOS sensor noise: Read noise + photon shot noise + thermal dark current.

---

## 5. Required Deliverables from Gemini

For each of the 18 presets and optical modules, please provide:

1. **Photometric / Colorimetric Explanation**:
   - Historical background and exact hardware or chemical mechanism.
   - Primary RGB/CMY curve shapes (toe, linear segment, shoulder, white point, black point).
   - Tone balance in Highlights, Midtones, and Shadows.

2. **Mathematical Formulation**:
   - Formulas for per-channel transfer functions $R'(R), G'(G), B'(B)$, or matrix operations $M \cdot [R, G, B]^T$.
   - Any color space conversions (e.g. Linear RGB, Rec.709, sRGB, CIE XYZ, Oklab).

3. **Production-Ready GLSL Fragment Shader Code**:
   - Clean, efficient, drop-in GLSL code optimized for real-time WebGL execution.
   - Avoid slow loops; use native GLSL functions (`mix`, `step`, `smoothstep`, `clamp`, `pow`, `dot`, `mat3`).

4. **Reference Calibration Data**:
   - Typical RGB output values for standard Macbeth ColorChecker 24-patch inputs or grayscale ramp values ($[0.0, 0.25, 0.5, 0.75, 1.0]$) to allow automated unit testing and validation.

---

*Thank you! Formulating these models will allow Sanktuary OS Darkroom to achieve museum-grade and film-archival accuracy.*
