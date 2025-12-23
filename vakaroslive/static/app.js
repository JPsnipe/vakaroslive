const $ = (id) => document.getElementById(id);

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const APP_VERSION = "v25";

const els = {
  status: $("status"),
  appVersion: $("appVersion"),
  navHdg: $("navHdg"),
  navSog: $("navSog"),
  navCog: $("navCog"),
  navCogInline: $("navCogInline"),
  navDelta: $("navDelta"),
  navSrc: $("navSrc"),
  navLast: $("navLast"),
  map: $("map"),
  mapTypeStreet: $("mapTypeStreet"),
  mapTypeSat: $("mapTypeSat"),
  mapTypeNautical: $("mapTypeNautical"),
  mapCenter: $("mapCenter"),
  mapFullscreen: $("mapFullscreen"),
  setMark: $("setMark"),
  clearMark: $("clearMark"),
  markDist: $("markDist"),
  markBrg: $("markBrg"),
  heel: $("heel"),
  pitch: $("pitch"),
  field6: $("field6"),
  cogTest: $("cogTest"),
  compact2: $("compact2"),
  setPin: $("setPin"),
  setRcb: $("setRcb"),
  clearStartLine: $("clearStartLine"),
  toggleStartAuto: $("toggleStartAuto"),
  startSource: $("startSource"),
  pinDist: $("pinDist"),
  pinBrg: $("pinBrg"),
  rcbDist: $("rcbDist"),
  rcbBrg: $("rcbBrg"),
  lineBrg: $("lineBrg"),
  lineLen: $("lineLen"),
  distLine: $("distLine"),
  etaLine: $("etaLine"),
  setWindward: $("setWindward"),
  setLeewardPort: $("setLeewardPort"),
  setLeewardStarboard: $("setLeewardStarboard"),
  setWing: $("setWing"),
  setReach: $("setReach"),
  clearRaceMarks: $("clearRaceMarks"),
  courseType: $("courseType"),
  targetSelect: $("targetSelect"),
  targetHint: $("targetHint"),
  targetDist: $("targetDist"),
  targetBrg: $("targetBrg"),
  targetCmg: $("targetCmg"),
  targetEta: $("targetEta"),
  targetLaylineEta: $("targetLaylineEta"),
  perfChart: $("perfChart"),
  bleConnect: $("bleConnect"),
  bleConnectAll: $("bleConnectAll"),
  bleDisconnect: $("bleDisconnect"),
  bleInfo: $("bleInfo"),
  bleDebug: $("bleDebug"),
  recToggle: $("recToggle"),
  recDownload: $("recDownload"),
  scan: $("scan"),
  scanInfo: $("scanInfo"),
  deviceList: $("deviceList"),
  dampingHeading: $("dampingHeading"),
  dampingHeadingValue: $("dampingHeadingValue"),
  dampingCog: $("dampingCog"),
  dampingCogValue: $("dampingCogValue"),
  dampingSog: $("dampingSog"),
  dampingSogValue: $("dampingSogValue"),
  dampingHeel: $("dampingHeel"),
  dampingHeelValue: $("dampingHeelValue"),
  dampingPitch: $("dampingPitch"),
  dampingPitchValue: $("dampingPitchValue"),
  dampingPosition: $("dampingPosition"),
  dampingPositionValue: $("dampingPositionValue"),
  bleWakeLock: $("bleWakeLock"),
  bleBackground: $("bleBackground"),
};

let lastState = null;
let wsConn = null;
let mark = null; // {lat, lon}
let startLine = { pin: null, rcb: null, followAtlas: false, source: null };
let windward = null; // {lat, lon}
let leewardPort = null; // {lat, lon}
let leewardStarboard = null; // {lat, lon}
let wingMark = null; // {lat, lon}
let reachMark = null; // {lat, lon}
let currentCourseType = "W/L";
let targetId = null; // string|null
let trackPoints = []; // [{lat, lon}]
let lastTrackTsMs = null;

// Rendimiento (1 Hz)
const CHART_WINDOW_S = 120;
const CHART_ALPHA = 0.35; // EMA (~5s)
const KNOTS_PER_MPS = 1.9438444924406048;
const DAMPING_KEY = "vkl_damping_scale_v1";
const DAMPING_UI_KEY = "vkl_damping_ui_v1";
const DAMPING_BOUNDS = { min: 0.2, max: 6.0 };
const DAMPING_UI_BOUNDS = { min: 0, max: 20 };
const DAMPING_UI_MID = (DAMPING_UI_BOUNDS.max - DAMPING_UI_BOUNDS.min) / 2.0;
const DAMPING_UI_DEFAULTS = {
  heading: 10,
  cog: 10,
  sog: 10,
  heel: 9,
  pitch: 9,
  position: 8,
};
const DAMPING_PROFILE = {
  heading: { tauMin: 1.2, tauMax: 9.0, noiseRange: 12 },
  cog: { tauMin: 0.2, tauMax: 0.5, noiseRange: 20 },
  sog: { tauMin: 0.8, tauMax: 6.0, noiseRange: 3 },
  heel: { tauMin: 0.6, tauMax: 2.5, noiseRange: 6 },
  pitch: { tauMin: 0.6, tauMax: 2.5, noiseRange: 6 },
  position: { tauMin: 0.8, tauMax: 3.5, noiseRange: 12 },
};
const DAMPING_FIELDS = {
  heading: { slider: els.dampingHeading, value: els.dampingHeadingValue },
  cog: { slider: els.dampingCog, value: els.dampingCogValue },
  sog: { slider: els.dampingSog, value: els.dampingSogValue },
  heel: { slider: els.dampingHeel, value: els.dampingHeelValue },
  pitch: { slider: els.dampingPitch, value: els.dampingPitchValue },
  position: { slider: els.dampingPosition, value: els.dampingPositionValue },
};
let perfSamples = []; // [{sec, sog, cmg, hdg}]
let lastPerfSec = null;
let emaSog = null;
let emaCmg = null;
let emaSin = null;
let emaCos = null;
let lastHdgEma = null;
let lastHdgUnwrapped = null;
let chartDrawPending = false;
let fixHistory = []; // [{tsMs, lat, lon}]
let cogFusion = { cogDeg: null, lastHdgDeg: null, lastUpdateTsMs: null };
let lastDerivedSogKn = null;
let compactSogScale = null; // 100|10|1
let compactSogScaleHits = { 100: 0, 10: 0, 1: 0 };
let lastField6SogTsMs = 0;
let bleInfoBaseText = null;
let dampingUi = { ...DAMPING_UI_DEFAULTS };
let dampingScaleByKey = {
  heading: 1.0,
  cog: 1.0,
  sog: 1.0,
  heel: 1.0,
  pitch: 1.0,
  position: 1.0,
};
let dampingState = {
  lastTsMs: null,
  sog: null,
  heel: null,
  pitch: null,
  lat: null,
  lon: null,
  headingSin: null,
  headingCos: null,
  cogSin: null,
  cogCos: null,
  lastHdg: null,
  lastHeel: null,
  lastPitch: null,
};

// Grabación de sesión (raw + parseado) para depurar el protocolo.
let sessionRec = {
  active: false,
  startedTsMs: null,
  stoppedTsMs: null,
  entries: [],
  maxEntries: 20000,
};

function recSetActive(active) {
  sessionRec.active = !!active;
  if (sessionRec.active) {
    sessionRec.startedTsMs = Date.now();
    sessionRec.stoppedTsMs = null;
    sessionRec.entries = [];
  } else {
    sessionRec.stoppedTsMs = Date.now();
  }
  if (els.recToggle) els.recToggle.textContent = sessionRec.active ? "Parar" : "Grabar";
  if (els.recDownload) els.recDownload.disabled = sessionRec.active || !sessionRec.entries.length;
}

function recAdd(kind, payload) {
  if (!sessionRec.active) return;
  try {
    sessionRec.entries.push({ ts_ms: Date.now(), kind, ...(payload || {}) });
    if (sessionRec.entries.length > sessionRec.maxEntries) sessionRec.entries.shift();
    if (els.recDownload) els.recDownload.disabled = sessionRec.active || !sessionRec.entries.length;
  } catch {
    // ignore
  }
}

function downloadJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function dvToBase64(dv) {
  try {
    if (!dv || typeof dv.byteLength !== "number") return null;
    const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode(...u8.subarray(i, i + chunk));
    }
    return btoa(bin);
  } catch {
    return null;
  }
}

function recClone(value) {
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {
    // ignore
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function recUiSnapshot() {
  const ui = {};
  const textKeys = [
    "status",
    "navHdg",
    "navSog",
    "navCog",
    "navCogInline",
    "navDelta",
    "navSrc",
    "navLast",
    "markDist",
    "markBrg",
    "heel",
    "pitch",
    "field6",
    "compact2",
    "startSource",
    "pinDist",
    "pinBrg",
    "rcbDist",
    "rcbBrg",
    "lineBrg",
    "lineLen",
    "distLine",
    "etaLine",
    "targetHint",
    "targetDist",
    "targetBrg",
    "targetCmg",
    "targetEta",
    "targetLaylineEta",
    "bleInfo",
    "bleDebug",
  ];
  for (const k of textKeys) {
    const el = els[k];
    ui[k] = el ? el.textContent : null;
  }
  const valueKeys = ["courseType", "targetSelect"];
  for (const k of valueKeys) {
    const el = els[k];
    ui[k] = el && typeof el.value === "string" ? el.value : null;
  }
  return ui;
}

function recDebugSnapshot() {
  let ws = null;
  try {
    ws = {
      wanted: !!wsWanted,
      ready_state: wsConn ? wsConn.readyState : null,
      open: !!wsConn && wsConn.readyState === WebSocket.OPEN,
    };
  } catch {
    ws = null;
  }

  let ble = null;
  try {
    ble = bleClient
      ? {
        connected: !!bleClient.server?.connected,
        rx_main: bleClient.rxMainCount || 0,
        ok_main: bleClient.okMainCount || 0,
        rx_compact: bleClient.rxCompactCount || 0,
        ok_compact: bleClient.okCompactCount || 0,
        last_main_len: bleClient.lastMainLen ?? null,
        last_main_type: bleClient.lastMainType ?? null,
        last_main_head_hex: bleClient.lastMainHeadHex ?? null,
        last_compact_len: bleClient.lastCompactLen ?? null,
        last_compact_type: bleClient.lastCompactType ?? null,
        last_compact_head_hex: bleClient.lastCompactHeadHex ?? null,
      }
      : null;
  } catch {
    ble = null;
  }

  return {
    use_local_marks: !!useLocalMarks,
    course_type: currentCourseType,
    target_id: targetId,
    compact_sog_scale: compactSogScale,
    compact_sog_scale_hits: recClone(compactSogScaleHits),
    last_derived_sog_knots: lastDerivedSogKn,
    last_field6_sog_ts_ms: lastField6SogTsMs,
    ws,
    ble,
  };
}

function recDashboardSnapshot(state) {
  if (!sessionRec.active) return;
  recAdd("dashboard", {
    state: recClone(state),
    ui: recUiSnapshot(),
    debug: recDebugSnapshot(),
  });
}

// BLE directo (Web Bluetooth)
const VAKAROS_SERVICE_UUID = "ac510001-0000-5a11-0076-616b61726f73";
const VAKAROS_CHAR_COMMAND_1 = "ac510002-0000-5a11-0076-616b61726f73";
const VAKAROS_CHAR_TELEMETRY_MAIN = "ac510003-0000-5a11-0076-616b61726f73";
const VAKAROS_CHAR_COMMAND_2 = "ac510004-0000-5a11-0076-616b61726f73";
const VAKAROS_CHAR_TELEMETRY_COMPACT = "ac510005-0000-5a11-0076-616b61726f73";
const LOCAL_MARKS_KEY = "vkl_marks_v1";
let bleClient = null;
let useLocalMarks = false;
let localMarks = null;
const IS_GH_PAGES = typeof location !== "undefined" && location.hostname.endsWith("github.io");
let wsWanted = !IS_GH_PAGES;

// Leaflet map
let map = null;
let currentLayer = null;
let nauticalBaseLayer = null;
let trackPolyline = null;
let positionMarker = null;
let markMarker = null;
let pinMarker = null;
let rcbMarker = null;
let startLinePolyline = null;
let windwardMarker = null;
let leewardPortMarker = null;
let leewardStarboardMarker = null;
let leewardGatePolyline = null;
let coursePolyline = null; // Line connecting marks based on course type
let laylinesPolyline = null;
let targetLinePolyline = null;
let wingMarker = null;
let reachMarker = null;

function fmtDeg(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(1)}°`;
}

function fmtSignedDeg(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0.05 ? "+" : v < -0.05 ? "−" : "";
  const abs = Math.abs(v).toFixed(1);
  return `${sign}${abs}°`;
}

function fmtKn(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(2)} kn`;
}

function fmtNum(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return Number(v).toFixed(digits);
}

function shortErr(s) {
  if (!s) return "";
  const v = String(s).trim();
  if (!v) return "";
  return v.length > 56 ? `${v.slice(0, 56)}…` : v;
}

function fmtDuration(s) {
  if (!Number.isFinite(s) || s < 0) return "—";
  const sec = Math.round(s);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function sliderToScale(value) {
  if (!Number.isFinite(value)) return 1.0;
  if (value <= DAMPING_UI_BOUNDS.min) return 0;
  if (value <= DAMPING_UI_MID) {
    const lowerSpan = DAMPING_UI_MID - DAMPING_UI_BOUNDS.min;
    const norm = (value - DAMPING_UI_BOUNDS.min) / Math.max(1, lowerSpan);
    return DAMPING_BOUNDS.min + norm * (1.0 - DAMPING_BOUNDS.min);
  }
  const upperSpan = DAMPING_UI_BOUNDS.max - DAMPING_UI_MID;
  const norm = (value - DAMPING_UI_MID) / Math.max(1, upperSpan);
  return 1.0 + norm * (DAMPING_BOUNDS.max - 1.0);
}

function scaleToSlider(scale) {
  if (!Number.isFinite(scale)) return DAMPING_UI_DEFAULTS.heading;
  if (scale <= 0) return DAMPING_UI_BOUNDS.min;
  const clamped = clamp(scale, DAMPING_BOUNDS.min, DAMPING_BOUNDS.max);
  if (clamped <= 1.0) {
    const norm = (clamped - DAMPING_BOUNDS.min) / (1.0 - DAMPING_BOUNDS.min);
    return clamp(
      DAMPING_UI_BOUNDS.min + norm * DAMPING_UI_MID,
      DAMPING_UI_BOUNDS.min,
      DAMPING_UI_MID,
    );
  }
  const norm = (clamped - 1.0) / (DAMPING_BOUNDS.max - 1.0);
  return clamp(
    DAMPING_UI_MID + norm * (DAMPING_UI_BOUNDS.max - DAMPING_UI_MID),
    DAMPING_UI_MID,
    DAMPING_UI_BOUNDS.max,
  );
}

function loadDampingUi() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(DAMPING_UI_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    // ignore
  }

  let values = null;
  if (parsed && typeof parsed === "object") values = parsed;

  if (!values) {
    try {
      const legacyRaw = localStorage.getItem(DAMPING_KEY);
      const legacy = Number.parseFloat(legacyRaw);
      if (Number.isFinite(legacy)) {
        const v = scaleToSlider(legacy);
        values = {};
        for (const key of Object.keys(DAMPING_UI_DEFAULTS)) values[key] = v;
      }
    } catch {
      // ignore
    }
  }

  const out = { ...DAMPING_UI_DEFAULTS };
  if (values) {
    for (const key of Object.keys(out)) {
      const v = Number.parseFloat(values[key]);
      if (Number.isFinite(v)) {
        out[key] = clamp(v, DAMPING_UI_BOUNDS.min, DAMPING_UI_BOUNDS.max);
      }
    }
  }
  return out;
}

function saveDampingUi() {
  try {
    localStorage.setItem(DAMPING_UI_KEY, JSON.stringify(dampingUi));
  } catch {
    // ignore
  }
}

function setDampingField(key, value, opts = {}) {
  const clamped = clamp(value, DAMPING_UI_BOUNDS.min, DAMPING_UI_BOUNDS.max);
  const snapped = Math.round(clamped);
  dampingUi[key] = snapped;
  const scale = sliderToScale(snapped);
  dampingScaleByKey[key] = scale;

  const field = DAMPING_FIELDS[key];
  if (field?.slider) field.slider.value = String(snapped);
  if (field?.value) {
    field.value.textContent = snapped <= 0 ? "OFF" : `${snapped} (${scale.toFixed(2)}x)`;
  }

  if (opts.persist !== false) saveDampingUi();
}

function getDampingScale(key) {
  const value = dampingScaleByKey[key];
  return Number.isFinite(value) ? value : 1.0;
}

function tauForSpeed(profile, sogKn) {
  const minTau = profile.tauMin;
  const maxTau = profile.tauMax;
  if (!Number.isFinite(sogKn)) return (minTau + maxTau) / 2.0;
  const norm = clamp((sogKn - 2.0) / 10.0, 0, 1);
  return maxTau - norm * (maxTau - minTau);
}

function dampScalar(prev, next, dt, tau, noiseRange, scale = 1.0) {
  if (!Number.isFinite(next)) return null;
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(tau)) return next;
  if (!Number.isFinite(prev)) return next;
  const scaleValue = Number.isFinite(scale) ? scale : 1.0;
  if (scaleValue <= 0) return next;
  let adjustedTau = tau;
  if (Number.isFinite(noiseRange) && noiseRange > 0) {
    const noise = Math.abs(next - prev);
    const boost = 1 + clamp(noise / noiseRange, 0, 1) * 0.6;
    adjustedTau *= boost;
  }
  adjustedTau *= scaleValue;
  const alpha = 1 - Math.exp(-dt / Math.max(0.05, adjustedTau));
  return prev + alpha * (next - prev);
}

