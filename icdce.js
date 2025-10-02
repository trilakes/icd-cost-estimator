/* ===== ICD Cost Estimator — JS (Part 1/2) ===== */

/* ---------- Simple DOM helpers ---------- */
function whenReady(ids, cb, attempts = 20) {
  const els = ids.map(id => document.getElementById(id));
  if (els.every(Boolean)) { cb.apply(null, els); return; }
  if (attempts <= 0) return;
  setTimeout(function () { whenReady(ids, cb, attempts - 1); }, 100);
}
function $(id) { return document.getElementById(id); }

/* ---------- Formatting ---------- */
function money(n)  { return "$" + (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function money0(n) { return "$" + (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }

/* ---------- Labels ---------- */
function regionLabel(f) {
  if (f < 0.90) return 'Low-cost';
  if (f < 1.10) return 'Standard';
  if (f < 1.30) return 'High-cost metro';
  return 'Very high';
}
function finishLabel(mult) {
  if (mult === 0.95) return 'Economy';
  if (mult === 1.00) return 'Standard';
  if (mult === 1.20) return 'Premium';
  if (mult === 1.35) return 'Luxury';
  if (mult < 0.975) return 'Economy';
  if (mult < 1.10)  return 'Standard';
  if (mult < 1.28)  return 'Premium';
  return 'Luxury';
}

/* ---------- Paywall Config ---------- */
const PAY_URL       = 'https://buy.stripe.com/4gMdR95Gl9cdddLch09MY00';
const SUCCESS_PARAM = 'paid';
const ACCESS_CODE   = 'FREE99';                 // set '' to disable code
const STORE_KEY     = 'icdce_paid_test1d';      // remember paid locally
const STATE_KEY     = 'icdce_state_v1';         // inputs

/* ---------- Local storage helpers ---------- */
function persistInputs(inp) { try { localStorage.setItem(STATE_KEY, JSON.stringify(inp)); } catch (_) {} }
function readInputsFromStore() {
  try { const s = localStorage.getItem(STATE_KEY); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
function clearInputsStore() { try { localStorage.removeItem(STATE_KEY); } catch (_) {} }

function isPaid()  { try { return localStorage.getItem(STORE_KEY) === 'yes'; } catch (_) { return false; } }
function setPaid() { try { localStorage.setItem(STORE_KEY, 'yes'); } catch (_) {} }
function clearPaid(){ try { localStorage.removeItem(STORE_KEY); } catch (_) {} }

/* ---------- Checkout helpers ---------- */
function safeRedirect(url) {
  try { if (window.top && window.top !== window.self) { window.top.location.href = url; return; } } catch (_) {}
  try { window.location.assign(url); return; } catch (_) {}
  try {
    const a = document.createElement('a');
    a.href = url; a.target = '_top'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove(); return;
  } catch (_) {}
  const w = window.open(url, '_blank', 'noopener');
  if (!w) alert('Please allow pop-ups to continue to checkout.');
}
function openPaywall() {
  const el = $('icdce_paywall');
  if (!el) { safeRedirect(PAY_URL); return; }
  el.style.display = 'flex';
  el.setAttribute('aria-hidden', 'false');
}
function closePaywall() {
  const el = $('icdce_paywall');
  if (!el) return;
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
}
function gotoCheckout() {
  const inp = getInputs();
  if (inp && inp.sf > 0) persistInputs(inp);
  safeRedirect(PAY_URL);
}
function unhideActions() {
  const sticky = $('icdce_sticky');
  if (sticky) { sticky.style.display = 'flex'; sticky.setAttribute('aria-hidden', 'false'); }
  ['ce_calcBtn','ce_clearBtn','ce_printBtn'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = false;
    el.style.display = '';            // undo inline display:none
    el.removeAttribute('aria-hidden');
    el.classList.remove('hidden','is-hidden'); // undo class-hiding
  });
}
function showUnlockToast() {
  const toast = $('icdce_unlocked');
  if (!toast) return;
  toast.classList.add('_show');
  toast.setAttribute('aria-hidden', 'false');
}
function hideUnlockToast() {
  const toast = $('icdce_unlocked');
  if (!toast) return;
  toast.classList.remove('_show');
  toast.setAttribute('aria-hidden', 'true');
}

/* -------------------------------------------------------
   Estimator Config & Core Logic
--------------------------------------------------------*/
var CONFIG = {
  priceCal: 0.65,
  glazingEnvelopeSFPerInteriorSF: 0.35,
  shellUnit: {
    airform_per_shell_sf: [12, 18],
    foam_per_shell_sf: [9, 14],
    shotcrete_per_shell_sf: [20, 28],
    rebar_per_int_sf: [9, 14]
  },
  domes: { "1": 1.00, "2": 1.07, "3": 1.12 },
  height: { std: 1.00, tall: 1.05 },
  siteStaging: { flat: 1.00, moderate: 1.05, complex: 1.10 },
  mep: { simple: 0.97, standard: 1.00, advanced: 1.10 },
  site: { flat: 1.00, moderate: 1.08, complex: 1.15 },
  finish: { 0.95: 0.95, 1.00: 1.00, 1.20: 1.20, 1.35: 1.35 },
  glazingCostPerSF: { 0.10: 110, 0.20: 125, 0.30: 160, 0.40: 200 },
  basementAdders: { none: [0, 0], partial: [35, 60], full: [55, 95] },
  options: {
    // Geothermal removed per request
    solar: 20000, storage: 18000,
    rain: 12000, septic: 35000, hydronic: 20000,
    drivewayPerFt: 80, drivewayMaxFt: 150
  },
  rangeLowPct: -0.05, rangeHighPct: 0.07,
  multipliers: {
    site: { flat: 1.00, moderate: 1.20, complex: 1.45 },
    mep: { simple: 0.95, standard: 1.00, advanced: 1.12 }
  },
  unitCosts: {
    // PRE-CONSTRUCTION
    designDocsPSF: [4, 8],
    permitsFeesPSF: [2, 4],
    surveyGeotechLump: [2500, 6000],
    mobilizationLump: [3000, 9000],
    // SITE & FOUNDATION (excludes shell)
    siteworkPSF: [12, 22],
    utilitiesStubPSF: [6, 12],
    foundationPSF: [22, 35],
    // INTERIORS
    interiorFramingPSF: [14, 22],
    insulDrywallPSF: [12, 20],
    flooringFinishesPSF: [18, 35],
    millworkDoorsPSF: [8, 16],
    // SYSTEMS (MEP)
    plumbingPSF: [14, 22],
    electricalPSF: [14, 22],
    hvacPSF: [18, 32],
    specialSystemsPSF: [3, 6],
    // EXTERIOR (non-glazing)
    exteriorFinishPSF: [8, 16],
    // ALLOWANCES
    kitchenBathPSF: [20, 45],
    appliancesLump: [6000, 12000],
    // Dome-specific
    oculusCurbLumpPerEa: [900, 1600],
    connectorShellShort: [6000, 11000],
    connectorShellMed: [12000, 20000],
    connectorShellLong: [24000, 42000],
    generatorRentalLump: [900, 1800],        // used if no reliable power on site
    remoteLogisticsAdderLump: { easy: [0,0], moderate: [1800,3600], remote: [6000,12000] },
    transitionWaterproofLump: [900, 1800]
    // Lightning removed
  },
  shellThicknessMult: { 4: 1.00, 5: 1.12, 6: 1.25 },
  mixTypeMult: { std: 1.00, pozz: 1.06, hemp: 1.18 }
};

function cal(v) { return v * CONFIG.priceCal; }

var lastEstimate = null, lastInputs = null;

/* ---------- Read inputs (incl. bedrooms + NC dome fields) ---------- */
function getInputs() {
  return {
    sf: +($('ce_sf')?.value || 0),
    regionPreset: +($('ce_region')?.value || 1),
    regionIdx: +($('ce_regionIdx')?.value || 1),
    finish: +($('ce_finish')?.value || 1),
    domes: $('ce_domes')?.value || '1',
    height: $('ce_height')?.value || 'std',
    glazing: +($('ce_glazing')?.value || 0.2),
    basement: $('ce_basement')?.value || 'none',
    site: $('ce_site')?.value || 'flat',
    mep: $('ce_mep')?.value || 'standard',

    bedrooms: +($('ce_bedrooms')?.value || 0),
    baths: Math.max(1, +($('ce_baths')?.value || 2)),

    includeSitework: !!$('ce_incSitework')?.checked,

    // Optional systems
    opts: {
      solar: !!$('ce_optSolar')?.checked,
      storage: !!$('ce_optStorage')?.checked,
      rain: !!$('ce_optRain')?.checked,
      septic: !!$('ce_optSeptic')?.checked,
      hydronic: !!$('ce_optHydronic')?.checked,
      driveway: !!$('ce_optDriveway')?.checked
    },

    drivewayLen: Math.max(0, Math.min(+($('ce_driveLen')?.value || 0), CONFIG.options.drivewayMaxFt)),
    contPct: (+($('ce_contPct')?.value || 10)) / 100,

    diameter: +($('ce_diameter')?.value || 0),
    shellThk: +($('ce_shellThk')?.value || 4),
    mixType: $('ce_mixType')?.value || "std",
    oculusCount: +($('ce_oculusCount')?.value || 0),
    connector: $('ce_connector')?.value || "none",
    remote: $('ce_remote')?.value || "easy",

    // Electricity on site (for inflation)
    inflationPower: $('ce_inflationPower')?.value || "onsite",

    // Non-conditioned domes
    ncDomes: +($('ce_ncDomes')?.value || 0),
    ncSf: +($('ce_ncSf')?.value || 0)
  };
}

/* ---------- Bath scaling ---------- */
function bathFactors(inp) {
  var expected = Math.max(1, Math.round((inp.sf || 0) / 900));
  var delta = (inp.baths || expected) - expected;
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  var bathPF = clamp(1 + 0.07 * delta, 0.85, 1.25);
  var bathUF = clamp(1 + 0.03 * delta, 0.90, 1.15);
  var bathSF = clamp(1 + 0.03 * delta, 0.90, 1.15);
  return { expected, delta, bathPF, bathUF, bathSF };
}

/* ---------- Shell calculator (conditioned) ---------- */
function computeBaseShell(inp, regionFactor) {
  var shellSurfaceSF = inp.sf * CONFIG.glazingEnvelopeSFPerInteriorSF;
  var domesMult = CONFIG.domes[inp.domes] || 1;
  var heightMult = CONFIG.height[inp.height] || 1;
  var siteStageMult = CONFIG.siteStaging[inp.site] || 1;
  var m = regionFactor * domesMult * heightMult * siteStageMult;

  var u = CONFIG.shellUnit;
  function pick(loHi) { return [cal(loHi[0] * m), cal(loHi[1] * m)]; }
  var air = pick(u.airform_per_shell_sf);
  var foam = pick(u.foam_per_shell_sf);
  var shot = pick(u.shotcrete_per_shell_sf);
  var thicknessMult = CONFIG.shellThicknessMult[inp.shellThk] || 1;
  var mixMult = CONFIG.mixTypeMult[inp.mixType] || 1;
  shot = [shot[0] * thicknessMult * mixMult, shot[1] * thicknessMult * mixMult];
  var reb = pick(u.rebar_per_int_sf);
  reb = [reb[0] * thicknessMult * mixMult, reb[1] * thicknessMult * mixMult];

  var airCost = [air[0] * shellSurfaceSF, air[1] * shellSurfaceSF];
  var foamCost = [foam[0] * shellSurfaceSF, foam[1] * shellSurfaceSF];
  var shotCost = [shot[0] * shellSurfaceSF, shot[1] * shellSurfaceSF];
  var rebarCost = [reb[0] * inp.sf, reb[1] * inp.sf];

  var low = airCost[0] + foamCost[0] + shotCost[0] + rebarCost[0];
  var high = airCost[1] + foamCost[1] + shotCost[1] + rebarCost[1];
  var mid = (low + high) / 2;

  return {
    shellSurfaceSF,
    components: {
      airform: { low: airCost[0], high: airCost[1] },
      foam: { low: foamCost[0], high: foamCost[1] },
      shotcrete: { low: shotCost[0], high: shotCost[1] },
      rebar: { low: rebarCost[0], high: rebarCost[1] }
    },
    totalMid: mid
  };
}

/* ---------- Shell calculator (non-conditioned dome) ---------- */
function computeNCshell(ncSf, regionFactor, siteKey, shellThk, mixType) {
  if (!ncSf) return { totalMid: 0, surfaceSF: 0 };
  var temp = {
    sf: ncSf,
    domes: '1',
    height: 'std',
    site: siteKey || 'flat',
    shellThk: shellThk || 4,
    mixType: mixType || 'std'
  };
  var shellSurfaceSF = temp.sf * CONFIG.glazingEnvelopeSFPerInteriorSF;
  var domesMult = CONFIG.domes[temp.domes] || 1;
  var heightMult = CONFIG.height[temp.height] || 1;
  var siteStageMult = CONFIG.siteStaging[temp.site] || 1;
  var m = regionFactor * domesMult * heightMult * siteStageMult;

  var u = CONFIG.shellUnit;
  function pick(loHi) { return [cal(loHi[0] * m), cal(loHi[1] * m)]; }
  var air = pick(u.airform_per_shell_sf);
  var foam = pick(u.foam_per_shell_sf);
  var shot = pick(u.shotcrete_per_shell_sf);
  var thicknessMult = CONFIG.shellThicknessMult[temp.shellThk] || 1;
  var mixMult = CONFIG.mixTypeMult[temp.mixType] || 1;
  shot = [shot[0] * thicknessMult * mixMult, shot[1] * thicknessMult * mixMult];
  var reb = pick(u.rebar_per_int_sf);
  reb = [reb[0] * thicknessMult * mixMult, reb[1] * thicknessMult * mixMult];

  var airCost = [air[0] * shellSurfaceSF, air[1] * shellSurfaceSF];
  var foamCost = [foam[0] * shellSurfaceSF, foam[1] * shellSurfaceSF];
  var shotCost = [shot[0] * shellSurfaceSF, shot[1] * shellSurfaceSF];
  var rebarCost = [reb[0] * temp.sf, reb[1] * temp.sf];

  var low = airCost[0] + foamCost[0] + shotCost[0] + rebarCost[0];
  var high = airCost[1] + foamCost[1] + shotCost[1] + rebarCost[1];
  var mid = (low + high) / 2;

  return { totalMid: mid, surfaceSF: shellSurfaceSF };
}

/* ---------- Full compute ---------- */
function compute(inp) {
  var regionFactor = inp.regionIdx || inp.regionPreset || 1;

  // Base (conditioned) dome shell
  var shell = computeBaseShell(inp, regionFactor);
  var structureCost = shell.totalMid;

  // Glazing (conditioned envelope only)
  var shellSurfaceSF = inp.sf * CONFIG.glazingEnvelopeSFPerInteriorSF;
  var glazingSF = shellSurfaceSF * inp.glazing;
  var glazingUnit = CONFIG.glazingCostPerSF[inp.glazing] || 0;
  var glazingCost = cal(glazingSF * glazingUnit * regionFactor);

  // Basement
  var adder = CONFIG.basementAdders[inp.basement] || [0, 0];
  var cov = inp.basement === 'partial' ? 0.5 : (inp.basement === 'full' ? 1 : 0);
  var basementLow = cal(adder[0] * inp.sf * cov * regionFactor);
  var basementHigh = cal(adder[1] * inp.sf * cov * regionFactor);

  // Multipliers
  var siteMultItems = CONFIG.multipliers.site[inp.site] || 1;
  var mepMultItems = CONFIG.multipliers.mep[inp.mep] || 1;
  var finishMultItems = CONFIG.finish[inp.finish] || 1;
  var bf = bathFactors(inp);

  function psf(loHi)      { return [cal(loHi[0] * regionFactor), cal(loHi[1] * regionFactor)]; }
  function psfSite(loHi)  { var p = psf(loHi); return [p[0] * siteMultItems, p[1] * siteMultItems]; }
  function psfFinish(loHi){ var p = psf(loHi); return [p[0] * finishMultItems, p[1] * finishMultItems]; }
  function psfMEP(loHi)   { var p = psf(loHi); return [p[0] * mepMultItems, p[1] * mepMultItems]; }
  function lump(loHi, m)  { m = m || 1; return [cal(loHi[0] * regionFactor * m), cal(loHi[1] * regionFactor * m)]; }

  var I = CONFIG.unitCosts;
  var items = [];

  // PRE-CONSTRUCTION
  var a = psf(I.designDocsPSF);
  items.push({ cat: "Pre-Construction", name: "Design & Construction Documents", desc: "Full architecture/engineering and coordinated construction drawings", low: a[0] * inp.sf, high: a[1] * inp.sf });
  var b = psf(I.permitsFeesPSF);
  items.push({ cat: "Pre-Construction", name: "Permits & Agency Fees", desc: "Plan review, building permit, utility/tap fees where applicable", low: b[0] * inp.sf, high: b[1] * inp.sf });
  var c = lump(I.surveyGeotechLump, siteMultItems);
  items.push({ cat: "Pre-Construction", name: "Survey & Geotechnical", desc: "Boundary/topographic survey and geotechnical (soils) report", low: c[0], high: c[1] });
  var d = lump(I.mobilizationLump, siteMultItems);
  items.push({ cat: "Pre-Construction", name: "Mobilization", desc: "Staging, temporary power/water, delivery logistics setup", low: d[0], high: d[1] });

  // SITE & FOUNDATION (non-shell)
  var siteworkPSF = psfSite(I.siteworkPSF);
  var siteworkLow = inp.includeSitework ? siteworkPSF[0] * inp.sf : 0;
  var siteworkHigh = inp.includeSitework ? siteworkPSF[1] * inp.sf : 0;
  items.push({ cat: "Site & Foundation", name: "Sitework & Rough Grading", desc: (inp.includeSitework ? "Clearing, rough grading, temporary access, erosion control" : "Excluded (by owner/others)"), low: siteworkLow, high: siteworkHigh });

  b = psfSite(I.utilitiesStubPSF); b[0] *= bf.bathUF; b[1] *= bf.bathUF;
  items.push({ cat: "Site & Foundation", name: "Utilities Stub-ins", desc: "Trenching and laterals for water/septic/electric to the shell", low: b[0] * inp.sf, high: b[1] * inp.sf });

  var f = psfSite(I.foundationPSF);
  items.push({ cat: "Site & Foundation", name: "Foundation / Slab / Footings", desc: "Footings, slab, anchors — basement costs shown separately", low: f[0] * inp.sf, high: f[1] * inp.sf });

  // Remote Logistics / Access
  var remoteLump = lump(I.remoteLogisticsAdderLump[inp.remote], siteMultItems);
  items.push({ cat: "Site & Foundation", name: "Remote Logistics / Access", desc: "Access/logistics cost for remote sites (" + inp.remote + ")", low: remoteLump[0], high: remoteLump[1] });

  // Basement explicit
  items.push({ cat: "Site & Foundation", name: "Basement", desc: inp.basement === 'none' ? 'None (slab only)' : inp.basement === 'partial' ? 'Partial (~50% footprint)' : 'Full (~100% footprint)', low: basementLow, high: basementHigh });

  // CORE STRUCTURE (shell)
  items.push({ cat: "Core Structure", name: "Base Dome Shell (Airform, Foam, Rebar, Shotcrete)", desc: "Airform membrane, spray foam insulation, rebar, shotcrete structural shell (multipliers: region/domes/height/site)", low: structureCost, high: structureCost });

  if (inp.oculusCount > 0) {
    var oculus = lump(I.oculusCurbLumpPerEa);
    items.push({ cat: "Core Structure", name: "Oculus/Skylights Curbs", desc: inp.oculusCount + " unit" + (inp.oculusCount === 1 ? "" : "s"), low: oculus[0] * inp.oculusCount, high: oculus[1] * inp.oculusCount });
  }
  if (inp.connector !== "none") {
    var connectorLump = inp.connector === "short" ? I.connectorShellShort : inp.connector === "med" ? I.connectorShellMed : I.connectorShellLong;
    var connectorCost = lump(connectorLump);
    items.push({ cat: "Core Structure", name: "Connector / Tunnel (Shell)", desc: inp.connector.charAt(0).toUpperCase() + inp.connector.slice(1) + " connector", low: connectorCost[0], high: connectorCost[1] });
  }

  // EXTERIOR
  a = psfFinish(I.exteriorFinishPSF);
  items.push({ cat: "Exterior", name: "Exterior Finishes / Coatings", desc: "Membrane topcoat/paint and trims at shell openings", low: a[0] * inp.sf, high: a[1] * inp.sf });
  var transWp = lump(I.transitionWaterproofLump);
  items.push({ cat: "Exterior", name: "Transition Waterproofing at Openings", desc: "Waterproofing transitions around openings", low: transWp[0], high: transWp[1] });
  items.push({ cat: "Exterior", name: "Windows & Glazed Openings", desc: (inp.glazing * 100).toFixed(0) + "% of shell surface @ $" + (CONFIG.glazingCostPerSF[inp.glazing] || 0) + "/SF", low: glazingCost, high: glazingCost });

  // INTERIORS
  a = psfFinish(I.interiorFramingPSF);
  items.push({ cat: "Interiors", name: "Interior Framing & Partitions", desc: "Non-structural partitions and basic framing details", low: a[0] * inp.sf, high: a[1] * inp.sf });
  var ii = psfFinish(I.insulDrywallPSF);
  items.push({ cat: "Interiors", name: "Insulation & Drywall", desc: "Thermal/sound insulation plus drywall hang, tape and texture", low: ii[0] * inp.sf, high: ii[1] * inp.sf });
  var ff = psfFinish(I.flooringFinishesPSF);
  items.push({ cat: "Interiors", name: "Flooring & Interior Finishes", desc: "LVT/tile/carpet, interior paint and finish carpentry", low: ff[0] * inp.sf, high: ff[1] * inp.sf });
  var mm = psfFinish(I.millworkDoorsPSF);
  items.push({ cat: "Interiors", name: "Millwork, Interior Doors & Trim", desc: "Interior doors, casing/base, basic built-ins/shelving", low: mm[0] * inp.sf, high: mm[1] * inp.sf });

  // SYSTEMS (MEP)
  var pl = psfMEP(I.plumbingPSF); pl[0] *= bathFactors(inp).bathPF; pl[1] *= bathFactors(inp).bathPF;
  items.push({ cat: "Systems (MEP)", name: "Plumbing (rough-in + fixtures)", desc: "Supply/drain/vent, water heater and standard plumbing fixtures", low: pl[0] * inp.sf, high: pl[1] * inp.sf });

  var el = psfMEP(I.electricalPSF); el[0] *= bathFactors(inp).bathPF; el[1] *= bathFactors(inp).bathPF;
  items.push({ cat: "Systems (MEP)", name: "Electrical (rough-in + devices)", desc: "Service/panels, branch circuits, devices and light fixtures", low: el[0] * inp.sf, high: el[1] * inp.sf });

  var hv = psfMEP(I.hvacPSF);
  items.push({ cat: "Systems (MEP)", name: "HVAC / Mechanical", desc: "Heat pump/furnace/air handler and distribution (ducted/ductless)", low: hv[0] * inp.sf, high: hv[1] * inp.sf });

  var ss = psfMEP(I.specialSystemsPSF);
  items.push({ cat: "Systems (MEP)", name: "Special Systems", desc: "ERV/HRV, simple controls and minor low-voltage allowances", low: ss[0] * inp.sf, high: ss[1] * inp.sf });

  // ALLOWANCES
  var kb = psfFinish(I.kitchenBathPSF);
  items.push({ cat: "Allowances", name: "Kitchens & Baths Package", desc: "Cabinetry, counters, tile and shower glass finishes", low: kb[0] * inp.sf, high: kb[1] * inp.sf });
  var app = lump(I.appliancesLump, finishMultItems);
  items.push({ cat: "Allowances", name: "Appliances", desc: "Typical kitchen + laundry appliance package", low: app[0], high: app[1] });

  // Electricity on site? If not, add generator rental
  if (inp.inflationPower !== "onsite") {
    var genRental = lump(I.generatorRentalLump);
    items.push({ cat: "Site & Foundation", name: "Generator Rental (Airform Inflation)", desc: "No reliable power available; temporary generator for inflation", low: genRental[0], high: genRental[1] });
  }

  // Optional systems
  var optLabels = [], optsSum = 0;
  if (inp.opts.solar)    { optsSum += cal(CONFIG.options.solar   * regionFactor); optLabels.push('Solar PV'); }
  if (inp.opts.storage)  { optsSum += cal(CONFIG.options.storage * regionFactor); optLabels.push('Battery Storage'); }
  if (inp.opts.rain)     { optsSum += cal(CONFIG.options.rain    * regionFactor); optLabels.push('Rainwater collection / cistern'); }
  if (inp.opts.hydronic) { optsSum += cal(CONFIG.options.hydronic* regionFactor); optLabels.push('Hydronic Radiant Floors'); }
  if (inp.opts.septic)   { optsSum += cal(CONFIG.options.septic  * regionFactor * (CONFIG.site[inp.site] || 1)); optLabels.push('Septic'); }
  if (inp.opts.driveway && inp.drivewayLen > 0) {
    var len = Math.min(inp.drivewayLen, CONFIG.options.drivewayMaxFt);
    var drivewayCost = cal(len * CONFIG.options.drivewayPerFt * regionFactor * (CONFIG.site[inp.site] || 1));
    optsSum += drivewayCost; optLabels.push("Driveway (~" + len + " ft)");
  }

  // Non-conditioned dome(s) (garage/utility): shell + slab only
  if (inp.ncDomes > 0 && inp.ncSf > 0) {
    var nc = computeNCshell(inp.ncSf, regionFactor, inp.site, inp.shellThk, inp.mixType);
    var nf = psfSite(I.foundationPSF); // slab
    var ncFoundLow = nf[0] * inp.ncSf, ncFoundHigh = nf[1] * inp.ncSf;
    var ncShell = { low: nc.totalMid, high: nc.totalMid }; // mid as point
    items.push({ cat: "Non-Conditioned Domes", name: "Utility/Garage Dome Shell (x" + inp.ncDomes + ")", desc: "Shell only, no interiors/MEP", low: ncShell.low * inp.ncDomes, high: ncShell.high * inp.ncDomes });
    items.push({ cat: "Non-Conditioned Domes", name: "Utility/Garage Slab/Foundation", desc: "Simple slab foundation", low: ncFoundLow * inp.ncDomes, high: ncFoundHigh * inp.ncDomes });
  }

  // Totals
  var preLow  = items.reduce((a, it) => a + it.low, 0);
  var preHigh = items.reduce((a, it) => a + it.high, 0);
  var contLow  = preLow  * (inp.contPct || 0);
  var contHigh = preHigh * (inp.contPct || 0);
  var low  = (preLow  + contLow  + (optsSum||0)) * (1 + CONFIG.rangeLowPct);
  var high = (preHigh + contHigh + (optsSum||0)) * (1 + CONFIG.rangeHighPct);

  return {
    inp: Object.assign({}, inp, { expectedBaths: bathFactors(inp).expected }),
    parts: {
      regionFactor,
      optsSum, optLabels,
      shell: shell,
      sitework: { low: inp.includeSitework ? siteworkLow : 0, high: inp.includeSitework ? siteworkHigh : 0, included: inp.includeSitework }
    },
    items: items,
    base: { structureCost: structureCost, glazingCost: glazingCost, basementLow: basementLow, basementHigh: basementHigh },
    totals: {
      preLow, preHigh, contLow, contHigh,
      low, high,
      lowPSF: low / Math.max(inp.sf, 1),
      highPSF: high / Math.max(inp.sf, 1),
      structurePSFout: structureCost / Math.max(inp.sf, 1)
    }
  };
}

/* ---------- Render to page ---------- */
function render(est) {
  var inp = est.inp || {};
  if (!inp.sf) {
    $('ce_rangeTotal')   && ($('ce_rangeTotal').textContent = "$0 – $0");
    $('ce_rangePerSf')   && ($('ce_rangePerSf').textContent = "$/SF: $0 – $0");
    $('ce_baseTotal')    && ($('ce_baseTotal').textContent = "$0");
    $('ce_basePsf')      && ($('ce_basePsf').textContent = "$/SF: $0");
    $('ce_siteworkTotal')&& ($('ce_siteworkTotal').textContent = "$0 – $0");
    $('ce_siteworkNote') && ($('ce_siteworkNote').textContent = "Included");
    $('ce_assumptions')  && ($('ce_assumptions').textContent = "Region Standard • Standard finish • Typical glazing • Single dome");
    if ($('ce_breakdown')) $('ce_breakdown').innerHTML =
      '<tr><td colspan="4" class="_muted" style="text-align:center;padding:18px">Run a calculation to see details.</td></tr>';

    // Apply gates (keeps preview blur/fade even when no inputs)
    applyGates();
    return;
  }

  $('ce_rangeTotal') && ($('ce_rangeTotal').textContent = money(est.totals.low) + " – " + money(est.totals.high));
  $('ce_rangePerSf') && ($('ce_rangePerSf').textContent = "$/SF: " + money(est.totals.lowPSF) + " – " + money(est.totals.highPSF));
  $('ce_baseTotal')  && ($('ce_baseTotal').textContent  = money(est.base.structureCost));
  $('ce_basePsf')    && ($('ce_basePsf').textContent    = "$/SF: " + money(est.totals.structurePSFout));

  var sw = est.parts.sitework;
  $('ce_siteworkTotal') && ($('ce_siteworkTotal').textContent = money(sw.low) + " – " + money(sw.high));
  $('ce_siteworkNote')  && ($('ce_siteworkNote').textContent  = sw.included ? "Included" : "Excluded");

  var optStr = (est.parts.optLabels && est.parts.optLabels.length) ? (" • Options: " + est.parts.optLabels.join(', ')) : '';
  var basementStr = inp.basement === 'none' ? 'No basement (slab)' : inp.basement === 'partial' ? 'Partial basement (~50%)' : 'Full basement (~100%)';
  var powerText = (inp.inflationPower === 'onsite') ? 'Yes' : 'No (use generator for Airform inflation)';

  $('ce_assumptions') && ($('ce_assumptions').textContent =
    "Region " + regionLabel(est.parts.regionFactor) + " (" + est.parts.regionFactor.toFixed(2) + ")" +
    " • Finish " + finishLabel(+inp.finish || 1) +
    " • " + ((+inp.glazing || 0) * 100).toFixed(0) + "% glazing" +
    " • " + inp.domes + " dome" + (inp.domes === '1' ? '' : 's') +
    " • " + (inp.height === 'tall' ? 'tall shell' : 'std shell') +
    " • Bedrooms: " + (inp.bedrooms || 0) +
    " • Bathrooms: " + (inp.baths || 0) +
    " • " + basementStr +
    " • " + inp.site + " site" +
    " • " + (sw.included ? "Sitework included" : "Sitework excluded") +
    " • " + inp.mep + " MEP" +
    " • Shell thickness: " + inp.shellThk + " \"" +
    " • Mix: " + (inp.mixType === 'pozz' ? 'Pozzolan' : (inp.mixType === 'hemp' ? 'Hempcrete' : 'Standard')) +
    (inp.connector !== "none" ? " • Connector: " + inp.connector : "") +
    (inp.oculusCount > 0 ? " • Oculus: " + inp.oculusCount : "") +
    " • Access: " + inp.remote +
    " • Electricity on site: " + powerText +
    (inp.ncDomes > 0 && inp.ncSf > 0 ? (" • Non-conditioned dome(s): " + inp.ncDomes + " @ " + inp.ncSf + " SF each") : "") +
    " • Contingency: " + (inp.contPct * 100).toFixed(1) + "% " +
    optStr
  );

  var rows = [], currentCat = null;
  est.items.forEach(function (it) {
    if (it.cat !== currentCat) { currentCat = it.cat; rows.push(["— " + currentCat + " —", "", "", ""]); }
    rows.push([it.name, it.desc, it.low, it.high]);
  });

  rows.push(["Subtotal (pre contingency)", "All line items above", est.totals.preLow, est.totals.preHigh]);
  rows.push(["Contingency", (est.inp.contPct * 100).toFixed(1) + "%", est.totals.contLow, est.totals.contHigh]);
  if (est.parts.optsSum) { rows.push(["Optional systems", est.parts.optLabels.join(' + '), est.parts.optsSum, est.parts.optsSum]); }

  var withContLow  = est.totals.preLow + est.totals.contLow + (est.parts.optsSum || 0);
  var withContHigh = est.totals.preHigh + est.totals.contHigh + (est.parts.optsSum || 0);
  var spreadLow  = withContLow  * (-0.05);
  var spreadHigh = withContHigh * (0.07);
  rows.push(["Range spread", "-5% / +7%", spreadLow, spreadHigh]);
  rows.push(["Total (rounded)", "Low / High", est.totals.low, est.totals.high]);

  if ($('ce_breakdown')) {
    $('ce_breakdown').innerHTML = rows.map(function (r) {
      var isDivider = (r[0] || "").indexOf("— ") === 0;
      if (isDivider) return '<tr><td colspan="4" style="background:#f1f5f9;color:#0b1320;font-weight:700">' + r[0] + '</td></tr>';
      return '<tr><td>' + r[0] + '</td><td class="_muted">' + r[1] + '</td><td class="_right">' + money(r[2]) + '</td><td class="_right">' + money(r[3]) + '</td></tr>';
    }).join('');
  }

  // Apply/refresh gating (blur totals, lock sections, teaser table)
  applyGates();
}

/* ---------- Fill form from saved inputs ---------- */
function fillFormFromInputs(inp) {
  if (!inp) return;
  function setVal(id, val) { const el = $(id); if (el) el.value = String(val); }
  function setCheck(id, v) { const el = $(id); if (el) el.checked = !!v; }

  setVal('ce_sf', inp.sf ?? '');
  setVal('ce_region', inp.regionPreset ?? '1.00');
  setVal('ce_regionIdx', inp.regionIdx ?? '1.00');
  setVal('ce_finish', inp.finish ?? '1.00');
  setVal('ce_domes', inp.domes ?? '1');
  setVal('ce_height', inp.height ?? 'std');
  setVal('ce_glazing', inp.glazing ?? '0.20');
  setVal('ce_basement', inp.basement ?? 'none');
  setVal('ce_site', inp.site ?? 'flat');
  setVal('ce_mep', inp.mep ?? 'standard');

  setVal('ce_bedrooms', inp.bedrooms ?? '0');
  setVal('ce_baths', inp.baths ?? '2');

  setCheck('ce_incSitework', !!inp.includeSitework);

  setCheck('ce_optSolar',   inp?.opts?.solar);
  setCheck('ce_optStorage', inp?.opts?.storage);
  setCheck('ce_optRain',    inp?.opts?.rain);
  setCheck('ce_optSeptic',  inp?.opts?.septic);
  setCheck('ce_optHydronic',inp?.opts?.hydronic);
  setCheck('ce_optDriveway',inp?.opts?.driveway);

  setVal('ce_driveLen', inp.drivewayLen ?? 0);
  setVal('ce_contPct',  (inp.contPct ?? 0.10) * 100);

  setVal('ce_diameter', inp.diameter ?? '');
  setVal('ce_shellThk', inp.shellThk ?? 4);
  setVal('ce_mixType',  inp.mixType  ?? 'std');
  setVal('ce_oculusCount', inp.oculusCount ?? 0);
  setVal('ce_connector',   inp.connector   ?? 'none');
  setVal('ce_remote',      inp.remote      ?? 'easy');
  setVal('ce_inflationPower', inp.inflationPower ?? 'onsite');

  // Non-conditioned dome fields
  setVal('ce_ncDomes', inp.ncDomes ?? 0);
  setVal('ce_ncSf',    inp.ncSf    ?? 0);

  updateRegionIdxBadge();
  updateRangeFill($('ce_regionIdx'));
  toggleDrivewayInputs();
}

/* ---------- Slider & small UI helpers ---------- */
function updateRangeFill(el) {
  if (!el) return;
  var min = parseFloat(el.min || 0), max = parseFloat(el.max || 100), val = parseFloat(el.value || 0);
  var pct = ((val - min) / (max - min)) * 100;
  el.style.setProperty('--fill', pct + '%');
}
function applyRegionPreset() {
  var sel = $('ce_region'); var slider = $('ce_regionIdx');
  if (sel && slider) { slider.value = sel.value; updateRegionIdxBadge(); updateRangeFill(slider); }
}
function updateRegionIdxBadge() {
  var slider = $('ce_regionIdx'); var badge = $('ce_regionIdxVal');
  if (slider && badge) badge.textContent = (+slider.value || 1).toFixed(2);
}
function toggleDrivewayInputs() {
  var cb = $('ce_optDriveway'); var len = $('ce_driveLen');
  if (!len) return;
  var checked = !!(cb && cb.checked);
  len.disabled = !checked;
  len.style.opacity = checked ? '1' : '0.6';
}

/* ---------- Gating helpers (lock sections, blur money, teaser table) ---------- */
function findPanelByAria(label) {
  const regions = document.querySelectorAll('section[role="region"]');
  for (const r of regions) {
    if ((r.getAttribute('aria-label') || '').toLowerCase() === label.toLowerCase()) return r;
  }
  return null;
}
/* ---------- New "outside ribbon" helper ---------- */
function ensureOverlay(panel, opts) {
  if (!panel) return null;

  // If there’s an old inside-the-panel ribbon from previous versions, remove it
  const oldInside = panel.querySelector(':scope > .sectionLockRibbon');
  if (oldInside) oldInside.remove();

  // If the previous sibling is already our ribbon, reuse it
  let rib = panel.previousElementSibling;
  if (!(rib && rib.classList && rib.classList.contains('sectionLockRibbon'))) {
    rib = document.createElement('div');
    rib.className = 'sectionLockRibbon';
    rib.innerHTML = `
      <div class="_rWrap">
        <div class="_rTitle">${(opts && opts.title) || 'Advanced Options'}</div>
        <button type="button" class="_rCTA">${(opts && opts.cta) || 'Unlock'}</button>
      </div>
      <div class="_rSub">${(opts && opts.sub) || 'Upgrade to view all design & site features and Download a professional line-item PDF estimate'}</div>
    `;
    // Insert BEFORE the section so it sits above the title
    panel.parentNode.insertBefore(rib, panel);
    rib.querySelector('._rCTA')?.addEventListener('click', openPaywall);
  } else {
    // Update text if already present
    const t = rib.querySelector('._rTitle');
    const sub = rib.querySelector('._rSub');
    const cta = rib.querySelector('._rCTA');
    if (t && opts?.title) t.textContent = opts.title;
    if (sub && opts?.sub) sub.textContent = opts.sub;
    if (cta && opts?.cta) cta.textContent = opts.cta;
  }

  return rib;
}

/* ---------- NEW: helper to remove outside ribbons once paid ---------- */
function removeOutsideRibbons() {
  // Remove any ribbons that were inserted before sections
  document.querySelectorAll('.sectionLockRibbon').forEach(el => el.remove());
}


/* ---------- Lock/Unlock now disable individual controls ---------- */
function lockPanel(panel, meta) {
  if (!panel) return;
  panel.classList.add('section--locked');
  ensureOverlay(panel, meta);

  // Disable all form controls inside this panel (but not the ribbon button)
  const ctrls = panel.querySelectorAll('input, select, textarea, button');
  ctrls.forEach(el => {
    // Don’t disable our ribbon CTA
    if (el.closest('.sectionLockRibbon')) return;

    // Remember prior state so we can restore precisely
    if (!el.hasAttribute('data-prev-disabled')) {
      el.setAttribute('data-prev-disabled', el.disabled ? '1' : '0');
    }
    el.disabled = true;
    el.setAttribute('aria-disabled', 'true');
  });
}

function unlockPanel(panel) {
  if (!panel) return;
  panel.classList.remove('section--locked');

  // Restore prior disabled state
  const ctrls = panel.querySelectorAll('input, select, textarea, button');
  ctrls.forEach(el => {
    if (el.closest('.sectionLockRibbon')) return;

    const prev = el.getAttribute('data-prev-disabled');
    if (prev !== null) {
      el.disabled = (prev === '1');
      el.removeAttribute('data-prev-disabled');
    } else {
      el.disabled = false; // default
    }
    el.removeAttribute('aria-disabled');
  });

  // Remove the small ribbon
  const rib = panel.querySelector(':scope > .sectionLockRibbon');
  if (rib) rib.remove();
}
function maskMoney() {
  // Blur All-In TOTAL dollars only (keep $/SF visible for free users)
  ['ce_rangeTotal'].forEach(id => {
    const el = $(id);
    if (el) el.classList.add('_moneyMask');
  });

  // Ensure these remain UNBLURRED (visible for both unpaid & paid)
  ['ce_rangePerSf', 'ce_baseTotal','ce_basePsf','ce_siteworkTotal','ce_siteworkNote'].forEach(id => {
    const el = $(id);
    if (el) el.classList.remove('_moneyMask');
  });

  // Keep line-item Low/High numbers gated
  document
    .querySelectorAll('section._breakdown td._right')
    .forEach(td => td.classList.add('_moneyMask'));
}

function unmaskMoney() {
  const sel = [
    '#ce_rangeTotal',   // All-In $ range
    '#ce_rangePerSf',   // All-In $/SF (now explicitly unmasked on paid)
    '#ce_baseTotal',    // Dome shell $
    '#ce_basePsf',      // Dome shell $/SF
    '#ce_siteworkTotal',
    '#ce_siteworkNote',
    'section._breakdown td._right'
  ];
  document.querySelectorAll(sel.join(',')).forEach(el => el.classList.remove('_moneyMask'));
}

function wrapTeaser() {
  const breakdownPanel = document.querySelector('section._breakdown');
  if (!breakdownPanel) return;
  let table = breakdownPanel.querySelector('table');
  if (!table) return;

  // Already wrapped?
  if (table.parentElement && table.parentElement.classList.contains('_teaserArea')) return;

  const wrap = document.createElement('div');
  wrap.className = '_teaserArea';
  table.parentElement.insertBefore(wrap, table);
  wrap.appendChild(table);

  // Note + CTA
  let note = breakdownPanel.querySelector('._teaserNote');
  if (!note) {
    note = document.createElement('div');
    note.className = '_teaserNote';
    note.innerHTML = `<span>Preview of full line-item detail.</span><button type="button" class="_btn _primary">See full report</button>`;
    breakdownPanel.appendChild(note);
    note.querySelector('button')?.addEventListener('click', openPaywall);
  }
}
function unwrapTeaser() {
  const breakdownPanel = document.querySelector('section._breakdown');
  if (!breakdownPanel) return;
  const wrap = breakdownPanel.querySelector('._teaserArea');
  const note = breakdownPanel.querySelector('._teaserNote');
  if (wrap) {
    const table = wrap.querySelector('table');
    if (table) wrap.parentElement.insertBefore(table, wrap);
    wrap.remove();
  }
  if (note) note.remove();
}
function applyGates() {
  if (isPaid()) {
    // Fully unlocked
    ['Design and Envelope','Site and Systems','Other Site Factors']
      .forEach(lbl => unlockPanel(findPanelByAria(lbl)));

    unmaskMoney();          // show all dollar amounts
    unwrapTeaser();         // make sure no teaser wrapper remains
    removeOutsideRibbons(); // clears any ribbons inserted before sections

    // NEW: hide upgrade note + unlock button(s)
    const note = document.querySelector('.upgradeNote');
    if (note) note.style.display = 'none';
    const unlockBtns = document.querySelectorAll('.upgradeBtn');
    unlockBtns.forEach(btn => btn.style.display = 'none');

    return;
  }

  // Not paid: lock advanced sections (but still visible), blur money only
  lockPanel(findPanelByAria('Design and Envelope'), {title:'Premium Controls', cta:'Unlock Design & Envelope'});
  lockPanel(findPanelByAria('Site and Systems'),   {title:'Premium Controls', cta:'Unlock Site & Systems'});
  lockPanel(findPanelByAria('Other Site Factors'), {title:'Premium Controls', cta:'Unlock Other Factors'});

  // Keep Project Basics & Contingency interactive
  maskMoney();     // blur money cells
  unwrapTeaser();  // ensure full list is visible

  // NEW: show upgrade note + unlock button(s)
  const note = document.querySelector('.upgradeNote');
  if (note) note.style.display = 'flex';
  const unlockBtns = document.querySelectorAll('.upgradeBtn');
  unlockBtns.forEach(btn => btn.style.display = '');
}


/* ===== PDF (Part 2/2): jsPDF loader + export + wiring/init ===== */

/* ---------------- jsPDF loader ---------------- */
function ensureJsPDF() {
  return new Promise(function (resolve, reject) {
    var hasCore = !!(window.jspdf && window.jspdf.jsPDF);
    var hasAT   = !!(window.jspdf && window.jspdf.autoTable);
    if (hasCore && hasAT) return resolve();

    function load(src) {
      return new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = res; s.onerror = function () { rej(new Error('Failed to load ' + src)); };
        document.head.appendChild(s);
      });
    }

    (hasCore ? Promise.resolve()
             : load('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'))
    .then(function () { return hasAT ? Promise.resolve()
             : load('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js'); })
    .then(resolve).catch(reject);
  });
}

/* ---------------- PDF helpers ---------------- */
function drawFooter(doc) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;
  const y = pageH - 40;

  doc.setDrawColor(230, 234, 240);
  doc.line(margin, y, pageW - margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);

  const pageNo = doc.getCurrentPageInfo
    ? doc.getCurrentPageInfo().pageNumber
    : doc.internal.getNumberOfPages();

  doc.text(
    'Planning-level estimate only. Not a bid. Final costs depend on site, engineering, and trade bids.',
    margin, y + 14
  );
  doc.text('Page ' + pageNo, pageW - margin, y + 14, { align: 'right' });
  doc.setTextColor(0);
}

function saveOrOpenPDF(doc, filename) {
  try {
    const fe = window.frameElement;
    const sandboxed = !!(fe && fe.hasAttribute('sandbox'));
    if (!sandboxed && ('download' in HTMLAnchorElement.prototype)) { doc.save(filename); return; }
  } catch (_) {}
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) alert('Popup blocked. Please allow pop-ups to download the PDF.');
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

function fitTextSingleLine(doc, text, maxW, startSize, minSize) {
  let fs = startSize;
  while (fs >= minSize) {
    doc.setFontSize(fs);
    if (doc.getTextWidth(text) <= maxW) return fs;
    fs -= 1;
  }
  return minSize;
}

function drawKPIv2(doc, x, y, w, h, opts, colors) {
  const r = 10;
  const padX = 14;
  const innerW = w - padX * 2;

  // Card
  doc.setDrawColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.setFillColor(colors.kpiBg[0], colors.kpiBg[1], colors.kpiBg[2]);
  doc.roundedRect(x, y, w, h, r, r, 'F');

  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.text(String(opts.label || '').toUpperCase(), x + w/2, y + 18, { align: 'center' });

  // Primary (single line, auto-fit)
  const primary = String(opts.primary || '');
  const primaryFs = fitTextSingleLine(doc, primary, innerW, 22, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(primaryFs);
  doc.setTextColor(colors.navy[0], colors.navy[1], colors.navy[2]);
  doc.text(primary, x + w/2, y + 48, { align: 'center' });

  // Secondary
  if (opts.secondary) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80);
    doc.text(String(opts.secondary), x + w/2, y + 68, { align: 'center' });
  }
}


