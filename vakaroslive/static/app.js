const $ = (id) => document.getElementById(id);

const els = {
  status: $("status"),
  navHdg: $("navHdg"),
  navSog: $("navSog"),
  navCog: $("navCog"),
  navDelta: $("navDelta"),
  navSrc: $("navSrc"),
  navLast: $("navLast"),
  map: $("map"),
  mapTypeStreet: $("mapTypeStreet"),
  mapTypeSat: $("mapTypeSat"),
  mapTypeNautical: $("mapTypeNautical"),
  mapCenter: $("mapCenter"),
  setMark: $("setMark"),
  clearMark: $("clearMark"),
  markDist: $("markDist"),
  markBrg: $("markBrg"),
  heel: $("heel"),
  pitch: $("pitch"),
  field6: $("field6"),
  compact2: $("compact2"),
  setPin: $("setPin"),
  setRcb: $("setRcb"),
  clearStartLine: $("clearStartLine"),
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
  perfChart: $("perfChart"),
  bleConnect: $("bleConnect"),
  bleConnectAll: $("bleConnectAll"),
  bleDisconnect: $("bleDisconnect"),
  bleInfo: $("bleInfo"),
  scan: $("scan"),
  scanInfo: $("scanInfo"),
  deviceList: $("deviceList"),
};

let lastState = null;
let wsConn = null;
let mark = null; // {lat, lon}
let startLine = { pin: null, rcb: null, source: null };
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

// BLE directo (Web Bluetooth)
const VAKAROS_SERVICE_UUID = "ac510001-0000-5a11-0076-616b61726f73";
const VAKAROS_CHAR_TELEMETRY_MAIN = "ac510003-0000-5a11-0076-616b61726f73";
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

  // Actualizar botones activos
  document.querySelectorAll(".map-btn").forEach(btn => {
    btn.classList.remove("map-btn--active");
  });

  if (type === "street") {
    currentLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    });
    els.mapTypeStreet.classList.add("map-btn--active");
  } else if (type === "sat") {
    currentLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: '© Esri',
      maxZoom: 19
    });
    els.mapTypeSat.classList.add("map-btn--active");
  } else if (type === "nautical") {
    currentLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
      attribution: '© OpenSeaMap',
      maxZoom: 18
    });
    // Añadir base OSM debajo
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
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

function getMagHeadingDeg(state) {
  const hc = state?.heading_compact_deg;
  if (typeof hc === "number" && hc >= 0 && hc <= 360) return hc;
  const hm = state?.heading_deg;
  if (typeof hm === "number" && hm >= 0 && hm <= 360) return hm;
  return null;
}

function supportsWebBluetooth() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