function dampAngle(prevSin, prevCos, nextDeg, dt, tau, noiseRange, scale = 1.0) {
  if (!Number.isFinite(nextDeg)) return { deg: null, sin: null, cos: null };
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(tau)) {
    const rad = (nextDeg * Math.PI) / 180.0;
    return { deg: (nextDeg + 360) % 360, sin: Math.sin(rad), cos: Math.cos(rad) };
  }
  const rad = (nextDeg * Math.PI) / 180.0;
  const nextSin = Math.sin(rad);
  const nextCos = Math.cos(rad);
  if (!Number.isFinite(prevSin) || !Number.isFinite(prevCos)) {
    return { deg: (nextDeg + 360) % 360, sin: nextSin, cos: nextCos };
  }
  const scaleValue = Number.isFinite(scale) ? scale : 1.0;
  if (scaleValue <= 0) {
    return { deg: (nextDeg + 360) % 360, sin: nextSin, cos: nextCos };
  }
  let adjustedTau = tau;
  if (Number.isFinite(noiseRange) && noiseRange > 0) {
    const prevDeg = (Math.atan2(prevSin, prevCos) * 180.0) / Math.PI;
    const delta = ((nextDeg - prevDeg + 540.0) % 360.0) - 180.0;
    const boost = 1 + clamp(Math.abs(delta) / noiseRange, 0, 1) * 0.6;
    adjustedTau *= boost;
  }
  adjustedTau *= scaleValue;
  const alpha = 1 - Math.exp(-dt / Math.max(0.05, adjustedTau));
  const sin = prevSin + alpha * (nextSin - prevSin);
  const cos = prevCos + alpha * (nextCos - prevCos);
  const deg = (Math.atan2(sin, cos) * 180.0) / Math.PI;
  return { deg: (deg + 360.0) % 360.0, sin, cos };
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000.0;
  const toRad = (x) => (x * Math.PI) / 180.0;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180.0;
  const toDeg = (x) => (x * 180.0) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dlambda = toRad(lon2 - lon1);
  const y = Math.sin(dlambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlambda);
  return (toDeg(Math.atan2(y, x)) + 360.0) % 360.0;
}

function projectPoint(lat, lon, bearing, distM) {
  const R = 6371000.0;
  const toRad = (x) => (x * Math.PI) / 180.0;
  const toDeg = (x) => (x * 180.0) / Math.PI;
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const brg = toRad(bearing);
  const dByR = distM / R;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(dByR) +
    Math.cos(phi1) * Math.sin(dByR) * Math.cos(brg)
  );
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(brg) * Math.sin(dByR) * Math.cos(phi1),
    Math.cos(dByR) - Math.sin(phi1) * Math.sin(phi2)
  );
  return { lat: toDeg(phi2), lon: toDeg(lambda2) };
}

function distToLineM(p, a, b) {
  const R = 6371000.0;
  const toRad = (x) => (x * Math.PI) / 180.0;
  const lat0 = toRad((a.lat + b.lat) / 2.0);
  const lon0 = toRad((a.lon + b.lon) / 2.0);
  const toXY = (pt) => {
    const lat = toRad(pt.lat);
    const lon = toRad(pt.lon);
    return {
      x: (lon - lon0) * Math.cos(lat0) * R,
      y: (lat - lat0) * R,
    };
  };

  const A = toXY(a);
  const B = toXY(b);
  const P = toXY(p);

  const ABx = B.x - A.x;
  const ABy = B.y - A.y;
  const APx = P.x - A.x;
  const APy = P.y - A.y;

  const ab2 = ABx * ABx + ABy * ABy;
  if (ab2 < 1e-6) return { distM: 0.0, t: 0.0 };

  const t = (APx * ABx + APy * ABy) / ab2;
  const tc = Math.max(0, Math.min(1, t));
  const Qx = A.x + tc * ABx;
  const Qy = A.y + tc * ABy;
  const dx = P.x - Qx;
  const dy = P.y - Qy;
  return { distM: Math.hypot(dx, dy), t: tc };
}

function initMap() {
  if (map) return;

  // Inicializar mapa centrado en Vigo (Galicia)
  map = L.map(els.map, {
    center: [42.23, -8.73],
    zoom: 14,
    zoomControl: true
  });

  // Capa por defecto: OpenStreetMap
  setMapLayer("street");
}

function setMapLayer(type) {
  if (currentLayer) {
    map.removeLayer(currentLayer);
  }
  if (nauticalBaseLayer) {
    map.removeLayer(nauticalBaseLayer);
    nauticalBaseLayer = null;
  }

  // Actualizar botones activos
  document.querySelectorAll(".map-btn").forEach(btn => {
    btn.classList.remove("map-btn--active");
  });

  if (type === "street") {
    // CartoDB Positron - fondo plano y claro para mejor visibilidad de líneas
    currentLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 19,
      className: 'map-tiles'
    });
    els.mapTypeStreet.classList.add("map-btn--active");
  } else if (type === "sat") {
    currentLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: '© Esri',
      maxZoom: 19,
      opacity: 0.7,
      className: 'map-tiles'
    });
    els.mapTypeSat.classList.add("map-btn--active");
  } else if (type === "nautical") {
    currentLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
      attribution: '© OpenSeaMap',
      maxZoom: 18,
      className: 'map-tiles'
    });
    // Añadir base clara debajo
    nauticalBaseLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap, © CARTO',
      maxZoom: 19
    });
    nauticalBaseLayer.addTo(map);
    els.mapTypeNautical.classList.add("map-btn--active");
  }

  currentLayer.addTo(map);
}