/* Build Assumptions table rows */
function buildAssumptionsRows(inp, est, money0) {
  const sw = est.parts.sitework;
  const swVal = sw.included ? (money0(sw.low) + ' – ' + money0(sw.high)) : 'Excluded';
  const basement = inp.basement === 'none'
    ? 'No basement (slab)'
    : (inp.basement === 'partial' ? 'Partial basement (~50%)' : 'Full basement (~100%)');
  const mix = inp.mixType === 'pozz' ? 'Pozzolan' : (inp.mixType === 'hemp' ? 'Hempcrete' : 'Standard');
  const height = (inp.height === 'tall' ? 'tall shell' : 'std shell');

  return [
    ['Region', regionLabel(est.parts.regionFactor) + ' (' + est.parts.regionFactor.toFixed(2) + ')'],
    ['Finish', finishLabel(+inp.finish || 1)],
    ['Glazing', ((+inp.glazing || 0) * 100).toFixed(0) + '%'],
    ['Domes', inp.domes],
    ['Shell Height', height],
    ['Bedrooms', String(inp.bedrooms || 0)],
    ['Bathrooms', String(inp.baths || 0)],
    ['Basement', basement],
    ['Site', inp.site],
    ['Sitework', swVal],
    ['MEP', inp.mep],
    ['Shell Thickness', String(inp.shellThk) + ' "'],
    ['Mix', mix],
    ...(inp.connector !== 'none' ? [['Connector', inp.connector]] : []),
    ...(inp.oculusCount > 0 ? [['Oculus', String(inp.oculusCount)]] : []),
    ['Access', inp.remote],
    ['Contingency', (inp.contPct * 100).toFixed(1) + '%'],
    ['Power (on site)', (inp.inflationPower === 'onsite' ? 'Yes' : 'No — use generator for Airform inflation')],
    ...(inp.ncDomes > 0 && inp.ncSf > 0 ? [['Non-conditioned domes', inp.ncDomes + ' @ ' + inp.ncSf + ' SF each']] : [])
  ];
}

