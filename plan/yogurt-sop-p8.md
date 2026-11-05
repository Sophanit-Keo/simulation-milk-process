[Index](README.md) · Source · [12. The yogurt line](12-yogurt-line.md)

# SOP: yogurt manufacturing & filling (Line P8)

The developer's standard operating procedure for the yogurt line, given on 5 November 2026. It is the source for [the yogurt line](12-yogurt-line.md), [D25](DECISIONS.md#d25-the-yogurt-line-line-p8), [D26](DECISIONS.md#d26-the-yogurt-lines-defaults) and phases 15–21. It is kept as given; the pasted copy repeated Parts 1 and 2 once, and the repeat is left out.

## Part 1: Upstream processing flow (milk preparation & fermentation)

1. **Raw milk reception & quality control**
   - Receive raw milk at ≤ 4 °C.
   - Test platform parameters: acidity, fat, total solids, antibiotics, alcohol test.
2. **Standardization & blending**
   - Clarify and separate cream/skim milk.
   - Standardize target milk fat and solids-not-fat (SNF).
   - Dose stabilizers or milk powder as per recipe.
3. **Deaeration & homogenization**
   - Remove entrapped air under vacuum (deaerator).
   - High-pressure homogenization (150–200 bar, 65–70 °C) to break fat globules and reduce syneresis.
4. **Pasteurization / thermal denaturation**
   - Thermal profile: 85–95 °C for 3–5 minutes.
   - Objective: denature whey proteins (beta-lactoglobulin) to reinforce the gel matrix and destroy vegetative microorganisms.
5. **In-line cooling & starter culture inoculation**
   - Cool in-line to incubation temperature: 41–43 °C.
   - Inject starter culture: *Lactobacillus delbrueckii* subsp. *bulgaricus* and *Streptococcus thermophilus*.
6. **Fermentation routing**
   - Option A (set yogurt): transfer directly to the Bench P8 filling buffer; ferment inside retail cups in a warm room (41–43 °C).
   - Option B (stirred yogurt): ferment in bulk tanks until target pH (4.50–4.65); smooth the curd gently, cool to 15–20 °C via plate heat exchanger, transfer to the P8 buffer tank.

## Part 2: Packaging & filling flow (Bench / machine P8)

**Line setup**
- Positive sterile air overpressure: Class 100 / ISO 5 HEPA hood active.
- Pre-operational verification: clean-in-place (CIP) / steam-in-place (SIP) complete and logged.

1. **Product feed to Line P8**
   - Transfer product from the P8 surge/buffer tank into the filler feed manifold under controlled positive pressure.
   - For fruit/flavour varieties: synchronize the in-line volumetric flavour/fruit dosing pump with the primary line flow.
2. **Cup de-nesting & indexing**
   - Automatic suction de-nesters drop cups from vertical magazines into conveyor carrier pockets.
   - The conveyor indexes cups sequentially under the laminar flow cabinet.
3. **Packaging sanitation & dust extraction**
   - An ionized air jet blows inside the cups to neutralize static and loosen micro-debris.
   - A vacuum shroud extracts suspended particulates.
   - A UV-C disinfection tunnel exposes the cups' inner surfaces.
4. **Volumetric dosing & piston filling**
   - Multi-head volumetric pistons draw calibrated product doses.
   - Anti-drip cut-off nozzles lower into the cups and dispense product.
   - A low-shear nozzle configuration prevents curd thinning and syneresis.
5. **Foil dispensing & heat sealing**
   - Pre-cut aluminium/composite foil lids are picked from magazines and centred over the cup rims.
   - Heated sealing heads apply controlled parameters:
     - sealing temperature: 180–220 °C;
     - sealing time: 0.8–1.2 s;
     - contact pressure: 4.0–6.0 bar.
6. **Coding & in-line quality checks**
   - A continuous inkjet (CIJ) or laser coder prints the date of manufacture, expiry date, batch code and line ID (P8).
   - Sealed cups pass in-line sensors:
     - dynamic checkweigher: rejects under-filled and over-filled cups automatically;
     - metal detector / X-ray: validates the absence of foreign bodies (ferrous, non-ferrous, stainless steel);
     - vision inspection: confirms lid alignment and print legibility.
7. **Secondary packaging & cold chain**
   - Robotic pick-and-place packs cups into secondary trays/cartons.
   - Automatic palletization and stretch-wrapping.
   - Routing:
     - set yogurt: move to the 41–43 °C incubation room; transfer to the blast chilling tunnel once pH reaches ≤ 4.60;
     - stirred yogurt: immediate transfer to the blast chilling tunnel (down to ≤ 4 °C); hold in the cold room (2–4 °C) for 24–48 hours of structural stabilization.

## Part 3: Bench P8 critical hygiene & quality control limits

- **Pre-operational hygiene:** ATP swab count < 10 RLU on contact surfaces; zero chemical residue after the CIP rinse.
- **CIP/SIP parameters:** caustic wash (1.5–2.0% NaOH at 75–80 °C), acid wash (0.5–1.0% HNO₃ at 65–70 °C), steam sterilization (≥ 121 °C for 20 minutes).
- **Sealing integrity:** dye penetration test and vacuum leak decay check (5 cups every 2 operating hours); zero liquid bypass allowed.
- **Environment:** HEPA differential pressure ≥ +15 Pa inside the filling cabin relative to the ambient packaging hall.

---

← [12. The yogurt line](12-yogurt-line.md) · [Index](README.md) →