function centerMap() {
  if (!map) return;

  const points = [];
  trackPoints.forEach(p => points.push([p.lat, p.lon]));
  if (mark) points.push([mark.lat, mark.lon]);
  if (windward) points.push([windward.lat, windward.lon]);
  if (leewardPort) points.push([leewardPort.lat, leewardPort.lon]);
  if (leewardStarboard) points.push([leewardStarboard.lat, leewardStarboard.lon]);
  if (startLine?.pin) points.push([startLine.pin.lat, startLine.pin.lon]);
  if (startLine?.rcb) points.push([startLine.rcb.lat, startLine.rcb.lon]);

  if (points.length === 0) {
    map.setView([42.23, -8.73], 14);
  } else if (points.length === 1) {
    map.setView(points[0], 16);
  } else {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

let mapFullscreenOn = false;
let mapCollapsedBeforeFullscreen = null;

function setMapFullscreen(on) {
  const next = !!on;
  if (mapFullscreenOn === next) return;
  mapFullscreenOn = next;

  const mapCard = document.querySelector('.card[data-card="map"]');
  if (mapFullscreenOn) {
    mapCollapsedBeforeFullscreen = mapCard ? mapCard.classList.contains("card--collapsed") : null;
    if (mapCard) setCardCollapsed(mapCard, false, { persist: false });
    document.body.classList.add("map-fullscreen");
    if (els.mapFullscreen) els.mapFullscreen.textContent = "Cerrar";
  } else {
    document.body.classList.remove("map-fullscreen");
    if (els.mapFullscreen) els.mapFullscreen.textContent = "Full";
    if (mapCard && mapCollapsedBeforeFullscreen) {
      setCardCollapsed(mapCard, true, { persist: false });
    }
    mapCollapsedBeforeFullscreen = null;
  }

  setTimeout(() => map?.invalidateSize?.(), 60);
}

function dotIcon(color, text) {
  return L.divIcon({
    className: "vkl-div-icon",
    html: `<div class="vkl-dot" style="background:${color}">${text}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function upsertDraggableMarker(existing, point, opts) {
  if (!map) initMap();
  if (!point) {
    if (existing) map.removeLayer(existing);
    return null;
  }

  if (!existing) {
    const marker = L.marker([point.lat, point.lon], {
      icon: dotIcon(opts.color, opts.text),
      draggable: true,
      autoPan: true,
    }).addTo(map);
    marker.bindPopup(opts.popup);
    marker.on("dragstart", () => {
      marker._vklDragging = true;
    });
    marker.on("dragend", () => {
      marker._vklDragging = false;
      const ll = marker.getLatLng();
      sendCmd(opts.cmd, { point: { lat: ll.lat, lon: ll.lng, ts_ms: Date.now() } });
    });
    return marker;
  }

  if (!existing._vklDragging) {
    existing.setLatLng([point.lat, point.lon]);
  }
  return existing;
}

function midpointPoint(a, b) {
  return { lat: (a.lat + b.lat) / 2.0, lon: (a.lon + b.lon) / 2.0 };
}

function targetLabelForId(id) {
  return id === "mark"
    ? "Marca"
    : id === "windward"
      ? "Barlovento"
      : id === "leeward_gate"
        ? "Sotavento (puerta)"
        : id === "leeward_port"
          ? "Sotavento P"
          : id === "leeward_starboard"
            ? "Sotavento S"
            : id === "wing"
              ? "Wing"
              : id === "reach"
                ? "Reach"
                : null;
}

function targetPointForId(id) {
  if (id === "mark") return mark;
  if (id === "windward") return windward;
  if (id === "leeward_port") return leewardPort;
  if (id === "leeward_starboard") return leewardStarboard;
  if (id === "wing") return wingMark;
  if (id === "reach") return reachMark;
  if (id === "leeward_gate") {
    if (!leewardPort || !leewardStarboard) return null;
    return midpointPoint(leewardPort, leewardStarboard);
  }
  return null;
}

function getRawHeadingDeg(state) {
  const nowTsMs =
    typeof state?.last_event_ts_ms === "number" ? state.last_event_ts_ms : Date.now();
  const hm = state?.heading_deg;
  const hmTs = state?.heading_main_ts_ms;
  const mainFresh = typeof hmTs !== "number" || Math.abs(nowTsMs - hmTs) <= 2500;
  if (typeof hm === "number" && hm >= 0 && hm <= 360 && mainFresh) return hm;
  if (typeof hm === "number" && hm >= 0 && hm <= 360) return hm;
  return null;
}

function getRawHeadingSource(state) {
  const nowTsMs =
    typeof state?.last_event_ts_ms === "number" ? state.last_event_ts_ms : Date.now();
  const hm = state?.heading_deg;
  const hmTs = state?.heading_main_ts_ms;
  const mainFresh = typeof hmTs !== "number" || Math.abs(nowTsMs - hmTs) <= 2500;
  if (typeof hm === "number" && hm >= 0 && hm <= 360 && mainFresh) return "main";

  if (typeof hm === "number" && hm >= 0 && hm <= 360) return "main";
  return null;
}

function getMagHeadingDeg(state) {
  const hf = state?.heading_filtered_deg;
  if (typeof hf === "number" && hf >= 0 && hf <= 360) return hf;
  return getRawHeadingDeg(state);
}

function applyDynamicDamping(state) {
  const tsMs =
    typeof state?.last_event_ts_ms === "number" ? state.last_event_ts_ms : Date.now();
  const dt = Number.isFinite(dampingState.lastTsMs)
    ? Math.max(0.016, (tsMs - dampingState.lastTsMs) / 1000.0)
    : null;
  dampingState.lastTsMs = tsMs;

  const sogRaw = typeof state?.sog_knots === "number" ? state.sog_knots : null;
  const next = { ...state };
  const headingScale = getDampingScale("heading");
  const cogScale = getDampingScale("cog");
  const sogScale = getDampingScale("sog");
  const heelScale = getDampingScale("heel");
  const pitchScale = getDampingScale("pitch");
  const posScale = getDampingScale("position");

  const sogTau = tauForSpeed(DAMPING_PROFILE.sog, sogRaw);
  const sog = dampScalar(
    dampingState.sog,
    sogRaw,
    dt,
    sogTau,
    DAMPING_PROFILE.sog.noiseRange,
    sogScale,
  );
  if (Number.isFinite(sog)) {
    dampingState.sog = sog;
    next.sog_knots = sog;
  } else {
    dampingState.sog = null;
  }

  const headingRaw = getRawHeadingDeg(state);
  const headingTau = tauForSpeed(DAMPING_PROFILE.heading, sogRaw);
  const heading = dampAngle(
    dampingState.headingSin,
    dampingState.headingCos,
    headingRaw,
    dt,
    headingTau,
    DAMPING_PROFILE.heading.noiseRange,
    headingScale,
  );
  if (Number.isFinite(heading.deg)) {
    dampingState.headingSin = heading.sin;
    dampingState.headingCos = heading.cos;
    next.heading_filtered_deg = heading.deg;
  } else {
    dampingState.headingSin = null;
    dampingState.headingCos = null;
    next.heading_filtered_deg = null;
  }

  const cogRaw = typeof state?.cog_deg === "number" ? state.cog_deg : null;
  const cogTau = tauForSpeed(DAMPING_PROFILE.cog, sogRaw);
  const cog = dampAngle(
    dampingState.cogSin,
    dampingState.cogCos,
    cogRaw,
    dt,
    cogTau,
    DAMPING_PROFILE.cog.noiseRange,
    cogScale,
  );
  if (Number.isFinite(cog.deg)) {
    dampingState.cogSin = cog.sin;
    dampingState.cogCos = cog.cos;
    next.cog_deg = cog.deg;
  } else {
    dampingState.cogSin = null;
    dampingState.cogCos = null;
  }

  const heelRaw = typeof state?.main_field_5 === "number" ? state.main_field_5 : null;
  const heelTau = tauForSpeed(DAMPING_PROFILE.heel, sogRaw);
  const heel = dampScalar(
    dampingState.heel,
    heelRaw,
    dt,
    heelTau,
    DAMPING_PROFILE.heel.noiseRange,
    heelScale,
  );
  if (Number.isFinite(heel)) {
    dampingState.heel = heel;
    next.main_field_5 = heel;
  } else {
    dampingState.heel = null;
  }

  const pitchRaw = typeof state?.main_field_4 === "number" ? state.main_field_4 : null;
  const pitchTau = tauForSpeed(DAMPING_PROFILE.pitch, sogRaw);
  const pitch = dampScalar(
    dampingState.pitch,
    pitchRaw,
    dt,
    pitchTau,
    DAMPING_PROFILE.pitch.noiseRange,
    pitchScale,
  );
  if (Number.isFinite(pitch)) {
    dampingState.pitch = pitch;
    next.main_field_4 = pitch;
  } else {
    dampingState.pitch = null;
  }

  const latRaw = typeof state?.latitude === "number" ? state.latitude : null;
  const lonRaw = typeof state?.longitude === "number" ? state.longitude : null;
  const posTauBase = tauForSpeed(DAMPING_PROFILE.position, sogRaw);

  // Dynamic Damping Bypass: Si hay transitorio (Giro/Escora), tau -> 0.05
  const tIdx = state.transient_idx || 0;
  const posTau = tIdx > 0.8 ? 0.05 : posTauBase;

  const lat = dampScalar(dampingState.lat, latRaw, dt, posTau, null, posScale);
  const lon = dampScalar(dampingState.lon, lonRaw, dt, posTau, null, posScale);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    dampingState.lat = lat;
    dampingState.lon = lon;
    next.latitude = lat;
    next.longitude = lon;
  } else if (!Number.isFinite(latRaw) || !Number.isFinite(lonRaw)) {
    dampingState.lat = null;
    dampingState.lon = null;
  }

  return next;
}

function supportsWebBluetooth() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

function hexByte(b) {
  return Number(b).toString(16).padStart(2, "0");
}

function dvPrefixHex(dv, maxBytes = 12) {
  try {
    if (!dv || typeof dv.byteLength !== "number") return null;
    const n = Math.max(0, Math.min(dv.byteLength, maxBytes));
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(hexByte(dv.getUint8(i)));
    return parts.join("");
  } catch {
    return null;
  }
}

function setBleUi(connected, info) {
  if (els.bleConnect) els.bleConnect.disabled = !!connected || !supportsWebBluetooth();
  if (els.bleDisconnect) els.bleDisconnect.disabled = !connected;
  if (els.bleInfo) {
    if (!supportsWebBluetooth()) els.bleInfo.textContent = "Web Bluetooth no disponible";
    else {
      bleInfoBaseText = info || (connected ? "Conectado" : "—");
      els.bleInfo.textContent = bleInfoBaseText;
    }
  }
}

function refreshBleInfoTelemetryHint() {
  if (!supportsWebBluetooth() || !els.bleInfo) return;
  if (!bleClient || !bleClient.server?.connected) return;

  const base = bleInfoBaseText || "Conectado";
  const lastRxTs = Math.max(bleClient.lastMainRxTs || 0, bleClient.lastCompactRxTs || 0);
  const lastOkTs = Math.max(bleClient.lastMainOkTs || 0, bleClient.lastCompactOkTs || 0);
  if (!lastRxTs) {
    els.bleInfo.textContent = `${base} · esperando datos...`;
    return;
  }
  if (!lastOkTs) {
    els.bleInfo.textContent = `${base} · datos no interpretados`;
    return;
  }
  const ageMs = Date.now() - lastOkTs;
  if (Number.isFinite(ageMs) && ageMs > 2200) {
    els.bleInfo.textContent = `${base} · sin datos (${Math.round(ageMs / 1000)}s)`;
    return;
  }
  els.bleInfo.textContent = base;
}

function refreshBleDebugLine() {
  if (!els.bleDebug) return;
  if (!supportsWebBluetooth()) {
    setText(els.bleDebug, "BLE: Web Bluetooth no disponible");
    return;
  }
  if (!bleClient || !bleClient.server?.connected) {
    setText(els.bleDebug, "BLE: -");
    return;
  }
  const fmtType = (t) => (typeof t === "number" ? `0x${hexByte(t)}` : "—");
  const fmtLen = (n) => (typeof n === "number" ? String(n) : "—");
  const rxM = bleClient.rxMainCount || 0;
  const okM = bleClient.okMainCount || 0;
  const rxC = bleClient.rxCompactCount || 0;
  const okC = bleClient.okCompactCount || 0;
  const main = `${fmtType(bleClient.lastMainType)}/${fmtLen(bleClient.lastMainLen)} ok ${okM}/${rxM}`;
  const compact = `${fmtType(bleClient.lastCompactType)}/${fmtLen(bleClient.lastCompactLen)} ok ${okC}/${rxC}`;
  let extra = "";
  if (rxM + rxC > 0 && okM + okC === 0) {
    const mh = bleClient.lastMainHeadHex ? ` m:${bleClient.lastMainHeadHex}` : "";
    const ch = bleClient.lastCompactHeadHex ? ` c:${bleClient.lastCompactHeadHex}` : "";
    extra = `${mh}${ch}`;
  }
  setText(els.bleDebug, `BLE main ${main} · compact ${compact}${extra}`);
}

function loadLocalMarks() {
  try {
    const raw = localStorage.getItem(LOCAL_MARKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocalMarks(marksObj) {
  try {
    localStorage.setItem(LOCAL_MARKS_KEY, JSON.stringify(marksObj));
  } catch {
    // ignore
  }
}

function ensureMarksShape(m) {
  const marks = m && typeof m === "object" ? { ...m } : {};
  marks.source = marks.source || "manual";
  if (!("start_line_follow_atlas" in marks)) marks.start_line_follow_atlas = false;
  if (!("target" in marks)) marks.target = null;
  return marks;
}

function extractStartLineCandidates(dataView, opts = {}) {
  if (!dataView || typeof dataView.byteLength !== "number") return [];
  const len = dataView.byteLength;
  if (len < 16) return [];

  const minLen = Number.isFinite(opts.minLenM) ? opts.minLenM : 5.0;
  const maxLen = Number.isFinite(opts.maxLenM) ? opts.maxLenM : 2000.0;

  const okLatLon = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0) return false;
    if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return false;
    return true;
  };

  const out = [];
  const seen = new Set();
  for (let off = 0; off <= len - 16; off++) {
    let aLat;
    let aLon;
    let bLat;
    let bLon;
    try {
      aLat = dataView.getFloat32(off, true);
      aLon = dataView.getFloat32(off + 4, true);
      bLat = dataView.getFloat32(off + 8, true);
      bLon = dataView.getFloat32(off + 12, true);
    } catch {
      break;
    }
    if (!okLatLon(aLat, aLon) || !okLatLon(bLat, bLon)) continue;
    const lineLen = haversineM(aLat, aLon, bLat, bLon);
    if (!(lineLen >= minLen && lineLen <= maxLen)) continue;
    const key = `${Math.round(aLat * 1e6)}|${Math.round(aLon * 1e6)}|${Math.round(bLat * 1e6)}|${Math.round(bLon * 1e6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      offset: off,
      a_lat: aLat,
      a_lon: aLon,
      b_lat: bLat,
      b_lon: bLon,
      line_len_m: lineLen,
    });
    if (out.length >= 12) break;
  }
  return out;
}

function applyLocalStartLineCandidates(candidates, source, opts = {}) {
  if (!useLocalMarks) return false;
  localMarks = ensureMarksShape(localMarks || loadLocalMarks() || {});
  const fromCommand = typeof source === "string" && source.startsWith("command_");
  if (!localMarks.start_line_follow_atlas && !fromCommand) return false;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;

  const boatLat = Number.isFinite(opts.boatLat)
    ? opts.boatLat
    : Number.isFinite(lastState?.latitude)
      ? lastState.latitude
      : null;
  const boatLon = Number.isFinite(opts.boatLon)
    ? opts.boatLon
    : Number.isFinite(lastState?.longitude)
      ? lastState.longitude
      : null;
  if (!Number.isFinite(boatLat) || !Number.isFinite(boatLon)) return false;

  const existingPin = localMarks.start_pin
    ? { lat: localMarks.start_pin.lat, lon: localMarks.start_pin.lon }
    : null;
  const existingRcb = localMarks.start_rcb
    ? { lat: localMarks.start_rcb.lat, lon: localMarks.start_rcb.lon }
    : null;

  const parseCandidate = (c) => {
    if (!c || typeof c !== "object") return null;
    const aLat = Number(c.a_lat);
    const aLon = Number(c.a_lon);
    const bLat = Number(c.b_lat);
    const bLon = Number(c.b_lon);
    if (!Number.isFinite(aLat) || !Number.isFinite(aLon) || !Number.isFinite(bLat) || !Number.isFinite(bLon)) {
      return null;
    }
    const lineLen = Number.isFinite(c.line_len_m)
      ? Number(c.line_len_m)
      : haversineM(aLat, aLon, bLat, bLon);
    return { aLat, aLon, bLat, bLon, lineLen };
  };

  const assignmentCost = (aLat, aLon, bLat, bLon) => {
    if (existingPin && existingRcb) {
      const costDirect =
        haversineM(existingPin.lat, existingPin.lon, aLat, aLon) +
        haversineM(existingRcb.lat, existingRcb.lon, bLat, bLon);
      const costSwap =
        haversineM(existingPin.lat, existingPin.lon, bLat, bLon) +
        haversineM(existingRcb.lat, existingRcb.lon, aLat, aLon);
      if (costSwap < costDirect) return { cost: costSwap, swapped: true };
      return { cost: costDirect, swapped: false };
    }
    if (existingPin) {
      const da = haversineM(existingPin.lat, existingPin.lon, aLat, aLon);
      const db = haversineM(existingPin.lat, existingPin.lon, bLat, bLon);
      return db < da ? { cost: db, swapped: true } : { cost: da, swapped: false };
    }
    if (existingRcb) {
      const da = haversineM(existingRcb.lat, existingRcb.lon, aLat, aLon);
      const db = haversineM(existingRcb.lat, existingRcb.lon, bLat, bLon);
      return db < da ? { cost: db, swapped: true } : { cost: da, swapped: false };
    }
    return { cost: 0.0, swapped: false };
  };

  let best = null;
  let bestScore = null;
  for (const raw of candidates) {
    const parsed = parseCandidate(raw);
    if (!parsed) continue;
    const { aLat, aLon, bLat, bLon, lineLen } = parsed;
    if (lineLen < 5.0 || lineLen > 2500.0) continue;
    const distA = haversineM(boatLat, boatLon, aLat, aLon);
    const distB = haversineM(boatLat, boatLon, bLat, bLon);
    if (distA > 20000.0 || distB > 20000.0) continue;

    const { cost, swapped } = assignmentCost(aLat, aLon, bLat, bLon);
    const score = existingPin || existingRcb ? cost : distA + distB;
    if (bestScore === null || score < bestScore) {
      bestScore = score;
      best = { aLat, aLon, bLat, bLon, swapped };
    }
  }

  if (!best) return false;
  const pinLat = best.swapped ? best.bLat : best.aLat;
  const pinLon = best.swapped ? best.bLon : best.aLon;
  const rcbLat = best.swapped ? best.aLat : best.bLat;
  const rcbLon = best.swapped ? best.aLon : best.bLon;
  const tsMs = Number.isFinite(opts.tsMs) ? opts.tsMs : Date.now();

  const differs = (prev, lat, lon) => {
    if (!prev || !Number.isFinite(prev.lat) || !Number.isFinite(prev.lon)) return true;
    return haversineM(prev.lat, prev.lon, lat, lon) > 0.5;
  };

  let changed = false;
  if (differs(localMarks.start_pin, pinLat, pinLon)) {
    localMarks.start_pin = { lat: pinLat, lon: pinLon, ts_ms: tsMs };
    changed = true;
  }
  if (differs(localMarks.start_rcb, rcbLat, rcbLon)) {
    localMarks.start_rcb = { lat: rcbLat, lon: rcbLon, ts_ms: tsMs };
    changed = true;
  }
  if (!changed) return false;

  localMarks.source = "atlas";
  saveLocalMarks(localMarks);
  applyLocalMarksToUi();
  return true;
}

function maybeAutoStartLineFromBle(dataView, source, opts = {}) {
  if (!useLocalMarks) return;
  localMarks = ensureMarksShape(localMarks || loadLocalMarks() || {});
  const fromCommand = typeof source === "string" && source.startsWith("command_");
  if (!localMarks.start_line_follow_atlas && !fromCommand) return;

  const candidates = extractStartLineCandidates(dataView);
  if (!candidates.length) return;

  applyLocalStartLineCandidates(candidates, source, opts);
}

function applyLocalMarksToUi() {
  const marks = ensureMarksShape(localMarks);
  mark = marks.mark ? { lat: marks.mark.lat, lon: marks.mark.lon } : null;
  windward = marks.windward ? { lat: marks.windward.lat, lon: marks.windward.lon } : null;
  leewardPort = marks.leeward_port ? { lat: marks.leeward_port.lat, lon: marks.leeward_port.lon } : null;
  leewardStarboard = marks.leeward_starboard
    ? { lat: marks.leeward_starboard.lat, lon: marks.leeward_starboard.lon }
    : null;
  wingMark = marks.wing_mark ? { lat: marks.wing_mark.lat, lon: marks.wing_mark.lon } : null;
  reachMark = marks.reach_mark ? { lat: marks.reach_mark.lat, lon: marks.reach_mark.lon } : null;
  currentCourseType = marks.course_type || "W/L";

  if (els.courseType && els.courseType.value !== currentCourseType) {
    els.courseType.value = currentCourseType;
  }

  targetId = marks.target ?? null;
  const startFollowAtlas = !!marks.start_line_follow_atlas;
  startLine = {
    pin: marks.start_pin ? { lat: marks.start_pin.lat, lon: marks.start_pin.lon } : null,
    rcb: marks.start_rcb ? { lat: marks.start_rcb.lat, lon: marks.start_rcb.lon } : null,
    followAtlas: startFollowAtlas,
    source: startFollowAtlas ? "Atlas2 (auto)" : "Manual",
  };
  if (els.targetSelect) {
    const wanted = targetId || "";
    if (els.targetSelect.value !== wanted) els.targetSelect.value = wanted;
  }
  updateMarkStats();
  updateTargetStats();
  updateStartLineStats();
  drawTrack();
}

function nowPointFromState() {
  if (typeof lastState?.latitude !== "number" || typeof lastState?.longitude !== "number") return null;
  return { lat: lastState.latitude, lon: lastState.longitude, ts_ms: Date.now() };
}

function applyLocalCommand(type, extra = {}) {
  localMarks = ensureMarksShape(localMarks || loadLocalMarks() || {});
  const p = extra.point || nowPointFromState();

  const setKey = (key) => {
    if (!p) return;
    localMarks[key] = { lat: p.lat, lon: p.lon, ts_ms: p.ts_ms || Date.now() };
    localMarks.source = "manual";
  };

  if (type === "set_mark") setKey("mark");
  else if (type === "clear_mark") localMarks.mark = null;
  else if (type === "set_windward") setKey("windward");
  else if (type === "clear_windward") localMarks.windward = null;
  else if (type === "set_leeward_port") setKey("leeward_port");
  else if (type === "set_leeward_starboard") setKey("leeward_starboard");
  else if (type === "set_wing") setKey("wing_mark");
  else if (type === "set_reach") setKey("reach_mark");
  else if (type === "clear_leeward_gate") {
    localMarks.leeward_port = null;
    localMarks.leeward_starboard = null;
  } else if (type === "clear_race_marks") {
    localMarks.windward = null;
    localMarks.leeward_port = null;
    localMarks.leeward_starboard = null;
    localMarks.wing_mark = null;
    localMarks.reach_mark = null;
    if (
      localMarks.target === "windward" ||
      localMarks.target === "leeward_port" ||
      localMarks.target === "leeward_starboard" ||
      localMarks.target === "leeward_gate" ||
      localMarks.target === "wing" ||
      localMarks.target === "reach"
    ) {
      localMarks.target = null;
    }
  } else if (type === "set_start_pin") {
    setKey("start_pin");
    localMarks.start_line_follow_atlas = false;
  } else if (type === "set_start_rcb") {
    setKey("start_rcb");
    localMarks.start_line_follow_atlas = false;
  } else if (type === "set_start_line_follow_atlas") {
    localMarks.start_line_follow_atlas = !!extra.enabled;
  }
  else if (type === "clear_start_line") {
    localMarks.start_pin = null;
    localMarks.start_rcb = null;
  } else if (type === "set_course_type") {
    const allowed = new Set(["W/L", "Triangle", "Trapezoid"]);
    if (allowed.has(extra.course_type)) {
      localMarks.course_type = extra.course_type;
      localMarks.source = "manual";
    }
  } else if (type === "set_target") {
    const allowed = new Set([
      null,
      "mark",
      "windward",
      "leeward_gate",
      "leeward_port",
      "leeward_starboard",
      "wing",
      "reach",
    ]);
    const t = extra.target ?? null;
    if (allowed.has(t)) localMarks.target = t;
  } else {
    return;
  }

  saveLocalMarks(localMarks);
  applyLocalMarksToUi();
}

function resetPerfSeries() {
  perfSamples = [];
  lastPerfSec = null;
  emaSog = null;
  emaCmg = null;
  emaSin = null;
  emaCos = null;
  lastHdgEma = null;
  lastHdgUnwrapped = null;
  fixHistory = [];
  cogFusion = { cogDeg: null, lastHdgDeg: null, lastUpdateTsMs: null };
  lastDerivedSogKn = null;
  compactSogScale = null;
  compactSogScaleHits = { 100: 0, 10: 0, 1: 0 };
  lastField6SogTsMs = 0;
  scheduleChartDraw();
}

function resetCmgSmoothing() {
  emaCmg = null;
}

function computeCmgKn(state, targetPoint) {
  if (!targetPoint) return null;
  if (typeof state?.latitude !== "number" || typeof state?.longitude !== "number") return null;
  const sog = state?.sog_knots;
  const cog = state?.cog_deg;
  if (typeof sog !== "number" || typeof cog !== "number" || sog <= 0) return null;
  const brg = bearingDeg(state.latitude, state.longitude, targetPoint.lat, targetPoint.lon);
  const deltaDeg = ((cog - brg + 540.0) % 360.0) - 180.0;
  const cmgKn = sog * Math.cos((deltaDeg * Math.PI) / 180.0);
  return Number.isFinite(cmgKn) ? cmgKn : null;
}

function decodeSogKnFromCompactField2(field2, refSogKn) {
  if (typeof field2 !== "number" || !Number.isFinite(field2)) return null;
  const raw = Math.round(field2);
  if (raw < 0 || raw > 65535) return null;

  if (compactSogScale) {
    const v = raw / compactSogScale;
    return v >= 0 && v <= 60 ? v : null;
  }

  const candidates = [];
  for (const scale of [100, 10, 1]) {
    const v = raw / scale;
    if (v >= 0 && v <= 60) candidates.push({ scale, v });
  }
  if (!candidates.length) return null;

  const hasRef = typeof refSogKn === "number" && Number.isFinite(refSogKn) && refSogKn > 0.05;
  if (hasRef) {
    candidates.sort((a, b) => Math.abs(a.v - refSogKn) - Math.abs(b.v - refSogKn));
    const best = candidates[0];

    const tol = Math.max(2.5, refSogKn * 0.8);
    if (Math.abs(best.v - refSogKn) > tol) {
      compactSogScaleHits[100] = Math.max(0, (compactSogScaleHits[100] || 0) - 1);
      compactSogScaleHits[10] = Math.max(0, (compactSogScaleHits[10] || 0) - 1);
      compactSogScaleHits[1] = Math.max(0, (compactSogScaleHits[1] || 0) - 1);
      return null;
    }

    compactSogScaleHits[best.scale] = (compactSogScaleHits[best.scale] || 0) + 1;
    for (const s of [100, 10, 1]) {
      if (s !== best.scale) compactSogScaleHits[s] = Math.max(0, (compactSogScaleHits[s] || 0) - 1);
    }
    if ((compactSogScaleHits[best.scale] || 0) >= 3) {
      compactSogScale = best.scale;
    }

    return best.v;
  }

  // Sin referencia: intenta la escala más probable (más resolución) que dé un rango plausible.
  candidates.sort((a, b) => b.scale - a.scale);
  const best = candidates[0];
  compactSogScaleHits[best.scale] = (compactSogScaleHits[best.scale] || 0) + 1;
  if ((compactSogScaleHits[best.scale] || 0) >= 5) {
    compactSogScale = best.scale;
  }
  return best.v;
}

function normDeg(deg) {
  const d = deg % 360.0;
  return d < 0 ? d + 360.0 : d;
}

function angleDiffDeg(aDeg, bDeg) {
  return ((aDeg - bDeg + 540.0) % 360.0) - 180.0;
}

function blendAngleDeg(aDeg, bDeg, weightB) {
  if (typeof aDeg !== "number" || typeof bDeg !== "number") return null;
  const w = clamp(weightB, 0.0, 1.0);
  const ar = (aDeg * Math.PI) / 180.0;
  const br = (bDeg * Math.PI) / 180.0;
  const x = (1.0 - w) * Math.cos(ar) + w * Math.cos(br);
  const y = (1.0 - w) * Math.sin(ar) + w * Math.sin(br);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return null;
  return normDeg((Math.atan2(y, x) * 180.0) / Math.PI);
}

function cogGpsWeightForSog(sogKn, transientIdx = 0) {
  if (typeof sogKn !== "number" || !Number.isFinite(sogKn)) return 0.5;
  const sogLow = 1.0;
  const sogHigh = 3.0;

  // Si estamos maniobrando brusco (transientIdx > 1), el peso del GPS baja casi a cero.
  // Fiarse al 100% de la inercia (Compass) durante el giro.
  const baseAlphaLow = transientIdx > 0.8 ? 0.01 : 0.05;
  const baseAlphaHigh = transientIdx > 0.8 ? 0.05 : 0.3;

  const t = clamp((sogKn - sogLow) / (sogHigh - sogLow), 0.0, 1.0);
  return baseAlphaLow + (baseAlphaHigh - baseAlphaLow) * t;
}

function updateCogFusion({ tsMs, sogKn, hdgDeg, cogGpsDeg, transientIdx = 0 }) {
  const moving = typeof sogKn === "number" && Number.isFinite(sogKn) && sogKn > 0.3;
  const recentlyUpdated =
    typeof cogFusion.lastUpdateTsMs === "number" && tsMs - cogFusion.lastUpdateTsMs < 7000;

  let predicted = typeof cogFusion.cogDeg === "number" ? cogFusion.cogDeg : null;
  if (
    moving &&
    typeof predicted === "number" &&
    typeof hdgDeg === "number" &&
    typeof cogFusion.lastHdgDeg === "number"
  ) {
    predicted = normDeg(predicted + angleDiffDeg(hdgDeg, cogFusion.lastHdgDeg));
  } else if (moving && typeof predicted !== "number" && typeof hdgDeg === "number") {
    predicted = normDeg(hdgDeg);
  }

  if (typeof hdgDeg === "number") cogFusion.lastHdgDeg = normDeg(hdgDeg);

  let fused = predicted;
  if (typeof cogGpsDeg === "number") {
    const wGps = cogGpsWeightForSog(sogKn, transientIdx);
    fused = typeof predicted === "number" ? blendAngleDeg(predicted, cogGpsDeg, wGps) : cogGpsDeg;
    if (typeof fused === "number") {
      cogFusion.cogDeg = fused;
      cogFusion.lastUpdateTsMs = tsMs;
    }
    return typeof cogFusion.cogDeg === "number" ? cogFusion.cogDeg : null;
  }

  if (typeof predicted === "number" && (moving || recentlyUpdated)) {
    cogFusion.cogDeg = predicted;
    cogFusion.lastUpdateTsMs = tsMs;
  }
  return typeof cogFusion.cogDeg === "number" ? cogFusion.cogDeg : null;
}

function deriveSogCogInPlace(state) {
  if (typeof state?.latitude !== "number" || typeof state?.longitude !== "number") return;
  const tsMs =
    typeof state?.last_event_ts_ms === "number" ? state.last_event_ts_ms : Date.now();

  const backendActive = wsWanted && wsConn && wsConn.readyState === WebSocket.OPEN;
  const atlasSogFresh = Number.isFinite(lastField6SogTsMs) && tsMs - lastField6SogTsMs < 2500;
  const hasField6Sog =
    typeof state?.main_field_6 === "number" && Number.isFinite(state.main_field_6);
  const hdg = getRawHeadingDeg(state);
  const sogForFusion =
    typeof state?.sog_knots === "number" && Number.isFinite(state.sog_knots)
      ? state.sog_knots
      : lastDerivedSogKn;

  // Si no hay nueva posición (solo llegan frames de heading), no dejes SOG/COG congelados.
  const last = fixHistory.length ? fixHistory[fixHistory.length - 1] : null;
  if (
    last &&
    last.lat === state.latitude &&
    last.lon === state.longitude &&
    !backendActive
  ) {
    const fused = updateCogFusion({ tsMs, sogKn: sogForFusion, hdgDeg: hdg, cogGpsDeg: null });
    const ageMs = tsMs - last.tsMs;
    if (Number.isFinite(ageMs) && ageMs > 2500) {
      if (!hasField6Sog && !atlasSogFresh) state.sog_knots = null;
      const moving =
        typeof sogForFusion === "number" &&
        Number.isFinite(sogForFusion) &&
        sogForFusion > 0.3 &&
        (hasField6Sog || atlasSogFresh);
      if (!moving) {
        state.cog_deg = null;
        cogFusion = { cogDeg: null, lastHdgDeg: null, lastUpdateTsMs: null };
      } else {
        state.cog_deg = fused;
      }
    } else {
      state.cog_deg = fused;
    }
    return;
  }

  fixHistory.push({ tsMs, lat: state.latitude, lon: state.longitude });
  const cutoff = tsMs - 2000; // Reducido de 4s a 2s para menos lag en giros
  while (fixHistory.length > 2 && fixHistory[0].tsMs < cutoff) fixHistory.shift();

  let cogGps = null;
  if (fixHistory.length >= 2) {
    const first = fixHistory[0];
    const lastFix = fixHistory[fixHistory.length - 1];
    const dt = Math.max(0.001, (lastFix.tsMs - first.tsMs) / 1000.0);
    const distM = haversineM(first.lat, first.lon, lastFix.lat, lastFix.lon);
    const derivedSogKn = (distM / dt) * KNOTS_PER_MPS;
    if (Number.isFinite(derivedSogKn) && derivedSogKn > 0 && derivedSogKn <= 40) {
      lastDerivedSogKn = derivedSogKn;
      // Ignora COG GPS si la distancia es muy pequeA±a (cuantizaciA3n/noise).
      if (distM >= 1.0) cogGps = bearingDeg(first.lat, first.lon, lastFix.lat, lastFix.lon);
    }
  }

  // Si Atlas está enviando SOG (vía compact), no lo sobrescribas con el derivado del GPS del móvil.
  if (!hasField6Sog) {
    const derived = lastDerivedSogKn;
    if (typeof derived === "number" && Number.isFinite(derived)) {
      if (!backendActive && !atlasSogFresh) {
        state.sog_knots = derived;
      } else if (backendActive && typeof state.sog_knots !== "number") {
        state.sog_knots = derived;
      }
    }
  }

  const sogFusionNow =
    typeof state?.sog_knots === "number" && Number.isFinite(state.sog_knots)
      ? state.sog_knots
      : lastDerivedSogKn;

  // Calculate Rates for 6-DOF Transient index
  const dtSec = (tsMs - (dampingState.prevTs || tsMs)) / 1000.0;
  dampingState.prevTs = tsMs;
  let tIdx = 0;
  if (dtSec > 0.01) {
    const rot = Math.abs(angleDiffDeg(hdg, dampingState.lastHdg || hdg)) / dtSec;
    const roh = Math.abs((state.main_field_5 || 0) - (dampingState.lastHeel || (state.main_field_5 || 0))) / dtSec;
    const rop = Math.abs((state.main_field_4 || 0) - (dampingState.lastPitch || (state.main_field_4 || 0))) / dtSec;
    tIdx = Math.max(rot / 12.0, roh / 8.0, rop / 6.0);
    dampingState.lastHdg = hdg;
    dampingState.lastHeel = state.main_field_5;
    dampingState.lastPitch = state.main_field_4;
  }
  state.transient_idx = tIdx;

  const fused = updateCogFusion({ tsMs, sogKn: sogFusionNow, hdgDeg: hdg, cogGpsDeg: cogGps, transientIdx: tIdx });
  if (!backendActive || typeof state.cog_deg !== "number") state.cog_deg = fused;
}

function pushPerfSample(state) {
  if (!els.perfChart) return;
  if (!state?.connected) {
    resetPerfSeries();
    return;
  }

  const tsMs = typeof state.last_event_ts_ms === "number" ? state.last_event_ts_ms : Date.now();
  const sec = Math.floor(tsMs / 1000);
  if (lastPerfSec === sec) return;
  lastPerfSec = sec;

  const sogRaw = typeof state.sog_knots === "number" ? state.sog_knots : null;
  const sog =
    typeof sogRaw === "number"
      ? (emaSog = emaSog === null ? sogRaw : emaSog + CHART_ALPHA * (sogRaw - emaSog))
      : (emaSog = null);

  const targetPoint = targetPointForId(targetId);
  const cmgRaw = computeCmgKn(state, targetPoint);
  const cmg =
    typeof cmgRaw === "number"
      ? (emaCmg = emaCmg === null ? cmgRaw : emaCmg + CHART_ALPHA * (cmgRaw - emaCmg))
      : (emaCmg = null);

  const mag = getMagHeadingDeg(state);
  if (typeof mag === "number") {
    const rad = (mag * Math.PI) / 180.0;
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    emaSin = emaSin === null ? s : emaSin + CHART_ALPHA * (s - emaSin);
    emaCos = emaCos === null ? c : emaCos + CHART_ALPHA * (c - emaCos);
    const ang = (Math.atan2(emaSin, emaCos) * 180.0) / Math.PI;
    lastHdgEma = (ang + 360.0) % 360.0;
  }

  let hdg = null;
  if (typeof lastHdgEma === "number") {
    if (lastHdgUnwrapped === null) {
      lastHdgUnwrapped = lastHdgEma;
    } else {
      const prevMod = ((lastHdgUnwrapped % 360.0) + 360.0) % 360.0;
      const delta = ((lastHdgEma - prevMod + 540.0) % 360.0) - 180.0;
      lastHdgUnwrapped += delta;
    }
    hdg = lastHdgUnwrapped;
  }

  perfSamples.push({ sec, sog, cmg, hdg });
  const cutoff = sec - CHART_WINDOW_S;
  while (perfSamples.length && perfSamples[0].sec < cutoff) perfSamples.shift();
  scheduleChartDraw();
}

function scheduleChartDraw() {
  if (!els.perfChart) return;
  if (chartDrawPending) return;
  chartDrawPending = true;
  requestAnimationFrame(() => {
    chartDrawPending = false;
    drawPerfChart();
  });
}

function _niceRange(min, max, padMin) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max - min < 0.05) {
    const mid = (min + max) / 2.0;
    min = mid - 0.5;
    max = mid + 0.5;
  }
  const pad = Math.max(padMin ?? 0.5, (max - min) * 0.12);
  min -= pad;
  max += pad;
  const step = 0.5;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (max - min < 0.5) max = min + 0.5;
  return { min, max };
}

function _drawSeries(ctx, samples, xOf, yOf, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (const p of samples) {
    if (!Number.isFinite(p.v)) {
      started = false;
      continue;
    }
    const x = xOf(p);
    const y = yOf(p.v);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function drawPerfChart() {
  const canvas = els.perfChart;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(260, rect.width || 0);
  const h = Math.max(160, rect.height || 0);
  const dpr = window.devicePixelRatio || 1;
  const wantW = Math.round(w * dpr);
  const wantH = Math.round(h * dpr);
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(0, 0, w, h);

  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  ctx.fillStyle = "rgba(232,238,252,0.70)";

  if (!perfSamples.length) {
    ctx.fillText("Esperando telemetría…", 12, 20);
    return;
  }

  const endSec = perfSamples[perfSamples.length - 1].sec;
  const startSec = endSec - CHART_WINDOW_S;
  const win = perfSamples.filter((p) => p.sec >= startSec);

  const padL = 44;
  const padR = 10;
  const padT = 10;
  const padB = 18;
  const gap = 10;
  const innerW = Math.max(10, w - padL - padR);
  const innerH = Math.max(10, h - padT - padB);
  const topH = Math.max(40, Math.round(innerH * 0.60));
  const botH = Math.max(30, innerH - topH - gap);
  const topY0 = padT;
  const topY1 = padT + topH;
  const botY0 = topY1 + gap;
  const botY1 = padT + innerH;

  const xOf = (sec) => padL + ((sec - startSec) / CHART_WINDOW_S) * innerW;

  // Time grid
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  const tickStep = 30;
  const firstTick = Math.ceil(startSec / tickStep) * tickStep;
  for (let t = firstTick; t <= endSec; t += tickStep) {
    const x = xOf(t);
    ctx.beginPath();
    ctx.moveTo(x, topY0);
    ctx.lineTo(x, botY1);
    ctx.stroke();

    const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
    const ss = String(t % 60).padStart(2, "0");
    ctx.fillText(`${mm}:${ss}`, x - 16, h - 4);
  }

  // Panel 1: SOG + CMG (kn)
  let topMin = 0;
  let topMax = 0;
  let hadTop = false;
  for (const p of win) {
    for (const v of [p.sog, p.cmg]) {
      if (!Number.isFinite(v)) continue;
      if (!hadTop) {
        topMin = v;
        topMax = v;
        hadTop = true;
      } else {
        topMin = Math.min(topMin, v);
        topMax = Math.max(topMax, v);
      }
    }
  }
  if (!hadTop) {
    topMin = 0;
    topMax = 1;
  }
  topMin = Math.min(topMin, 0);
  topMax = Math.max(topMax, 0);
  const topRange = _niceRange(topMin, topMax, 0.5);
  const topDen = Math.max(0.001, topRange.max - topRange.min);
  const yTop = (v) => topY1 - ((v - topRange.min) / topDen) * topH;

  // Horizontal grid
  for (let i = 0; i <= 4; i++) {
    const y = topY0 + (i / 4.0) * topH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }

  // Zero line
  const yZero = yTop(0);
  if (yZero >= topY0 && yZero <= topY1) {
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.moveTo(padL, yZero);
    ctx.lineTo(w - padR, yZero);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.06)";

  ctx.fillStyle = "rgba(232,238,252,0.70)";
  ctx.fillText(`${topRange.max.toFixed(1)} kn`, 6, topY0 + 10);
  ctx.fillText(`${topRange.min.toFixed(1)}`, 6, topY1 - 2);
  ctx.fillText("SOG / CMG", padL, topY0 + 10);

  const sogSeries = win.map((p) => ({ sec: p.sec, v: p.sog }));
  const cmgSeries = win.map((p) => ({ sec: p.sec, v: p.cmg }));
  _drawSeries(ctx, sogSeries, (p) => xOf(p.sec), yTop, "#4ea1ff");
  _drawSeries(ctx, cmgSeries, (p) => xOf(p.sec), yTop, "#ffcc66");

  // Panel 2: Heading (deg, unwrapped)
  let botMin = 0;
  let botMax = 0;
  let hadBot = false;
  for (const p of win) {
    if (!Number.isFinite(p.hdg)) continue;
    if (!hadBot) {
      botMin = p.hdg;
      botMax = p.hdg;
      hadBot = true;
    } else {
      botMin = Math.min(botMin, p.hdg);
      botMax = Math.max(botMax, p.hdg);
    }
  }
  if (!hadBot) {
    botMin = 0;
    botMax = 360;
  }
  const botRange = _niceRange(botMin, botMax, 5.0);
  const botDen = Math.max(0.001, botRange.max - botRange.min);
  const yBot = (v) => botY1 - ((v - botRange.min) / botDen) * botH;

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let i = 0; i <= 3; i++) {
    const y = botY0 + (i / 3.0) * botH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
  }

  const mod360 = (v) => ((v % 360.0) + 360.0) % 360.0;
  ctx.fillStyle = "rgba(232,238,252,0.70)";
  ctx.fillText(`${mod360(botRange.max).toFixed(0)}°`, 8, botY0 + 10);
  ctx.fillText(`${mod360(botRange.min).toFixed(0)}°`, 8, botY1 - 2);
  ctx.fillText("HDG (mag)", padL, botY0 + 10);

  const hdgSeries = win.map((p) => ({ sec: p.sec, v: p.hdg }));
  _drawSeries(ctx, hdgSeries, (p) => xOf(p.sec), yBot, "#c084fc");
}

function drawTrack() {
  if (!map) {
    initMap();
  }

  // Actualizar track polyline
  if (trackPoints.length > 1) {
    const latlngs = trackPoints.map((p) => [p.lat, p.lon]);
    if (!trackPolyline) {
      trackPolyline = L.polyline(latlngs, {
        color: "#4ea1ff",
        weight: 3,
        opacity: 0.9,
      }).addTo(map);
    } else {
      trackPolyline.setLatLngs(latlngs);
    }
  } else if (trackPolyline) {
    map.removeLayer(trackPolyline);
    trackPolyline = null;
  }

  // Posición actual (último punto del track)
  if (trackPoints.length > 0) {
    const last = trackPoints[trackPoints.length - 1];
    if (!positionMarker) {
      positionMarker = L.circleMarker([last.lat, last.lon], {
        radius: 8,
        fillColor: "#fff",
        color: "#4ea1ff",
        weight: 2,
        opacity: 1,
        fillOpacity: 1,
      }).addTo(map);
    } else {
      positionMarker.setLatLng([last.lat, last.lon]);
    }
  } else if (positionMarker) {
    map.removeLayer(positionMarker);
    positionMarker = null;
  }

  // Marca / balizas (draggable para corregir GPS)
  markMarker = upsertDraggableMarker(markMarker, mark, {
    color: "#ffcc66",
    text: "M",
    popup: "Marca",
    cmd: "set_mark",
  });
  windwardMarker = upsertDraggableMarker(windwardMarker, windward, {
    color: "#c084fc",
    text: "W",
    popup: "Barlovento",
    cmd: "set_windward",
  });
  leewardPortMarker = upsertDraggableMarker(leewardPortMarker, leewardPort, {
    color: "#ff5d5d",
    text: "LP",
    popup: "Sotavento P",
    cmd: "set_leeward_port",
  });
  leewardStarboardMarker = upsertDraggableMarker(
    leewardStarboardMarker,
    leewardStarboard,
    {
      color: "#ffa94d",
      text: "LS",
      popup: "Sotavento S",
      cmd: "set_leeward_starboard",
    },
  );
  wingMarker = upsertDraggableMarker(wingMarker, wingMark, {
    color: "#ff88ff",
    text: "Wi",
    popup: "Wing / Gybe",
    cmd: "set_wing",
  });
  reachMarker = upsertDraggableMarker(reachMarker, reachMark, {
    color: "#ff88ff",
    text: "Re",
    popup: "Reach",
    cmd: "set_reach",
  });

  // Línea de salida (PIN/RCB)
  pinMarker = upsertDraggableMarker(pinMarker, startLine?.pin, {
    color: "#4dffb5",
    text: "PIN",
    popup: "PIN",
    cmd: "set_start_pin",
  });
  rcbMarker = upsertDraggableMarker(rcbMarker, startLine?.rcb, {
    color: "#4dffb5",
    text: "RCB",
    popup: "RCB",
    cmd: "set_start_rcb",
  });

  if (startLine?.pin && startLine?.rcb) {
    const latlngs = [
      [startLine.pin.lat, startLine.pin.lon],
      [startLine.rcb.lat, startLine.rcb.lon],
    ];
    if (!startLinePolyline) {
      startLinePolyline = L.polyline(latlngs, {
        color: "#00ff9d",
        weight: 5,
        opacity: 1.0,
      }).addTo(map);
    } else {
      startLinePolyline.setLatLngs(latlngs);
    }
  } else if (startLinePolyline) {
    map.removeLayer(startLinePolyline);
    startLinePolyline = null;
  }

  // Puerta de sotavento (línea entre balizas, si están)
  if (leewardPort && leewardStarboard) {
    const latlngs = [
      [leewardPort.lat, leewardPort.lon],
      [leewardStarboard.lat, leewardStarboard.lon],
    ];
    if (!leewardGatePolyline) {
      leewardGatePolyline = L.polyline(latlngs, {
        color: "#ffdd00",
        weight: 4,
        opacity: 0.95,
        dashArray: "8,8",
      }).addTo(map);
    } else {
      leewardGatePolyline.setLatLngs(latlngs);
    }
  } else if (leewardGatePolyline) {
    map.removeLayer(leewardGatePolyline);
    leewardGatePolyline = null;
  }

  // Línea al objetivo (si hay uno seleccionado)
  const t = targetPointForId(targetId);
  if (trackPoints.length > 0 && t) {
    const last = trackPoints[trackPoints.length - 1];
    const latlngs = [
      [last.lat, last.lon],
      [t.lat, t.lon],
    ];
    if (!targetLinePolyline) {
      targetLinePolyline = L.polyline(latlngs, {
        color: "#ffaa00",
        weight: 3,
        opacity: 0.9,
        dashArray: "10,8",
      }).addTo(map);
    } else {
      targetLinePolyline.setLatLngs(latlngs);
    }
  } else if (targetLinePolyline) {
    map.removeLayer(targetLinePolyline);
    targetLinePolyline = null;
  }

  // Draw Course Geometry (Triangle/Trapezoid/WL)
  const coursePoints = [];
  if (currentCourseType === "Triangle") {
    // W -> Wing -> Leeward -> W
    if (windward) coursePoints.push([windward.lat, windward.lon]);
    if (wingMark) coursePoints.push([wingMark.lat, wingMark.lon]);
    if (leewardPort || leewardStarboard) {
      const l = leewardPort || leewardStarboard;
      coursePoints.push([l.lat, l.lon]);
    }
    if (windward) coursePoints.push([windward.lat, windward.lon]); // Close loop
  } else if (currentCourseType === "Trapezoid") {
    // W -> Reach -> Leeward -> Reach -> W (simplified)
    if (windward) coursePoints.push([windward.lat, windward.lon]);
    if (reachMark) coursePoints.push([reachMark.lat, reachMark.lon]);
    if (leewardPort || leewardStarboard) {
      const l = leewardPort || leewardStarboard;
      coursePoints.push([l.lat, l.lon]);
    }
    // TODO: support 2nd reach mark if needed
  } else {
    // W/L: just W <-> Leeward
    if (windward && (leewardPort || leewardStarboard)) {
      coursePoints.push([windward.lat, windward.lon]);
      const l = leewardPort || leewardStarboard; // or gate center
      coursePoints.push([l.lat, l.lon]);
    }
  }

  if (coursePoints.length > 1) {
    if (!coursePolyline) {
      coursePolyline = L.polyline(coursePoints, {
        color: "#ffffff",
        weight: 3,
        dashArray: "10,6",
        opacity: 0.8,
      }).addTo(map);
    } else {
      coursePolyline.setLatLngs(coursePoints);
    }
  } else if (coursePolyline) {
    map.removeLayer(coursePolyline);
    coursePolyline = null;
  }

  drawLaylines();
}

function courseBottomPoint() {
  if (leewardPort && leewardStarboard) return midpointPoint(leewardPort, leewardStarboard);
  if (leewardPort) return leewardPort;
  if (leewardStarboard) return leewardStarboard;
  if (startLine?.pin && startLine?.rcb) return midpointPoint(startLine.pin, startLine.rcb);
  return null;
}

function upwindAxisDeg(fallbackPoint) {
  const bottom = courseBottomPoint();
  const up = windward || fallbackPoint;
  if (!bottom || !up) return null;
  return bearingDeg(bottom.lat, bottom.lon, up.lat, up.lon);
}

function laylineAnchorPoint() {
  const t = targetPointForId(targetId);
  if (t && (targetId === "windward" || targetId === "mark")) return t;
  return windward;
}

function drawLaylines() {
  const laylineDist = 3000; // 3km
  const lines = [];

  const anchor = laylineAnchorPoint();
  const axis = upwindAxisDeg(anchor);
  if (anchor && typeof axis === "number") {
    const p1 = projectPoint(anchor.lat, anchor.lon, axis + 135, laylineDist);
    lines.push([[anchor.lat, anchor.lon], [p1.lat, p1.lon]]);
    const p2 = projectPoint(anchor.lat, anchor.lon, axis + 225, laylineDist);
    lines.push([[anchor.lat, anchor.lon], [p2.lat, p2.lon]]);
  }

  // TODO: Leeward laylines (gybing angles) if needed?

  if (lines.length > 0) {
    if (!laylinesPolyline) {
      laylinesPolyline = L.polyline(lines, {
        color: "#ff3333",
        weight: 4,
        dashArray: "10,8",
        opacity: 1.0,
      }).addTo(map);
    } else {
      laylinesPolyline.setLatLngs(lines);
    }
  } else if (laylinesPolyline) {
    map.removeLayer(laylinesPolyline);
    laylinesPolyline = null;
  }
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

function computeLaylineEtasForTarget(targetPoint) {
  if (!targetPoint) return null;

  const axis = upwindAxisDeg(targetPoint);
  if (typeof axis !== "number") return null;

  const lat = lastState?.latitude;
  const lon = lastState?.longitude;
  const sogKn = lastState?.sog_knots;
  const cogDeg = lastState?.cog_deg;

  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    typeof sogKn !== "number" ||
    typeof cogDeg !== "number" ||
    sogKn <= 0.05 ||
    sogKn > 40
  ) {
    return null;
  }

  const toRad = (x) => (x * Math.PI) / 180.0;
  const R = 6371000.0;
  const lat0 = toRad(targetPoint.lat);
  const lon0 = toRad(targetPoint.lon);
  const phi = toRad(lat);
  const lambda = toRad(lon);
  const p = {
    x: (lambda - lon0) * Math.cos(lat0) * R,
    y: (phi - lat0) * R,
  };

  const sogMps = sogKn / KNOTS_PER_MPS;
  const cog = toRad(cogDeg);
  const v = {
    x: Math.sin(cog) * sogMps,
    y: Math.cos(cog) * sogMps,
  };

  const timeToLaylineS = (bearingDeg) => {
    const brg = toRad(((bearingDeg % 360) + 360) % 360);
    const d = { x: Math.sin(brg), y: Math.cos(brg) }; // ray from mark downwind
    const det = cross2(d, v);
    if (Math.abs(det) < 1e-6) return null;

    const rhs = { x: -p.x, y: -p.y };
    const t = cross2(d, rhs) / det;
    const u = cross2(v, rhs) / det;
    if (!Number.isFinite(t) || !Number.isFinite(u) || t < 0 || u < 0) return null;
    return t;
  };

  return {
    starboardS: timeToLaylineS(axis + 135),
    portS: timeToLaylineS(axis + 225),
  };
}

function formatLaylineEtaText(targetPoint) {
  const show = targetId === "windward" || targetId === "mark";
  if (!show) return "—";

  const etas = computeLaylineEtasForTarget(targetPoint);
  if (!etas) return "—";

  const hasAny = typeof etas.starboardS === "number" || typeof etas.portS === "number";
  if (!hasAny) return "—";

  const es = typeof etas.starboardS === "number" ? fmtDuration(etas.starboardS) : "—";
  const ba = typeof etas.portS === "number" ? fmtDuration(etas.portS) : "—";
  return `ES ${es} · BA ${ba}`;
}

function updateMarkStats() {
  if (
    !mark ||
    typeof lastState?.latitude !== "number" ||
    typeof lastState?.longitude !== "number"
  ) {
    els.markDist.textContent = "—";
    els.markBrg.textContent = "—";
    return;
  }
  const distM = haversineM(
    lastState.latitude,
    lastState.longitude,
    mark.lat,
    mark.lon,
  );
  const brg = bearingDeg(
    lastState.latitude,
    lastState.longitude,
    mark.lat,
    mark.lon,
  );
  els.markDist.textContent = `${distM.toFixed(0)} m`;
  els.markBrg.textContent = `${brg.toFixed(1)}°`;
}

function updateTargetStats() {
  if (!els.targetDist) return;
  if (els.targetLaylineEta) els.targetLaylineEta.textContent = "—";

  const targetLabel = targetLabelForId(targetId);
  const targetPoint = targetPointForId(targetId);

  const hasFix =
    typeof lastState?.latitude === "number" && typeof lastState?.longitude === "number";

  if (!targetId) {
    els.targetHint.textContent = "Selecciona un objetivo";
    els.targetDist.textContent = "—";
    els.targetBrg.textContent = "—";
    els.targetCmg.textContent = "—";
    els.targetEta.textContent = "—";
    return;
  }

  if (!targetPoint) {
    els.targetHint.textContent = `${targetLabel ?? "Objetivo"} no fijado`;
    els.targetDist.textContent = "—";
    els.targetBrg.textContent = "—";
    els.targetCmg.textContent = "—";
    els.targetEta.textContent = "—";
    return;
  }

  if (!hasFix) {
    els.targetHint.textContent = `${targetLabel ?? "Objetivo"} (sin GPS)`;
    els.targetDist.textContent = "—";
    els.targetBrg.textContent = "—";
    els.targetCmg.textContent = "—";
    els.targetEta.textContent = "—";
    return;
  }

  const distM = haversineM(
    lastState.latitude,
    lastState.longitude,
    targetPoint.lat,
    targetPoint.lon,
  );
  const brg = bearingDeg(
    lastState.latitude,
    lastState.longitude,
    targetPoint.lat,
    targetPoint.lon,
  );

  els.targetHint.textContent = targetLabel ?? "Objetivo";
  els.targetDist.textContent = `${distM.toFixed(0)} m`;
  els.targetBrg.textContent = `${brg.toFixed(1)}°`;

  const sog = lastState?.sog_knots;
  const cog = lastState?.cog_deg;
  if (typeof sog !== "number" || typeof cog !== "number" || sog <= 0) {
    els.targetCmg.textContent = "—";
    els.targetEta.textContent = "—";
    return;
  }

  const deltaDeg = ((cog - brg + 540.0) % 360.0) - 180.0;
  const cmgKn = sog * Math.cos((deltaDeg * Math.PI) / 180.0);
  els.targetCmg.textContent = Number.isFinite(cmgKn) ? `${cmgKn.toFixed(2)} kn` : "—";

  // ETA usando CMG positivo (hacia la baliza)
  if (cmgKn > 0.05) {
    const cmgMps = cmgKn * 0.5144444444444444;
    els.targetEta.textContent = fmtDuration(distM / Math.max(0.01, cmgMps));
  } else {
    els.targetEta.textContent = "—";
  }

  if (els.targetLaylineEta) {
    els.targetLaylineEta.textContent = formatLaylineEtaText(targetPoint);
  }
}

function updateStartLineStats() {
  const hasFix =
    typeof lastState?.latitude === "number" && typeof lastState?.longitude === "number";
  const pin = startLine?.pin;
  const rcb = startLine?.rcb;

  const followAtlas = !!startLine?.followAtlas;
  els.startSource.textContent = `Fuente: ${followAtlas ? "Atlas2" : "Manual"}`;
  if (els.toggleStartAuto) {
    const backendActive = !useLocalMarks && wsConn && wsConn.readyState === WebSocket.OPEN;
    const bleActive = useLocalMarks && supportsWebBluetooth();
    els.toggleStartAuto.disabled = !(backendActive || bleActive);
    els.toggleStartAuto.textContent = followAtlas ? "Auto Atlas2: ON" : "Auto Atlas2: OFF";
  }

  if (!pin) {
    els.pinDist.textContent = "—";
    els.pinBrg.textContent = "—";
  } else if (!hasFix) {
    els.pinDist.textContent = "—";
    els.pinBrg.textContent = "—";
  } else {
    const d = haversineM(lastState.latitude, lastState.longitude, pin.lat, pin.lon);
    const b = bearingDeg(lastState.latitude, lastState.longitude, pin.lat, pin.lon);
    els.pinDist.textContent = `${d.toFixed(0)} m`;
    els.pinBrg.textContent = `${b.toFixed(1)}°`;
  }

  if (!rcb) {
    els.rcbDist.textContent = "—";
    els.rcbBrg.textContent = "—";
  } else if (!hasFix) {
    els.rcbDist.textContent = "—";
    els.rcbBrg.textContent = "—";
  } else {
    const d = haversineM(lastState.latitude, lastState.longitude, rcb.lat, rcb.lon);
    const b = bearingDeg(lastState.latitude, lastState.longitude, rcb.lat, rcb.lon);
    els.rcbDist.textContent = `${d.toFixed(0)} m`;
    els.rcbBrg.textContent = `${b.toFixed(1)}°`;
  }

  if (!pin || !rcb) {
    els.lineBrg.textContent = "—";
    els.lineLen.textContent = "—";
    els.distLine.textContent = "—";
    els.etaLine.textContent = "—";
    return;
  }

  const lineBearing = bearingDeg(pin.lat, pin.lon, rcb.lat, rcb.lon);
  const lineLen = haversineM(pin.lat, pin.lon, rcb.lat, rcb.lon);
  els.lineBrg.textContent = `${lineBearing.toFixed(1)}°`;
  els.lineLen.textContent = `${lineLen.toFixed(0)} m`;

  if (!hasFix) {
    els.distLine.textContent = "—";
    els.etaLine.textContent = "—";
    return;
  }

  const p = { lat: lastState.latitude, lon: lastState.longitude };
  const { distM } = distToLineM(p, pin, rcb);
  els.distLine.textContent = `${distM.toFixed(0)} m`;

  const sog = lastState?.sog_knots;
  if (typeof sog === "number" && sog > 0.05 && sog < 40) {
    const mps = sog / 1.9438444924406048;
    els.etaLine.textContent = fmtDuration(distM / Math.max(0.01, mps));
  } else {
    els.etaLine.textContent = "—";
  }
}

function applyState(state) {
  const rawState = state;

  // Atlas: Field 6 parece ser SOG en m/s (mejor que compact/derivado). Normaliza a nudos.
  if (typeof rawState?.main_field_6 === "number" && Number.isFinite(rawState.main_field_6)) {
    const kn = rawState.main_field_6 * KNOTS_PER_MPS;
    if (Number.isFinite(kn) && kn >= 0 && kn <= 60) {
      rawState.sog_knots = kn;
    }
  }

  // En modo BLE directo no recibimos SOG/COG: lo derivamos de lat/lon recientes.
  deriveSogCogInPlace(rawState);
  const uiState = applyDynamicDamping(rawState);
  lastState = uiState;
  state = uiState;

  const connected = !!state.connected;
  const extra = state.last_error ? ` (${shortErr(state.last_error)})` : "";
  setText(
    els.status,
    connected
      ? `Conectado (${state.device_address ?? "?"})${extra}`
      : `Desconectado${extra}`,
  );
  if (els.status) {
    els.status.className =
      connected && state.last_error
        ? "status status--warning"
        : connected
          ? "status status--connected"
          : "status status--disconnected";
  }

  const hdgMag = getMagHeadingDeg(state);
  setText(els.navHdg, fmtDeg(hdgMag));
  setText(els.navSog, fmtKn(state.sog_knots));
  setText(els.navCog, fmtDeg(state.cog_deg));
  setText(els.navCogInline, fmtDeg(state.cog_deg));

  let src = "—";
  const hs = getRawHeadingSource(state);
  if (hs === "main") src = "HDG: main";
  setText(els.navSrc, src);

  if (typeof hdgMag === "number" && typeof state.cog_deg === "number") {
    const delta = ((state.cog_deg - hdgMag + 540.0) % 360.0) - 180.0;
    setText(els.navDelta, fmtSignedDeg(delta));
  } else {
    setText(els.navDelta, "—");
  }

  setText(
    els.navLast,
    state.last_event_ts_ms ? new Date(state.last_event_ts_ms).toLocaleTimeString() : "—",
  );

  const marks = state.marks || {};
  if (!useLocalMarks) {
    mark = marks.mark ? { lat: marks.mark.lat, lon: marks.mark.lon } : null;
    windward = marks.windward ? { lat: marks.windward.lat, lon: marks.windward.lon } : null;
    leewardPort = marks.leeward_port
      ? { lat: marks.leeward_port.lat, lon: marks.leeward_port.lon }
      : null;
    leewardStarboard = marks.leeward_starboard
      ? { lat: marks.leeward_starboard.lat, lon: marks.leeward_starboard.lon }
      : null;
    wingMark = marks.wing_mark ? { lat: marks.wing_mark.lat, lon: marks.wing_mark.lon } : null;
    reachMark = marks.reach_mark ? { lat: marks.reach_mark.lat, lon: marks.reach_mark.lon } : null;
    targetId = marks.target ?? null;
    const startFollowAtlas = marks.start_line_follow_atlas !== false;
    startLine = {
      pin: marks.start_pin ? { lat: marks.start_pin.lat, lon: marks.start_pin.lon } : null,
      rcb: marks.start_rcb ? { lat: marks.start_rcb.lat, lon: marks.start_rcb.lon } : null,
      followAtlas: startFollowAtlas,
      source: startFollowAtlas ? "Atlas2 (auto)" : "Manual",
    };
    currentCourseType = marks.course_type || "W/L";
    if (els.courseType && els.courseType.value !== currentCourseType) {
      els.courseType.value = currentCourseType;
    }
  }
  if (els.targetSelect) {
    const wanted = targetId || "";
    if (els.targetSelect.value !== wanted) {
      els.targetSelect.value = wanted;
    }
  }

  // Atlas: en la práctica estos dos campos vienen invertidos (heel/pitch).
  setText(els.heel, typeof state.main_field_5 === "number" ? fmtDeg(state.main_field_5) : "-");
  setText(els.pitch, typeof state.main_field_4 === "number" ? fmtDeg(state.main_field_4) : "-");
  setText(
    els.field6,
    typeof state.main_field_6 === "number"
      ? `${fmtNum(state.main_field_6, 2)} m/s (${fmtKn(state.main_field_6 * KNOTS_PER_MPS)})`
      : "—",
  );
  const cogTest = state.main_cog_test_deg;
  if (typeof cogTest === "number" && Number.isFinite(cogTest)) {
    let extra = "";
    if (typeof state.cog_deg === "number" && Number.isFinite(state.cog_deg)) {
      const delta = ((cogTest - state.cog_deg + 540.0) % 360.0) - 180.0;
      extra = ` (${fmtSignedDeg(delta)})`;
    }
    setText(els.cogTest, `${fmtDeg(cogTest)}${extra}`);
  } else {
    setText(els.cogTest, "—");
  }
  setText(els.compact2, typeof state.compact_field_2 === "number" ? String(state.compact_field_2) : "—");

  if (typeof rawState.latitude === "number" && typeof rawState.longitude === "number") {
    const ts = rawState.last_event_ts_ms || Date.now();
    const next = { lat: rawState.latitude, lon: rawState.longitude };

    // Ignore near-zero - Africa issue
    if (Math.abs(next.lat) < 1e-4 && Math.abs(next.lon) < 1e-4) {
      // ignore
    } else {
      const last = trackPoints.length ? trackPoints[trackPoints.length - 1] : null;
      const lastTs = lastTrackTsMs;

      if (last && typeof lastTs === "number") {
        const dt = Math.max(0.001, (ts - lastTs) / 1000.0);
        const distM = haversineM(last.lat, last.lon, next.lat, next.lon);
        const speedKn = (distM / dt) * KNOTS_PER_MPS;

        if (speedKn < 35) {
          trackPoints.push(next);
          lastTrackTsMs = ts;
        } else if (distM > 100 * 1000) {
          // Massive jump (>100km): likely a reset from Africa/NoFix to valid position.
          // Let's reset the track instead of ignoring forever.
          trackPoints = [next];
          lastTrackTsMs = ts;
        }
      } else {
        trackPoints.push(next);
        lastTrackTsMs = ts;
      }

      if (trackPoints.length > 120) trackPoints.shift();
    }
  }

  drawTrack();
  updateMarkStats();
  updateTargetStats();
  pushPerfSample(state);
  updateStartLineStats();
  recDashboardSnapshot(state);
}

function applyBlePartialState(partial) {
  const merged = { ...(lastState || {}), ...(partial || {}) };
  if (useLocalMarks) {
    merged.marks = ensureMarksShape(localMarks || loadLocalMarks() || {});
  }
  applyState(merged);
}

function dvSubView(dv, offset) {
  try {
    if (!dv || typeof dv.byteLength !== "number") return null;
    if (!Number.isFinite(offset) || offset < 0 || offset > dv.byteLength) return null;
    return new DataView(dv.buffer, dv.byteOffset + offset, dv.byteLength - offset);
  } catch {
    return null;
  }
}

function parseMainPacketInner(dataView) {
  const len = dataView.byteLength;
  if (len < 20) return null;
  const msgType = dataView.getUint8(0);
  if (msgType !== 0x02) return null;
  const msgSubtype = dataView.getUint8(1);
  const reserved = [];
  for (let i = 2; i < Math.min(8, len); i++) reserved.push(dataView.getUint8(i));
  const getF32 = (off) => {
    if (len < off + 4) return null;
    const v = dataView.getFloat32(off, true);
    return Number.isFinite(v) ? v : null;
  };
  let latitude = getF32(8);
  let longitude = getF32(12);

  // Discovery fallback for new firmware versions (if 0,0 at default offsets)
  if ((latitude === null || Math.abs(latitude) < 1e-4) && (longitude === null || Math.abs(longitude) < 1e-4)) {
    for (let off = 2; off <= len - 8; off++) {
      const tl = getF32(off);
      const to = getF32(off + 4);
      if (tl && to && Math.abs(tl) > 35.0 && Math.abs(tl) < 65.0 && Math.abs(to) < 180.0) {
        latitude = tl;
        longitude = to;
        break;
      }
    }
  }

  const heading = getF32(16);
  const f4 = getF32(20);
  const f5 = getF32(24);
  const f6 = getF32(28);
  const cogTest = getF32(32);
  let tailHex = null;
  if (len >= 36) {
    const tail = [];
    for (let i = 32; i < 36; i++) tail.push(dataView.getUint8(i));
    tailHex = tail.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const reservedHex = reserved.map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    ts_ms: Date.now(),
    msg_type: msgType,
    msg_subtype: msgSubtype,
    latitude,
    longitude,
    heading_deg: heading,
    field_4: f4,
    field_5: f5,
    field_6: f6,
    cog_test_deg: cogTest,
    reserved_hex: reservedHex,
    tail_hex: tailHex,
    raw_len: len,
  };
}

function parseMainPacket(dataView) {
  const len = dataView.byteLength;
  if (len < 20) return null;
  const direct = parseMainPacketInner(dataView);
  if (direct) return direct;

  // Fallback: algunos stacks/BLE capturas incluyen 1-3 bytes de prefijo.
  for (let off = 1; off <= Math.min(3, len - 20); off++) {
    if (dataView.getUint8(off) !== 0x02) continue;
    const view = dvSubView(dataView, off);
    if (!view) continue;
    const parsed = parseMainPacketInner(view);
    if (parsed) return { ...parsed, offset: off };
  }
  return null;
}

function parseCompactPacketInner(dataView) {
  const len = dataView.byteLength;
  if (len < 6) return null;
  const msgType = dataView.getUint8(0);
  if (msgType !== 0xfe) return null;
  const msgSubtype = dataView.getUint8(1);
  const headingRaw = dataView.getUint16(2, true);
  const scale = headingRaw > 3600 ? 100.0 : 10.0;
  const heading = headingRaw / scale;
  const field2 = dataView.getUint16(4, true);
  return {
    ts_ms: Date.now(),
    msg_type: msgType,
    msg_subtype: msgSubtype,
    heading_deg: heading,
    field_2: field2,
    raw_len: len,
  };
}

function parseCompactPacket(dataView) {
  const len = dataView.byteLength;
  if (len < 6) return null;
  const direct = parseCompactPacketInner(dataView);
  if (direct) return direct;

  for (let off = 1; off <= Math.min(3, len - 6); off++) {
    if (dataView.getUint8(off) !== 0xfe) continue;
    const view = dvSubView(dataView, off);
    if (!view) continue;
    const parsed = parseCompactPacketInner(view);
    if (parsed) return { ...parsed, offset: off };
  }
  return null;
}


/**
 * Keeps the screen awake if supported and requested.
 */
class WakeLockManager {
  constructor() {
    this.lock = null;
    this.requested = false;
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    document.addEventListener("visibilitychange", this._onVisibilityChange);
  }

  async setRequested(requested) {
    this.requested = requested;
    if (requested) {
      await this.acquire();
    } else {
      await this.release();
    }
  }

  async acquire() {
    if (!this.requested || !("wakeLock" in navigator)) return;
    if (this.lock) return;
    try {
      this.lock = await navigator.wakeLock.request("screen");
      console.log("[WakeLock] Acquired");
      this.lock.addEventListener("release", () => {
        console.log("[WakeLock] Released by system");
        this.lock = null;
      });
    } catch (err) {
      console.error("[WakeLock] Failed to acquire:", err);
    }
  }

  async release() {
    if (this.lock) {
      await this.lock.release();
      this.lock = null;
      console.log("[WakeLock] Released manually");
    }
  }

  async _onVisibilityChange() {
    if (document.visibilityState === "visible" && this.requested) {
      await this.acquire();
    }
  }
}

/**
 * Uses a silent audio loop to keep the browser process active in the background.
 */
class BackgroundPersistenceManager {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.requested = false;
  }

  setRequested(requested) {
    this.requested = requested;
    if (requested) {
      this.start();
    } else {
      this.stop();
    }
  }

  start() {
    if (!this.requested) return;
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Oscillator with 0 gain is enough to signal "active media playback"
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      this.osc = this.ctx.createOscillator();
      this.osc.connect(gain);
      gain.connect(this.ctx.destination);
      this.osc.start();
      console.log("[BackgroundMode] Audio context started (silent)");
    } catch (err) {
      console.error("[BackgroundMode] Failed to start:", err);
    }
  }

  stop() {
    if (this.osc) {
      try { this.osc.stop(); } catch { }
      this.osc = null;
    }
    if (this.ctx) {
      try { this.ctx.close(); } catch { }
      this.ctx = null;
      console.log("[BackgroundMode] Audio context stopped");
    }
  }
}