/* /* ---------------- Export PDF (cover + breakdown) ---------------- */

/* ---- KPI helpers (clean, centered, single-line fit) ---- */
function fitTextSingleLine(doc, text, maxW, startSize = 22, minSize = 12) {
  let fs = startSize;
  while (fs >= minSize) {
    doc.setFontSize(fs);
    if (doc.getTextWidth(String(text)) <= maxW) return fs;
    fs -= 1;
  }
  return minSize;
}

function drawKPIv2(doc, x, y, w, h, opts, colors) {
  const r = 10;
  const padX = 14;
  const innerW = w - padX * 2;

  // Card
  doc.setDrawColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.setFillColor(colors.kpiBg[0], colors.kpiBg[1], colors.kpiBg[2]);
  doc.roundedRect(x, y, w, h, r, r, 'F');

  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.text(String(opts.label || '').toUpperCase(), x + w / 2, y + 18, { align: 'center' });

  // Primary (auto-fit, one line)
  const primary = String(opts.primary || '');
  const primaryFs = fitTextSingleLine(doc, primary, innerW, 22, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(primaryFs);
  doc.setTextColor(colors.navy[0], colors.navy[1], colors.navy[2]);
  doc.text(primary, x + w / 2, y + 46, { align: 'center' });

  // Secondary (caption)
  if (opts.secondary) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80);
    doc.text(String(opts.secondary), x + w / 2, y + 66, { align: 'center' });
  }
}

