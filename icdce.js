/* ===== ICD Cost Estimator — Contingency-only, colored slider, PDF, Paywall ===== */
document.addEventListener('DOMContentLoaded', function () {
  /* ---------- Small utilities ---------- */
  function whenReady(ids, cb, attempts = 20) {
    const els = ids.map(id => document.getElementById(id));
    if (els.every(Boolean)) { cb.apply(null, els); return; }
    if (attempts <= 0) return;
    setTimeout(function () { whenReady(ids, cb, attempts - 1); }, 100);
  }
  function $(id) { return document.getElementById(id); }
  function tryJSON(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }

  /* ---------- Paywall / Persistence Config (edit these) ---------- */
  // Your Stripe Payment Link (no params added here)
  const PAY_URL = 'https://buy.stripe.com/4gMdR95Gl9cdddLch09MY00';
  // Stripe should return users to this page with ?paid=1 (configure in Stripe Payment Link settings)
  const SUCCESS_PARAM = 'paid';
  // Optional access code for manual unlock; set '' to disable
  const ACCESS_CODE = 'FREE99';
  // localStorage keys
  const STORE_KEY_PAID   = 'icdce_paid_test1d';
  const STORE_KEY_INPUTS = 'icdce_inputs_v1';

  /* ---------- Paywall helpers ---------- */
  function isPaid() { return tryJSON(() => localStorage.getItem(STORE_KEY_PAID) === 'yes', false); }
  function setPaid() { tryJSON(() => localStorage.setItem(STORE_KEY_PAID, 'yes')); }
  function clearPaid() { tryJSON(() => localStorage.removeItem(STORE_KEY_PAID)); }

  // Restore saved inputs (if any)
  function loadSavedInputs() {
    return tryJSON(() => JSON.parse(localStorage.getItem(STORE_KEY_INPUTS) || 'null'), null);
  }
  function saveInputs(inp) {
    tryJSON(() => localStorage.setItem(STORE_KEY_INPUTS, JSON.stringify(inp)));
  }

  // If redirected back with ?paid=1/true → mark paid and clean URL (but do NOT clear saved inputs)
  (function checkPaidReturn() {
    const usp = new URLSearchParams(window.location.search || '');
    const val = usp.get(SUCCESS_PARAM);
    if (val === '1' || val === 'true') {
      setPaid();
      // Clean the URL so refreshing doesn’t keep re-triggering this
      if (history && history.replaceState) {
        usp.delete(SUCCESS_PARAM);
        const clean = window.location.pathname + (usp.toString() ? '?' + usp.toString() : '');
        history.replaceState({}, document.title, clean);
      }
    }
  })();

  // Improved paywall navigation with layered fallbacks (top nav, new tab, anchor click, same-frame)
  function openPaywall() {
    const el = $('icdce_paywall');
    if (el) {
      // If a local paywall modal exists in the page, show it. That is the preferred UX.
      el.style.display = 'flex';
      el.setAttribute('aria-hidden', 'false');
      return;
    }

    // No in-page modal available — attempt to navigate to the Stripe payment link.
    // Many site builders (GoDaddy preview/editor) load pages in sandboxed iframes which block
    // top-level navigation or window.open. We'll try a few strategies in order and fall back to
    // a user-visible message if none succeed.
    try {
      // 1) Try top-level navigation (best for regular sites)
      (window.top || window).location.assign(PAY_URL);
      return;
    } catch (e) {
      console.warn('Top navigation to checkout blocked, trying fallbacks', e);
    }

    try {
      // 2) Try opening a new tab/window (should be allowed when invoked by a user click)
      var w = window.open(PAY_URL, '_blank', 'noopener');
      if (w) { try { w.focus(); } catch (_) {} ; return; }
    } catch (e) {
      console.warn('window.open to checkout blocked', e);
    }

    try {
      // 3) Anchor click fallback (programmatic click on an <a target="_blank">)
      var a = document.createElement('a');
      a.href = PAY_URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    } catch (e) {
      console.warn('Anchor click to checkout blocked', e);
    }

    try {
      // 4) Last resort: navigate the current frame (may be allowed when others are blocked)
      window.location.href = PAY_URL;
      return;
    } catch (e) {
      console.warn('Fallback current-frame navigation blocked', e);
    }

    // If everything is blocked (common in sandboxed preview iframes), inform the user with an explicit link
    try {
      alert('Could not open the checkout window automatically (this can happen in site editors or sandboxed previews). Please open this link in a new tab to complete payment:\n\n' + PAY_URL);
    } catch (e) {
      // If even alert is blocked, put link on console
      console.error('Could not open checkout automatically. Please visit: ' + PAY_URL);
    }
  }

  function closePaywall() {
    const el = $('icdce_paywall');
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }

  function gotoCheckout() {
    // Save current inputs before leaving so we can restore after return
    const inp = getInputs();
    if (inp && (inp.sf || 0) > 0) saveInputs(inp);

    // Use same robust navigation strategy as openPaywall (so checkout works even inside builders)
    try {
      (window.top || window).location.assign(PAY_URL);
      return;
    } catch (e) {
      console.warn('Top navigation blocked in gotoCheckout', e);
    }

    try {
      var w = window.open(PAY_URL, '_blank', 'noopener');
      if (w) { try { w.focus(); } catch (_) {} ; return; }
    } catch (e) {
      console.warn('window.open blocked in gotoCheckout', e);
    }

    try {
      var a = document.createElement('a');
      a.href = PAY_URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    } catch (e) {
      console.warn('Anchor click blocked in gotoCheckout', e);
    }

    try {
      window.location.href = PAY_URL;
      return;
    } catch (e) {
      console.warn('Final fallback navigation blocked in gotoCheckout', e);
    }

    try {
      alert('Could not open checkout automatically. Please open this link in a new tab to complete payment:\n\n' + PAY_URL);
    } catch (e) {
      console.error('Could not open checkout. Please visit: ' + PAY_URL);
    }
  }

  /* ---------- Estimator Config & Helpers ---------- */
  var CONFIG = {
    priceCal: 0.93,
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
      solar: 20000, storage: 18000, geo: 45000,
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
      generatorRentalLump: [900, 1800],
      remoteLogisticsAdderLump: { easy: [0, 0], moderate: [1800, 3600], remote: [6000, 12000] },
      transitionWaterproofLump: [900, 1800],
      lightningProtectionLump: [1200, 2200]
    },
    shellThicknessMult: { 4: 1.00, 5: 1.12, 6: 1.25 },
    mixTypeMult: { std: 1.00, pozz: 1.06, hemp: 1.18 }
  };

  function money(n) { return "$" + (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function money0(n) { return "$" + (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function cal(v) { return v * CONFIG.priceCal; }

  var lastEstimate = null, lastInputs = null;

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
      baths: Math.max(1, +($('ce_baths')?.value || 2)),
      includeSitework: !!$('ce_incSitework')?.checked,
      opts: {
        solar: !!$('ce_optSolar')?.checked, storage: !!$('ce_optStorage')?.checked, geo: !!$('ce_optGeo')?.checked,
        rain: !!$('ce_optRain')?.checked, septic: !!$('ce_optSeptic')?.checked, hydronic: !!$('ce_optHydronic')?.checked,
        driveway: !!$('ce_optDriveway')?.checked
      },
      drivewayLen: Math.max(0, Math.min(+($('ce_driveLen')?.value || 0), CONFIG.options.drivewayMaxFt)),
      contPct: (+($('ce_contPct')?.value || 10)) / 100, // contingency only (default 10%)
      diameter: +($('ce_diameter')?.value || 0),
      shellThk: +($('ce_shellThk')?.value || 4),
      mixType: $('ce_mixType')?.value || "std",
      oculusCount: +($('ce_oculusCount')?.value || 0),
      connector: $('ce_connector')?.value || "none",
      remote: $('ce_remote')?.value || "easy",
      inflationPower: $('ce_inflationPower')?.value || "onsite",
      lightning: !!$('ce_lightning')?.checked
    };
  }

  function setInputs(inp) {
    // Populate UI controls from a saved input object
    if (!inp) return;
    function setVal(id, val) { const el = $(id); if (el) el.value = val; }
    function setChk(id, val) { const el = $(id); if (el) el.checked = !!val; }

    setVal('ce_sf', inp.sf);
    setVal('ce_region', String(inp.regionPreset || 1));
    setVal('ce_regionIdx', String(inp.regionIdx || 1));
    setVal('ce_finish', String(inp.finish || 1));
    setVal('ce_domes', inp.domes || '1');
    setVal('ce_height', inp.height || 'std');
    setVal('ce_glazing', String(inp.glazing || 0.2));
    setVal('ce_basement', inp.basement || 'none');
    setVal('ce_site', inp.site || 'flat');
    setVal('ce_mep', inp.mep || 'standard');
    setVal('ce_baths', String(inp.baths || 2));
    setChk('ce_incSitework', inp.includeSitework);
    if (inp.opts) {
      setChk('ce_optSolar', inp.opts.solar);
      setChk('ce_optStorage', inp.opts.storage);
      setChk('ce_optGeo', inp.opts.geo);
      setChk('ce_optRain', inp.opts.rain);
      setChk('ce_optSeptic', inp.opts.septic);
      setChk('ce_optHydronic', inp.opts.hydronic);
      setChk('ce_optDriveway', inp.opts.driveway);
    }
    setVal('ce_driveLen', String(inp.drivewayLen || 0));
    setVal('ce_contPct', String(Math.round((inp.contPct || 0.10) * 1000) / 10));
    setVal('ce_diameter', String(inp.diameter || 0));
    setVal('ce_shellThk', String(inp.shellThk || 4));
    setVal('ce_mixType', inp.mixType || 'std');
    setVal('ce_oculusCount', String(inp.oculusCount || 0));
    setVal('ce_connector', inp.connector || 'none');
    setVal('ce_remote', inp.remote || 'easy');
    setVal('ce_inflationPower', inp.inflationPower || 'onsite');
    setChk('ce_lightning', inp.lightning);

    // Visual helpers
    updateRangeFill($('ce_regionIdx'));
    updateRegionIdxBadge();
    toggleDrivewayInputs();
  }

  function bathFactors(inp) {
    var expected = Math.max(1, Math.round((inp.sf || 0) / 900));
    var delta = (inp.baths || expected) - expected;
    function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
    var bathPF = clamp(1 + 0.07 * delta, 0.85, 1.25);
    var bathUF = clamp(1 + 0.03 * delta, 0.90, 1.15);
    var bathSF = clamp(1 + 0.03 * delta, 0.90, 1.15);
    return { expected, delta, bathPF, bathUF, bathSF };
  }

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

  function compute(inp) {
    var regionFactor = inp.regionIdx || inp.regionPreset || 1;

    // Base dome shell
    var shell = computeBaseShell(inp, regionFactor);
    var structureCost = shell.totalMid;

    // Glazing
    var shellSurfaceSF = inp.sf * CONFIG.glazingEnvelopeSFPerInteriorSF;
    var glazingSF = shellSurfaceSF * inp.glazing;
    var glazingUnit = CONFIG.glazingCostPerSF[inp.glazing] || 0;
    var glazingCost = cal(glazingSF * glazingUnit * regionFactor);

    // Basement
    var adder = CONFIG.basementAdders[inp.basement] || [0, 0];
    var cov = inp.basement === 'partial' ? 0.5 : (inp.basement === 'full' ? 1 : 0);
    var basementLow = cal(adder[0] * inp.sf * cov * regionFactor);
    var basementHigh = cal(adder[1] * inp.sf * cov * regionFactor);

    // Other multipliers
    var siteMultItems = CONFIG.multipliers.site[inp.site] || 1;
    var mepMultItems = CONFIG.multipliers.mep[inp.mep] || 1;
    var finishMultItems = CONFIG.finish[inp.finish] || 1;
    var bf = bathFactors(inp);

    function psf(loHi) { return [cal(loHi[0] * regionFactor), cal(loHi[1] * regionFactor)]; }
    function psfSite(loHi) { var p = psf(loHi); return [p[0] * siteMultItems, p[1] * siteMultItems]; }
    function psfFinish(loHi) { var p = psf(loHi); return [p[0] * finishMultItems, p[1] * finishMultItems]; }
    function psfMEP(loHi) { var p = psf(loHi); return [p[0] * mepMultItems, p[1] * mepMultItems]; }
    function lump(loHi, mult) { mult = mult || 1; return [cal(loHi[0] * regionFactor * mult), cal(loHi[1] * regionFactor * mult)]; }

    var I = CONFIG.unitCosts;
    var items = [];

    // PRE-CONSTRUCTION
    var a = psf(I.designDocsPSF); items.push({ cat: "Pre-Construction", name: "Design & Construction Documents", desc: "Full architecture/engineering and coordinated construction drawings", low: a[0] [...]
    var b = psf(I.permitsFeesPSF); items.push({ cat: "Pre-Construction", name: "Permits & Agency Fees", desc: "Plan review, building permit, utility/tap fees where applicable", low: b[0] * inp.sf, hig[...]
    var c = lump(I.surveyGeotechLump, siteMultItems); items.push({ cat: "Pre-Construction", name: "Survey & Geotechnical", desc: "Boundary/topographic survey and geotechnical (soils) report", low: c[0[...]
    var d = lump(I.mobilizationLump, siteMultItems); items.push({ cat: "Pre-Construction", name: "Mobilization", desc: "Staging, temporary power/water, delivery logistics setup", low: d[0], high: d[1][...]

    // SITE & FOUNDATION (non-shell)
    var siteworkPSF = psfSite(I.siteworkPSF);
    var siteworkLow = inp.includeSitework ? siteworkPSF[0] * inp.sf : 0;
    var siteworkHigh = inp.includeSitework ? siteworkPSF[1] * inp.sf : 0;
    items.push({ cat: "Site & Foundation", name: "Sitework & Rough Grading", desc: (inp.includeSitework ? "Clearing, rough grading, temporary access, erosion control" : "Excluded (by owner/others)"), [...]

    b = psfSite(I.utilitiesStubPSF); b[0] *= bf.bathUF; b[1] *= bf.bathUF;
    items.push({ cat: "Site & Foundation", name: "Utilities Stub-ins", desc: "Trenching and laterals for water/septic/electric to the shell", low: b[0] * inp.sf, high: b[1] * inp.sf });

    var f = psfSite(I.foundationPSF);
    items.push({ cat: "Site & Foundation", name: "Foundation / Slab / Footings", desc: "Footings, slab, anchors — basement costs shown separately", low: f[0] * inp.sf, high: f[1] * inp.sf });

    items.push({ cat: "Site & Foundation", name: "Basement", desc: inp.basement === 'none' ? 'None (slab only)' : inp.basement === 'partial' ? 'Partial (~50% footprint)' : 'Full (~100% footprint)', lo[...]

    // CORE STRUCTURE (shell)
    items.push({ cat: "Core Structure", name: "Base Dome Shell (Airform, Foam, Rebar, Shotcrete)", desc: "Airform membrane, spray foam insulation, rebar, shotcrete structural shell (multipliers: regio[...]

    if (inp.oculusCount > 0) {
      var oculus = lump(I.oculusCurbLumpPerEa);
      items.push({ cat: "Core Structure", name: "Oculus/Skylights Curbs", desc: inp.oculusCount + " unit" + (inp.oculusCount === 1 ? "" : "s"), low: oculus[0] * inp.oculusCount, high: oculus[1] * inp.[...]
    }
    if (inp.connector !== "none") {
      var connectorLump = inp.connector === "short" ? I.connectorShellShort : inp.connector === "med" ? I.connectorShellMed : I.connectorShellLong;
      var connectorCost = lump(connectorLump);
      items.push({ cat: "Core Structure", name: "Connector / Tunnel (Shell)", desc: inp.connector.charAt(0).toUpperCase() + inp.connector.slice(1) + " connector", low: connectorCost[0], high: connecto[...]
    }

    // EXTERIOR
    a = psfFinish(I.exteriorFinishPSF);
    items.push({ cat: "Exterior", name: "Exterior Finishes / Coatings", desc: "Membrane topcoat/paint and trims at shell openings", low: a[0] * inp.sf, high: a[1] * inp.sf });
    var transWp = lump(I.transitionWaterproofLump);
    items.push({ cat: "Exterior", name: "Transition Waterproofing at Openings", desc: "Waterproofing transitions around openings", low: transWp[0], high: transWp[1] });
    items.push({ cat: "Exterior", name: "Windows & Glazed Openings", desc: (inp.glazing * 100).toFixed(0) + "% of shell surface @ $" + (CONFIG.glazingCostPerSF[inp.glazing] || 0) + "/SF", low: glazing[...]

    // INTERIORS
    a = psfFinish(I.interiorFramingPSF); items.push({ cat: "Interiors", name: "Interior Framing & Partitions", desc: "Non-structural partitions and basic framing details", low: a[0] * inp.sf, high: a[[...]
    b = psfFinish(I.insulDrywallPSF); items.push({ cat: "Interiors", name: "Insulation & Drywall", desc: "Thermal/sound insulation plus drywall hang, tape and texture", low: b[0] * inp.sf, high: b[1] [...]
    c = psfFinish(I.flooringFinishesPSF); items.push({ cat: "Interiors", name: "Flooring & Interior Finishes", desc: "LVT/tile/carpet, interior paint and finish carpentry", low: c[0] * inp.sf, high: c[...]
    d = psfFinish(I.millworkDoorsPSF); items.push({ cat: "Interiors", name: "Millwork, Interior Doors & Trim", desc: "Interior doors, casing/base, basic built-ins/shelving", low: d[0] * inp.sf, high: d[...]

    // SYSTEMS (MEP)
    a = psfMEP(I.plumbingPSF); a[0] *= bf.bathPF; a[1] *= bf.bathPF; items.push({ cat: "Systems (MEP)", name: "Plumbing (rough-in + fixtures)", desc: "Supply/drain/vent, water heater and standard plum[...]
    b = psfMEP(I.electricalPSF); b[0] *= bf.bathPF; b[1] *= bf.bathPF; items.push({ cat: "Systems (MEP)", name: "Electrical (rough-in + devices)", desc: "Service/panels, branch circuits, devices and l[...]
    c = psfMEP(I.hvacPSF); items.push({ cat: "Systems (MEP)", name: "HVAC / Mechanical", desc: "Heat pump/furnace/air handler and distribution (ducted/ductless)", low: c[0] * inp.sf, high: c[1] * inp.[...]
    d = psfMEP(I.specialSystemsPSF); d[0] *= bf.bathSF; d[1] *= bf.bathSF; items.push({ cat: "Systems (MEP)", name: "Special Systems", desc: "ERV/HRV, simple controls and minor low-voltage allowances"[...]

    // ALLOWANCES
    a = psfFinish(I.kitchenBathPSF); items.push({ cat: "Allowances", name: "Kitchens & Baths Package", desc: "Cabinetry, counters, tile and shower glass finishes", low: a[0] * inp.sf, high: a[1] * inp[...]
    b = lump(I.appliancesLump, finishMultItems); items.push({ cat: "Allowances", name: "Appliances", desc: "Typical kitchen + laundry appliance package", low: b[0], high: b[1] });

    // Site additions
    if (inp.inflationPower === "generator") {
      var genRental = lump(I.generatorRentalLump);
      items.push({ cat: "Site & Foundation", name: "Inflation Power (Generator rental)", desc: "Generator rental for inflation power", low: genRental[0], high: genRental[1] });
    }
    var remoteLump = lump(I.remoteLogisticsAdderLump[inp.remote], siteMultItems);
    items.push({ cat: "Site & Foundation", name: "Remote Logistics / Access", desc: "Access/logistics cost for remote sites (" + inp.remote + ")", low: remoteLump[0], high: remoteLump[1] });

    // Optional systems
    var optLabels = [], optsSum = 0;
    if (inp.opts.solar) { optsSum += cal(CONFIG.options.solar * regionFactor); optLabels.push('Solar PV'); }
    if (inp.opts.storage) { optsSum += cal(CONFIG.options.storage * regionFactor); optLabels.push('Battery Storage'); }
    if (inp.opts.geo) { optsSum += cal(CONFIG.options.geo * regionFactor); optLabels.push('Geothermal'); }
    if (inp.opts.rain) { optsSum += cal(CONFIG.options.rain * regionFactor); optLabels.push('Rainwater collection / cistern'); }
    if (inp.opts.hydronic) { optsSum += cal(CONFIG.options.hydronic * regionFactor); optLabels.push('Hydronic Radiant Floors'); }
    if (inp.opts.septic) {
      var septicCost = cal(CONFIG.options.septic * regionFactor * (CONFIG.site[inp.site] || 1));
      optsSum += septicCost; optLabels.push('Septic');
    }
    if (inp.opts.driveway && inp.drivewayLen > 0) {
      var len = Math.min(inp.drivewayLen, CONFIG.options.drivewayMaxFt);
      var drivewayCost = cal(len * CONFIG.options.drivewayPerFt * regionFactor * (CONFIG.site[inp.site] || 1));
      optsSum += drivewayCost; optLabels.push("Driveway (~" + len + " ft)");
    }

    if (inp.lightning) {
      var lightningCost = lump(I.lightningProtectionLump);
      items.push({ cat: "Closeout & Site Services", name: "Lightning Protection / Grounding", desc: "Provision for lightning protection", low: lightningCost[0], high: lightningCost[1] });
    }

    // Totals (Contingency only)
    var preLow = items.reduce((a, it) => a + it.low, 0);
    var preHigh = items.reduce((a, it) => a + it.high, 0);
    var contLow = preLow * (inp.contPct || 0);
    var contHigh = preHigh * (inp.contPct || 0);
    var low = (preLow + contLow + optsSum) * (1 + CONFIG.rangeLowPct);
    var high = (preHigh + contHigh + optsSum) * (1 + CONFIG.rangeHighPct);

    return {
      inp: Object.assign({}, inp, { expectedBaths: bf.expected }),
      parts: {
        regionFactor,
        optsSum, optLabels,
        shell: shell,
        sitework: { low: siteworkLow, high: siteworkHigh, included: inp.includeSitework }
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

  function render(est) {
    var inp = est.inp;
    if (!inp.sf) {
      $('ce_rangeTotal') && ($('ce_rangeTotal').textContent = "$0 – $0");
      $('ce_rangePerSf') && ($('ce_rangePerSf').textContent = "$/SF: $0 – $0");
      $('ce_baseTotal') && ($('ce_baseTotal').textContent = "$0");
      $('ce_basePsf') && ($('ce_basePsf').textContent = "$/SF: $0");
      $('ce_siteworkTotal') && ($('ce_siteworkTotal').textContent = "$0 – $0");
      $('ce_siteworkNote') && ($('ce_siteworkNote').textContent = "Included");
      $('ce_assumptions') && ($('ce_assumptions').textContent = "Region 1.00 • Standard finish • Typical glazing • Single dome");
      if ($('ce_breakdown')) $('ce_breakdown').innerHTML = '<tr><td colspan="4" class="_muted" style="text-align:center;padding:18px">Run a calculation to see details.</td></tr>';
      return;
    }

    $('ce_rangeTotal') && ($('ce_rangeTotal').textContent = money(est.totals.low) + " – " + money(est.totals.high));
    $('ce_rangePerSf') && ($('ce_rangePerSf').textContent = "$/SF: " + money(est.totals.lowPSF) + " – " + money(est.totals.highPSF));
    $('ce_baseTotal') && ($('ce_baseTotal').textContent = money(est.base.structureCost));
    $('ce_basePsf') && ($('ce_basePsf').textContent = "$/SF: " + money(est.totals.structurePSFout));

    var sw = est.parts.sitework;
    $('ce_siteworkTotal') && ($('ce_siteworkTotal').textContent = money(sw.low) + " – " + money(sw.high));
    $('ce_siteworkNote') && ($('ce_siteworkNote').textContent = sw.included ? "Included" : "Excluded");

    var optStr = (est.parts.optLabels && est.parts.optLabels.length) ? (" • Options: " + est.parts.optLabels.join(', ')) : '';
    var basementStr = inp.basement === 'none' ? 'No basement (slab)' : inp.basement === 'partial' ? 'Partial basement (~50%)' : 'Full basement (~100%)';
    $('ce_assumptions') && ($('ce_assumptions').textContent =
      "Region " + est.parts.regionFactor.toFixed(2) +
      " • Finish " + inp.finish.toFixed(2) +
      " • " + (inp.glazing * 100).toFixed(0) + "% glazing" +
      " • " + inp.domes + " dome" + (inp.domes === '1' ? '' : 's') +
      " • " + (inp.height === 'tall' ? 'tall shell' : 'std shell') +
      " • " + basementStr +
      " • " + inp.site + " site" +
      " • " + (sw.included ? "Sitework included" : "Sitework excluded") +
      " • " + inp.mep + " MEP" +
      " • " + inp.baths + " bath" + (inp.baths > 1 ? 's' : '') + optStr +
      " • Shell " + inp.shellThk + "″" +
      " • Mix: " + (inp.mixType === 'pozz' ? 'Pozzolan' : (inp.mixType === 'hemp' ? 'Hempcrete' : 'Standard')) +
      (inp.connector !== "none" ? " • Connector: " + inp.connector : "") +
      (inp.oculusCount > 0 ? " • Oculus: " + inp.oculusCount : "") +
      " • Access: " + inp.remote +
      " • Inflation power: " + (inp.inflationPower === 'generator' ? 'Generator' : 'On-site')
    );

    var rows = [], currentCat = null;
    est.items.forEach(function (it) {
      if (it.cat !== currentCat) { currentCat = it.cat; rows.push(["— " + currentCat + " —", "", "", ""]); }
      rows.push([it.name, it.desc, it.low, it.high]);
    });

    rows.push(["Subtotal (pre contingency)", "All line items above", est.totals.preLow, est.totals.preHigh]);
    rows.push(["Contingency", (est.inp.contPct * 100).toFixed(1) + "%", est.totals.contLow, est.totals.contHigh]);

    if (est.parts.optsSum) { rows.push(["Optional systems", est.parts.optLabels.join(' + '), est.parts.optsSum, est.parts.optsSum]); }

    var withContLow = est.totals.preLow + est.totals.contLow + (est.parts.optsSum || 0);
    var withContHigh = est.totals.preHigh + est.totals.contHigh + (est.parts.optsSum || 0);
    var spreadLow = withContLow * (-0.05);
    var spreadHigh = withContHigh * (0.07);
    rows.push(["Range spread", "-5% / +7%", spreadLow, spreadHigh]);
    rows.push(["Total (rounded)", "Low / High", est.totals.low, est.totals.high]);

    if ($('ce_breakdown')) {
      $('ce_breakdown').innerHTML = rows.map(function (r) {
        var isDivider = (r[0] || "").indexOf("— ") === 0;
        if (isDivider) { return '<tr><td colspan="4" style="background:#f1f5f9;color:#0b1320;font-weight:700">' + r[0] + '</td></tr>'; }
        return '<tr><td>' + r[0] + '</td><td class="_muted">' + r[1] + '</td><td class="_right">' + money(r[2]) + '</td><td class="_right">' + money(r[3]) + '</td></tr>';
      }).join('');
    }
  }

  /* ---------- jsPDF Loader ---------- */
  function ensureJsPDF() {
    return new Promise(function (resolve, reject) {
      var hasCore = !!(window.jspdf && window.jspdf.jsPDF);
      var hasAT = !!(window.jspdf && window.jspdf.autoTable);
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

  function drawFooter(doc) {
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 44;
    var y = pageH - 40;
    doc.setDrawColor(230, 234, 240);
    doc.line(margin, y, pageW - margin, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110);
    var pageNo = doc.getCurrentPageInfo ? doc.getCurrentPageInfo().pageNumber : doc.internal.getNumberOfPages();
    doc.text('Planning-level estimate only. Not a bid. Final costs depend on site, engineering, and trade bids.', margin, y + 14);
    doc.text('Page ' + pageNo, pageW - margin, y + 14, { align: 'right' });
    doc.setTextColor(0);
  }

  function saveOrOpenPDF(doc, filename) {
    try {
      var fe = window.frameElement;
      var sandboxed = !!(fe && fe.hasAttribute('sandbox'));
      if (!sandboxed && ('download' in HTMLAnchorElement.prototype)) { doc.save(filename); return; }
    } catch (_) { }
    var blob = doc.output('blob');
    var url = URL.createObjectURL(blob);
    var w = window.open(url, '_blank', 'noopener');
    if (!w) alert('Popup blocked. Please allow pop-ups to download the PDF.');
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  async function exportPDF(inp, est) {
    await ensureJsPDF();
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });
    var margin = 44;
    var pageW = doc.internal.pageSize.getWidth();
    var maxW = pageW - margin * 2;
    var y = 64;

    // Cover summary
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    doc.text('ICD Cost Estimator™ — Planning Estimate', margin, y); y += 22;

    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100);
    doc.text('Generated ' + new Date().toLocaleString(), margin, y); doc.setTextColor(0); y += 24;

    doc.setDrawColor(230, 234, 240); doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin - 10, y - 10, maxW + 20, 120, 8, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Summary', margin, y + 12);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(24);
    doc.text('Estimated Range: ' + money0(est.totals.low) + ' – ' + money0(est.totals.high), margin, y + 46);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
    doc.text('$/SF: ' + money0(est.totals.lowPSF) + ' – ' + money0(est.totals.highPSF), margin, y + 70);
    doc.text('Base Dome Shell: ' + money0(est.base.structureCost) + '  •  Base $/SF: ' + money0(est.totals.structurePSFout), margin, y + 92);
    y += 140;

    // Assumptions
    var sw = est.parts.sitework;
    var swVal = sw.included ? (money0(sw.low) + ' – ' + money0(sw.high)) : 'Excluded';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text('Assumptions', margin, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90);
    var assumptions =
      'Region ' + est.parts.regionFactor.toFixed(2) +
      ' • Finish ' + est.inp.finish.toFixed(2) +
      ' • ' + (est.inp.glazing * 100).toFixed(0) + '% glazing' +
      ' • ' + est.inp.domes + ' dome' + (est.inp.domes === '1' ? '' : 's') +
      ' • ' + (est.inp.height === 'tall' ? 'tall shell' : 'std shell') +
      ' • ' + (est.inp.basement === 'none' ? 'No basement (slab)' : (est.inp.basement === 'partial' ? 'Partial basement (~50%)' : 'Full basement (~100%)')) +
      ' • ' + est.inp.site + ' site' +
      ' • Sitework: ' + swVal +
      ' • ' + est.inp.mep + ' MEP' +
      ' • ' + est.inp.baths + ' bath' + (est.inp.baths > 1 ? 's' : '') +
      " • Shell " + est.inp.shellThk + "″" +
      " • Mix: " + (est.inp.mixType === 'pozz' ? 'Pozzolan' : (est.inp.mixType === 'hemp' ? 'Hempcrete' : 'Standard')) +
      (est.inp.connector !== "none" ? " • Connector: " + est.inp.connector : "") +
      (est.inp.oculusCount > 0 ? " • Oculus: " + est.inp.oculusCount : "") +
      " • Access: " + est.inp.remote +
      " • Contingency: " + (est.inp.contPct * 100).toFixed(1) + "%" +
      " • Inflation power: " + (est.inp.inflationPower === 'generator' ? 'Generator' : 'On-site');
    var asumLines = doc.splitTextToSize(assumptions, maxW);
    doc.text(asumLines, margin, y + 16);
    doc.setTextColor(0);

    drawFooter(doc);

    // Line-Item page
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('Line-Item Breakdown', margin, 64);

    var body = [], currentCat = null;
    est.items.forEach(function (it) {
      if (it.cat !== currentCat) {
        currentCat = it.cat;
        body.push([{ content: '— ' + currentCat + ' —', colSpan: 4, styles: { halign: 'left', fillColor: [241, 245, 249], textColor: 20, fontStyle: 'bold' } }]);
      }
      body.push([it.name, it.desc, money0(it.low), money0(it.high)]);
    });

    body.push(['Subtotal (pre contingency)', 'All line items above', money0(est.totals.preLow), money0(est.totals.preHigh)]);
    body.push(['Contingency', (est.inp.contPct * 100).toFixed(1) + '%', money0(est.totals.contLow), money0(est.totals.contHigh)]);
    if (est.parts.optsSum) {
      body.push(['Optional systems', (est.parts.optLabels || []).join(' + '), money0(est.parts.optsSum), money0(est.parts.optsSum)]);
    }

    var withContLow = est.totals.preLow + est.totals.contLow + (est.parts.optsSum || 0);
    var withContHigh = est.totals.preHigh + est.totals.contHigh + (est.parts.optsSum || 0);
    var spreadLow = withContLow * (-0.05);
    var spreadHigh = withContHigh * (0.07);
    body.push(['Range spread', '-5% / +7%', money0(spreadLow), money0(spreadHigh)]);
    body.push(['Total (rounded)', 'Low / High', money0(est.totals.low), money0(est.totals.high)]);

    doc.autoTable({
      startY: 78,
      head: [['Category', 'Description', 'Low', 'High']],
      body,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 6, overflow: 'linebreak', lineColor: [230, 234, 240], lineWidth: .5 },
      headStyles: { fillColor: [248, 250, 252], textColor: 33, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [252, 253, 255] },
      columnStyles: { 0: { cellWidth: 180 }, 1: { cellWidth: 'auto' }, 2: { halign: 'right', cellWidth: 90 }, 3: { halign: 'right', cellWidth: 90 } },
      margin: { left: 44, right: 44 },
      didDrawPage: function () { drawFooter(doc); }
    });

    saveOrOpenPDF(doc, 'ICD-Estimate.pdf');
  }

  /* ---------- Slider fill helper (expects CSS using --fill) ---------- */
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
    if (slider && badge) badge.textContent = (+slider.value || 1).toFixed(02);
  }
  function toggleDrivewayInputs() {
    var cb = $('ce_optDriveway'); var len = $('ce_driveLen');
    if (!len) return;
    var checked = !!(cb && cb.checked);
    len.disabled = !checked;
    len.style.opacity = checked ? '1' : '0.6';
  }

  /* ---------- UI wiring ---------- */
  whenReady(['ce_region'], function () { $('ce_region').addEventListener('change', applyRegionPreset); });
  whenReady(['ce_regionIdx', 'ce_regionIdxVal'], function () {
    $('ce_regionIdx').addEventListener('input', function (e) { updateRegionIdxBadge(); updateRangeFill(e.target); });
    updateRegionIdxBadge(); updateRangeFill($('ce_regionIdx'));
  });
  whenReady(['ce_optDriveway', 'ce_driveLen'], function () { $('ce_optDriveway').addEventListener('change', toggleDrivewayInputs); });

  whenReady(['ce_calcBtn'], function () {
    $('ce_calcBtn').addEventListener('click', function () {
      var inp = getInputs();
      var est = compute(inp);
      // save inputs for restore (user will likely export right after)
      saveInputs(inp);
      lastInputs = inp; lastEstimate = est;
      render(est);
    });
  });

  // Clear (keeps paywall state in localStorage)
  whenReady(['ce_clearBtn'], function () {
    $('ce_clearBtn').addEventListener('click', function () {
      ['ce_sf', 'ce_driveLen'].forEach(function (id) { var el = $(id); if (el) el.value = ""; });
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
      ['ce_optSolar', 'ce_optStorage', 'ce_optGeo', 'ce_optRain', 'ce_optSeptic', 'ce_optHydronic', 'ce_optDriveway'].forEach(function (id) { var el = $(id); if (el) el.checked = false; });
      if ($('ce_diameter')) $('ce_diameter').value = "";
      if ($('ce_shellThk')) $('ce_shellThk').value = "4";
      if ($('ce_mixType')) $('ce_mixType').value = "std";
      if ($('ce_oculusCount')) $('ce_oculusCount').value = "0";
      if ($('ce_connector')) $('ce_connector').value = "none";
      if ($('ce_remote')) $('ce_remote').value = "easy";
      if ($('ce_inflationPower')) $('ce_inflationPower').value = "onsite";
      if ($('ce_lightning')) $('ce_lightning').checked = false;
      if ($('ce_contPct')) $('ce_contPct').value = "10";

      // wipe saved inputs
      tryJSON(() => localStorage.removeItem(STORE_KEY_INPUTS));

      var zero = {
        totals: { low: 0, high: 0, lowPSF: 0, highPSF: 0, structurePSFout: 0, preLow: 0, preHigh: 0, contLow: 0, contHigh: 0 },
        base: { structureCost: 0, glazingCost: 0, basementLow: 0, basementHigh: 0 },
        parts: { regionFactor: 1, optsSum: 0, optLabels: [], shell: null, sitework: { low: 0, high: 0, included: true } },
        items: [],
        inp: { finish: 1, glazing: .2, domes: '1', height: 'std', site: 'flat', mep: 'standard', sf: 0, contPct: 0.10, opts: {}, baths: 2, expectedBaths: 1, drivewayLen: 0, includeSitework: true, base[...]
      };
      lastEstimate = zero; lastInputs = zero.inp;
      render(zero);
      toggleDrivewayInputs();
      updateRegionIdxBadge();
      updateRangeFill($('ce_regionIdx'));
    });
  });

  // Export PDF (guarded by paywall)
  whenReady(['ce_printBtn'], function () {
    $('ce_printBtn').addEventListener('click', async function () {
      var inp = lastInputs || getInputs();
      if (!inp || !inp.sf) { alert("Enter square footage and click Calculate first."); return; }
      if (!isPaid()) { openPaywall(); return; }
      var est = lastEstimate || compute(inp);
      if (!lastEstimate) { render(est); lastEstimate = est; lastInputs = inp; }
      try { await exportPDF(inp, est); } catch (err) { console.error(err); alert('Could not create the PDF.'); }
    });
  });

  // Modal wiring (if present)
  whenReady(['pw_payBtn', 'pw_closeBtn', 'pw_apply', 'pw_code', 'pw_msg'], function (payBtn, closeBtn, applyBtn, codeInput, msg) {
    payBtn.addEventListener('click', gotoCheckout);
    closeBtn.addEventListener('click', closePaywall);
    applyBtn.addEventListener('click', function () {
      var code = (codeInput.value || '').trim();
      if (!ACCESS_CODE) {
        msg.textContent = "Access code is not enabled. Use the checkout button above.";
        return;
      }
      if (code && code.toLowerCase() === ACCESS_CODE.toLowerCase()) {
        setPaid();
        msg.textContent = "Access granted. You can now export the PDF.";
        setTimeout(closePaywall, 600);
      } else {
        msg.textContent = "That code didn’t match. Please try again or use checkout.";
      }
    });
  });

  /* ---------- Init: restore inputs if available, then render ---------- */
  (function init() {
    // Apply presets/visuals
    applyRegionPreset();
    toggleDrivewayInputs();
    updateRegionIdxBadge();
    updateRangeFill($('ce_regionIdx'));

    // If we have saved inputs, restore them and compute immediately (nice after Stripe return)
    const saved = loadSavedInputs();
    if (saved && (saved.sf || 0) > 0) {
      setInputs(saved);
      const freshInp = getInputs();
      const est = compute(freshInp);
      lastInputs = freshInp; lastEstimate = est;
      render(est);
    } else {
      // Initial blank render
      render({
        totals: { low: 0, high: 0, lowPSF: 0, highPSF: 0, structurePSFout: 0, preLow: 0, preHigh: 0, contLow: 0, contHigh: 0 },
        base: { structureCost: 0, glazingCost: 0, basementLow: 0, basementHigh: 0 },
        parts: { regionFactor: 1, optsSum: 0, optLabels: [], shell: null, sitework: { low: 0, high: 0, included: true } },
        items: [],
        inp: { finish: 1, glazing: .2, domes: '1', height: 'std', site: 'flat', mep: 'standard', sf: 0, contPct: 0.10, opts: {}, baths: 2, expectedBaths: 1, drivewayLen: 0, includeSitework: true, base[...]
      });
    }
  })();
});