const wakeLockMgr = new WakeLockManager();
const bgMgr = new BackgroundPersistenceManager();

class AtlasWebBleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.mainChar = null;
    this.compactChar = null;
    this.cmd1Char = null;
    this.cmd2Char = null;
    this.pollTimer = null;
    this.pollInFlight = false;
    this.lastMainTs = 0;
    this.lastCompactTs = 0;
    this.cmdPollTimer = null;
    this.cmdPollInFlight = false;
    this.noDataTimer = null;

    this.lastMainRxTs = 0;
    this.lastCompactRxTs = 0;
    this.lastMainOkTs = 0;
    this.lastCompactOkTs = 0;
    this.rxMainCount = 0;
    this.okMainCount = 0;
    this.rxCompactCount = 0;
    this.okCompactCount = 0;
    this.lastMainType = null;
    this.lastMainLen = null;
    this.lastMainHeadHex = null;
    this.lastCompactType = null;
    this.lastCompactLen = null;
    this.lastCompactHeadHex = null;

    this.onDisconnected = this.onDisconnected.bind(this);
    this.onMain = this.onMain.bind(this);
    this.onCompact = this.onCompact.bind(this);
    this.onCmd1 = this.onCmd1.bind(this);
    this.onCmd2 = this.onCmd2.bind(this);
  }

  async connect(options = {}) {
    if (!supportsWebBluetooth()) throw new Error("Web Bluetooth no disponible");
    this.lastMainTs = 0;
    this.lastCompactTs = 0;
    this.cmdPollInFlight = false;
    this.lastMainRxTs = 0;
    this.lastCompactRxTs = 0;
    this.lastMainOkTs = 0;
    this.lastCompactOkTs = 0;
    this.rxMainCount = 0;
    this.okMainCount = 0;
    this.rxCompactCount = 0;
    this.okCompactCount = 0;
    this.lastMainType = null;
    this.lastMainLen = null;
    this.lastMainHeadHex = null;
    this.lastCompactType = null;
    this.lastCompactLen = null;
    this.lastCompactHeadHex = null;
    this.cmd1Char = null;
    this.cmd2Char = null;
    if (this.noDataTimer) {
      clearTimeout(this.noDataTimer);
      this.noDataTimer = null;
    }
    if (this.cmdPollTimer) {
      clearInterval(this.cmdPollTimer);
      this.cmdPollTimer = null;
    }
    setBleUi(false, "Selecciona el Atlas 2…");

    // Algunos firmwares no anuncian el servicio propietario hasta estar conectados.
    // En ese caso, filtrar por servicio deja el selector vacío en Android.
    // Preferimos filtrar por nombre y ofrecemos fallback a "mostrar todos".
    const acceptAll = !!options.acceptAllDevices;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (acceptAll) {
        this.device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [VAKAROS_SERVICE_UUID],
        });
      } else {
        try {
          this.device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: "Atlas" }, { services: [VAKAROS_SERVICE_UUID] }],
            optionalServices: [VAKAROS_SERVICE_UUID],
          });
        } catch (e) {
          const name = e?.name || "";
          if (name === "NotFoundError") {
            const ok = confirm(
              "Si el selector se queda buscando sin mostrar dispositivos, pulsa Atrás para cancelar.\n\n¿Quieres mostrar TODOS los BLE cercanos? (puede haber muchos)\n\nTip: Ubicación activada + Vakaros Connect cerrado.",
            );
            if (ok) {
              return this.connect({ acceptAllDevices: true });
            }
          }
          throw e;
        }
      }

      this.device.addEventListener("gattserverdisconnected", this.onDisconnected);
      this.server = await this.device.gatt.connect();

      let service;
      try {
        service = await this.server.getPrimaryService(VAKAROS_SERVICE_UUID);
      } catch (e) {
        // Si el usuario eligió otro BLE, no tendrá el servicio Vakaros.
        // Lo indicamos claramente y permitimos reintentar (para listas con nombres raros).
        this.disconnect();
        const ok = confirm(
          "Ese dispositivo no parece ser el Atlas 2 (no expone el servicio Vakaros).\n\n¿Quieres probar con otro?",
        );
        if (ok) {
          continue;
        }
        throw e;
      }

      this.mainChar = await service.getCharacteristic(VAKAROS_CHAR_TELEMETRY_MAIN);
      this.compactChar = await service.getCharacteristic(VAKAROS_CHAR_TELEMETRY_COMPACT);
      try {
        this.cmd1Char = await service.getCharacteristic(VAKAROS_CHAR_COMMAND_1);
      } catch {
        this.cmd1Char = null;
      }
      try {
        this.cmd2Char = await service.getCharacteristic(VAKAROS_CHAR_COMMAND_2);
      } catch {
        this.cmd2Char = null;
      }

      const name = this.device.name || "Atlas";
      wsWanted = false;
      if (wsConn && wsConn.readyState <= WebSocket.OPEN) {
        try {
          wsConn.close();
        } catch {
          // ignore
        }
      }
      useLocalMarks = true;
      localMarks = ensureMarksShape(loadLocalMarks() || {});
      applyLocalMarksToUi();

      setBleUi(true, `Conectado: ${name}`);
      applyBlePartialState({
        connected: true,
        device_address: name,
        last_error: null,
      });

      await this.startNotifications();
      this.startPolling();
      this.startCmdPolling();
      this.startNoDataWatchdog();

      // Persistence - Start if requested
      await wakeLockMgr.setRequested(els.bleWakeLock?.checked);
      bgMgr.setRequested(els.bleBackground?.checked);

      return;
    }

    throw new Error("No se pudo seleccionar el Atlas 2.");
  }

  onDisconnected() {
    this.disconnect();
  }

  onMain(evt) {
    const dv = evt.target.value;
    const source = evt?.vklSource || "telemetry_main_notify";
    const now = Date.now();
    this.rxMainCount++;
    this.lastMainRxTs = now;
    if (sessionRec.active) {
      recAdd("ble_rx", {
        chan: "main",
        raw_b64: dvToBase64(dv),
        raw_len: dv?.byteLength ?? null,
      });
    }
    try {
      this.lastMainLen = dv?.byteLength ?? null;
      this.lastMainType =
        typeof dv?.byteLength === "number" && dv.byteLength >= 1 ? dv.getUint8(0) : null;
      this.lastMainHeadHex = dvPrefixHex(dv, 14);
    } catch {
      // ignore
    }
    const parsed = parseMainPacket(dv);
    const boatLat = Number.isFinite(parsed?.latitude)
      ? parsed.latitude
      : Number.isFinite(lastState?.latitude)
        ? lastState.latitude
        : null;
    const boatLon = Number.isFinite(parsed?.longitude)
      ? parsed.longitude
      : Number.isFinite(lastState?.longitude)
        ? lastState.longitude
        : null;
    maybeAutoStartLineFromBle(dv, source, { boatLat, boatLon, tsMs: parsed?.ts_ms });
    if (!parsed) return;
    if (sessionRec.active) {
      recAdd("ble_parsed", { chan: "main", parsed });
    }

    const sogField6Mps = parsed.field_6;
    const sogField6Kn =
      typeof sogField6Mps === "number" && Number.isFinite(sogField6Mps) ? sogField6Mps * KNOTS_PER_MPS : null;
    const useField6Sog =
      typeof sogField6Kn === "number" &&
      Number.isFinite(sogField6Kn) &&
      sogField6Kn >= 0 &&
      sogField6Kn <= 60;
    if (useField6Sog) {
      lastField6SogTsMs = parsed.ts_ms;
    }

    this.okMainCount++;
    this.lastMainOkTs = now;
    this.lastMainTs = now;
    applyBlePartialState({
      connected: true,
      device_address: this.device?.name || "Atlas",
      last_event_ts_ms: parsed.ts_ms,
      last_error: null,
      sog_knots: useField6Sog ? sogField6Kn : (lastState?.sog_knots ?? null),
      latitude: parsed.latitude ?? lastState?.latitude ?? null,
      longitude: parsed.longitude ?? lastState?.longitude ?? null,
      heading_deg: parsed.heading_deg ?? lastState?.heading_deg ?? null,
      heading_main_ts_ms:
        typeof parsed.heading_deg === "number" ? parsed.ts_ms : (lastState?.heading_main_ts_ms ?? null),
      main_field_4: parsed.field_4 ?? null,
      main_field_5: parsed.field_5 ?? null,
      main_field_6: parsed.field_6 ?? null,
      main_cog_test_deg: parsed.cog_test_deg ?? null,
      main_reserved_hex: parsed.reserved_hex ?? null,
      main_tail_hex: parsed.tail_hex ?? null,
      main_raw_len: parsed.raw_len ?? null,
    });
  }

  onCompact(evt) {
    const dv = evt.target.value;
    const source = evt?.vklSource || "telemetry_compact_notify";
    const now = Date.now();
    this.rxCompactCount++;
    this.lastCompactRxTs = now;
    if (sessionRec.active) {
      recAdd("ble_rx", {
        chan: "compact",
        raw_b64: dvToBase64(dv),
        raw_len: dv?.byteLength ?? null,
      });
    }
    try {
      this.lastCompactLen = dv?.byteLength ?? null;
      this.lastCompactType =
        typeof dv?.byteLength === "number" && dv.byteLength >= 1 ? dv.getUint8(0) : null;
      this.lastCompactHeadHex = dvPrefixHex(dv, 14);
    } catch {
      // ignore
    }
    const parsed = parseCompactPacket(dv);
    maybeAutoStartLineFromBle(dv, source, { tsMs: parsed?.ts_ms });
    if (!parsed) return;
    this.okCompactCount++;
    this.lastCompactOkTs = now;
    this.lastCompactTs = now;
    const decodedSog = decodeSogKnFromCompactField2(parsed.field_2 ?? null, lastDerivedSogKn);
    if (sessionRec.active) {
      recAdd("ble_parsed", {
        chan: "compact",
        parsed,
        decoded_sog_knots: typeof decodedSog === "number" ? decodedSog : null,
        compact_sog_scale: compactSogScale,
        compact_sog_scale_hits: { ...compactSogScaleHits },
        last_derived_sog_knots: lastDerivedSogKn,
      });
    }
    applyBlePartialState({
      connected: true,
      device_address: this.device?.name || "Atlas",
      last_event_ts_ms: parsed.ts_ms,
      last_error: null,
      heading_compact_deg: parsed.heading_deg ?? null,
      heading_compact_ts_ms:
        typeof parsed.heading_deg === "number" ? parsed.ts_ms : (lastState?.heading_compact_ts_ms ?? null),
      compact_field_2: parsed.field_2 ?? null,
      compact_raw_len: parsed.raw_len ?? null,
    });
  }

  onCmd1(evt) {
    const dv = evt.target.value;
    const source = evt?.vklSource || "command_1_notify";
    if (sessionRec.active) {
      recAdd("ble_rx", {
        chan: "command_1",
        raw_b64: dvToBase64(dv),
        raw_len: dv?.byteLength ?? null,
      });
    }
    maybeAutoStartLineFromBle(dv, source, { tsMs: Date.now() });
  }

  onCmd2(evt) {
    const dv = evt.target.value;
    const source = evt?.vklSource || "command_2_notify";
    if (sessionRec.active) {
      recAdd("ble_rx", {
        chan: "command_2",
        raw_b64: dvToBase64(dv),
        raw_len: dv?.byteLength ?? null,
      });
    }
    maybeAutoStartLineFromBle(dv, source, { tsMs: Date.now() });
  }

  startNoDataWatchdog() {
    if (this.noDataTimer) {
      clearTimeout(this.noDataTimer);
      this.noDataTimer = null;
    }
    this.noDataTimer = setTimeout(() => {
      try {
        if (!this.server?.connected) return;
        const okTs = Math.max(this.lastMainOkTs || 0, this.lastCompactOkTs || 0);
        if (okTs) return;
        const rxTs = Math.max(this.lastMainRxTs || 0, this.lastCompactRxTs || 0);
        const tip =
          "Cierra/forza detención de Vakaros Connect y vuelve a conectar (normalmente solo 1 app recibe telemetría).";
        const detail = rxTs
          ? `Datos no interpretados (main ${this.lastMainType !== null ? `0x${hexByte(this.lastMainType)}` : "—"}/${this.lastMainLen ?? "—"}; compact ${this.lastCompactType !== null ? `0x${hexByte(this.lastCompactType)}` : "—"}/${this.lastCompactLen ?? "—"}).`
          : "No llegan paquetes BLE.";
        applyBlePartialState({
          connected: true,
          device_address: this.device?.name || "Atlas",
          last_error: `Conectado pero sin telemetría. ${detail} ${tip}`,
        });
      } catch {
        // ignore
      }
    }, 6000);
  }

  async startNotifications() {
    if (this.mainChar) {
      try {
        this.mainChar.addEventListener("characteristicvaluechanged", this.onMain);
        await this.mainChar.startNotifications();
        try {
          const v = await this.mainChar.readValue();
          this.onMain({ target: { value: v } });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
    if (this.compactChar) {
      try {
        this.compactChar.addEventListener("characteristicvaluechanged", this.onCompact);
        await this.compactChar.startNotifications();
        try {
          const v = await this.compactChar.readValue();
          this.onCompact({ target: { value: v } });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
    if (this.cmd1Char) {
      try {
        this.cmd1Char.addEventListener("characteristicvaluechanged", this.onCmd1);
        await this.cmd1Char.startNotifications();
        try {
          const v = await this.cmd1Char.readValue();
          this.onCmd1({ target: { value: v }, vklSource: "command_1_read" });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
    if (this.cmd2Char) {
      try {
        this.cmd2Char.addEventListener("characteristicvaluechanged", this.onCmd2);
        await this.cmd2Char.startNotifications();
        try {
          const v = await this.cmd2Char.readValue();
          this.onCmd2({ target: { value: v }, vklSource: "command_2_read" });
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (!this.server?.connected) return;
      if (this.pollInFlight) return;
      this.pollInFlight = true;
      const now = Date.now();
      const staleMain = now - this.lastMainTs > 1200;
      const staleCompact = now - this.lastCompactTs > 1200;
      try {
        if (staleMain && this.mainChar) {
          const v = await this.mainChar.readValue();
          this.onMain({ target: { value: v }, vklSource: "telemetry_main_poll" });
        }
        if (staleCompact && this.compactChar) {
          const v = await this.compactChar.readValue();
          this.onCompact({ target: { value: v }, vklSource: "telemetry_compact_poll" });
        }
      } catch {
        // ignore
      } finally {
        this.pollInFlight = false;
      }
    }, 400);
  }

  startCmdPolling() {
    if (this.cmdPollTimer) return;
    this.cmdPollTimer = setInterval(() => {
      if (!this.server?.connected) return;
      if (this.cmdPollInFlight) return;
      if (!this.cmd1Char && !this.cmd2Char) return;
      if (!useLocalMarks) return;

      const marks = ensureMarksShape(localMarks || loadLocalMarks() || {});
      if (!marks.start_line_follow_atlas) return;

      this.cmdPollInFlight = true;
      const reads = [];
      if (this.cmd1Char) {
        reads.push(
          this.cmd1Char
            .readValue()
            .then((v) => {
              this.onCmd1({ target: { value: v }, vklSource: "command_1_poll" });
            })
            .catch(() => {
              this.cmd1Char = null;
            }),
        );
      }
      if (this.cmd2Char) {
        reads.push(
          this.cmd2Char
            .readValue()
            .then((v) => {
              this.onCmd2({ target: { value: v }, vklSource: "command_2_poll" });
            })
            .catch(() => {
              this.cmd2Char = null;
            }),
        );
      }
      if (!reads.length) {
        this.cmdPollInFlight = false;
        return;
      }
      Promise.allSettled(reads).finally(() => {
        this.cmdPollInFlight = false;
      });
    }, 900);
  }

  disconnect() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cmdPollTimer) {
      clearInterval(this.cmdPollTimer);
      this.cmdPollTimer = null;
    }
    this.cmdPollInFlight = false;
    if (this.noDataTimer) {
      clearTimeout(this.noDataTimer);
      this.noDataTimer = null;
    }
    try {
      if (this.mainChar) this.mainChar.removeEventListener("characteristicvaluechanged", this.onMain);
    } catch {
      // ignore
    }
    try {
      if (this.compactChar) this.compactChar.removeEventListener("characteristicvaluechanged", this.onCompact);
    } catch {
      // ignore
    }
    try {
      if (this.cmd1Char) this.cmd1Char.removeEventListener("characteristicvaluechanged", this.onCmd1);
    } catch {
      // ignore
    }
    try {
      if (this.cmd2Char) this.cmd2Char.removeEventListener("characteristicvaluechanged", this.onCmd2);
    } catch {
      // ignore
    }
    try {
      if (this.device) this.device.removeEventListener("gattserverdisconnected", this.onDisconnected);
    } catch {
      // ignore
    }
    try {
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch {
      // ignore
    }
    this.device = null;
    this.server = null;
    this.mainChar = null;
    this.compactChar = null;
    this.cmd1Char = null;
    this.cmd2Char = null;
    setBleUi(false, "—");
    applyBlePartialState({ connected: false, last_error: null });

    // Persistence - Stop on disconnect
    wakeLockMgr.setRequested(false);
    bgMgr.setRequested(false);
  }
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  wsConn = new WebSocket(`${proto}://${location.host}/ws`);

  wsConn.onopen = () => {
    if (!wsWanted) {
      try {
        wsConn.close();
      } catch {
        // ignore
      }
      return;
    }
    useLocalMarks = false;
  };

  wsConn.onclose = () => {
    if (wsWanted) setTimeout(connectWs, 1000);
  };
  wsConn.onerror = () => {
    wsConn.close();
  };
  wsConn.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (sessionRec.active) recAdd("ws_msg", { msg });
      if (msg.type === "state" && msg.state) applyState(msg.state);
    } catch {
      // ignore
    }
  };
}

function sendCmd(type, extra = {}) {
  if (useLocalMarks) {
    applyLocalCommand(type, extra);
    return;
  }
  if (wsConn && wsConn.readyState === WebSocket.OPEN) {
    wsConn.send(JSON.stringify({ type, ...extra }));
  }
}

async function scanDevices() {
  if (IS_GH_PAGES) {
    els.scanInfo.textContent = "Solo disponible con backend (PC).";
    return;
  }
  els.scan.disabled = true;
  els.scanInfo.textContent = "Escaneando...";
  els.deviceList.innerHTML = "";

  try {
    const res = await fetch("./api/scan?timeout=6");
    const json = await res.json();
    if (json.error) {
      els.scanInfo.textContent = shortErr(json.error);
      return;
    }
    const devices = json.devices ?? [];
    els.scanInfo.textContent = `${devices.length} encontrados`;
    for (const d of devices) {
      const div = document.createElement("div");
      div.className = "device";
      const name = d.name || "(sin nombre)";
      const addr = d.address || "?";
      div.innerHTML = `
        <div class="device__meta">
          <div class="device__name">${name}</div>
          <div class="device__addr">${addr}</div>
        </div>
        <button class="btn btn--ghost" disabled>Auto</button>
      `;
      els.deviceList.appendChild(div);
    }
  } catch {
    els.scanInfo.textContent = "Error de scan";
  } finally {
    els.scan.disabled = false;
  }
}

const CARD_COLLAPSE_PREFIX = "vkl_card_collapsed_v1:";

function setCardCollapsed(card, collapsed, opts = {}) {
  if (!card) return;
  const key = card.dataset?.card || "";
  card.classList.toggle("card--collapsed", !!collapsed);

  const toggle = card.querySelector("[data-card-toggle]");
  if (toggle) {
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", collapsed ? "Expandir" : "Minimizar");
  }

  if (opts.persist !== false && key) {
    try {
      localStorage.setItem(`${CARD_COLLAPSE_PREFIX}${key}`, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }

  if (!collapsed && key === "map") {
    setTimeout(() => map?.invalidateSize?.(), 50);
  }
  if (!collapsed && key === "race") {
    scheduleChartDraw();
  }
}

function initCardCollapsing() {
  const cards = document.querySelectorAll(".card[data-card]");
  for (const card of cards) {
    const key = card.dataset?.card || "";
    const toggle = card.querySelector("[data-card-toggle]");
    if (!key || !toggle) continue;

    let collapsed = false;
    try {
      collapsed = localStorage.getItem(`${CARD_COLLAPSE_PREFIX}${key}`) === "1";
    } catch {
      collapsed = false;
    }
    setCardCollapsed(card, collapsed, { persist: false });

    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (key === "map" && document.body.classList.contains("map-fullscreen")) return;
      setCardCollapsed(card, !card.classList.contains("card--collapsed"));
    });
  }
}

function initExpertControls() {
  dampingUi = loadDampingUi();
  for (const key of Object.keys(DAMPING_FIELDS)) {
    setDampingField(key, dampingUi[key], { persist: false });
    const field = DAMPING_FIELDS[key];
    if (!field?.slider) continue;
    field.slider.addEventListener("input", (e) => {
      const value = Number.parseFloat(e.target.value);
      if (Number.isFinite(value)) setDampingField(key, value);
    });
  }
}

els.setMark?.addEventListener("click", () => {
  sendCmd("set_mark");
});

els.clearMark?.addEventListener("click", () => {
  sendCmd("clear_mark");
});

els.setWindward?.addEventListener("click", () => {
  sendCmd("set_windward");
});

els.setLeewardPort?.addEventListener("click", () => {
  sendCmd("set_leeward_port");
});

els.setWing?.addEventListener("click", () => {
  sendCmd("set_wing");
});

els.setReach?.addEventListener("click", () => {
  sendCmd("set_reach");
});

els.courseType?.addEventListener("change", () => {
  sendCmd("set_course_type", { course_type: els.courseType.value });
});

els.setLeewardStarboard?.addEventListener("click", () => {
  sendCmd("set_leeward_starboard");
});

els.clearRaceMarks?.addEventListener("click", () => {
  sendCmd("clear_race_marks");
});

els.targetSelect?.addEventListener("change", () => {
  targetId = els.targetSelect.value || null;
  resetCmgSmoothing();
  sendCmd("set_target", { target: targetId });
  updateTargetStats();
  drawTrack();
});

els.setPin?.addEventListener("click", () => {
  sendCmd("set_start_pin");
});

els.setRcb?.addEventListener("click", () => {
  sendCmd("set_start_rcb");
});

els.clearStartLine?.addEventListener("click", () => {
  sendCmd("clear_start_line");
});

els.toggleStartAuto?.addEventListener("click", () => {
  sendCmd("set_start_line_follow_atlas", { enabled: !startLine?.followAtlas });
});

els.scan?.addEventListener("click", () => scanDevices());

els.mapTypeStreet?.addEventListener("click", () => setMapLayer("street"));
els.mapTypeSat?.addEventListener("click", () => setMapLayer("sat"));
els.mapTypeNautical?.addEventListener("click", () => setMapLayer("nautical"));
els.mapCenter?.addEventListener("click", () => centerMap());
els.mapFullscreen?.addEventListener("click", () => setMapFullscreen(!mapFullscreenOn));

els.bleConnect?.addEventListener("click", async () => {
  try {
    if (!bleClient) bleClient = new AtlasWebBleClient();
    await bleClient.connect();
  } catch (e) {
    setBleUi(false, shortErr(e?.message || String(e)));
    applyBlePartialState({ last_error: String(e?.message || e), connected: false });
  }
});

els.bleConnectAll?.addEventListener("click", async () => {
  try {
    if (!bleClient) bleClient = new AtlasWebBleClient();
    await bleClient.connect({ acceptAllDevices: true });
  } catch (e) {
    setBleUi(false, shortErr(e?.message || String(e)));
    applyBlePartialState({ last_error: String(e?.message || e), connected: false });
  }
});

els.bleDisconnect?.addEventListener("click", () => {
  try {
    bleClient?.disconnect();
  } catch {
    // ignore
  }
});

els.recToggle?.addEventListener("click", () => {
  recSetActive(!sessionRec.active);
});

els.recDownload?.addEventListener("click", () => {
  try {
    const started = sessionRec.startedTsMs || Date.now();
    const stamp = new Date(started).toISOString().replaceAll(":", "-");
    downloadJson(`vakaroslive_session_${stamp}.json`, {
      meta: {
        appVersion: APP_VERSION,
        started_ts_ms: sessionRec.startedTsMs,
        stopped_ts_ms: sessionRec.stoppedTsMs,
        ua: navigator?.userAgent || null,
        href: location?.href || null,
      },
      entries: sessionRec.entries,
    });
  } catch {
    // ignore
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { });
}

setText(els.appVersion, APP_VERSION);
if (document?.title?.startsWith("VakarosLive")) {
  document.title = `VakarosLive ${APP_VERSION}`;
}

initCardCollapsing();
initExpertControls();
initMap();
recSetActive(false);
setBleUi(false, "—");
refreshBleDebugLine();
setInterval(() => {
  refreshBleInfoTelemetryHint();
  refreshBleDebugLine();
}, 900);

// Estado inicial (sin backend)
localMarks = ensureMarksShape(loadLocalMarks() || {});
lastState = {
  connected: false,
  device_address: null,
  last_event_ts_ms: null,
  latitude: null,
  longitude: null,
  heading_deg: null,
  heading_main_ts_ms: null,
  heading_compact_deg: null,
  heading_compact_ts_ms: null,
  heading_filtered_deg: null,
  sog_knots: null,
  cog_deg: null,
  main_field_4: null,
  main_field_5: null,
  main_field_6: null,
  main_cog_test_deg: null,
  main_reserved_hex: null,
  main_tail_hex: null,
  main_raw_len: null,
  compact_field_2: null,
  compact_raw_len: null,
  last_error: null,
  marks: localMarks,
};
useLocalMarks = true;
applyLocalMarksToUi();
applyState(lastState);

// Si hay backend, se impondrá al conectar por WS.
if (wsWanted) connectWs();
window.addEventListener("resize", () => scheduleChartDraw());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setMapFullscreen(false);
});

function initPersistenceUi() {
  els.bleWakeLock?.addEventListener("change", () => {
    const active = !!lastState?.connected;
    if (active) wakeLockMgr.setRequested(els.bleWakeLock.checked);
  });
  els.bleBackground?.addEventListener("change", () => {
    const active = !!lastState?.connected;
    if (active) bgMgr.setRequested(els.bleBackground.checked);
  });
}
initPersistenceUi();