async function exportPDF(inp, est) {
  await ensureJsPDF();
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new Error('jsPDF not available');

  const colors = {
    navy: [17, 34, 64],
    accent: [38, 86, 138],
    headerBg: [17, 34, 64],
    headerText: [255, 255, 255],
    kpiBg: [245, 248, 255],
    muted: [110, 110, 110],
    line: [230, 234, 240]
  };

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 44;
  const maxW = pageW - margin * 2;

  /* ---- Cover ---- */
  const headerH = 92;
  doc.setFillColor(colors.headerBg[0], colors.headerBg[1], colors.headerBg[2]);
  doc.rect(0, 0, pageW, headerH, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(colors.headerText[0], colors.headerText[1], colors.headerText[2]);
  doc.text('ICD Cost Estimator™ — Planning Estimate', margin, 56);

  // KPIs
  const kpiY = headerH + 28;
  const kpiH = 86;
  const gap = 18;
  const kpiW = (maxW - gap * 2) / 3;

  const rangePrimary = money0(est.totals.low) + ' – ' + money0(est.totals.high);
  const rangeSecondary = 'All-in project cost';

  const psfPrimary   = money0(est.totals.lowPSF) + ' – ' + money0(est.totals.highPSF);
  const psfSecondary = 'All-in $/SF';

  const basePrimary   = money0(est.base.structureCost);
  const baseSecondary = 'Base $/SF: ' + money0(est.totals.structurePSFout);

  drawKPIv2(
    doc,
    margin + 0 * (kpiW + gap),
    kpiY,
    kpiW,
    kpiH,
    { label: 'Estimated range', primary: rangePrimary, secondary: rangeSecondary },
    colors
  );

  drawKPIv2(
    doc,
    margin + 1 * (kpiW + gap),
    kpiY,
    kpiW,
    kpiH,
    { label: '$ / SF', primary: psfPrimary, secondary: psfSecondary },
    colors
  );

  drawKPIv2(
    doc,
    margin + 2 * (kpiW + gap),
    kpiY,
    kpiW,
    kpiH,
    { label: 'Base dome shell', primary: basePrimary, secondary: baseSecondary },
    colors
  );

  // Assumptions card
  let y = kpiY + kpiH + 28;
  const cardR = 10;
  const colGap = 28;
  const colW = (maxW - colGap) / 2;
  const rowH = 18;

  const rows = buildAssumptionsRows(inp, est, money0);
  const left  = rows.slice(0, Math.ceil(rows.length / 2));
  const right = rows.slice(Math.ceil(rows.length / 2));
  const rowsPerCol = Math.ceil(rows.length / 2);
  const neededH = 24 + rowsPerCol * rowH + 32;
  const cardH = Math.max(neededH, 170);

  doc.setDrawColor(colors.line[0], colors.line[1], colors.line[2]);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin - 8, y - 14, maxW + 16, cardH, cardR, cardR, 'F');

  // Card header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(colors.navy[0], colors.navy[1], colors.navy[2]);
  doc.text('Assumptions', margin, y);

  // Columns
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  function drawAssumptionColumn(arr, x, yy) {
    arr.forEach((pair, i) => {
      const lineY = yy + i * rowH;
      const label = pair[0] + ':';
      const val = pair[1];

      // bullet
      doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
      doc.circle(x + 3, lineY - 3.5, 2, 'F');

      // label
      doc.setTextColor(colors.navy[0], colors.navy[1], colors.navy[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(label, x + 12, lineY);

      // value
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60);
      const lblW = doc.getTextWidth(label + '  ');
      const wrap = doc.splitTextToSize(String(val), colW - 12 - lblW);
      doc.text(wrap, x + 12 + lblW, lineY);
    });
  }

  const colY = y + 24;
  drawAssumptionColumn(left,  margin,                 colY);
  drawAssumptionColumn(right, margin + colW + colGap, colY);

  drawFooter(doc);

  /* ---- Breakdown page ---- */
  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0);
  doc.text('Line-Item Breakdown', margin, 64);

  const body = [];
  let currentCat = null;

  function sectionRow(title) {
    return [{
      content: '— ' + title + ' —',
      colSpan: 4,
      styles: { halign: 'left', fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' }
    }];
  }
  function spacerRow() {
    return [{
      content: ' ',
      colSpan: 4,
      styles: { halign: 'left', fillColor: [255, 255, 255], textColor: 255 }
    }];
  }

  est.items.forEach((it) => {
    if (it.cat !== currentCat) {
      currentCat = it.cat;
      body.push(sectionRow(currentCat));
    }
    body.push([it.name, it.desc, money0(it.low), money0(it.high)]);
  });

  body.push(spacerRow());
  body.push(['Subtotal (pre contingency)', 'All line items above', money0(est.totals.preLow), money0(est.totals.preHigh)]);
  body.push(spacerRow());
  body.push(['Contingency', (est.inp.contPct * 100).toFixed(1) + '%', money0(est.totals.contLow), money0(est.totals.contHigh)]);
  body.push(spacerRow());
  if (est.parts.optsSum) {
    body.push(['Optional systems', (est.parts.optLabels || []).join(' + '), money0(est.parts.optsSum), money0(est.parts.optsSum)]);
    body.push(spacerRow());
  }
  const withContLow  = est.totals.preLow + est.totals.contLow + (est.parts.optsSum || 0);
  const withContHigh = est.totals.preHigh + est.totals.contHigh + (est.parts.optsSum || 0);
  const spreadLow  = withContLow  * (-0.05);
  const spreadHigh = withContHigh * (0.07);
  body.push(['Range spread', '-5% / +7%', money0(spreadLow), money0(spreadHigh)]);
  body.push(spacerRow());
  body.push(['Total (rounded)', 'Low / High', money0(est.totals.low), money0(est.totals.high)]);

  doc.autoTable({
    startY: 78,
    head: [['Item', 'Description', 'Low', 'High']],
    body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 6, overflow: 'linebreak', lineColor: [230, 234, 240], lineWidth: 0.5 },
    headStyles: { fillColor: [248, 250, 252], textColor: 33, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [252, 253, 255] },
    columnStyles: { 0: { cellWidth: 180 }, 1: { cellWidth: 'auto' }, 2: { halign: 'right', cellWidth: 90 }, 3: { halign: 'right', cellWidth: 90 } },
    margin: { left: 44, right: 44 },
    didDrawPage: function () { drawFooter(doc); }
  });

  saveOrOpenPDF(doc, 'ICD-Estimate-NAVY.pdf');
}