function setBleUi(connected, info) {
  if (els.bleConnect) els.bleConnect.disabled = !!connected || !supportsWebBluetooth();
  if (els.bleDisconnect) els.bleDisconnect.disabled = !connected;
  if (els.bleInfo) {
    if (!supportsWebBluetooth()) els.bleInfo.textContent = "Web Bluetooth no disponible";
    else els.bleInfo.textContent = info || (connected ? "Conectado" : "—");
  }
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
  if (!("target" in marks)) marks.target = null;
  return marks;
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
  startLine = {
    pin: marks.start_pin ? { lat: marks.start_pin.lat, lon: marks.start_pin.lon } : null,
    rcb: marks.start_rcb ? { lat: marks.start_rcb.lat, lon: marks.start_rcb.lon } : null,
    source: marks.source || null,
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
  else if (type === "clear_leeward_gate") {
    localMarks.leeward_port = null;
    localMarks.leeward_starboard = null;
  } else if (type === "clear_race_marks") {
    localMarks.windward = null;
    localMarks.leeward_port = null;
    localMarks.leeward_starboard = null;
    if (
      localMarks.target === "windward" ||
      localMarks.target === "leeward_port" ||
      localMarks.target === "leeward_starboard" ||
      localMarks.target === "leeward_gate"
    ) {
      localMarks.target = null;
    }
  } else if (type === "set_start_pin") setKey("start_pin");
  else if (type === "set_start_rcb") setKey("start_rcb");
  else if (type === "clear_start_line") {
    localMarks.start_pin = null;
    localMarks.start_rcb = null;
  } else if (type === "set_target") {
    const allowed = new Set([null, "mark", "windward", "leeward_gate", "leeward_port", "leeward_starboard"]);
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

function deriveSogCogInPlace(state) {
  if (typeof state?.latitude !== "number" || typeof state?.longitude !== "number") return;
  const tsMs =
    typeof state?.last_event_ts_ms === "number" ? state.last_event_ts_ms : Date.now();

  fixHistory.push({ tsMs, lat: state.latitude, lon: state.longitude });
  const cutoff = tsMs - 4000;
  while (fixHistory.length > 2 && fixHistory[0].tsMs < cutoff) fixHistory.shift();

  if (fixHistory.length < 2) return;
  const first = fixHistory[0];
  const last = fixHistory[fixHistory.length - 1];
  const dt = Math.max(0.001, (last.tsMs - first.tsMs) / 1000.0);
  const distM = haversineM(first.lat, first.lon, last.lat, last.lon);
  const sogKn = (distM / dt) * KNOTS_PER_MPS;
  if (!Number.isFinite(sogKn) || sogKn <= 0 || sogKn > 40) return;

  // No machacar valores que ya vengan del backend.
  if (typeof state.sog_knots !== "number") state.sog_knots = sogKn;
  if (typeof state.cog_deg !== "number")
    state.cog_deg = bearingDeg(first.lat, first.lon, last.lat, last.lon);
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
        color: "#4dffb5",
        weight: 3,
        opacity: 0.85,
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
        color: "#ffcc66",
        weight: 2,
        opacity: 0.55,
        dashArray: "4,6",
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
        color: "#ffcc66",
        weight: 2,
        opacity: 0.75,
        dashArray: "6,6",
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
        color: "#ccc",
        weight: 1,
        dashArray: "5,5",
        opacity: 0.5,
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

function drawLaylines() {
  const laylineDist = 3000; // 3km
  const lines = [];

  // Windward Laylines (assuming axis is Leeward/Start -> Windward)
  if (windward && (leewardPort || leewardStarboard || startLine?.pin)) {
    // Determine bottom mark (reference for axis)
    let bottom = null;
    if (leewardPort && leewardStarboard) {
      bottom = midpointPoint(leewardPort, leewardStarboard);
    } else if (leewardPort) {
      bottom = leewardPort;
    } else if (leewardStarboard) {
      bottom = leewardStarboard;
    } else if (startLine?.pin && startLine?.rcb) {
      bottom = midpointPoint(startLine.pin, startLine.rcb);
    }

    if (bottom) {
      const axis = bearingDeg(bottom.lat, bottom.lon, windward.lat, windward.lon);

      // Starboard Tack Layline (Wind from Axis): approach from right side (looking upwind)
      // Bearing TO mark = Axis + 135
      const p1 = projectPoint(windward.lat, windward.lon, axis + 135, laylineDist);
      lines.push([[windward.lat, windward.lon], [p1.lat, p1.lon]]);

      // Port Tack Layline
      // Bearing TO mark = Axis + 225 (or axis - 135)
      const p2 = projectPoint(windward.lat, windward.lon, axis + 225, laylineDist);
      lines.push([[windward.lat, windward.lon], [p2.lat, p2.lon]]);
    }
  }

  // TODO: Leeward laylines (gybing angles) if needed?

  if (lines.length > 0) {
    if (!laylinesPolyline) {
      laylinesPolyline = L.polyline(lines, {
        color: "#ff5555",
        weight: 1,
        dashArray: "2,4",
        opacity: 0.6,
      }).addTo(map);
    } else {
      laylinesPolyline.setLatLngs(lines);
    }
  } else if (laylinesPolyline) {
    map.removeLayer(laylinesPolyline);
    laylinesPolyline = null;
  }
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
}

function updateStartLineStats() {
  const hasFix =
    typeof lastState?.latitude === "number" && typeof lastState?.longitude === "number";
  const pin = startLine?.pin;
  const rcb = startLine?.rcb;

  els.startSource.textContent = startLine?.source ? `Fuente: ${startLine.source}` : "—";

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
  lastState = state;

  // En modo BLE directo no recibimos SOG/COG: lo derivamos de lat/lon recientes.
  deriveSogCogInPlace(state);

  const connected = !!state.connected;
  const extra = state.last_error ? ` (${shortErr(state.last_error)})` : "";
  els.status.textContent = connected
    ? `Conectado (${state.device_address ?? "?"})${extra}`
    : `Desconectado${extra}`;
  els.status.className =
    connected && state.last_error
      ? "status status--warning"
      : connected
        ? "status status--connected"
        : "status status--disconnected";

  const hdgMag = getMagHeadingDeg(state);
  els.navHdg.textContent = fmtDeg(hdgMag);
  els.navSog.textContent = fmtKn(state.sog_knots);
  els.navCog.textContent = fmtDeg(state.cog_deg);

  let src = "—";
  const hc = state.heading_compact_deg;
  const hm = state.heading_deg;
  if (typeof hc === "number" && hc >= 0 && hc <= 360) src = "HDG: compact";
  else if (typeof hm === "number" && hm >= 0 && hm <= 360) src = "HDG: main";
  els.navSrc.textContent = src;

  if (typeof hdgMag === "number" && typeof state.cog_deg === "number") {
    const delta = ((state.cog_deg - hdgMag + 540.0) % 360.0) - 180.0;
    els.navDelta.textContent = fmtSignedDeg(delta);
  } else {
    els.navDelta.textContent = "—";
  }

  els.navLast.textContent = state.last_event_ts_ms
    ? new Date(state.last_event_ts_ms).toLocaleTimeString()
    : "—";

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
    targetId = marks.target ?? null;
    startLine = {
      pin: marks.start_pin ? { lat: marks.start_pin.lat, lon: marks.start_pin.lon } : null,
      rcb: marks.start_rcb ? { lat: marks.start_rcb.lat, lon: marks.start_rcb.lon } : null,
      source: marks.source || null,
    };
  }
  if (els.targetSelect) {
    const wanted = targetId || "";
    if (els.targetSelect.value !== wanted) {
      els.targetSelect.value = wanted;
    }
  }

  els.heel.textContent =
    typeof state.main_field_4 === "number" ? fmtDeg(state.main_field_4) : "—";
  els.pitch.textContent =
    typeof state.main_field_5 === "number" ? fmtDeg(state.main_field_5) : "—";
  els.field6.textContent =
    typeof state.main_field_6 === "number" ? fmtNum(state.main_field_6, 3) : "—";
  els.compact2.textContent =
    typeof state.compact_field_2 === "number" ? String(state.compact_field_2) : "—";

  if (typeof state.latitude === "number" && typeof state.longitude === "number") {
    const ts = state.last_event_ts_ms || Date.now();
    const next = { lat: state.latitude, lon: state.longitude };
    const last = trackPoints.length ? trackPoints[trackPoints.length - 1] : null;
    const lastTs = lastTrackTsMs;

    if (last && typeof lastTs === "number") {
      const dt = Math.max(0.001, (ts - lastTs) / 1000.0);
      const distM = haversineM(last.lat, last.lon, next.lat, next.lon);
      const speedKn = (distM / dt) * KNOTS_PER_MPS;
      if (speedKn < 35) {
        trackPoints.push(next);
        lastTrackTsMs = ts;
      }
    } else {
      trackPoints.push(next);
      lastTrackTsMs = ts;
    }

    if (trackPoints.length > 120) trackPoints.shift();
  }
  drawTrack();
  updateMarkStats();
  updateTargetStats();
  pushPerfSample(state);
  updateStartLineStats();
}

function applyBlePartialState(partial) {
  const merged = { ...(lastState || {}), ...(partial || {}) };
  if (useLocalMarks) {
    merged.marks = ensureMarksShape(localMarks || loadLocalMarks() || {});
  }
  applyState(merged);
}

function parseMainPacket(dataView) {
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
  const latitude = getF32(8);
  const longitude = getF32(12);
  const heading = getF32(16);
  const f4 = getF32(20);
  const f5 = getF32(24);
  const f6 = getF32(28);
  let tailHex = null;
  if (len >= 35) {
    const tail = [];
    for (let i = 32; i < 35; i++) tail.push(dataView.getUint8(i));
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
    reserved_hex: reservedHex,
    tail_hex: tailHex,
    raw_len: len,
  };
}

function parseCompactPacket(dataView) {
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

class AtlasWebBleClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.mainChar = null;
    this.compactChar = null;
    this.pollTimer = null;
    this.lastMainTs = 0;
    this.lastCompactTs = 0;
    this.onDisconnected = this.onDisconnected.bind(this);
    this.onMain = this.onMain.bind(this);
    this.onCompact = this.onCompact.bind(this);
  }

  async connect(options = {}) {
    if (!supportsWebBluetooth()) throw new Error("Web Bluetooth no disponible");
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
      return;
    }

    throw new Error("No se pudo seleccionar el Atlas 2.");
  }

  onDisconnected() {
    this.disconnect();
  }

  onMain(evt) {
    const dv = evt.target.value;
    const parsed = parseMainPacket(dv);
    if (!parsed) return;
    this.lastMainTs = Date.now();
    applyBlePartialState({
      connected: true,
      device_address: this.device?.name || "Atlas",
      last_event_ts_ms: parsed.ts_ms,
      latitude: parsed.latitude ?? lastState?.latitude ?? null,
      longitude: parsed.longitude ?? lastState?.longitude ?? null,
      heading_deg: parsed.heading_deg ?? lastState?.heading_deg ?? null,
      main_field_4: parsed.field_4 ?? null,
      main_field_5: parsed.field_5 ?? null,
      main_field_6: parsed.field_6 ?? null,
      main_reserved_hex: parsed.reserved_hex ?? null,
      main_tail_hex: parsed.tail_hex ?? null,
      main_raw_len: parsed.raw_len ?? null,
    });
  }

  onCompact(evt) {
    const dv = evt.target.value;
    const parsed = parseCompactPacket(dv);
    if (!parsed) return;
    this.lastCompactTs = Date.now();
    applyBlePartialState({
      connected: true,
      device_address: this.device?.name || "Atlas",
      last_event_ts_ms: parsed.ts_ms,
      heading_compact_deg: parsed.heading_deg ?? null,
      compact_field_2: parsed.field_2 ?? null,
      compact_raw_len: parsed.raw_len ?? null,
    });
  }

  async startNotifications() {
    if (this.mainChar) {
      try {
        await this.mainChar.startNotifications();
        this.mainChar.addEventListener("characteristicvaluechanged", this.onMain);
      } catch {
        // ignore
      }
    }
    if (this.compactChar) {
      try {
        await this.compactChar.startNotifications();
        this.compactChar.addEventListener("characteristicvaluechanged", this.onCompact);
      } catch {
        // ignore
      }
    }
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (!this.server?.connected) return;
      const now = Date.now();
      const staleMain = now - this.lastMainTs > 1200;
      const staleCompact = now - this.lastCompactTs > 1200;
      try {
        if (staleMain && this.mainChar) {
          const v = await this.mainChar.readValue();
          const parsed = parseMainPacket(v);
          if (parsed) this.onMain({ target: { value: v } });
        }
        if (staleCompact && this.compactChar) {
          const v = await this.compactChar.readValue();
          const parsed = parseCompactPacket(v);
          if (parsed) this.onCompact({ target: { value: v } });
        }
      } catch {
        // ignore
      }
    }, 250);
  }

  disconnect() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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
    setBleUi(false, "—");
    applyBlePartialState({ connected: false, last_error: null });
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
      if (msg.type === "state" && msg.state) applyState(msg.state);
    } catch {
      // ignore
    }
  };
}

function sendCmd(type, extra = {}) {
  if (wsConn && wsConn.readyState === WebSocket.OPEN) {
    wsConn.send(JSON.stringify({ type, ...extra }));
    return;
  }
  if (useLocalMarks) applyLocalCommand(type, extra);
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

els.scan?.addEventListener("click", () => scanDevices());

els.mapTypeStreet?.addEventListener("click", () => setMapLayer("street"));
els.mapTypeSat?.addEventListener("click", () => setMapLayer("sat"));
els.mapTypeNautical?.addEventListener("click", () => setMapLayer("nautical"));
els.mapCenter?.addEventListener("click", () => centerMap());

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

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => { });
}

initMap();
setBleUi(false, "—");

// Estado inicial (sin backend)
localMarks = ensureMarksShape(loadLocalMarks() || {});
lastState = {
  connected: false,
  device_address: null,
  last_event_ts_ms: null,
  latitude: null,
  longitude: null,
  heading_deg: null,
  heading_compact_deg: null,
  sog_knots: null,
  cog_deg: null,
  main_field_4: null,
  main_field_5: null,
  main_field_6: null,
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