/* ---------------- Wiring ---------------- */
whenReady(['ce_region'], function () {
  $('ce_region').addEventListener('change', applyRegionPreset);
});
whenReady(['ce_regionIdx','ce_regionIdxVal'], function () {
  $('ce_regionIdx').addEventListener('input', function (e) {
    updateRegionIdxBadge(); updateRangeFill(e.target);
  });
  updateRegionIdxBadge(); updateRangeFill($('ce_regionIdx'));
});
whenReady(['ce_optDriveway','ce_driveLen'], function () {
  $('ce_optDriveway').addEventListener('change', toggleDrivewayInputs);
});

whenReady(['ce_calcBtn'], function () {
  $('ce_calcBtn').addEventListener('click', function () {
    var inp = getInputs();
    var est = compute(inp);
    lastInputs = inp; lastEstimate = est;
    render(est);
    if (inp && inp.sf > 0) persistInputs(inp);
  });
});

whenReady(['ce_clearBtn'], function () {
  $('ce_clearBtn').addEventListener('click', function () {
    // basic fields
    ['ce_sf','ce_driveLen','ce_diameter','ce_ncDomes','ce_ncSf','ce_bedrooms'].forEach(function (id) {
      var el = $(id); if (el) el.value = "";
    });

    if ($('ce_region')) { $('ce_region').value = "1.00"; applyRegionPreset(); }
    if ($('ce_finish')) $('ce_finish').value = "1.00";
    if ($('ce_domes')) $('ce_domes').value = "1";
    if ($('ce_height')) $('ce_height').value = "std";
    if ($('ce_glazing')) $('ce_glazing').value = "0.20";
    if ($('ce_basement')) $('ce_basement').value = "none";
    if ($('ce_site')) $('ce_site').value = "flat";
    if ($('ce_mep')) $('ce_mep').value = "standard";
    if ($('ce_baths')) $('ce_baths').value = "2";
    if ($('ce_incSitework')) $('ce_incSitework').checked = true;

    // options
    ['ce_optSolar','ce_optStorage','ce_optRain','ce_optSeptic','ce_optHydronic','ce_optDriveway'].forEach(function (id) {
      var el = $(id); if (el) el.checked = false;
    });

    if ($('ce_shellThk')) $('ce_shellThk').value = "4";
    if ($('ce_mixType')) $('ce_mixType').value = "std";
    if ($('ce_oculusCount')) $('ce_oculusCount').value = "0";
    if ($('ce_connector')) $('ce_connector').value = "none";
    if ($('ce_remote')) $('ce_remote').value = "easy";
    if ($('ce_inflationPower')) $('ce_inflationPower').value = "onsite";
    if ($('ce_contPct')) $('ce_contPct').value = "10";

    clearInputsStore();

    var zero = {
      totals: { low: 0, high: 0, lowPSF: 0, highPSF: 0, structurePSFout: 0, preLow: 0, preHigh: 0, contLow: 0, contHigh: 0 },
      base: { structureCost: 0, glazingCost: 0, basementLow: 0, basementHigh: 0 },
      parts: { regionFactor: 1, optsSum: 0, optLabels: [], shell: null, sitework: { low: 0, high: 0, included: true } },
      items: [],
      inp: {
        finish: 1, glazing: .2, domes: '1', height: 'std', site: 'flat', mep: 'standard',
        sf: 0, contPct: 0.10, opts: {}, baths: 2, bedrooms: 0, expectedBaths: 1,
        drivewayLen: 0, includeSitework: true, basement: 'none',
        shellThk: 4, mixType: "std", oculusCount: 0, connector: "none",
        remote: "easy", inflationPower: "onsite", ncDomes: 0, ncSf: 0
      }
    };
    lastEstimate = zero; lastInputs = zero.inp;
    render(zero);
    toggleDrivewayInputs();
    updateRegionIdxBadge();
    updateRangeFill($('ce_regionIdx'));
  });
});

whenReady(['ce_printBtn'], function () {
  $('ce_printBtn').addEventListener('click', async function () {
    var inp = lastInputs || getInputs();
    if (!inp || !inp.sf) { alert("Enter square footage and click Calculate first."); return; }
    persistInputs(inp);
    if (!isPaid()) { openPaywall(); return; }
    var est = lastEstimate || compute(inp);
    if (!lastEstimate) { render(est); lastEstimate = est; lastInputs = inp; }
    try { await exportPDF(inp, est); hideUnlockToast(); } 
    catch (err) { console.error(err); alert('Could not create the PDF.'); }
  });
});

/* Sticky toast button → triggers the Export button */
whenReady(['icdce_unlocked_btn'], function () {
  $('icdce_unlocked_btn').addEventListener('click', function () {
    $('ce_printBtn')?.click();
  });
});

/* ---------------- Paywall modal wiring ---------------- */
whenReady(['pw_payBtn','pw_closeBtn','pw_apply','pw_code','pw_msg'], function (payBtn, closeBtn, applyBtn, codeInput, msg) {
  payBtn.addEventListener('click', gotoCheckout);
  closeBtn.addEventListener('click', closePaywall);
  applyBtn.addEventListener('click', function () {
    var code = (codeInput.value || '').trim();
    if (!ACCESS_CODE) { msg.textContent = "Access code is not enabled. Use the checkout button above."; return; }
    if (code && code.toLowerCase() === ACCESS_CODE.toLowerCase()) {
      setPaid();
      msg.textContent = "Access granted. You can now export the PDF.";
      setTimeout(closePaywall, 600);
      unhideActions();
      ensureJsPDF().catch(() => {});
      showUnlockToast();
      applyGates(); // immediately unlock UI
    } else {
      msg.textContent = "That code didn’t match. Please try again or use checkout.";
    }
  });
});

/* ---------------- Init: restore state and first render ---------------- */
(function tryRestoreOnLoad() {
  const saved = readInputsFromStore();
  if (saved) {
    fillFormFromInputs(saved);
    const est = compute(saved);
    lastInputs = saved; lastEstimate = est;
    render(est);
  } else {
    render({
      totals: { low: 0, high: 0, lowPSF: 0, highPSF: 0, structurePSFout: 0, preLow: 0, preHigh: 0, contLow: 0, contHigh: 0 },
      base: { structureCost: 0, glazingCost: 0, basementLow: 0, basementHigh: 0 },
      parts: { regionFactor: 1, optsSum: 0, optLabels: [], shell: null, sitework: { low: 0, high: 0, included: true } },
      items: [],
      inp: {
        finish: 1, glazing: .2, domes: '1', height: 'std', site: 'flat', mep: 'standard',
        sf: 0, contPct: 0.10, opts: {}, baths: 2, bedrooms: 0, expectedBaths: 1,
        drivewayLen: 0, includeSitework: true, basement: 'none',
        shellThk: 4, mixType: "std", oculusCount: 0, connector: "none",
        remote: "easy", inflationPower: "onsite", ncDomes: 0, ncSf: 0
      }
    });
  }
  unhideActions();   // show the floating action bar for everyone
applyGates();      // STILL locks premium sections until paid
})();

/* First-run UI nits */
applyRegionPreset();
toggleDrivewayInputs();
updateRegionIdxBadge();
updateRangeFill($('ce_regionIdx'));

/* ---------------- Stripe return handler ---------------- */
(function checkPaidReturn() {
  try {
    const usp = new URLSearchParams(window.location.search);
    const val = usp.get(SUCCESS_PARAM);
    if (val === '1' || val === 'true') {
      setPaid();

      // Clean URL to avoid re-trigger on refresh
      if (history && history.replaceState) {
        usp.delete(SUCCESS_PARAM);
        const clean = window.location.pathname + (usp.toString() ? '?' + usp.toString() : '');
        history.replaceState({}, document.title, clean);
      }

      const saved = readInputsFromStore();
      if (saved) {
        fillFormFromInputs(saved);
        lastInputs = saved;
        lastEstimate = compute(saved);
        render(lastEstimate);
      }

      unhideActions();
      ensureJsPDF().catch(() => {}); // warm-up
      showUnlockToast();
      applyGates(); // unlock UI on return
    }
  } catch (e) {}
})();





  




  






  
