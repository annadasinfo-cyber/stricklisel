import { useState, useRef, useEffect } from "react";
import React from "react";

// Supabase — eigenes Projekt, hat nichts mit Lenormandia zu tun.
// Werte aus: Supabase > Connect > App Frameworks
const SUPABASE_URL = "https://ntstnmrwgqhhxgewuiyu.supabase.co";
const SUPABASE_KEY = "sb_publishable_eNForv3M8_e1b0-bf-IBUA_BWYfCJOt";

// ============================================================
// SUPABASE (handgeschrieben, gleiches Muster wie in Lenormandia)
// ============================================================
const supabase = (() => {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };
  const authUrl = `${SUPABASE_URL}/auth/v1`;
  return {
    auth: {
      signInWithPassword: async ({ email, password }) => {
        const r = await fetch(`${authUrl}/token?grant_type=password`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
        const data = await r.json();
        if (data.access_token) localStorage.setItem("sb_session", JSON.stringify(data));
        return data;
      },
      signOut: async () => { localStorage.removeItem("sb_session"); },
      getSession: () => {
        try {
          const s = JSON.parse(localStorage.getItem("sb_session") || "null");
          if (!s || !s.access_token) return null;
          const payload = JSON.parse(atob(s.access_token.split(".")[1]));
          // offline lässt sich eh nicht verifizieren — lieber reinlassen als aussperren,
          // ohne netz kann man sich sowieso nicht neu einloggen.
          if (payload.exp && payload.exp < Date.now() / 1000 && navigator.onLine) return null;
          return s;
        } catch { localStorage.removeItem("sb_session"); return null; }
      },
      refresh: async () => {
        try {
          const s = JSON.parse(localStorage.getItem("sb_session") || "null");
          if (!s?.refresh_token) return null;
          const r = await fetch(`${authUrl}/token?grant_type=refresh_token`, { method: "POST", headers, body: JSON.stringify({ refresh_token: s.refresh_token }) });
          const data = await r.json();
          if (data.access_token) { localStorage.setItem("sb_session", JSON.stringify(data)); return data; }
          return null;
        } catch { return null; }
      },
    },
  };
})();

const dbHeaders = (token) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${token || SUPABASE_KEY}`, "Content-Type": "application/json" });
const getToken = () => { try { return JSON.parse(localStorage.getItem("sb_session") || "null")?.access_token || null; } catch { return null; } };
const getUserId = () => { try { const s = JSON.parse(localStorage.getItem("sb_session") || "null"); return JSON.parse(atob(s.access_token.split(".")[1])).sub; } catch { return null; } };

// ============================================================
// OFFLINE · lokaler cache fürs lesen, sync-queue fürs schreiben
// ============================================================
// eigene id vergeben, statt auf die datenbank zu warten — damit offline
// angelegte dinge sofort eine echte, stabile id haben (für kinder, referenzen …)
const neueId = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));

const offLesen = (key) => { try { return JSON.parse(localStorage.getItem("off:" + key) || "null"); } catch { return null; } };
const offSchreibenCache = (key, wert) => { try { localStorage.setItem("off:" + key, JSON.stringify(wert)); } catch {} };
const offQueue = () => { try { return JSON.parse(localStorage.getItem("off:queue") || "[]"); } catch { return []; } };
const offQueueSetzen = (q) => { try { localStorage.setItem("off:queue", JSON.stringify(q)); } catch {} };
const offAusstehend = () => offQueue().length;

// fetch mit zeitgrenze — navigator.onLine lügt manchmal ("online" trotz totem netz),
// ohne das hier würde ein hängender request die app minutenlang blockieren.
async function fetchZeit(url, options = {}, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// liest per netz, cached lokal · bei fehler (offline) letzten bekannten stand liefern
async function dbGet(cacheKey, url) {
  try {
    const r = await fetchZeit(url, { headers: dbHeaders(getToken()) });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    offSchreibenCache(cacheKey, d);
    return d;
  } catch (e) {
    const cached = offLesen(cacheKey);
    if (cached !== null) return cached;
    throw e;
  }
}

// schreibt (post/patch/delete) · sofort senden wenn online, sonst in die queue —
// die queue wird automatisch nachgesendet, sobald wieder netz da ist.
// gibt { ok, data } zurück — data nur gefüllt, wenn prefer "representation" enthält.
async function dbSchreiben(methode, url, body, opts = {}) {
  const prefer = opts.prefer || "return=minimal";
  const op = { methode, url, body: body || null, prefer, t: Date.now() };
  if (navigator.onLine) {
    try {
      const r = await fetchZeit(url, { method: methode, headers: { ...dbHeaders(getToken()), Prefer: prefer }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error(await r.text());
      if (prefer.includes("representation")) { try { return { ok: true, data: await r.json() }; } catch { return { ok: true, data: null }; } }
      return { ok: true, data: null };
    } catch { offQueueSetzen([...offQueue(), op]); return { ok: false, data: null }; }
  }
  offQueueSetzen([...offQueue(), op]);
  return { ok: false, data: null };
}

let offSyncLaeuft = false;
async function offSyncJetzt() {
  if (offSyncLaeuft || !navigator.onLine) return;
  const q = offQueue();
  if (!q.length) return;
  offSyncLaeuft = true;
  const rest = [];
  for (const op of q) {
    try {
      const r = await fetchZeit(op.url, { method: op.methode, headers: { ...dbHeaders(getToken()), Prefer: op.prefer || "return=minimal" }, body: op.body ? JSON.stringify(op.body) : undefined });
      if (!r.ok) rest.push(op);
    } catch { rest.push(op); }
  }
  offQueueSetzen(rest);
  offSyncLaeuft = false;
}
if (typeof window !== "undefined") {
  window.addEventListener("online", offSyncJetzt);
  setInterval(offSyncJetzt, 20000);
}
const getEmail = () => { try { const s = JSON.parse(localStorage.getItem("sb_session") || "null"); return JSON.parse(atob(s.access_token.split(".")[1])).email; } catch { return ""; } };

// ============================================================
// KONSTANTEN
// ============================================================
const BANDS = {
  delta: { beat: 2, txt: "delta 0,5–4 hz — tiefschlaf-ebene. regeneration, körperliche heilung, tiefe erdung." },
  theta: { beat: 6, txt: "theta 4–7 hz — das traumtor. unterbewusstsein weit offen — der sub-sweetspot." },
  alpha: { beat: 10, txt: "alpha 8–12 hz — wache ruhe. entspannte aufnahme, lernen, sanfter übergang." },
  beta:  { beat: 18, txt: "beta 13–30 hz — klarer fokus. antrieb, konzentration, waches handeln." },
  gamma: { beat: 40, txt: "gamma ~40 hz — spitzenklarheit. bewusstseinsblitz, heilkräfte aktivieren." },
};

const DEFAULTS = {
  bedType: "music", noiseColor: "pink", bedVol: 70,
  mode: "kette", gap: 2,
  ketteText: "", ketteSpeed: 1,
  linksText: "", linksSpeed: 1,
  rechtsText: "", rechtsSpeed: 1,
  layers: [
    { on: true, text: "", off: 0, pan: 0, lvl: 0, spd: 1 },
    { on: true, text: "", off: 4, pan: -45, lvl: 0, spd: 1 },
    { on: true, text: "", off: 8, pan: 45, lvl: 0, spd: 1 },
  ],
  opOn: false, opLine: 45, opDirt: 40,
  audOn: true, audGain: -20,
  ultraOn: true, ultraFreq: 17000, ultraGain: -6,
  entOn: false, entType: "binaural", entBand: "theta", entBeat: 6, entCarrier: 200, entVol: 35,
  playMode: "einmal", len: 10, fade: 4, sr: 48000,
  voice: "mms",
};

// Formatierer
const F = {
  pct: (x) => x + " %",
  sec: (x) => Number(x).toFixed(1).replace(".", ",") + " s",
  secI: (x) => x + " s",
  db: (x) => (Number(x) === 0 ? "0" : "−" + Math.abs(x)) + " db",
  khz: (x) => (x / 1000).toFixed(1).replace(".", ",") + " khz",
  hz: (x) => Number(x).toFixed(1).replace(".", ",") + " hz",
  hzI: (x) => x + " hz",
  min: (x) => { const h = Math.floor(x / 60), m = x % 60; return h ? h + " h" + (m ? " " + m + " min" : "") : m + " min"; },
  pan: (x) => (Number(x) === 0 ? "mitte" : (x < 0 ? "L " : "R ") + Math.abs(x)),
  spd: (x) => Number(x).toFixed(2).replace(".", ",") + "×",
  clock: (s) => { const m = Math.floor(s / 60), r = Math.round(s % 60); return m + ":" + String(r).padStart(2, "0"); },
};

// ============================================================
// TTS — packen, cachen, erzeugen
// ============================================================
const MAXLEN = 180;

function splitLong(s) {
  if (s.length <= MAXLEN) return [s];
  const out = []; let rest = s;
  while (rest.length > MAXLEN) {
    let cut = rest.lastIndexOf(",", MAXLEN);
    if (cut < 40) cut = rest.lastIndexOf(";", MAXLEN);
    if (cut < 40) cut = rest.lastIndexOf(" ", MAXLEN);
    if (cut < 40) cut = MAXLEN;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Sätze zerlegen UND kurze wieder zusammenpacken — das spart 3-4x Modellaufrufe.
function chunkText(t) {
  const saetze = t.split(/\n+/)
    .flatMap((line) => line.match(/[^.!?]+[.!?]*/g) || [line])
    .map((s) => s.trim()).filter(Boolean)
    .flatMap(splitLong).filter(Boolean);
  const out = []; let buf = "";
  saetze.forEach((s) => {
    if (buf && buf.length + s.length + 1 <= MAXLEN) buf = buf + " " + s;
    else { if (buf) out.push(buf); buf = s; }
  });
  if (buf) out.push(buf);
  return out;
}

// Cache: einmal erzeugt, nie wieder rechnen. Überlebt Neuladen und Abbruch.
let idbP = null;
function openDB() {
  if (idbP) return idbP;
  idbP = new Promise((res, rej) => {
    const r = indexedDB.open("subconstructor", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("tts");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return idbP;
}
async function cacheGet(k) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const q = db.transaction("tts", "readonly").objectStore("tts").get(k);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}
async function cachePut(k, v) {
  try {
    const db = await openDB();
    await new Promise((res) => {
      const q = db.transaction("tts", "readwrite").objectStore("tts").put(v, k);
      q.onsuccess = () => res(); q.onerror = () => res();
    });
  } catch {}
}
async function cacheClear() {
  try {
    const db = await openDB();
    await new Promise((res) => {
      const q = db.transaction("tts", "readwrite").objectStore("tts").clear();
      q.onsuccess = () => res(); q.onerror = () => res();
    });
  } catch {}
}
async function keyFor(voice, text) {
  try {
    const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(voice + "|" + text));
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch { return voice + "|" + text; }
}

// Modelle
let synthP = null, piperP = null;
const PIPER_VOICE = "de_DE-thorsten-medium";

async function getSynth(say) {
  if (synthP) return synthP;
  synthP = (async () => {
    say("» lade tts-bibliothek …", "work");
    const T = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm");
    T.env.allowLocalModels = false;
    say("» lade ilona … (einmalig)", "work");
    const s = await T.pipeline("text-to-speech", "Xenova/mms-tts-deu", {
      progress_callback: (p) => { if (p?.status === "progress" && p.progress != null) say("» ilona lädt … " + Math.round(p.progress) + " %", "work"); },
    });
    say("» ilona bereit", "ok");
    return s;
  })();
  return synthP;
}

async function getPiper(say) {
  if (piperP) return piperP;
  piperP = (async () => {
    say("» lade piper …", "work");
    const tts = await import("@diffusionstudio/vits-web");
    const stored = await tts.stored().catch(() => []);
    if (stored.indexOf(PIPER_VOICE) === -1) {
      say("» lade thorsten … (einmalig)", "work");
      await tts.download(PIPER_VOICE, (p) => { if (p?.total) say("» thorsten lädt … " + Math.round((p.loaded / p.total) * 100) + " %", "work"); });
    }
    say("» thorsten bereit", "ok");
    return tts;
  })();
  return piperP;
}

// Piper läuft im Worker und wird regelmäßig entsorgt — sonst frisst er sich tot.
// (vits-web baut pro predict() eine neue Session mit dem ganzen Modell und gibt sie nie frei.)
const PIPER_RECYCLE = 15; // nach so vielen Häppchen: frischer Worker
let piperW = null, piperUses = 0, piperSeq = 0;

function newPiperWorker() {
  const w = new Worker(new URL("./piper-worker.js", import.meta.url), { type: "module" });
  w.pending = new Map();
  w.onmessage = (e) => {
    const { id, ok, ab, err } = e.data;
    const p = w.pending.get(id);
    if (!p) return;
    w.pending.delete(id);
    ok ? p.res(ab) : p.rej(new Error(err));
  };
  w.onerror = (e) => { w.pending.forEach((p) => p.rej(new Error(e.message || "worker-fehler"))); w.pending.clear(); };
  return w;
}
function killPiper() { if (piperW) { piperW.terminate(); piperW = null; } piperUses = 0; }

// WAV selbst auslesen — kein AudioContext. Sonst hätten wir hunderte davon.
function wavToFloat(ab) {
  const dv = new DataView(ab);
  let sr = 22050, off = 12, dataOff = -1, dataLen = 0, bits = 16, ch = 1;
  while (off + 8 <= dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
    const sz = dv.getUint32(off + 4, true);
    if (id === "fmt ") { ch = dv.getUint16(off + 10, true); sr = dv.getUint32(off + 12, true); bits = dv.getUint16(off + 22, true); }
    else if (id === "data") { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz % 2);
  }
  if (dataOff < 0) throw new Error("wav ohne data-block");
  const n = Math.floor(dataLen / (bits / 8) / ch);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(dataOff + i * 2 * ch, true) / 32768;
  return { audio: out, sampling_rate: sr };
}

async function piperFloat(text, say) {
  await getPiper(say); // stellt sicher, dass das modell einmalig geladen ist
  if (!piperW || piperUses >= PIPER_RECYCLE) { killPiper(); piperW = newPiperWorker(); }
  piperUses++;
  const id = ++piperSeq;
  const w = piperW;
  const ab = await new Promise((res, rej) => { w.pending.set(id, { res, rej }); w.postMessage({ id, text, voiceId: PIPER_VOICE }); });
  return wavToFloat(ab);
}

// Häppchen können mit verschiedenen Abtastraten im Cache liegen (Ilona 16 kHz,
// Thorsten 22,05 kHz, ältere Einträge 48 kHz). Ungleiche Raten in einer Datei
// = falsches Tempo. Also alles auf eine gemeinsame Rate bringen.
function resample(data, from, to) {
  if (from === to || !from || !to) return data;
  const ratio = to / from;
  const n = Math.round(data.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, data.length - 1);
    const f = x - i0;
    out[i] = data[i0] * (1 - f) + data[i1] * f;
  }
  return out;
}

function floatToWav(data, sr) {
  const len = data.length, ab = new ArrayBuffer(44 + len * 2), dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + len * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, "data"); dv.setUint32(40, len * 2, true);
  let off = 44;
  for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, data[i])); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return ab;
}

// ============================================================
// AUDIO-ENGINE
// ============================================================
const dB = (v) => Math.pow(10, v / 20);

// Wie lang ist dieses Audio? (für "einmal durch")
async function measure(ab) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const b = await ctx.decodeAudioData(ab.slice(0));
    const d = b.duration; ctx.close(); return d;
  } catch { return 0; }
}

// Wie lang läuft die Botschaft EINMAL durch? (Tempo und Zeitversatz eingerechnet)
function messageSeconds(cfg, A) {
  const g = cfg.gap, D = A.dur || {};
  if (cfg.mode === "kette") return (D.kette || 0) / cfg.ketteSpeed + g;
  if (cfg.mode === "ichdu") return Math.max((D.links || 0) / cfg.linksSpeed, (D.rechts || 0) / cfg.rechtsSpeed) + g;
  const fb = (D.layers || []).find((x) => x) || 0;
  let m = 0;
  for (let i = 0; i < 3; i++) {
    const L = cfg.layers[i];
    if (!L.on) continue;
    const d = (D.layers || [])[i] || fb;
    if (d) m = Math.max(m, L.off + d / L.spd + g);
  }
  return m;
}
const decode = async (ctx, ab) => await ctx.decodeAudioData(ab.slice(0));
const panNode = (ctx, v) => { if (!ctx.createStereoPanner) return null; const p = ctx.createStereoPanner(); p.pan.value = v; return p; };

async function padded(ctx, ab, gapSec) {
  const b = await decode(ctx, ab);
  const gap = Math.round(gapSec * ctx.sampleRate);
  if (gap <= 0) return b;
  const out = ctx.createBuffer(1, b.length + gap, ctx.sampleRate);
  out.getChannelData(0).set(b.getChannelData(0).subarray(0, b.length), 0);
  return out;
}

function noiseBuffer(ctx, seconds, color) {
  const len = Math.ceil(seconds * ctx.sampleRate), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  if (color === "white") { for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
  else if (color === "pink") {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  } else { let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } }
  return buf;
}

function makeCurve(drive) {
  const n = 1024, c = new Float32Array(n), d = 1 + drive * 8;
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = Math.tanh(x * d); }
  return c;
}

// "operator über eine lange analoge leitung"
function applyOperator(ctx, input, cfg) {
  const dirt = cfg.opDirt / 100, line = cfg.opLine / 100;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300; hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 0.7;
  const honk = ctx.createBiquadFilter(); honk.type = "peaking"; honk.frequency.value = 1500; honk.Q.value = 1.2; honk.gain.value = 6;
  const drive = ctx.createGain(); drive.gain.value = 1 + dirt * 2;
  const shaper = ctx.createWaveShaper(); shaper.curve = makeCurve(0.2 + dirt * 0.7); shaper.oversample = "2x";
  const post = ctx.createGain(); post.gain.value = 1 / (1 + dirt * 1.2);
  const delay = ctx.createDelay(0.05); delay.delayTime.value = 0.012 + line * 0.02;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.25 + line * 0.4;
  const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.0015 + line * 0.004;
  lfo.connect(lfoDepth).connect(delay.delayTime); lfo.start(0);
  const out = ctx.createGain();
  input.connect(hp); hp.connect(lp); lp.connect(honk); honk.connect(drive);
  drive.connect(shaper); shaper.connect(post); post.connect(delay); delay.connect(out);
  if (dirt > 0.02) {
    const nz = ctx.createBufferSource(); nz.buffer = noiseBuffer(ctx, 10, "white"); nz.loop = true;
    const nbp = ctx.createBiquadFilter(); nbp.type = "bandpass"; nbp.frequency.value = 1800; nbp.Q.value = 0.5;
    const ng = ctx.createGain(); ng.gain.value = dirt * 0.012;
    nz.connect(nbp).connect(ng).connect(out); nz.start(0);
  }
  return out;
}

async function buildMessage(ctx, cfg, A) {
  const out = ctx.createGain(); out.gain.value = 1;
  const gap = cfg.gap; let any = false;
  const rund = cfg.playMode !== "einmal";
  const src = (b) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = rund; return s; };
  if (cfg.mode === "kette") {
    if (!A.kette) return null;
    const s = src(await padded(ctx, A.kette, gap)); s.playbackRate.value = cfg.ketteSpeed;
    s.connect(out); s.start(0); any = true;
  } else if (cfg.mode === "ichdu") {
    if (A.links) { const s = src(await padded(ctx, A.links, gap)); s.playbackRate.value = cfg.linksSpeed; const p = panNode(ctx, -1); if (p) { s.connect(p); p.connect(out); } else s.connect(out); s.start(0); any = true; }
    if (A.rechts) { const s = src(await padded(ctx, A.rechts, gap)); s.playbackRate.value = cfg.rechtsSpeed; const p = panNode(ctx, 1); if (p) { s.connect(p); p.connect(out); } else s.connect(out); s.start(0); any = true; }
  } else {
    const fallback = A.layers.find((b) => b) || null;
    for (let i = 0; i < 3; i++) {
      const L = cfg.layers[i];
      if (!L.on) continue;
      const buf = A.layers[i] || fallback;
      if (!buf) continue;
      const s = src(await padded(ctx, buf, gap)); s.playbackRate.value = L.spd;
      const p = panNode(ctx, L.pan / 100);
      const g = ctx.createGain(); g.gain.value = dB(L.lvl);
      if (p) { s.connect(p); p.connect(g); } else s.connect(g);
      g.connect(out); s.start(L.off); any = true;
    }
  }
  return any ? out : null;
}

async function build(ctx, seconds, cfg, A) {
  const master = ctx.createGain();
  // TRÄGERBETT
  if (cfg.bedType !== "silent") {
    let bed;
    if (cfg.bedType === "noise") bed = noiseBuffer(ctx, Math.min(seconds, 20), cfg.noiseColor);
    else { if (!A.bed) throw new Error("kein trägerbett — lade audio oder wähle rauschen/stille"); bed = await decode(ctx, A.bed); }
    const s = ctx.createBufferSource(); s.buffer = bed; s.loop = true;
    const g = ctx.createGain(); g.gain.value = (cfg.bedVol / 100) * 0.9;
    s.connect(g).connect(master); s.start(0);
  }
  // JACK_IN
  if (cfg.entOn) {
    const beat = cfg.entBeat, base = cfg.entCarrier;
    const ev = ctx.createGain(); ev.gain.value = (cfg.entVol / 100) * 0.3; ev.connect(master);
    if (cfg.entType === "binaural") {
      const oL = ctx.createOscillator(), oR = ctx.createOscillator();
      oL.frequency.value = base; oR.frequency.value = base + beat;
      const m = ctx.createChannelMerger(2);
      oL.connect(m, 0, 0); oR.connect(m, 0, 1); m.connect(ev); oL.start(0); oR.start(0);
    } else {
      const tone = ctx.createOscillator(); tone.frequency.value = base;
      const pulse = ctx.createGain(); pulse.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = beat;
      const depth = ctx.createGain(); depth.gain.value = 0.5;
      lfo.connect(depth).connect(pulse.gain);
      tone.connect(pulse).connect(ev); tone.start(0); lfo.start(0);
    }
  }
  // BOTSCHAFT
  const msg = await buildMessage(ctx, cfg, A);
  if (msg) {
    const voice = cfg.opOn ? applyOperator(ctx, msg, cfg) : msg;
    if (cfg.audOn) { const g = ctx.createGain(); g.gain.value = dB(cfg.audGain); voice.connect(g).connect(master); }
    if (cfg.ultraOn) {
      const ring = ctx.createGain(); ring.gain.value = 0;
      const osc = ctx.createOscillator(); osc.frequency.value = cfg.ultraFreq; osc.connect(ring.gain);
      const g = ctx.createGain(); g.gain.value = dB(cfg.ultraGain);
      voice.connect(ring).connect(g).connect(master); osc.start(0);
    }
  }
  // Fade
  const fade = Math.min(cfg.fade, seconds / 2), mg = master.gain;
  if (fade > 0) {
    mg.setValueAtTime(0, 0); mg.linearRampToValueAtTime(1, fade);
    mg.setValueAtTime(1, Math.max(fade, seconds - fade)); mg.linearRampToValueAtTime(0, seconds);
  }
  return master;
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const bytes = len * ch * 2, ab = new ArrayBuffer(44 + bytes), dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + bytes, true); ws(8, "WAVE"); ws(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true);
  dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, bytes, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([ab], { type: "audio/wav" });
}

// ============================================================
// BAUTEILE
// ============================================================

// Stürzt ein reiter ab, wird die seite sonst einfach weiß und sagt nichts.
class Fehlerfang extends React.Component {
  constructor(p) { super(p); this.state = { fehler: null }; }
  static getDerivedStateFromError(e) { return { fehler: e }; }
  componentDidCatch(e, info) { console.error("[stricklisel]", e, info); }
  render() {
    if (!this.state.fehler) return this.props.children;
    const f = this.state.fehler;
    return (
      <div className="absturz">
        <div className="atitel">▲ hier ist was gekippt</div>
        <div className="atext">{String(f?.message || f)}</div>
        {f?.stack && <pre className="astack">{String(f.stack).split("\n").slice(0, 6).join("\n")}</pre>}
        <div className="azeile">
          <button className="btn" onClick={() => this.setState({ fehler: null })}>↺ nochmal</button>
          <button className="btn" onClick={() => location.reload()}>↻ seite neu laden</button>
        </div>
        <p className="hint">schick anni@claude den text hier oben — dann weiß ich, wo's klemmt.</p>
      </div>
    );
  }
}
// Wächst mit dem text mit — man soll seine 200 wörter sehen, nicht scrollen.
function AutoTa({ value, onChange, ...rest }) {
  const ref = useRef(null);
  const anpassen = () => {
    const el = ref.current;
    if (!el) return;
    const y = window.scrollY;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
    window.scrollTo(0, y);
  };
  useEffect(anpassen, [value]);
  useEffect(() => { const f = () => anpassen(); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return <textarea ref={ref} value={value} onChange={onChange} {...rest} />;
}

function Switch({ checked, onChange, mini }) {
  return (
    <label className={"switch" + (mini ? " mini" : "")} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
    </label>
  );
}

// Klappzustand überlebt das Neuladen — pro Box gemerkt.
function Panel({ id, title, sub, sw, children }) {
  const key = "panel:" + (id || title);
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v === null ? true : v === "1"; } catch { return true; }
  });
  const kippen = () => setOpen((o) => {
    const n = !o;
    try { localStorage.setItem(key, n ? "1" : "0"); } catch {}
    return n;
  });
  return (
    <section className={"panel" + (open ? "" : " collapsed")}>
      <div className="phead" onClick={kippen}>
        {sw}
        <span className="prompt">&gt;</span>
        <span className="pid">{title}</span>
        {sub && <span className="psub">{sub}</span>}
        <span className="chev">▾</span>
      </div>
      {open && <div className="pbodywrap">{children}</div>}
    </section>
  );
}

function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.t}</button>
      ))}
    </div>
  );
}

function Slider({ label, value, onChange, min, max, step, fmt }) {
  return (
    <div className="field">
      <label className="cap">{label}</label>
      <div className="slider">
        <input type="range" min={min} max={max} step={step || 1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="val">{fmt(value)}</span>
      </div>
    </div>
  );
}

// Wetter · Dümmer 19073 (53,576° N · 11,205° O)
// Open-Meteo: kein schlüssel, kein konto, kein tracking.
const WMO = {
  0: ["☀︎", "klar"], 1: ["☀︎", "heiter"], 2: ["⛅︎", "wolkig"], 3: ["☁︎", "bedeckt"],
  45: ["≡", "nebel"], 48: ["≡", "reifnebel"],
  51: ["☂︎", "leichter niesel"], 53: ["☂︎", "niesel"], 55: ["☂︎", "starker niesel"],
  56: ["☂︎", "gefrierender niesel"], 57: ["☂︎", "gefrierender niesel"],
  61: ["☂︎", "leichter regen"], 63: ["☂︎", "regen"], 65: ["☂︎", "starker regen"],
  66: ["☂︎", "gefrierender regen"], 67: ["☂︎", "gefrierender regen"],
  71: ["❄︎", "leichter schnee"], 73: ["❄︎", "schnee"], 75: ["❄︎", "starker schnee"], 77: ["❄︎", "schneegriesel"],
  80: ["☂︎", "schauer"], 81: ["☂︎", "schauer"], 82: ["☂︎", "starke schauer"],
  85: ["❄︎", "schneeschauer"], 86: ["❄︎", "schneeschauer"],
  95: ["⚡︎", "gewitter"], 96: ["⚡︎", "gewitter mit hagel"], 99: ["⚡︎", "gewitter mit hagel"],
};

function ScrollTop() {
  const [sichtbar, setSichtbar] = useState(false);
  useEffect(() => {
    const f = () => setSichtbar(window.scrollY > 400);
    addEventListener("scroll", f, { passive: true });
    return () => removeEventListener("scroll", f);
  }, []);
  if (!sichtbar) return null;
  return (
    <button className="hoch" onClick={() => scrollTo({ top: 0, behavior: "smooth" })} title="nach oben" aria-label="nach oben">▲</button>
  );
}

function SyncStatus() {
  const [n, setN] = useState(0);
  const [on, setOn] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const check = () => setN(offAusstehend());
    check();
    const iv = setInterval(check, 4000);
    const onOn = () => setOn(true), onOff = () => setOn(false);
    window.addEventListener("online", onOn); window.addEventListener("offline", onOff);
    return () => { clearInterval(iv); window.removeEventListener("online", onOn); window.removeEventListener("offline", onOff); };
  }, []);
  if (!on) return <span className="syncstat offline" title="kein netz — alles wird lokal zwischengespeichert">◌ offline</span>;
  if (n > 0) return <span className="syncstat wartet" title={n + " änderung" + (n === 1 ? "" : "en") + " wartet noch auf sync"}>◍ sync {n}</span>;
  return null;
}

function Wetter() {
  const [w, setW] = useState(null);
  useEffect(() => {
    const holen = () =>
      fetch("https://api.open-meteo.com/v1/forecast?latitude=53.576&longitude=11.205&current=temperature_2m,weather_code&timezone=Europe%2FBerlin")
        .then((r) => r.json())
        .then((d) => { if (d?.current) setW({ t: Math.round(d.current.temperature_2m), c: d.current.weather_code }); })
        .catch(() => {});
    holen();
    const iv = setInterval(holen, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);
  if (!w) return null;
  const [sym, txt] = WMO[w.c] || ["·", "unbekannt"];
  return <span className="wetter" title={"dümmer · " + txt}><i>{sym}</i> {w.t}°</span>;
}

function Uhr() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setT(new Date()), 1000); return () => clearInterval(iv); }, []);
  const p = (n) => String(n).padStart(2, "0");
  return <span className="uhr">{p(t.getHours())}:{p(t.getMinutes())}<i>:{p(t.getSeconds())}</i></span>;
}

function Rain() {
  const ref = useRef(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) return;
    const c = ref.current, g = c.getContext("2d");
    let cols, drops, fs = 14, timer;
    const rs = () => { c.width = innerWidth; c.height = innerHeight; cols = Math.floor(c.width / fs); drops = Array(cols).fill(0).map(() => Math.random() * -40); };
    rs(); addEventListener("resize", rs);
    const chars = "01アイウエオカキクケコサシスセソ<>/{}[]=+*".split("");
    const draw = () => {
      g.fillStyle = "rgba(4,7,5,.045)"; g.fillRect(0, 0, c.width, c.height);
      g.font = fs + "px monospace";
      for (let i = 0; i < cols; i++) {
        const t = chars[Math.floor(Math.random() * chars.length)];
        const r = Math.random();
        if (r < 0.09) {            // helle spitze
          g.shadowBlur = 0; g.fillStyle = "rgba(235,255,240,1)";
        } else if (r < 0.22) {     // cursor-grün, glimmt wie der cursor oben
          g.shadowBlur = 8; g.shadowColor = "rgba(53,255,111,.75)"; g.fillStyle = "#35ff6f";
        } else {                   // der übliche regen
          g.shadowBlur = 0; g.fillStyle = "rgba(70,255,135,1)";
        }
        g.fillText(t, i * fs, drops[i] * fs);
        g.shadowBlur = 0;
        if (drops[i] * fs > c.height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.5;
      }
    };
    timer = setInterval(draw, 70);
    const onVis = () => {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { timer = setInterval(draw, 70); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(timer); removeEventListener("resize", rs); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return <canvas id="rain" ref={ref} />;
}

function Scope({ analyser, ctxRef }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current, cx = cv.getContext("2d");
    let raf, sichtbar = true;
    const size = () => { const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener("resize", size);
    const idle = () => { const w = cv.clientWidth, h = cv.clientHeight; cx.clearRect(0, 0, w, h); cx.strokeStyle = "rgba(53,255,111,.12)"; cx.beginPath(); cx.moveTo(0, h - 1); cx.lineTo(w, h - 1); cx.stroke(); };
    const zeichnen = () => {
      const an = analyser.current;
      if (!an || !ctxRef.current) { idle(); return; }
      const n = an.frequencyBinCount, data = new Uint8Array(n);
      an.getByteFrequencyData(data);
      const w = cv.clientWidth, h = cv.clientHeight; cx.clearRect(0, 0, w, h);
      const nyq = ctxRef.current.sampleRate / 2, bars = 110, step = Math.floor(n / bars);
      for (let i = 0; i < bars; i++) {
        let m = 0; for (let j = 0; j < step; j++) m = Math.max(m, data[i * step + j] || 0);
        const freq = (i * step * nyq) / n, bh = (m / 255) * (h - 6), x = (i / bars) * w, bw = w / bars - 1.2;
        cx.fillStyle = freq > 15000 ? "rgba(180,255,205,.95)" : "rgba(53,255,111,.5)";
        cx.fillRect(x, h - bh, bw, bh);
      }
      const mx = (15000 / nyq) * w;
      cx.strokeStyle = "rgba(180,255,205,.3)"; cx.setLineDash([3, 4]);
      cx.beginPath(); cx.moveTo(mx, 0); cx.lineTo(mx, h); cx.stroke(); cx.setLineDash([]);
    };
    const loop = () => {
      if (!sichtbar || document.hidden) { raf = null; return; }
      zeichnen();
      raf = requestAnimationFrame(loop);
    };
    const starten = () => { if (!raf) raf = requestAnimationFrame(loop); };
    const obs = new IntersectionObserver(([entry]) => { sichtbar = entry.isIntersecting; if (sichtbar) starten(); else idle(); }, { threshold: 0 });
    obs.observe(cv);
    const onVis = () => { if (!document.hidden) starten(); };
    document.addEventListener("visibilitychange", onVis);
    starten();
    return () => { if (raf) cancelAnimationFrame(raf); obs.disconnect(); removeEventListener("resize", size); document.removeEventListener("visibilitychange", onVis); };
  }, [analyser, ctxRef]);
  return (
    <div className="scope">
      <canvas id="spectrum" ref={ref} />
      <div className="scope-lbl">FREQ.SCOPE</div>
      <div className="scope-ultra">▌ ultraschall &gt;15 khz</div>
    </div>
  );
}

// laufschrift unter dem scope — subliminaltext läuft durch.
// quelle umschaltbar (konsole / eigener text), an/aus, tempo. reines css, kein js-loop.
// erste n sätze — damit ein ellenlanges protokoll das band nicht flutet
const laufKurz = (t, n = 3) => {
  const s = (t || "").trim();
  if (!s) return "";
  const treffer = s.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!treffer) return s;                       // kein satzende gefunden → ganzen (kurzen) text
  const kurz = treffer.slice(0, n).join("").trim();
  return kurz || s;
};
function Laufschrift() {
  const [an, setAn] = useState(true);
  const [tempo, setTempo] = useState("langsam"); // "langsam" | "schnell"
  const [konsolenText, setKonsolenText] = useState("");

  // konsolen-affirmationen aus dem zuletzt gespeicherten stand ziehen
  useEffect(() => {
    const lesen = () => {
      const c = offLesen("konsole-cfg");
      if (!c) { setKonsolenText(""); return; }
      let t = "";
      if (c.mode === "kette") t = c.ketteText || "";
      else if (c.mode === "ich↔du") t = [c.linksText, c.rechtsText].filter(Boolean).join("  ·  ");
      else t = (c.layers || []).map((l) => l.text).filter(Boolean).join("  ·  ");
      setKonsolenText((t || "").trim());
    };
    lesen();
    const iv = setInterval(lesen, 4000);
    return () => clearInterval(iv);
  }, []);

  const text = laufKurz(konsolenText, 3);
  const zeigen = an && text.trim();

  return (
    <div className="lauf">
      <div className="laufband">
        {zeigen
          ? <div className={"laufinner " + tempo}><span>{text}</span><span aria-hidden="true">{text}</span></div>
          : <div className="laufleer">{an ? "— kein text —" : "— laufschrift aus —"}</div>}
      </div>
      <div className="laufctrl">
        <button className={"laufbtn" + (an ? " on" : "")} onClick={() => setAn((v) => !v)}>{an ? "◉ an" : "○ aus"}</button>
        <button className="laufbtn" onClick={() => setTempo((t) => t === "langsam" ? "schnell" : "langsam")}>{tempo === "langsam" ? "langsam" : "schnell"}</button>
      </div>
    </div>
  );
}

// ============================================================
// REAKTOR-LADUNG · sanfter entlade-balken (kein wegsperren!)
// entlädt sich über 90 min. bei null: 10 min leer + orange blinkend
// "reloade AMs" + einmal ein wegklickbares "ZUGRIFF VERWEIGERT"-popup.
// danach lädt er voll und läuft neu. an/aus wie die laufschrift.
// start-zeitstempel in localStorage → ein reload schummelt den zähler nicht.
// gedacht als schubs (mal aufstehen), NICHT als sperre — man arbeitet weiter.
// ============================================================
const RK_SESSION = 90 * 60 * 1000;   // 90 min arbeitsfenster
const RK_COOLDOWN = 10 * 60 * 1000;  // 10 min "leer"
const RK_ZYKLUS = RK_SESSION + RK_COOLDOWN;
const rkMMSS = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
const RK_SEG = 64;  // viele schmale, stehende segmente (retro-ladebalken)
const RkSegmente = ({ lit }) => (
  <div className="rkband">
    {Array.from({ length: RK_SEG }).map((_, i) => <i key={i} className={"rkseg" + (i < lit ? " an" : "")} />)}
  </div>
);
function Reaktorladung() {
  const [an, setAn] = useState(() => { const v = offLesen("reaktor-an"); return v === null ? true : !!v; });
  const [start, setStart] = useState(() => {
    const s = offLesen("reaktor-start");
    if (typeof s === "number" && Date.now() - s < RK_ZYKLUS) return s;
    const jetzt = Date.now(); offSchreibenCache("reaktor-start", jetzt); return jetzt;
  });
  const [jetzt, setJetzt] = useState(Date.now());
  const [denied, setDenied] = useState(false);

  // sekündlich ticken, solange an
  useEffect(() => {
    if (!an) return;
    const iv = setInterval(() => setJetzt(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [an]);

  const verstrichen = jetzt - start;
  const kuehlung = verstrichen >= RK_SESSION && verstrichen < RK_ZYKLUS;

  // zyklus vorbei → frische sitzung (auch nach langer abwesenheit)
  useEffect(() => {
    if (!an) return;
    if (verstrichen >= RK_ZYKLUS) {
      const jetztNeu = Date.now();
      setStart(jetztNeu); offSchreibenCache("reaktor-start", jetztNeu); setDenied(false);
    }
  }, [verstrichen, an]);

  // popup EINMAL pro zyklus, wenn wir gerade in die kühlung kippen
  useEffect(() => {
    if (!an || !kuehlung) return;
    if (offLesen("reaktor-denied-fuer") !== start) {
      setDenied(true); offSchreibenCache("reaktor-denied-fuer", start);
    }
  }, [kuehlung, an, start]);

  const umschalten = () => setAn((v) => { const n = !v; offSchreibenCache("reaktor-an", n); return n; });

  if (!an) return (
    <div className="reaktor aus">
      <RkSegmente lit={0} />
      <div className="rkctrl">
        <span className="rklabel">reaktor-ladung</span>
        <button className="laufbtn" onClick={umschalten}>○ aus</button>
      </div>
    </div>
  );

  const ladung = kuehlung ? 0 : Math.max(0, 100 * (1 - verstrichen / RK_SESSION));
  const knapp = !kuehlung && ladung <= 15;                 // erst gegen ende präsent
  const restCool = RK_ZYKLUS - verstrichen;
  const lit = kuehlung ? 0 : Math.round(RK_SEG * ladung / 100);

  return (
    <>
      <div className={"reaktor" + (kuehlung ? " kuehlung" : knapp ? " knapp" : "")}>
        <RkSegmente lit={lit} />
        <div className="rkctrl">
          <span className="rklabel">
            {kuehlung
              ? <span className="rkblink">reloade AMs · {rkMMSS(restCool)}</span>
              : <>reaktor-ladung <b>{Math.round(ladung)}%</b></>}
          </span>
          <button className="laufbtn" onClick={umschalten}>◉ an</button>
        </div>
      </div>

      {denied && (
        <div className="rkpop" onClick={() => setDenied(false)}>
          <div className="rkpopbox" onClick={(e) => e.stopPropagation()}>
            <div className="rkpoptitel">ZUGRIFF VERWEIGERT</div>
            <div className="rkpoptext">es gibt keinen löffel</div>
            <button className="btn" onClick={() => setDenied(false)}>× wegklicken</button>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// ABTEILUNG 17b · PRIORITY_MANAGER
// ============================================================
const PARAM_STD = ["sicher", "sanft", "schnell", "stabil", "effizient"];

// Commit-Signatur nach Modul 17b: gekennzeichnete Zahlen-Buchstaben-Kombination.
// Ohne O/0/I/1/l — die verwechselt man beim Abschreiben.
function signaturErzeugen() {
  const z = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const r = new Uint8Array(12);
  crypto.getRandomValues(r);
  const s = Array.from(r).map((x) => z[x % z.length]).join("");
  return "AURA3-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}
const heute = () => new Date().toISOString().slice(0, 10);

function Abteilung17b({ say }) {
  const [liste, setListe] = useState([]);
  const [projekt, setProjekt] = useState("");
  const [param, setParam] = useState(PARAM_STD);
  const [prio, setPrio] = useState(1);
  const [start, setStart] = useState(heute());
  const [ziel, setZiel] = useState("");
  const [sig, setSig] = useState("");
  const [msg, setMsg] = useState({ t: "", c: "" });
  const [offen, setOffen] = useState(null);
  const fbRef = useRef(null);

  const aktiv = liste.filter((c) => c.status === "aktiv").length;
  const frei = 3 - aktiv;

  useEffect(() => { laden(); }, []);

  async function laden() {
    try {
      const d = await dbGet("commits", `${SUPABASE_URL}/rest/v1/commits?select=*&order=created_at.desc`);
      setListe(Array.isArray(d) ? d : []);
    } catch (e) { setMsg({ t: "» " + (e?.message || e), c: "err" }); }
  }

  async function execute() {
    if (!projekt.trim()) { setMsg({ t: "» kein projekt eingetragen", c: "err" }); return; }
    if (!sig) { setMsg({ t: "» keine signatur — ohne signatur kein commit", c: "err" }); return; }
    if (aktiv >= 3) { setMsg({ t: "» drei prioritätsplätze belegt — erst einen beenden oder pausieren", c: "err" }); return; }
    const neuC = { id: neueId(), user_id: getUserId(), projekt: projekt.trim(), parameter: param, prioritaet: prio, signatur: sig, start_datum: start || null, ziel_datum: ziel || null, status: "aktiv", created_at: new Date().toISOString() };
    setListe((l) => [neuC, ...l]);
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/commits`, neuC);
    setMsg({ t: ok ? "» command accepted · commit aktiv · priorität " + prio : "» offline — wird nachgesendet, sobald wieder netz da ist", c: ok ? "ok" : "work" });
    setProjekt(""); setSig(""); setZiel(""); setParam(PARAM_STD); setStart(heute());
    if (ok) laden();
  }

  // priorität und feedback ändern — still gespeichert
  function feld(c, k, v) {
    setListe((l) => l.map((x) => (x.id === c.id ? { ...x, [k]: v } : x)));
    if (fbRef.current) clearTimeout(fbRef.current);
    fbRef.current = setTimeout(async () => {
      const { ok } = await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/commits?id=eq.${c.id}`, { [k]: v, updated_at: new Date().toISOString() });
      setMsg({ t: ok ? "» gespeichert" : "» offline gespeichert — sync folgt", c: ok ? "ok" : "work" });
    }, 900);
  }

  async function setzeStatus(c, status, wort) {
    if (status === "beendet" && !confirm(`„${c.projekt}" beenden und ressourcen freigeben?`)) return;
    setListe((l) => l.map((x) => (x.id === c.id ? { ...x, status } : x)));
    const { ok } = await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/commits?id=eq.${c.id}`, { status, updated_at: new Date().toISOString() });
    setMsg({ t: "» " + (ok ? wort : wort + " · offline, folgt noch") + " · " + c.projekt, c: ok ? "ok" : "work" });
    if (ok) laden();
  }

  async function loeschen(c) {
    if (!confirm(`„${c.projekt}" aus dem archiv löschen?`)) return;
    setListe((l) => l.filter((x) => x.id !== c.id));
    const { ok } = await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/commits?id=eq.${c.id}`);
    if (ok) laden();
  }

  const tage = (c) => {
    if (!c.ziel_datum) return null;
    const d = Math.ceil((new Date(c.ziel_datum) - new Date()) / 86400000);
    return d < 0 ? "ziel überschritten" : d === 0 ? "ziel heute" : "noch " + d + " tage";
  };

  const sortiert = [...liste].sort((a, b) => a.prioritaet - b.prioritaet);

  return (
    <>
      <div className="grouphead">NEUER COMMIT<span className="rule" /></div>

      <Panel title="AURA3_COMMIT" sub={`${frei} von 3 prioritätsplätzen frei`}>
        <div className="field">
          <label className="cap">projekt</label>
          <input className="ti" value={projekt} onChange={(e) => setProjekt(e.target.value)} placeholder="roman fertigstellen." />
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="cap">parameter</label>
          <div className="parambox">
            {PARAM_STD.map((p) => (
              <label key={p} className={"parambtn" + (param.includes(p) ? " on" : "")}
                onClick={() => setParam(param.includes(p) ? param.filter((x) => x !== p) : [...param, p])}>
                {param.includes(p) ? "▪" : "▫"} {p}
              </label>
            ))}
          </div>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <div className="field"><label className="cap">start</label>
            <input className="ti" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field"><label className="cap">ziel</label>
            <input className="ti" type="date" value={ziel} onChange={(e) => setZiel(e.target.value)} /></div>
          <div className="field"><label className="cap">priorität</label>
            <Seg value={prio} onChange={(v) => setPrio(Number(v))} options={[{ v: 1, t: "1" }, { v: 2, t: "2" }, { v: 3, t: "3" }]} />
          </div>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="cap">commit-signatur</label>
          <div className="rezrow">
            <input className="ti sig" value={sig} readOnly placeholder="noch keine signatur" />
            <button className="btn" onClick={() => setSig(signaturErzeugen())}>⟳ signatur erzeugen</button>
          </div>
          <p className="hint">gedanken ohne gültige commit-signatur werden als energie verarbeitet.</p>
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn primary big" onClick={execute}>⏺ commit · execute</button>
          <span className={"status " + msg.c}>{msg.t || "bereit"}</span>
        </div>
      </Panel>

      <div className="grouphead">AKTIVE PRIORITÄTEN<span className="rule" /></div>

      {!liste.length && <p className="hint" style={{ marginLeft: 4 }}>noch kein commit. aura3 definiert keine ziele.</p>}

      {sortiert.map((c) => (
        <div className={"commit " + c.status + (offen === c.id ? " auf" : "")} key={c.id}>
          <div className="chead" onClick={() => setOffen(offen === c.id ? null : c.id)}>
            <span className={"cdot " + c.status} />
            <span className="cprio">P{c.prioritaet}</span>
            <span className="cprojekt">{c.projekt}</span>
            <span className="cstatus">{c.status}</span>
            <span className="chev">▾</span>
          </div>
          <div className="cmeta">
            {(c.parameter || []).join(" · ")}
            {c.start_datum && <> &nbsp;|&nbsp; start {c.start_datum}</>}
            {c.ziel_datum && <> &nbsp;|&nbsp; ziel {c.ziel_datum} <b>({tage(c)})</b></>}
          </div>
          <div className="csig">{c.signatur}</div>

          {c.feedback && offen !== c.id && <div className="cfb">{c.feedback}</div>}

          {offen === c.id && (
            <div className="cedit">
              <div className="field">
                <label className="cap">priorität</label>
                <Seg value={c.prioritaet} onChange={(v) => feld(c, "prioritaet", Number(v))}
                     options={[{ v: 1, t: "1" }, { v: 2, t: "2" }, { v: 3, t: "3" }]} />
                <p className="hint">gewichtung ändern — der commit bleibt, was er ist. alle drei dürfen auf 1 stehen.</p>
              </div>
              <div className="field" style={{ marginTop: 12 }}>
                <label className="cap">feedback</label>
                <AutoTa className="ta klein" value={c.feedback || ""} onChange={(e) => feld(c, "feedback", e.target.value)}
                        placeholder="🥳 hat sich erfüllt am …" />
              </div>
            </div>
          )}
          <div className="crec">
            <button title="resume" disabled={c.status === "aktiv"} onClick={() => setzeStatus(c, "aktiv", "resume")}>▶</button>
            <button title="pause" disabled={c.status !== "aktiv"} onClick={() => setzeStatus(c, "pausiert", "pause")}>❚❚</button>
            <button title="exit · ressourcen freigeben" disabled={c.status === "beendet"} onClick={() => setzeStatus(c, "beendet", "exit · ressourcen freigegeben")}>■</button>
            <button title="aus dem archiv löschen" className="del" onClick={() => loeschen(c)}>✕</button>
          </div>
        </div>
      ))}
    </>
  );
}

// ============================================================
// LOG-FILES · Operator-Logbuch
// ============================================================
const ZIEL_WOERTER = 750;
const HALB_WOERTER = 500; // zwei drittel — ab hier hat der tag geliefert
const zaehleWoerter = (t) => (t.trim() ? t.trim().split(/\s+/).filter(Boolean).length : 0);
const WOCHENTAG = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
// "#idee, reaktor #glow" -> ["idee","reaktor","glow"]
const tagsLesen = (s) => Array.from(new Set(
  (s || "").split(/[\s,]+/).map((x) => x.replace(/^#+/, "").trim().toLowerCase()).filter(Boolean)
));
const tagsSchreiben = (a) => (a || []).map((x) => "#" + x).join(" ");

const MONATE = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];

// ============================================================
// M42 · KOMMUNIKATOR — frage stellen, antwort empfangen, feedback dazu
// ============================================================
function M42() {
  const [liste, setListe] = useState([]);
  const [neueFrage, setNeueFrage] = useState("");
  const [msg, setMsg] = useState({ t: "", c: "" });
  const [antwortEntwurf, setAntwortEntwurf] = useState({});
  const [feedbackEntwurf, setFeedbackEntwurf] = useState({});

  useEffect(() => { laden(); }, []);

  async function laden() {
    try {
      const d = await dbGet("m42", `${SUPABASE_URL}/rest/v1/m42?select=*&order=created_at.desc`);
      setListe(Array.isArray(d) ? d : []);
    } catch (e) { setMsg({ t: "» " + (e?.message || e), c: "err" }); }
  }

  async function stellen() {
    const t = neueFrage.trim();
    if (!t) return;
    setNeueFrage("");
    const neu = { id: neueId(), user_id: getUserId(), frage: t, erledigt: false, created_at: new Date().toISOString() };
    setListe((l) => [neu, ...l]);
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/m42`, neu);
    setMsg({ t: ok ? "» frage gestellt" : "» offline gestellt — sync folgt", c: ok ? "ok" : "work" });
    if (ok) laden();
  }

  async function antworten(m, text) {
    if (!text.trim()) return;
    const zeit = new Date().toISOString();
    setListe((l) => l.map((x) => (x.id === m.id ? { ...x, antwort: text, antwort_zeit: zeit } : x)));
    setAntwortEntwurf((d) => ({ ...d, [m.id]: "" }));
    const { ok } = await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/m42?id=eq.${m.id}`, { antwort: text, antwort_zeit: zeit });
    if (ok) laden();
  }

  async function feedbacken(m, text) {
    if (!text.trim()) return;
    const zeit = new Date().toISOString();
    setListe((l) => l.map((x) => (x.id === m.id ? { ...x, feedback: text, feedback_zeit: zeit } : x)));
    setFeedbackEntwurf((d) => ({ ...d, [m.id]: "" }));
    const { ok } = await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/m42?id=eq.${m.id}`, { feedback: text, feedback_zeit: zeit });
    if (ok) laden();
  }

  async function erledigen(m) {
    setListe((l) => l.map((x) => (x.id === m.id ? { ...x, erledigt: true } : x)));
    const { ok } = await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/m42?id=eq.${m.id}`, { erledigt: true });
    if (ok) laden();
  }

  const zeitfmt = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE") + " · " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  };

  const offeneListe = liste.filter((m) => !m.erledigt);
  const erledigtListe = liste.filter((m) => m.erledigt);

  const Karte = (m) => (
    <div className={"m42karte" + (m.erledigt ? " erledigt" : "")} key={m.id}>
      <div className="m42zeile m42frage"><span className="m42tag">frage</span><i>{zeitfmt(m.created_at)}</i></div>
      <div className="m42text m42frage">{m.frage}</div>

      {m.antwort ? (
        <>
          <div className="m42zeile m42antwort"><span className="m42tag">antwortet</span><i>{zeitfmt(m.antwort_zeit)}</i></div>
          <div className="m42text m42antwort">{m.antwort}</div>
        </>
      ) : !m.erledigt && (
        <div className="m42eingabe">
          <input className="ti" placeholder="antwort eintragen …" value={antwortEntwurf[m.id] || ""}
            onChange={(e) => setAntwortEntwurf((d) => ({ ...d, [m.id]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && antworten(m, antwortEntwurf[m.id] || "")} />
          <button className="btn" onClick={() => antworten(m, antwortEntwurf[m.id] || "")}>eintragen</button>
        </div>
      )}

      {m.antwort && (
        m.feedback ? (
          <>
            <div className="m42zeile m42feedback"><span className="m42tag">feedback</span><i>{zeitfmt(m.feedback_zeit)}</i></div>
            <div className="m42text m42feedback">{m.feedback}</div>
          </>
        ) : !m.erledigt && (
          <div className="m42eingabe">
            <input className="ti" placeholder="feedback eintragen …" value={feedbackEntwurf[m.id] || ""}
              onChange={(e) => setFeedbackEntwurf((d) => ({ ...d, [m.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && feedbacken(m, feedbackEntwurf[m.id] || "")} />
            <button className="btn" onClick={() => feedbacken(m, feedbackEntwurf[m.id] || "")}>eintragen</button>
          </div>
        )
      )}

      {!m.erledigt && (
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => erledigen(m)}>👍 erledigt</button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="grouphead">MODUL 42 · KOMMUNIKATOR<span className="rule" /></div>

      <Panel title="M42" sub="frage in den raum stellen · antwort empfangen, wenn sie kommt">
        <div className="field">
          <label className="cap">neue frage</label>
          <div className="rezrow">
            <input className="ti" value={neueFrage} onChange={(e) => setNeueFrage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && stellen()}
              placeholder="was willst du wissen?" />
            <button className="btn primary" onClick={stellen}>stellen</button>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <span className={"status " + msg.c}>{msg.t}</span>
        </div>
      </Panel>

      {!liste.length && <p className="hint" style={{ marginLeft: 4 }}>noch keine frage gestellt.</p>}

      {offeneListe.map(Karte)}

      {!!erledigtListe.length && (
        <>
          <div className="grouphead" style={{ marginTop: 26 }}>ARCHIV<span className="rule" /></div>
          {erledigtListe.map(Karte)}
        </>
      )}
    </>
  );
}

// Ein Monat als Kästchen — leer / beschrieben / voll.
function MonatsGitter({ liste, datum, setDatum, monat, setMonat, children }) {
  const [j, m] = monat.split("-").map(Number);
  const tage = new Date(j, m, 0).getDate();
  const heuteS = heute();
  const map = {};
  liste.forEach((x) => { map[x.datum] = x.woerter; });

  const schieben = (n) => {
    const d = new Date(j, m - 1 + n, 1);
    const neu = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    if (neu <= heuteS.slice(0, 7)) setMonat(neu);
  };
  const istHeuteMonat = monat >= heuteS.slice(0, 7);

  return (
    <div className="mwrap">
      <div className="mnav">
        <button onClick={() => schieben(-1)} title="voriger monat">◀</button>
        <span className="mname">{MONATE[m - 1]} {j}</span>
        <button onClick={() => schieben(1)} disabled={istHeuteMonat} title="nächster monat">▶</button>
      </div>
      <div className="mgrid">
        {Array.from({ length: tage }, (_, i) => {
          const d = j + "-" + String(m).padStart(2, "0") + "-" + String(i + 1).padStart(2, "0");
          const w = map[d] || 0;
          const zukunft = d > heuteS;
          const cls = ["kasten"];
          if (w >= ZIEL_WOERTER) cls.push("voll");
          else if (w >= HALB_WOERTER) cls.push("halb");
          else if (w > 0) cls.push("teil");
          if (d === datum) cls.push("gewaehlt");
          if (d === heuteS) cls.push("heute");
          if (zukunft) cls.push("zukunft");
          return (
            <button key={d} className={cls.join(" ")} disabled={zukunft}
              title={i + 1 + ". " + MONATE[m - 1] + " · " + (w ? w + " wörter" : "leer")}
              onClick={() => setDatum(d)} />
          );
        })}
      </div>
      {children}
    </div>
  );
}

function LogFiles({ zeigeAbschreib }) {
  const [datum, setDatum] = useState(heute());
  const [monat, setMonat] = useState(() => heute().slice(0, 7));
  const [text, setText] = useState("");
  const [tagText, setTagText] = useState("");
  const [tagVorschlag, setTagVorschlag] = useState([]);
  const [tagFokus, setTagFokus] = useState(false);
  const [liste, setListe] = useState([]);
  const [suche, setSuche] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [treffer, setTreffer] = useState(null);
  const [msg, setMsg] = useState({ t: "bereit", c: "" });
  const [dirty, setDirty] = useState(false);
  const tRef = useRef(null);

  const w = zaehleWoerter(text);
  const voll = w >= ZIEL_WOERTER;
  const nr = liste.length ? liste.findIndex((x) => x.datum === datum) : -1;
  const eintragNr = nr >= 0 ? liste.length - nr : liste.length + 1;
  const d = new Date(datum + "T12:00:00");

  useEffect(() => { laden(); }, []);
  useEffect(() => { ladeTag(datum); setMonat(datum.slice(0, 7)); }, [datum]);

  // still speichern, 2 s nach dem letzten tastendruck
  useEffect(() => {
    if (!dirty) return;
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => speichern(true), 2000);
    return () => clearTimeout(tRef.current);
  }, [text, dirty]);

  async function laden() {
    try {
      const d2 = await dbGet("logfiles-liste", `${SUPABASE_URL}/rest/v1/logfiles?select=datum,woerter,tags&order=datum.desc`);
      setListe(Array.isArray(d2) ? d2 : []);
    } catch {}
  }
  async function ladeTag(dt) {
    try {
      const d2 = await dbGet("logfiles-tag-" + dt, `${SUPABASE_URL}/rest/v1/logfiles?select=text,tags&datum=eq.${dt}`);
      setText(d2?.[0]?.text || "");
      setTagText(tagsSchreiben(d2?.[0]?.tags));
      setDirty(false);
      setMsg(d2?.[0] ? { t: "eintrag geladen", c: "" } : { t: "neuer eintrag", c: "" });
    } catch (e) { setMsg({ t: String(e?.message || e), c: "err" }); }
  }
  async function speichern(still) {
    if (!still) setMsg({ t: "übertrage …", c: "work" });
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/logfiles?on_conflict=user_id,datum`,
      { user_id: getUserId(), datum, text, woerter: w, tags: tagsLesen(tagText), updated_at: new Date().toISOString() },
      { prefer: "resolution=merge-duplicates,return=minimal" });
    setDirty(false);
    setMsg({ t: ok ? "transmission saved · " + w + " wörter" : "offline gespeichert · " + w + " wörter — sync folgt", c: ok ? "ok" : "work" });
    if (ok) laden();
  }

  async function suchen(q, tag) {
    if (!q && !tag) { setTreffer(null); return; }
    try {
      let url = `${SUPABASE_URL}/rest/v1/logfiles?select=datum,woerter,text,tags&order=datum.desc&limit=60`;
      if (q) url += `&text=ilike.*${encodeURIComponent(q)}*`;
      if (tag) url += `&tags=cs.{${encodeURIComponent(tag)}}`;
      const r = await fetch(url, { headers: dbHeaders(getToken()) });
      const d2 = await r.json();
      setTreffer(Array.isArray(d2) ? d2 : []);
    } catch (e) { setMsg({ t: String(e?.message || e), c: "err" }); }
  }
  useEffect(() => { const id = setTimeout(() => suchen(suche, tagFilter), 350); return () => clearTimeout(id); }, [suche, tagFilter]);

  // alle je vergebenen tags, häufigste zuerst
  const alleTags = (() => {
    const z = {};
    liste.forEach((x) => (x.tags || []).forEach((tg) => { z[tg] = (z[tg] || 0) + 1; }));
    return Object.keys(z).sort((a, b) => z[b] - z[a]);
  })();

  // was gerade getippt wird — das letzte wort im feld
  const letzterTag = (v) => (v || "").split(/[\s,]+/).pop().replace(/^#+/, "").toLowerCase();

  function tagTippen(v) {
    setTagText(v); setDirty(true);
    const l = letzterTag(v);
    const schon = tagsLesen(v);
    const treffer = alleTags.filter((x) => x !== l && !schon.includes(x) && (l ? x.startsWith(l) : true));
    setTagVorschlag(l || tagFokus ? treffer.slice(0, 8) : []);
  }
  function tagUebernehmen(tg) {
    setTagText((v) => v.replace(/[^\s,]*$/, "") + "#" + tg + " ");
    setDirty(true); setTagVorschlag([]);
  }

  const schnipsel = (s, q) => {
    if (!s) return "";
    const i = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
    const a = i > 40 ? i - 40 : 0;
    return (a ? "… " : "") + s.slice(a, a + 130).replace(/\n+/g, " ") + (s.length > a + 130 ? " …" : "");
  };

  return (
    <>
      <div className="grouphead">LOG-FILES<span className="rule" /></div>

      <MonatsGitter liste={liste} datum={datum} setDatum={setDatum} monat={monat} setMonat={setMonat}>
        <div className="suchzeile">
          <input className="ti" value={suche} placeholder="⌕ in allen einträgen suchen …" onChange={(e) => setSuche(e.target.value)} />
          {(suche || tagFilter) && <button className="btn" onClick={() => { setSuche(""); setTagFilter(""); }}>✕</button>}
        </div>
        {alleTags.length > 0 && (
          <div className="chips">
            {alleTags.map((tg) => (
              <button key={tg} className={"chip" + (tagFilter === tg ? " on" : "")}
                onClick={() => setTagFilter(tagFilter === tg ? "" : tg)}>#{tg}</button>
            ))}
          </div>
        )}
        {treffer && (
          <div className="treffer">
            <div className="tkopf">{treffer.length} {treffer.length === 1 ? "eintrag" : "einträge"}{tagFilter && <> mit <b>#{tagFilter}</b></>}</div>
            {treffer.map((x) => (
              <button key={x.datum} className="tzeile" onClick={() => { setDatum(x.datum); setSuche(""); setTagFilter(""); }}>
                <span className="tdatum">{x.datum}</span>
                <span className="tschnipsel">{schnipsel(x.text, suche)}</span>
                <span className="twoerter">{x.woerter} w</span>
              </button>
            ))}
            {!treffer.length && <div className="tkopf">nichts gefunden.</div>}
          </div>
        )}
      </MonatsGitter>

      <div className="logextra">
        <button className="btn txtbtn klein" disabled={!text.trim()} onClick={() => zeigeAbschreib(text)}
                title="tageseintrag als klartext — schwebendes fenster">▤ klartext</button>
      </div>

      <Panel id="log-eintrag" title={"EINTRAG #" + String(eintragNr).padStart(3, "0")}
             sub={WOCHENTAG[d.getDay()] + " · " + d.toLocaleDateString("de-DE")}>
        <div className="rezrow" style={{ marginBottom: 12 }}>
          <input className="ti" type="date" value={datum} max={heute()} onChange={(e) => setDatum(e.target.value)} style={{ flex: "0 0 auto", minWidth: 150 }} />
          <div className="tagfeld">
            <input className="ti tags" value={tagText} placeholder="#hashtags"
              onChange={(e) => tagTippen(e.target.value)}
              onFocus={() => { setTagFokus(true); tagTippen(tagText); }}
              onBlur={() => setTimeout(() => { setTagFokus(false); setTagVorschlag([]); }, 160)}
              onKeyDown={(e) => {
                if (e.key === "Tab" && tagVorschlag.length) { e.preventDefault(); tagUebernehmen(tagVorschlag[0]); }
                if (e.key === "Escape") setTagVorschlag([]);
              }} />
            {tagVorschlag.length > 0 && (
              <div className="tagliste">
                <div className="taghinweis">{letzterTag(tagText) ? "gibt es schon — tab nimmt den ersten" : "schon vergeben"}</div>
                {tagVorschlag.map((tg, n) => (
                  <button key={tg} className={"tagvor" + (n === 0 && letzterTag(tagText) ? " erst" : "")}
                          onMouseDown={(e) => { e.preventDefault(); tagUebernehmen(tg); }}>#{tg}</button>
                ))}
              </div>
            )}
          </div>
          {datum !== heute() && <button className="btn" onClick={() => setDatum(heute())}>↺ heute</button>}
        </div>

        <AutoTa className="ta log" value={text}
          onChange={(e) => { setText(e.target.value); setDirty(true); }}
          placeholder={"> operator log\n> " + d.toLocaleDateString("de-DE") + "\n> was heute durch den reaktor ging …"} />

        <div className="logfoot">
          <div className="logbar"><i style={{ width: Math.min(100, (w / ZIEL_WOERTER) * 100) + "%" }} className={voll ? "voll" : w >= HALB_WOERTER ? "halb" : ""} /></div>
          <div className={"wcount" + (voll ? " voll" : "")}>
            {voll ? <>✓ {w} wörter · mission completed</> : <>{w} <span className="wziel">/ {ZIEL_WOERTER} wörter</span></>}
          </div>
        </div>

        <div className="actions" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => speichern(false)}>⇥ übertragen</button>
          <span className={"status " + msg.c}>{dirty ? "◉ rec" : msg.t}</span>
        </div>
        <p className="hint">speichert sich still von selbst, zwei sekunden nach dem letzten tastendruck.</p>
      </Panel>
    </>
  );
}

// ============================================================
// HANDBUCH · DEFLEKTIONSREAKTOR_AURA3
// Der Text liegt in /public — dort änderbar, ohne den Code anzufassen.
// ============================================================
function Handbuch() {
  const [fassung, setFassung] = useState("lese");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState({ t: "", c: "" });

  useEffect(() => {
    setText("");
    setMsg({ t: "lade …", c: "work" });
    fetch(fassung === "lese" ? "aura3.txt" : "aura3-vorlese.txt")
      .then((r) => { if (!r.ok) throw new Error("nicht gefunden"); return r.text(); })
      .then((s) => { setText(s); setMsg({ t: "", c: "" }); })
      .catch((e) => setMsg({ t: "» " + (e?.message || e), c: "err" }));
  }, [fassung]);

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ t: "vollständig kopiert · " + text.length.toLocaleString("de-DE") + " zeichen", c: "ok" });
      setTimeout(() => setMsg({ t: "", c: "" }), 2500);
    } catch {
      setMsg({ t: "kopieren blockiert — text markieren und cmd+c", c: "err" });
    }
  }

  const version = (text.match(/Version\s+([\d.]+)/) || [])[1];

  return (
    <>
      <div className="grouphead">HANDBUCH<span className="rule" /></div>

      <Panel title="DEFLEKTIONSREAKTOR_AURA3" sub={version ? "betriebssystem version " + version : ""}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "0 0 auto" }}>
            <label className="cap">fassung</label>
            <Seg value={fassung} onChange={setFassung}
              options={[{ v: "lese", t: "lesen" }, { v: "vorlese", t: "vorlesen" }]} />
          </div>
          <div className="actions" style={{ flex: 1, marginTop: 0 }}>
            <button className="btn primary" disabled={!text} onClick={kopieren}>⧉ alles kopieren</button>
            <span className={"status " + msg.c}>{msg.t || (text ? text.length.toLocaleString("de-DE") + " zeichen" : "…")}</span>
          </div>
        </div>
        <p className="hint">
          {fassung === "lese"
            ? "die lesefassung — mit modulköpfen, (_)P und T.O.T.E."
            : "für thorsten und ilona — pfeile, slashes und abkürzungen sind aufgelöst. diese hier gehört ins protokoll."}
        </p>
        <pre className="handbuch">{text}</pre>
      </Panel>
    </>
  );
}

// ============================================================
// SKRIPTE · die 3x3-Matrix als Geschichte
// ============================================================
// Rasterlage (so wird sie gelesen und geschrieben):
//   0 kartharsis      1 pay-off      2 anfang
//   3 rückzug         4 mainstate    5 1. katastrophe
//   6 3. katastrophe  7 midbuild     8 2. katastrophe
const POS = [
  { k: "kartharsis", akt: 3, gk: "kartharsis" },
  { k: "pay-off", akt: 3, gk: "pay off" },
  { k: "anfang", akt: 1, gk: "anfang" },
  { k: "rückzug", akt: 2, gk: "rückzug" },
  { k: "mainstate", akt: 0, gk: "mainstate" },
  { k: "1. katastrophe", akt: 1, gk: "erste katastrophe" },
  { k: "3. katastrophe", akt: 2, gk: "dritte katastrophe" },
  { k: "midbuild", akt: 2, gk: "midbuild" },
  { k: "2. katastrophe", akt: 2, gk: "zweite katastrophe" },
];
// Geschrieben wird: mainstate zuerst, dann im uhrzeigersinn ab position 3.
const SCHREIB_ORDER = [4, 2, 5, 8, 7, 6, 3, 0, 1];
const AKT_ROEMISCH = { 1: "I", 2: "II", 3: "III" };
const ZIEL_ABSATZ = 200;
const leer9 = () => ["", "", "", "", "", "", "", "", ""];

// Satzende = punkt/!/? — aber nicht mitten in "..." und nicht in "E0.01_E1.01".
function satzTeilen(s) {
  const out = [];
  let rest = (s || "").trim();
  while (rest) {
    const m = rest.match(/^[^\n]*?[.!?](?![.!?])(?=\s|$)/);
    if (m) { out.push(m[0].trim()); rest = rest.slice(m[0].length).trim(); }
    else {
      const nl = rest.indexOf("\n");
      const zeile = (nl === -1 ? rest : rest.slice(0, nl)).trim();
      if (zeile) out.push(zeile);
      if (nl === -1) break;
      rest = rest.slice(nl + 1).trim();
    }
  }
  return out.filter(Boolean);
}
// Die 3x3-karte: nur der erste satz — sonst wird sie unförmig.
const erstSatz = (s) => { const a = satzTeilen(s)[0] || ""; return a.length > 130 ? a.slice(0, 127) + "…" : a; };
// Das denkbrett: die ersten paar sätze — im mainstate steht ja die ganze synopsis.
const ersteSaetze = (s, n = 3) => { const a = satzTeilen(s); return a.slice(0, n).join(" ") + (a.length > n ? " …" : ""); };

// Damit man sich nicht verläuft: jede ebene eine eigene farbe.
//   0 wurzel = das buch        · grün
//   1 kind   = die 8 stationen · gelb
//   2 enkel  = die 64 szenen   · rosa
//   3 urenkel                  · violett (braucht man selten)
const EBENE_FARBE = ["var(--green)", "var(--amber)", "#e88fc0", "#9b8cf0"];
const farbe = (n) => EBENE_FARBE[Math.min(n, EBENE_FARBE.length - 1)];

// ============================================================
// KORREKTUR · lesefassung zum korrigieren & vorlesen.
// jede box bleibt an ihr echtes feld gebunden (onChange) — korrekturen
// fließen direkt zurück, KEIN zusammenkleben/zerlegen nötig. das flatten
// passiert nur einseitig richtung konsole (vorlesen), nie zurück.
// bloecke: [{ nr, sub, text, onChange, gruppe? }]  gruppe = überschrift über dem block
// ============================================================
// ============================================================
// SCHWEBE-FENSTER · text zum abschreiben, frei verschiebbar + größenverstellbar.
// blockiert die app NICHT (kein backdrop) — an die seite ziehen, drunter weiterarbeiten.
// reines txt. verschieben an der titelleiste, größe an der ecke unten rechts.
// ============================================================
function SchwebeFenster({ text, onClose }) {
  const [pos, setPos] = useState({ x: 24, y: 96 });
  const [groesse, setGroesse] = useState(() => ({
    w: Math.min(460, Math.round(window.innerWidth * 0.88)),
    h: Math.min(560, Math.round(window.innerHeight * 0.72)),
  }));
  const [kopiert, setKopiert] = useState(false);
  if (text == null) return null;

  const hoeren = (move) => {
    const stop = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", move); window.removeEventListener("touchend", stop);
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", stop);
  };
  const startMove = (e) => {
    const p0 = e.touches ? e.touches[0] : e;
    const sx = p0.clientX, sy = p0.clientY, ox = pos.x, oy = pos.y;
    hoeren((ev) => {
      const p = ev.touches ? ev.touches[0] : ev;
      if (ev.cancelable) ev.preventDefault();
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 70, ox + (p.clientX - sx))),
        y: Math.max(0, Math.min(window.innerHeight - 46, oy + (p.clientY - sy))),
      });
    });
  };
  const startResize = (e) => {
    e.stopPropagation();
    const p0 = e.touches ? e.touches[0] : e;
    const sx = p0.clientX, sy = p0.clientY, ow = groesse.w, oh = groesse.h;
    hoeren((ev) => {
      const p = ev.touches ? ev.touches[0] : ev;
      if (ev.cancelable) ev.preventDefault();
      setGroesse({
        w: Math.max(240, Math.min(window.innerWidth - pos.x - 6, ow + (p.clientX - sx))),
        h: Math.max(140, Math.min(window.innerHeight - pos.y - 6, oh + (p.clientY - sy))),
      });
    });
  };
  const kopieren = () => { try { navigator.clipboard.writeText(text); setKopiert(true); setTimeout(() => setKopiert(false), 1400); } catch {} };

  return (
    <div className="schwebe" style={{ left: pos.x, top: pos.y, width: groesse.w, height: groesse.h }}>
      <div className="schwebekopf" onMouseDown={startMove} onTouchStart={startMove}>
        <span className="schwebetitel">▤ klartext</span>
        <button className="schwebebtn" onClick={kopieren} title="in die zwischenablage">{kopiert ? "✓" : "⧉"}</button>
        <button className="schwebebtn" onClick={onClose} title="schließen">×</button>
      </div>
      <div className="schwebetext">{text}</div>
      <div className="schweberesize" onMouseDown={startResize} onTouchStart={startResize} title="größe ziehen" />
    </div>
  );
}

function Korrektur({ titel, bloecke, onZurueck, onSpeichern, zurKonsole, zeigeAbschreib, dirty, msg }) {
  const gefuellt = bloecke.filter((b) => (b.text || "").trim());
  const alles = () => gefuellt.map((b) => (b.gruppe ? b.gruppe + ".\n\n" : "") + b.text.trim()).join("\n\n");
  return (
    <>
      <div className="seitenkopf">
        <button className="btn" onClick={onZurueck}>← zurück</button>
        <span className="xfiles">{(titel || "unbenannt") + " · korrektur"}</span>
        <button className="btn txtbtn" disabled={!gefuellt.length} onClick={() => { const t = alles(); if (t) zurKonsole(t); }}
                title="ganze lesefassung an die konsole — thorsten liest vor">▶ alles vorlesen</button>
        <button className="btn txtbtn klein" disabled={!gefuellt.length} onClick={() => zeigeAbschreib(alles())}
                title="ganze lesefassung als klartext — schwebendes fenster">▤</button>
        <button className="btn primary" onClick={onSpeichern}>⇥ speichern</button>
      </div>
      <div className="korr">
        {gefuellt.length === 0 && <div className="pleer">noch nichts geschrieben, was sich korrigieren ließe.</div>}
        {gefuellt.map((b, n) => (
          <div className="korrblock" key={b.key || n}>
            {b.gruppe && <div className="korrgruppe">{b.gruppe}</div>}
            <div className="korrlabel">
              <span className="korrnr">{b.nr}</span>
              {b.sub && <span className="korrsub">{b.sub}</span>}
              <span className="korrw">{zaehleWoerter(b.text || "")} w</span>
              <button className="btn txtbtn klein" title="diesen abschnitt vorlesen" onClick={() => (b.text || "").trim() && zurKonsole(b.text.trim())}>▶</button>
              <button className="btn txtbtn klein" title="diesen abschnitt als klartext" onClick={() => (b.text || "").trim() && zeigeAbschreib(b.text.trim())}>▤</button>
            </div>
            <AutoTa className="ta korrta" value={b.text || ""} onChange={(e) => b.onChange(e.target.value)} placeholder="—" />
          </div>
        ))}
      </div>
      <div className="actions" style={{ marginTop: 14 }}>
        <span className={"status " + (msg ? msg.c : "")}>{dirty ? "◉ rec" : (msg ? msg.t : "bereit")}</span>
      </div>
    </>
  );
}

function Skripte({ sprung, setSprung, projekt, setProjekt, zurKonsole, zeigeAbschreib, kette }) {
  const [view, setView] = useState("projekte");
  const [ordner, setOrdner] = useState([]);
  const [alle, setAlle] = useState([]);
  const aktOrdner = projekt, setAktOrdner = setProjekt; // "" = alle (nur filter)
  const [skriptOrdner, setSkriptOrdner] = useState(null); // der ordner DIESES skripts
  const [zu, setZu] = useState({});
  const [id, setId] = useState(null);
  const [name, setName] = useState("");
  const [hook, setHook] = useState("");
  const [htsMsg, setHtsMsg] = useState("");
  const [bemerkung, setBemerkung] = useState("");
  const [matrix, setMatrix] = useState(leer9);
  const [texte, setTexte] = useState(leer9);
  const [elternId, setElternId] = useState(null);
  const [elternPos, setElternPos] = useState(null);
  const [gewaehlt, setGewaehlt] = useState(null);
  const [zuSzene, setZuSzene] = useState({});
  const [msg, setMsg] = useState({ t: "bereit", c: "" });
  const [dirty, setDirty] = useState(false);
  const tRef = useRef(null);
  const idRef = useRef(null);
  const eingabeRef = useRef(null);
  useEffect(() => { idRef.current = id; }, [id]);
  // welche szenen zugeklappt sind — pro skript, überlebt das neuladen
  useEffect(() => {
    if (!id) { setZuSzene({}); return; }
    try { setZuSzene(JSON.parse(localStorage.getItem("szenen:" + id) || "{}")); } catch { setZuSzene({}); }
  }, [id]);
  const kippeSzene = (i) => setZuSzene((z) => {
    const n = { ...z, [i]: !z[i] };
    if (id) try { localStorage.setItem("szenen:" + id, JSON.stringify(n)); } catch {}
    return n;
  });

  useEffect(() => { laden(); }, [projekt]);

  // sprung aus THINGS: skript öffnen, auf die schreibseite, zur position scrollen
  useEffect(() => {
    if (!sprung || !alle.length) return;
    const s = alle.find((x) => x.id === sprung.id);
    if (!s) return;
    oeffnen(s); setView("schreiben");
    const pos = sprung.i;
    setSprung(null);
    setTimeout(() => {
      const el = document.getElementById("szene-" + pos);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("blitz");
      setTimeout(() => el.classList.remove("blitz"), 1600);
    }, 120);
  }, [sprung, alle]);

  useEffect(() => {
    if (!dirty) return;
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(() => speichern(true), 2000);
    return () => clearTimeout(tRef.current);
  }, [name, hook, bemerkung, matrix, texte, dirty]);

  const aendern = (fn) => { fn(); setDirty(true); };
  const setM = (i, v) => aendern(() => setMatrix((m) => m.map((x, n) => (n === i ? v : x))));
  const setT = (i, v) => aendern(() => setTexte((m) => m.map((x, n) => (n === i ? v : x))));

  async function laden() {
    try {
      const [o, s] = await Promise.all([
        dbGet("skript_ordner", `${SUPABASE_URL}/rest/v1/skript_ordner?select=*&order=created_at.asc`),
        dbGet("skripte", `${SUPABASE_URL}/rest/v1/skripte?select=*&order=updated_at.desc`),
      ]);
      // das projekt, an dem gerade gearbeitet wird, steht vorn — sonst sucht man ewig
      if (Array.isArray(o)) setOrdner(o.slice().sort((a, b) => (b.id === projekt) - (a.id === projekt)));
      if (Array.isArray(s)) setAlle(s);
    } catch (e) { setMsg({ t: String(e?.message || e), c: "err" }); }
  }

  function neu(vorgabe = {}) {
    setId(null); setSkriptOrdner(vorgabe.ordner_id !== undefined ? vorgabe.ordner_id : (aktOrdner || null));
    setName(vorgabe.name || ""); setHook(vorgabe.hook || ""); setBemerkung("");
    setMatrix(vorgabe.matrix || leer9()); setTexte(vorgabe.texte || leer9());
    setElternId(vorgabe.eltern_id || null); setElternPos(vorgabe.eltern_pos ?? null);
    setGewaehlt(null); setDirty(false); setMsg({ t: "neues skript", c: "" });
  }

  function oeffnen(s) {
    setId(s.id); setSkriptOrdner(s.ordner_id || null); setName(s.name || ""); setHook(s.hook || ""); setBemerkung(s.bemerkung || "");
    setMatrix(Array.isArray(s.matrix) && s.matrix.length === 9 ? s.matrix : leer9());
    setTexte(Array.isArray(s.texte) && s.texte.length === 9 ? s.texte : leer9());
    setElternId(s.eltern_id || null); setElternPos(s.eltern_pos ?? null);
    setGewaehlt(null); setDirty(false); setMsg({ t: "geladen: " + (s.name || "unbenannt"), c: "ok" });
  }

  async function speichern(still) {
    const nm = name.trim() || "unbenannt · " + new Date().toLocaleDateString("de-DE");
    const cur = idRef.current;
    const eigeneId = cur || neueId();
    const body = {
      ...(cur ? {} : { id: eigeneId }),
      user_id: getUserId(), ordner_id: skriptOrdner, name: nm,
      hook, bemerkung, matrix, texte, eltern_id: elternId, eltern_pos: elternPos,
      updated_at: new Date().toISOString(),
    };
    if (!still) setMsg({ t: "speichere …", c: "work" });
    const { ok } = cur
      ? await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/skripte?id=eq.${cur}`, body)
      : await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/skripte`, body);
    if (!cur) setId(eigeneId);
    setDirty(false);
    setMsg({ t: ok ? "gespeichert · " + nm : "offline gespeichert · " + nm + " — sync folgt", c: ok ? "ok" : "work" });
    if (ok) laden();
    return eigeneId;
  }

  // wie viele hängen dran? (kinder, enkel, urenkel …)
  function nachkommen(pid, tiefe = 0) {
    if (tiefe > 12) return [];
    const k = alle.filter((x) => x.eltern_id === pid);
    return k.concat(...k.map((x) => nachkommen(x.id, tiefe + 1)));
  }
  async function loeschen(s) {
    const n = nachkommen(s.id).length;
    const frage = n
      ? `skript „${s.name}" löschen?\n\nachtung: ${n} zweig${n === 1 ? "" : "e"} darunter ${n === 1 ? "wird" : "werden"} mitgelöscht.`
      : `skript „${s.name}" löschen?`;
    if (!confirm(frage)) return;
    const { ok } = await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/skripte?id=eq.${s.id}`);
    if (s.id === id) neu();
    if (ok) laden();
  }

  async function ordnerNeu() {
    const n = prompt("name des projekts?");
    if (!n?.trim()) return;
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/skript_ordner`, { id: neueId(), user_id: getUserId(), name: n.trim() });
    if (ok) laden();
  }
  async function ordnerWeg(o) {
    if (!confirm(`projekt „${o.name}" löschen? die skripte darin bleiben.`)) return;
    const { ok } = await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/skript_ordner?id=eq.${o.id}`);
    if (aktOrdner === o.id) setAktOrdner("");
    if (ok) laden();
  }

  // ganzen zweig (skript + alle nachkommen) einem anderen projekt zuordnen
  async function zweigVerschieben(s, zielOrdnerId) {
    const ids = [s.id, ...nachkommen(s.id).map((x) => x.id)];
    const { ok } = await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/skripte?id=in.(${ids.join(",")})`, { ordner_id: zielOrdnerId || null });
    setMsg({ t: "» " + ids.length + " szene" + (ids.length === 1 ? "" : "n") + (ok ? " verschoben" : " verschoben · offline, sync folgt"), c: ok ? "ok" : "work" });
    if (ok) laden();
  }

  // einzelnes skript duplizieren — kopie wird eigenständige wurzel, hängt an keinem baum
  async function kopieren(s) {
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/skripte`, {
      id: neueId(), user_id: getUserId(), ordner_id: s.ordner_id || null, name: (s.name || "unbenannt") + " (kopie)",
      hook: s.hook || "", bemerkung: s.bemerkung || "", matrix: s.matrix || leer9(), texte: s.texte || leer9(),
      eltern_id: null, eltern_pos: null,
    });
    setMsg({ t: ok ? "» kopiert · als eigenes skript im selben projekt" : "» offline kopiert — sync folgt", c: ok ? "ok" : "work" });
    if (ok) laden();
  }

  // hook in den henkeltassen-schrank (hts_ultra) im denkbrett schicken
  async function htsSenden() {
    const t = hook.trim();
    if (!t) return;
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/hts`, { id: neueId(), user_id: getUserId(), hook: t });
    setHtsMsg(ok ? "☕ im schrank" : "☕ offline — folgt");
    setTimeout(() => setHtsMsg(""), 2500);
  }

  // aus einer position ein eigenes skript machen — der baum
  async function verzweigen(i) {
    if (!matrix[i].trim()) { setMsg({ t: "erst beschreiben, was an der position passiert", c: "err" }); return; }
    const eltern = await speichern(true);
    if (!eltern) return;
    const m = leer9(); m[4] = matrix[i];
    // die 200 wörter, die hier oben schon geschrieben wurden, wandern als übersicht mit.
    const tx = leer9(); tx[4] = texte[i] || "";
    neu({ name: POS[i].k, hook, matrix: m, texte: tx, eltern_id: eltern, eltern_pos: i, ordner_id: skriptOrdner });
    setView("matrix");
    setMsg({ t: "verzweigt · " + POS[i].k + " ist jetzt mainstate", c: "ok" });
  }

  // alle szenentexte am stück — für thorsten in der konsole.
  // ohne mainstate (der hat kein textfeld) und ohne die matrix, nur der text.
  const szenenTexte = SCHREIB_ORDER.filter((i) => i !== 4).map((i) => (texte[i] || "").trim()).filter(Boolean);
  const szenenWoerter = szenenTexte.reduce((s, x) => s + zaehleWoerter(x), 0);
  // marker als eigener satz — dann liest thorsten sie als ansage, nicht als teil des textes
  const szenenText = () => SCHREIB_ORDER.filter((i) => i !== 4)
    .filter((i) => (texte[i] || "").trim())
    .map((i) => POS[i].gk + ".\n\n" + texte[i].trim())
    .join("\n\n");

  function anDieKonsole() {
    if (!szenenTexte.length) { setMsg({ t: "noch nichts geschrieben", c: "err" }); return; }
    const s = szenenText();
    // in der konsole steht schon was anderes drin? nicht einfach drüberbügeln.
    if (kette && kette.trim() && kette.trim() !== s.trim()) {
      const w = zaehleWoerter(kette);
      if (!confirm(`in der konsole liegen schon ${w.toLocaleString("de-DE")} wörter.\n\nüberschreiben?`)) return;
    }
    zurKonsole(s);
  }
  async function txtKopieren() {
    if (!szenenTexte.length) { setMsg({ t: "noch nichts geschrieben", c: "err" }); return; }
    try {
      await navigator.clipboard.writeText(szenenText());
      setMsg({ t: "kopiert · " + szenenWoerter.toLocaleString("de-DE") + " wörter", c: "ok" });
    } catch { setMsg({ t: "kopieren blockiert — text markieren und cmd+c", c: "err" }); }
  }

  // brotkrumen: den baum nach oben laufen
  const krumen = (() => {
    const k = []; let e = elternId, tiefe = 0;
    while (e && tiefe++ < 12) { const s = alle.find((x) => x.id === e); if (!s) break; k.unshift(s); e = s.eltern_id; }
    return k;
  })();

  // brotkrumen — auf jeder seite gleich, springen ohne die seite zu wechseln
  const ebene = krumen.length;
  const Krumen = ({ ziel }) => krumen.length === 0 ? null : (
    <div className="krumen">
      {krumen.map((s, n) => (
        <span key={s.id}>
          <button style={{ color: farbe(n) }} onClick={() => { oeffnen(s); if (ziel) setView(ziel); }}>{s.name || "unbenannt"}</button> ›{" "}
        </span>
      ))}
      <b style={{ color: farbe(ebene) }}>{name || "neu"}</b>
    </div>
  );

  const meine = alle.filter((s) => (aktOrdner ? s.ordner_id === aktOrdner : true));
  // mainstate (4) zählt nicht mit — der sagt nur, worum es geht. es gibt 8 stationen.
  const gefuellt = (s) => (Array.isArray(s.matrix) ? s.matrix.filter((x, n) => n !== 4 && x && x.trim()).length : 0);

  // der baum: wurzeln, kinder, kindeskinder — aufklappbar
  const Baum = ({ eltern, tiefe }) => {
    const kids = meine.filter((s) => (s.eltern_id || null) === eltern);
    if (!kids.length) return null;
    return kids.map((s) => {
      const enkel = meine.filter((x) => x.eltern_id === s.id);
      const offen = !zu[s.id];
      // steht der mainstate-text schon im namen? dann nicht zweimal zeigen.
      const nm = (s.name || "unbenannt").trim();
      const sub = ((Array.isArray(s.matrix) ? s.matrix[4] : "") || "").trim();
      const a = nm.toLowerCase(), b = sub.toLowerCase();
      const doppelt = !b || a === b || (b.length > 6 && a.includes(b.slice(0, 24))) || (a.length > 6 && b.includes(a.slice(0, 24)));
      return (
        <div key={s.id}>
          <div className={"bzeile" + (s.id === id ? " on" : "")}
               style={{ paddingLeft: 8 + tiefe * 20, "--lvl": farbe(tiefe) }}>
            <button className="bpfeil" disabled={!enkel.length}
              onClick={() => setZu((z) => ({ ...z, [s.id]: !z[s.id] }))}>
              {enkel.length ? (offen ? "▾" : "▸") : "·"}
            </button>
            <button className="bhaupt" onClick={() => oeffnen(s)}>
              <span className="bname">{nm}</span>
              {!doppelt && <span className="bsub">{sub}</span>}
            </button>
            <span className="bmeta">{gefuellt(s)}/8</span>
            {tiefe === 0 && (
              <select className="bmove" value="" onChange={(e) => { if (e.target.value) zweigVerschieben(s, e.target.value); e.target.value = ""; }}
                title="ganzen zweig in ein anderes projekt verschieben">
                <option value="" disabled>→ projekt</option>
                {ordner.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </div>
          {offen && <Baum eltern={s.id} tiefe={tiefe + 1} />}
        </div>
      );
    });
  };
  const kinder = (pid, pos) => alle.filter((s) => s.eltern_id === pid && s.eltern_pos === pos);

  // ---------- SEITE 1 ----------
  if (view === "projekte") return (
    <>
      <div className="grouphead">SKRIPTE<span className="rule" /></div>
      <div className="seitenkopf">
        <span className="xfiles">{name || "neues skript"}</span>
        <span className="ebadge" style={{ "--lvl": farbe(ebene) }} title={"ebene " + ebene}>E{ebene}</span>
        <button className="btn primary" onClick={() => setView("matrix")}>weiter →</button>
      </div>
      <Panel id="skripte-projekte" title="PROJEKTE" sub="ordner & gespeicherte skripte">
        <div className="otabs">
          <button className="otab neu" onClick={() => neu()}>+ neues skript</button>
          <button className={"otab" + (aktOrdner === "" ? " on" : "")} onClick={() => setAktOrdner("")}>alle</button>
          {ordner.map((o) => (
            <span className={"otab" + (aktOrdner === o.id ? " on" : "")} key={o.id}>
              <button onClick={() => setAktOrdner(o.id)}>{o.name}</button>
              <i onClick={() => ordnerWeg(o)}>✕</i>
            </span>
          ))}
          <button className="otab" onClick={ordnerNeu}>+ neu</button>
        </div>

        <div className="baum">
          {meine.filter((s) => !s.eltern_id).length === 0 && <div className="bleer">noch kein skript. „+ neues skript" fängt an.</div>}
          <Baum eltern={null} tiefe={0} />
        </div>
        {id && (
          <div className="rezrow" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => kopieren(alle.find((x) => x.id === id) || { id, name, hook, bemerkung, matrix, texte, ordner_id: skriptOrdner })}>⧉ kopieren</button>
            <button className="btn stop" onClick={() => loeschen(alle.find((x) => x.id === id) || { id, name })}>■ dieses skript löschen</button>
          </div>
        )}

        <Krumen />

        <div className="field" style={{ marginTop: 16 }}>
          <label className="cap">session-name</label>
          <input className="ti" value={name} onChange={(e) => aendern(() => setName(e.target.value))} placeholder="arbeitstitel" />
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="cap">the hook</label>
          <textarea className="ta" value={hook} onChange={(e) => aendern(() => setHook(e.target.value))}
            placeholder="der satz, der alles trägt" style={{ minHeight: 70 }} />
          <div className="rezrow" style={{ marginTop: 8 }}>
            <button className="btn" disabled={!hook.trim()} onClick={htsSenden}>☕ ans denkbrett senden</button>
            {htsMsg && <span className="status ok">{htsMsg}</span>}
          </div>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="cap">bemerkungen</label>
          <textarea className="ta" value={bemerkung} onChange={(e) => aendern(() => setBemerkung(e.target.value))}
            placeholder="was is die idee" style={{ minHeight: 70 }} />
        </div>

        <div className="actions" style={{ marginTop: 16 }}>
          <span className={"status " + msg.c}>{dirty ? "◉ rec" : msg.t}</span>
        </div>
      </Panel>
    </>
  );

  // ---------- SEITE 2 ----------
  if (view === "matrix") return (
    <>
      <div className="seitenkopf">
        <button className="btn" onClick={() => setView("projekte")}>← zurück</button>
        <span className="xfiles">x-files</span>
        <span className="ebadge" style={{ "--lvl": farbe(ebene) }} title={"ebene " + ebene}>E{ebene}</span>
        <button className="btn primary" onClick={() => setView("schreiben")}>weiter →</button>
      </div>
      <Krumen ziel="matrix" />
      <div className="mx">
        {POS.map((p, i) => (
          <button key={i} style={{ "--o": SCHREIB_ORDER.indexOf(i) }}
            className={"zelle" + (gewaehlt === i ? " on" : "") + (i === 4 ? " mitte" : "") + (matrix[i].trim() ? " voll" : "")}
            onClick={() => {
              setGewaehlt(i);
              // portrait: das schreibfeld liegt unter neun kästchen. hinbringen.
              if (window.innerWidth <= 640) setTimeout(() => eingabeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
            }}>
            {p.akt > 0 && <span className="akt">{AKT_ROEMISCH[p.akt]}</span>}
            <span className="zname">{p.k}</span>
            <span className="ztext">{erstSatz(matrix[i]) || "+"}</span>
          </button>
        ))}
      </div>
      {gewaehlt !== null && (
        <div className="eingabe" ref={eingabeRef}>
          <div className="ekopf">
            <span className="zname">{POS[gewaehlt].k}</span>
            <button className="btn" onClick={() => setM(gewaehlt, "")}>✕ leeren</button>
            <button className="btn zumraster" onClick={() => { setGewaehlt(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}>↑ zurück zur matrix</button>
          </div>
          <textarea className="ta" autoFocus value={matrix[gewaehlt]} onChange={(e) => setM(gewaehlt, e.target.value)}
            placeholder="in kurzen worten: was passiert hier?" style={{ minHeight: 80 }} />
        </div>
      )}
      <div className="actions" style={{ marginTop: 12 }}>
        <span className={"status " + msg.c}>{dirty ? "◉ rec" : msg.t}</span>
      </div>
    </>
  );

  // ---------- KORREKTUR (lesefassung) ----------
  if (view === "korrektur") return (
    <Korrektur
      titel={name}
      dirty={dirty}
      msg={msg}
      zurKonsole={zurKonsole}
      zeigeAbschreib={zeigeAbschreib}
      onZurueck={() => setView("schreiben")}
      onSpeichern={() => speichern(false)}
      bloecke={SCHREIB_ORDER.filter((i) => i !== 4).map((i) => ({
        key: "sz" + i,
        nr: POS[i].k,
        text: texte[i] || "",
        onChange: (v) => setT(i, v),
      }))}
    />
  );

  // ---------- SEITE 3 ----------
  return (
    <>
      <div className="seitenkopf">
        <button className="btn" onClick={() => setView("matrix")}>← zurück</button>
        <span className="xfiles" style={{ color: farbe(ebene), textShadow: "0 0 8px " + farbe(ebene) + "60" }}>{name || "unbenannt"}</span>
        <span className="ebadge" style={{ "--lvl": farbe(ebene) }} title={"ebene " + ebene}>E{ebene}</span>
        <button className="btn txtbtn" onClick={anDieKonsole} disabled={!szenenTexte.length}
                title="alle szenentexte ins textfeld der konsole — thorsten liest vor">
          ▶ konsole{szenenWoerter ? " · " + szenenWoerter.toLocaleString("de-DE") + " w" : ""}
        </button>
        <button className="btn txtbtn klein" onClick={txtKopieren} disabled={!szenenTexte.length}
                title="stattdessen in die zwischenablage">⧉</button>
        <button className="btn txtbtn klein" onClick={() => zeigeAbschreib(szenenText())} disabled={!szenenTexte.length}
                title="text als klartext — schwebendes fenster">▤</button>
        <button className="btn txtbtn" onClick={() => setView("korrektur")} disabled={!szenenTexte.length}
                title="lesefassung zum korrigieren & vorlesen">✎ korrektur</button>
        <button className="btn primary" onClick={() => speichern(false)}>⇥ speichern</button>
      </div>

      <Krumen ziel="schreiben" />

      {hook && <div className="hookzeile">🎯 {hook}</div>}

      <div className="mx klein">
        {POS.map((p, i) => {
          const kids = id ? kinder(id, i) : [];
          const kind = kids[0];
          const zurSzene = () => {
            const el = document.getElementById("szene-" + i);
            if (!el) return;
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("blitz"); setTimeout(() => el.classList.remove("blitz"), 1600);
          };
          return (
            <button key={i} style={{ "--o": SCHREIB_ORDER.indexOf(i) }}
              className={"zelle" + (i === 4 ? " mitte" : "") + (matrix[i].trim() ? " voll" : "") + (kind ? " hatkind" : "")}
              title={kind ? "→ " + kind.name + " (ebene " + (ebene + 1) + ")" : "→ zur szene"}
              onClick={() => { if (kind) { oeffnen(kind); setView("schreiben"); } else zurSzene(); }}>
              {p.akt > 0 && <span className="akt">{AKT_ROEMISCH[p.akt]}</span>}
              <span className="zname">{p.k}</span>
              <span className="ztext" title={matrix[i]}>{erstSatz(matrix[i]) || "—"}</span>
              {kind && <span className="zkind" style={{ color: farbe(ebene + 1) }}>↳ {kids.length > 1 ? kids.length + " zweige" : kind.name}</span>}
            </button>
          );
        })}
      </div>

      {SCHREIB_ORDER.map((i, n) => {
        const w = zaehleWoerter(texte[i]);
        const voll = w >= ZIEL_ABSATZ;
        const kids = id ? kinder(id, i) : [];
        const mitte = i === 4;
        const zu = !!zuSzene[i];
        return (
          <div className={"szene" + (mitte ? " mitte" : "") + (zu ? " zu" : "")} key={i} id={"szene-" + i}>
            <div className="skopf" onClick={() => kippeSzene(i)}>
              <span className="snr">{mitte ? "00" : String(n).padStart(2, "0")}</span>
              <span className="zname">{POS[i].k}</span>
              {POS[i].akt > 0 && <span className="akt">{AKT_ROEMISCH[POS[i].akt]}</span>}
              {!mitte && <span className="smatrix">{matrix[i] || "—"}</span>}
              {mitte && <span className="smatrix mshinweis">worum es hier geht — nicht zu schreiben, sondern mitgebracht</span>}
              {zu && !mitte && <span className="szu">{w} w</span>}
              <span className="chev">▾</span>
            </div>

            {!zu && (mitte ? (
              <div className="msuebersicht">
                <div className="msvoll">{matrix[4] || "— noch kein mainstate —"}</div>
                {texte[4] && (
                  <div className="mserbe">
                    <div className="mserbekopf">
                      ↳ aus <b>{elternPos != null ? POS[elternPos].k : "der ebene drüber"}</b>
                      {krumen.length > 0 && <> · {krumen[krumen.length - 1].name}</>}
                      <i>{zaehleWoerter(texte[4])} wörter</i>
                    </div>
                    <div className="mserbetext">{texte[4]}</div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <AutoTa className="ta" value={texte[i]} onChange={(e) => setT(i, e.target.value)} placeholder="…" />
                <div className="logfoot">
                  <div className="logbar"><i style={{ width: Math.min(100, (w / ZIEL_ABSATZ) * 100) + "%" }} className={voll ? "voll" : ""} /></div>
                  <div className={"wcount" + (voll ? " voll" : "")}>
                    {voll ? <>✓ {w} wörter</> : <>{w} <span className="wziel">/ {ZIEL_ABSATZ}</span></>}
                  </div>
                </div>
              </>
            ))}
            {i !== 4 && (
              <div className="zweig">
                {kids.map((k) => <button key={k.id} className="kind" onClick={() => { oeffnen(k); setView("schreiben"); }}>↳ {k.name}</button>)}
                <button className="btn zweigbtn" onClick={() => verzweigen(i)}>→ zum mainstate machen</button>
              </div>
            )}
          </div>
        );
      })}

      <div className="actions" style={{ marginTop: 12 }}>
        <span className={"status " + msg.c}>{dirty ? "◉ rec" : msg.t}</span>
      </div>
    </>
  );
}

// ============================================================
// THINGS · personen, orte, dinge
// ============================================================

// avatar-silhouetten — feine umrisse, unten offen, im terminal-look
const AVATARE = ["mann", "frau", "monster", "kreatur", "magier"];
const GRUPPEN = ["gruppe", "gruppe_evil"];
function Avatar({ typ, size = 44 }) {
  const mann1 = (t, s) => <g transform={`translate(${t},${s.y}) scale(${s.k})`}><circle className="avfill" cx="0" cy="18" r="21" /><path className="avfill" d={`M-31 ${s.b+1} Q-31 44 0 44 Q31 44 31 ${s.b+1} Z`} /><circle className="avf" cx="0" cy="18" r="20" /><circle className="avl" cx="0" cy="18" r="20" /><path className="avf" d={`M-30 ${s.b} Q-30 44 0 44 Q30 44 30 ${s.b} Z`} /><path className="avl" d={`M-30 ${s.b} Q-30 44 0 44 Q30 44 30 ${s.b}`} /></g>;
  const monst1 = (t, s) => <g transform={`translate(${t},${s.y}) scale(${s.k})`}><path className="avfill" d={`M-29 ${s.b} Q-31 34 0 30 Q31 34 29 ${s.b} Z`} /><path className="avf" d={`M-28 ${s.b} Q-30 34 0 30 Q30 34 28 ${s.b} Z`} /><path className="avl" d={`M-28 ${s.b} Q-30 34 0 30 Q30 34 28 ${s.b}`} /><path className="avl" d="M-28 40 Q-30 20 -20 16 Q-18 30 -12 34" /><path className="avl" d="M28 40 Q30 20 20 16 Q18 30 12 34" /><circle className="aveye" cx="-9" cy="54" r="3.2" /><circle className="aveye" cx="9" cy="54" r="3.2" /></g>;
  const inner = {
    mann: <><circle className="avf" cx="0" cy="18" r="20" /><path className="avf" d="M-30 94 Q-30 44 0 44 Q30 44 30 94 Z" /><circle className="avl" cx="0" cy="18" r="20" /><path className="avl" d="M-30 94 Q-30 44 0 44 Q30 44 30 94" /></>,
    frau: <><circle className="avf" cx="0" cy="12" r="15" /><path className="avf" d="M-15 32 L15 32 L0 52 Z" /><path className="avf" d="M0 40 Q-30 44 -28 94 Q0 94 28 94 Q30 44 0 40 Z" /><circle className="avl" cx="0" cy="12" r="15" /><path className="avl" d="M-15 32 L15 32 L0 52 Z" /><path className="avl" d="M0 40 Q-30 44 -28 94 M0 40 Q30 44 28 94" /></>,
    monster: <><path className="avf" d="M-28 96 Q-30 34 0 30 Q30 34 28 96 Z" /><path className="avl" d="M-28 96 Q-30 34 0 30 Q30 34 28 96" /><path className="avl" d="M-28 40 Q-30 20 -20 16 Q-18 30 -12 34" /><path className="avl" d="M28 40 Q30 20 20 16 Q18 30 12 34" /><circle className="aveye" cx="-9" cy="54" r="3.2" /><circle className="aveye" cx="9" cy="54" r="3.2" /></>,
    kreatur: <><path className="avf" d="M-10 56 Q-40 46 -34 18 Q-14 30 -8 54 Z" /><path className="avl" d="M-10 56 Q-40 46 -34 18 Q-14 30 -8 54 Z" /><path className="avf" d="M10 56 Q40 46 34 18 Q14 30 8 54 Z" /><path className="avl" d="M10 56 Q40 46 34 18 Q14 30 8 54 Z" /><path className="avf" d="M-22 96 Q-16 52 0 48 Q16 52 22 96 Q0 104 -22 96 Z" /><path className="avl" d="M-22 96 Q-16 52 0 48 Q16 52 22 96" /><circle className="avf" cx="0" cy="24" r="16" /><circle className="avl" cx="0" cy="24" r="16" /><circle className="aveye" cx="-6" cy="24" r="2.4" /><circle className="aveye" cx="6" cy="24" r="2.4" /></>,
    magier: <><line className="avl" x1="28" y1="58" x2="28" y2="98" /><circle className="avf" cx="28" cy="53" r="3.5" /><circle className="avl" cx="28" cy="53" r="3.5" /><path className="avf" d="M0 -16 L14 20 Q0 25 -14 20 Z" /><path className="avl" d="M0 -16 L14 20 Q0 25 -14 20 Z" /><ellipse className="avl" cx="0" cy="20" rx="16" ry="3.5" /><circle className="avf" cx="0" cy="32" r="12" /><circle className="avl" cx="0" cy="32" r="12" /><path className="avf" d="M-25 96 L-14 54 Q0 50 14 54 L25 96 Q0 104 -25 96 Z" /><path className="avl" d="M-25 96 L-14 54 Q0 50 14 54 L25 96" /></>,
    gruppe: <>{mann1(-26, { y: 4, k: 0.62, b: 78 })}{mann1(26, { y: 4, k: 0.62, b: 78 })}{mann1(0, { y: 30, k: 0.72, b: 74 })}</>,
    gruppe_evil: <>{monst1(-26, { y: 4, k: 0.62, b: 78 })}{monst1(26, { y: 4, k: 0.62, b: 78 })}{monst1(0, { y: 30, k: 0.72, b: 74 })}</>,
  }[typ];
  if (!inner) return null;
  const vb = (typ === "gruppe" || typ === "gruppe_evil") ? "-54 -14 108 128" : "-46 -20 92 128";
  return (
    <svg className="avatar" width={size} height={size} viewBox={vb}>{inner}</svg>
  );
}

const ARTEN = [
  { v: "besetzung", t: "besetzung", ein: "" },
  { v: "person", t: "personen", ein: "person" },
  { v: "ort", t: "orte", ein: "ort" },
  { v: "ding", t: "dinge", ein: "ding" },
];

// ---- Zwei achsen. Eine figur kann hauptfigur SEIN (rolle) und verführerin (archetyp). ----

// Was die figur TUT. Kern aus der Hollywood Story Matrix, Rest aus Annis Blatt.
const ROLLEN = [
  { g: "kern", r: [
    ["held", "protagonist · #2"],
    ["bösewicht", "der drachen · #11"],
    ["potentielles opfer", "das gesicht aller gefährdeten"],
    ["deflektor des helden", "hermes: dreht dem helden die hufe um, damit er rückwärts läuft ohne es zu merken"],
    ["deflektor des bösewichts", "lenkt den bösewicht ab"],
  ]},
  { g: "verbündete", r: [
    ["mentor", "#20 · prof. dumbledore, nur tiefer"],
    ["sidekick", "#1"],
    ["freund · begleiter", "des helden"],
    ["sterbender freund", "rettet den helden"],
    ["heilender charakter", "#37"],
    ["das orakel", "in der matrix"],
    ["lazarus-joker", "gibt neuen mut, wenn alles verloren scheint"],
  ]},
  { g: "gegner", r: [
    ["schurke · schatten", ""],
    ["handlanger des schurken", ""],
    ["torwächter · schwellenhüter", "schlüsselwächter in der matrix"],
    ["gestaltwandler", ""],
    ["endboss", "#11 · #57 · antagonist"],
  ]},
  { g: "funktion", r: [
    ["herold · bote", "#5 · treibt die story voran"],
    ["angebetete", "(zukunft) · manchmal = p.o."],
    ["flirty character", "für mehr infos"],
    ["autoritätsperson", "dominanter charakter"],
    ["major character", ""],
    ["minor character", ""],
    ["statist", ""],
  ]},
];
const ROLLE_INFO = Object.fromEntries(ROLLEN.flatMap((g) => g.r));

// Wie die figur IST.
const ARCHETYPEN = [
  ["krieger", "strahlt kontrollierte kraft und stärke aus"],
  ["hofnarr", "energetisch und fröhlich, überraschend in auftritt und zicken"],
  ["entdecker", "fordert auf, mit ihm neue abenteuer zu erleben"],
  ["liebhaber", "märchenhafte eigenschaften, die es leicht machen sich zu verlieben"],
  ["verführerin", "genussorientiert, mit hang zur ungezogenheit"],
  ["mädchen", "verspricht unschuld durch reinheit, natürlichkeit und sanftheit"],
  ["begleiter", "verspricht einen hohen nutzen"],
  ["begleiter II", "verspricht einen hohen nutzen"],
  ["mutter erde", "vertrauenswürdig und respektiert"],
  ["patriarch", "leader, der die regeln bestimmt"],
  ["beschützer", "hohes vertrauen, weiß rat und hat technisches können"],
  ["weiser", "bedacht und in einzelnen standpunkten unabhängig"],
  ["zauberer", "verändert die welt und entwickelt durch kreativität lust und freude"],
];
const ARCHETYP_INFO = Object.fromEntries(ARCHETYPEN);

function Things({ springe, projekt, setProjekt, sprungPerson, setSprungPerson }) {
  const [ordner, setOrdner] = useState([]);
  const aktOrdner = projekt, setAktOrdner = setProjekt;
  const [art, setArt] = useState("person");
  const [liste, setListe] = useState([]);
  const [offen, setOffen] = useState(null);
  const [msg, setMsg] = useState({ t: "bereit", c: "" });
  const [funde, setFunde] = useState(null);
  const tRef = useRef(null);

  useEffect(() => { laden(); }, [projekt]);
  useEffect(() => { setFunde(null); }, [aktOrdner, art]);

  // sprung aus dem denkbrett-steckbrief: person aufklappen
  useEffect(() => {
    if (!sprungPerson || !liste.length) return;
    const p = liste.find((x) => x.id === sprungPerson);
    if (p) {
      setArt("person");
      setAktOrdner("");
      setOffen(sprungPerson);
      setTimeout(() => document.querySelector('.thing.on')?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    }
    setSprungPerson && setSprungPerson(null);
  }, [sprungPerson, liste]);

  async function laden() {
    try {
      const [o, th] = await Promise.all([
        dbGet("skript_ordner", `${SUPABASE_URL}/rest/v1/skript_ordner?select=*&order=created_at.asc`),
        dbGet("things", `${SUPABASE_URL}/rest/v1/things?select=*&order=created_at.asc`),
      ]);
      if (Array.isArray(o)) setOrdner(o.slice().sort((a, b) => (b.id === projekt) - (a.id === projekt)));
      if (Array.isArray(th)) setListe(th);
    } catch (e) { setMsg({ t: String(e?.message || e), c: "err" }); }
  }

  async function neu() {
    const d0 = { id: neueId(), user_id: getUserId(), ordner_id: aktOrdner || null, art, name: "", created_at: new Date().toISOString() };
    setListe((l) => [...l, d0]); setOffen(d0.id);
    await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/things`, d0);
  }

  // aus der besetzung heraus: neue person direkt mit dieser rolle anlegen
  async function neuMitRolle(rolle) {
    const d0 = { id: neueId(), user_id: getUserId(), ordner_id: aktOrdner || null, art: "person", name: "", rolle, created_at: new Date().toISOString() };
    setListe((l) => [...l, d0]);
    setArt("person"); setOffen(d0.id);
    await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/things`, d0);
  }

  function feld(th, k, v) {
    setListe((l) => l.map((x) => (x.id === th.id ? { ...x, [k]: v } : x)));
    setMsg({ t: "◉ rec", c: "work" });
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      const { ok } = await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/things?id=eq.${th.id}`, { [k]: v, updated_at: new Date().toISOString() });
      setMsg({ t: ok ? "gespeichert" : "offline gespeichert — sync folgt", c: ok ? "ok" : "work" });
    }, 1200);
  }

  async function weg(th) {
    if (!confirm(`„${th.name || "unbenannt"}" löschen?`)) return;
    await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/things?id=eq.${th.id}`);
    setListe((l) => l.filter((x) => x.id !== th.id));
    setOffen(null);
  }

  // wo kommt das vor? — quer durch alle skripte des projekts
  async function fundstellen(th) {
    const q = (th.name || "").trim();
    if (!q) { setMsg({ t: "erst einen namen eintragen", c: "err" }); return; }
    try {
      setMsg({ t: "suche …", c: "work" }); setFunde(null);
      let url = `${SUPABASE_URL}/rest/v1/skripte?select=id,name,matrix,texte`;
      if (aktOrdner) url += `&ordner_id=eq.${aktOrdner}`;
      const sk = await dbGet("things-suche-" + (aktOrdner || "alle"), url);
      const low = q.toLowerCase();
      const tr = [];
      (Array.isArray(sk) ? sk : []).forEach((s) => {
        for (let i = 0; i < 9; i++) {
          const m = (s.matrix?.[i] || ""), x = (s.texte?.[i] || "");
          const wo = (x.toLowerCase().includes(low) ? x : m.toLowerCase().includes(low) ? m : null);
          if (!wo) continue;
          const p = wo.toLowerCase().indexOf(low), a = p > 50 ? p - 50 : 0;
          tr.push({ id: s.id, i, skript: s.name || "unbenannt", pos: POS[i].k,
            schnipsel: (a ? "… " : "") + wo.slice(a, a + 150).replace(/\n+/g, " ") + (wo.length > a + 150 ? " …" : "") });
        }
      });
      setFunde({ q, tr });
      setMsg({ t: tr.length + " fundstelle" + (tr.length === 1 ? "" : "n"), c: "ok" });
    } catch (e) { setMsg({ t: String(e?.message || e), c: "err" }); }
  }

  const alleBesetzung = liste.filter((x) => x.art === "person" && (aktOrdner ? x.ordner_id === aktOrdner : true));
  const meine = liste.filter((x) => x.art === art && (aktOrdner ? x.ordner_id === aktOrdner : true));
  const einzahl = ARTEN.find((a) => a.v === art)?.ein || "ding";

  return (
    <>
      <div className="grouphead">THINGS<span className="rule" /></div>

      <Panel id="things" title="BESETZUNG" sub="personal, orte und gegenstände · pro projekt">
        <div className="otabs">
          <button className={"otab" + (aktOrdner === "" ? " on" : "")} onClick={() => setAktOrdner("")}>alle</button>
          {ordner.map((o) => (
            <button className={"otab" + (aktOrdner === o.id ? " on" : "")} key={o.id} onClick={() => setAktOrdner(o.id)}>{o.name}</button>
          ))}
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <Seg value={art} onChange={setArt} options={ARTEN.map((a) => ({ v: a.v, t: a.t }))} />
        </div>

        {art === "besetzung" ? (
          <div className="besetzung" style={{ marginTop: 14 }}>
            {ROLLEN.map((g) => (
              <div key={g.g}>
                <div className="divider">{g.g}</div>
                <div className="bzgrid">
                  {g.r.map(([r, info]) => {
                    const wer = alleBesetzung.filter((x) => x.rolle === r);
                    if (wer.length) {
                      return wer.map((x) => (
                        <button className="bzkarte klick" key={x.id} onClick={() => { setArt("person"); setOffen(x.id); }} title="→ zur akte">
                          <div className="bzkopf">
                            <span className="bzav"><Avatar typ={x.avatar || "mann"} size={30} /></span>
                            <span className="bzrolle">{r}</span>
                            <span className="bzname">{x.name || "unbenannt"}{x.archetyp && <em>{x.archetyp}</em>}</span>
                          </div>
                          {info && <p className="bzinfo">{info}</p>}
                        </button>
                      ));
                    }
                    return (
                      <button className="bzkarte frei klick" key={r} onClick={() => neuMitRolle(r)} title="→ person für diese rolle anlegen">
                        <div className="bzkopf">
                          <span className="bzav leer"><Avatar typ="mann" size={30} /></span>
                          <span className="bzrolle">{r}</span>
                          <span className="bzname bzfrei">nicht besetzt</span>
                        </div>
                        {info && <p className="bzinfo">{info}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {alleBesetzung.filter((x) => !x.rolle).length > 0 && (
              <>
                <div className="divider">ohne rolle</div>
                <div className="bzgrid">
                  {alleBesetzung.filter((x) => !x.rolle).map((x) => (
                    <button className="bzkarte klick" key={x.id} onClick={() => { setArt("person"); setOffen(x.id); }} title="→ zur akte">
                      <div className="bzkopf">
                        <span className="bzav"><Avatar typ={x.avatar || "mann"} size={30} /></span>
                        <span className="bzname">{x.name || "unbenannt"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="actions" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={neu}>+ {einzahl}</button>
              <span className={"status " + msg.c}>{msg.t}</span>
            </div>

            {!meine.length && <p className="hint" style={{ marginTop: 12 }}>noch nichts. jede gute geschichte braucht personal.</p>}
          </>
        )}

        <div style={{ marginTop: 12 }}>
          {art !== "besetzung" && meine.map((th) => (
            <div className={"thing" + (offen === th.id ? " on" : "")} key={th.id}>
              <div className="thkopf" onClick={() => setOffen(offen === th.id ? null : th.id)}>
                {th.avatar && <span className="thav"><Avatar typ={th.avatar} size={26} /></span>}
                <span className="thname">{th.name || "unbenannt"}</span>
                {th.rolle && <span className="throlle">{th.rolle}</span>}
                {th.archetyp && <span className="tharch">{th.archetyp}</span>}
                <span className="thsub">{th.steckbrief || "—"}</span>
                <span className="chev">▾</span>
              </div>
              {offen === th.id && (
                <div className="thbody">
                  <div className="field">
                    <label className="cap">name</label>
                    <input className="ti" value={th.name} onChange={(e) => feld(th, "name", e.target.value)} placeholder={einzahl} />
                  </div>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label className="cap">steckbrief</label>
                    <textarea className="ta klein" value={th.steckbrief} onChange={(e) => feld(th, "steckbrief", e.target.value)}
                      placeholder="kurz. wer oder was ist das?" />
                  </div>
                  {art === "person" && (
                    <>
                    <div className="field" style={{ marginTop: 12 }}>
                      <label className="cap">avatar</label>
                      <div className="avwahl">
                        <button className={"avopt" + (!th.avatar ? " on" : "")} onClick={() => feld(th, "avatar", "")} title="keiner">–</button>
                        {AVATARE.map((a) => (
                          <button key={a} className={"avopt" + (th.avatar === a ? " on" : "")} onClick={() => feld(th, "avatar", a)} title={a}>
                            <Avatar typ={a} size={34} />
                          </button>
                        ))}
                        <span className="avtrenn" />
                        {GRUPPEN.map((a) => (
                          <button key={a} className={"avopt" + (th.avatar === a ? " on" : "")} onClick={() => feld(th, "avatar", a)} title={a.replace("_", " ")}>
                            <Avatar typ={a} size={34} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 12 }}>
                      <div className="field">
                        <label className="cap">rolle · was sie tut</label>
                        <select className="ti" value={th.rolle || ""} onChange={(e) => feld(th, "rolle", e.target.value)}>
                          <option value="">— keine rolle —</option>
                          {ROLLEN.map((g) => (
                            <optgroup key={g.g} label={g.g}>
                              {g.r.map(([r]) => <option key={r} value={r}>{r}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        {th.rolle && ROLLE_INFO[th.rolle] && <p className="hint">{ROLLE_INFO[th.rolle]}</p>}
                      </div>
                      <div className="field">
                        <label className="cap">archetyp · wie sie ist</label>
                        <select className="ti" value={th.archetyp || ""} onChange={(e) => feld(th, "archetyp", e.target.value)}>
                          <option value="">— kein archetyp —</option>
                          {ARCHETYPEN.map(([a]) => <option key={a} value={a}>{a}</option>)}
                        </select>
                        {th.archetyp && <p className="hint">{ARCHETYP_INFO[th.archetyp]}</p>}
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 12 }}>
                      <div className="field">
                        <label className="cap">wants</label>
                        <textarea className="ta klein" value={th.wants} onChange={(e) => feld(th, "wants", e.target.value)}
                          placeholder="was sie will — und jagt" />
                      </div>
                      <div className="field">
                        <label className="cap">needs</label>
                        <textarea className="ta klein" value={th.needs} onChange={(e) => feld(th, "needs", e.target.value)}
                          placeholder="was sie braucht — und noch nicht weiß" />
                      </div>
                    </div>
                    </>
                  )}
                  <div className="field" style={{ marginTop: 12 }}>
                    <label className="cap">notizen</label>
                    <textarea className="ta klein" value={th.notizen} onChange={(e) => feld(th, "notizen", e.target.value)} placeholder="…" />
                  </div>
                  <div className="zweig" style={{ marginTop: 12 }}>
                    <button className="btn" onClick={() => fundstellen(th)}>⌕ wo kommt das vor?</button>
                    <button className="btn stop" style={{ marginLeft: "auto" }} onClick={() => weg(th)}>■ löschen</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {funde && (
          <div className="treffer">
            <div className="tkopf">{funde.tr.length} fundstelle{funde.tr.length === 1 ? "" : "n"} für <b>{funde.q}</b></div>
            {funde.tr.map((f, n) => (
              <button className="tzeile" key={n} onClick={() => springe(f.id, f.i)} title="zur szene springen">
                <span className="tdatum">{f.skript}</span>
                <span className="twoerter" style={{ color: "var(--green)" }}>{f.pos}</span>
                <span className="tschnipsel">{f.schnipsel}</span>
              </button>
            ))}
            {!funde.tr.length && <div className="tkopf">nirgends. noch nicht.</div>}
          </div>
        )}
      </Panel>
    </>
  );
}

// ============================================================
// PAUSENSCHIRM
// Sieht nach Arbeit aus, ist aber Pause. Flugdaten von adsb.lol —
// offen, ohne schlüssel, von freiwilligen betrieben.
// ============================================================
const RADAR_ORTE = [
  { n: "dümmer", lat: 53.576, lon: 11.205 },
  { n: "hamburg", lat: 53.5511, lon: 9.9937 },
  { n: "berlin", lat: 52.52, lon: 13.405 },
  { n: "london", lat: 51.5074, lon: -0.1278 },
  { n: "chicago", lat: 41.8781, lon: -87.6298 },
  { n: "tokio", lat: 35.6762, lon: 139.6503 },
];
const RADIEN = [15, 25, 50, 100];
const rad = (g) => (g * Math.PI) / 180;

function entfernung(la1, lo1, la2, lo2) {
  const R = 3440.065; // erdradius in seemeilen
  const dLa = rad(la2 - la1), dLo = rad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function peilung(la1, lo1, la2, lo2) {
  const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2));
  const x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// Die Fünf-Punkt-Struktur — nach Annis Zeichnung.
//   1 hoch · 2 tief · 3 hoch · 4 am tiefsten · 5 hoch
const KURVE = [
  { n: 1, x: 70, y: 90, t: "erstes / auslösendes ereignis", u: "(geheimnis)", akt: "akt I",
    frage: "was ist das schlimmste, das in dieser situation passieren kann?" },
  { n: 2, x: 275, y: 300, t: "erster wendepunkt", u: "erster tiefpunkt",
    frage: "was kann uns noch helfen, diese aufgabe zu lösen?" },
  { n: 3, x: 500, y: 80, t: "die tragweite eröffnet sich", u: "und entwickelt sich weiter", akt: "akt II",
    frage: "hier muss die ↑ und ↓ struktur erkennbar werden." },
  { n: 4, x: 725, y: 345, t: "zweiter wendepunkt", u: "tiefster punkt der geschichte",
    frage: "hier helfen neue hoffnung, hilfe von außen oder eine wandlung im charakter." },
  { n: 5, x: 930, y: 70, t: "ende / lösung", u: "positives momentum",
    frage: "die situation in neuem licht — neuer sinn oder veränderung richtung lösung." },
];
const KANTEN = [
  { a: 0, b: 1, t: "das problem wird kreiert" },
  { a: 1, b: 2, t: "vom ersten schock erholend — neue hoffnung" },
  { a: 2, b: 3, t: "das problem wird weiter vertieft" },
  { a: 3, b: 4, t: "das problem wird gelöst" },
];

function Kurve() {
  const [wach, setWach] = useState(null);
  const p = (i) => KURVE[i];

  return (
    <div className="kwrap">
      <div className="ptitel">dramaturgie</div>
      <svg viewBox="0 0 1000 420" className="ksvg">
        {/* back story */}
        <path d="M 330 300 L 400 190 L 470 300 Z" className="kberg" />
        <text x="400" y="286" className="kbergtext">back story</text>

        {KANTEN.map((k, i) => {
          const a = p(k.a), b = p(k.b);
          return (
            <g key={i} className={"kkante" + (wach === k.a || wach === k.b ? " an" : "")}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8}
                transform={`rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 - 8})`}>
                {k.t}
              </text>
            </g>
          );
        })}

        {/* omg-punkt auf der letzten kante */}
        <g className="komg">
          <circle cx={(p(3).x + p(4).x) / 2 - 20} cy={(p(3).y + p(4).y) / 2 + 30} r="4" />
          <text x={(p(3).x + p(4).x) / 2 - 10} cy="0" y={(p(3).y + p(4).y) / 2 + 34}>omg · hopp oder topp</text>
        </g>

        {KURVE.map((k, i) => (
          <g key={k.n} className={"kknoten" + (wach === i ? " an" : "")}
             onMouseEnter={() => setWach(i)} onMouseLeave={() => setWach(null)} onClick={() => setWach(wach === i ? null : i)}>
            {k.akt && <text x={k.x} y={k.y - 42} className="kakt">{k.akt}</text>}
            <circle cx={k.x} cy={k.y} r="13" />
            <text x={k.x} y={k.y + 4} className="knr">{k.n}</text>
            <text x={k.x + (k.n === 5 ? -22 : 22)} y={k.y - 4} className="ktitel"
                  textAnchor={k.n === 5 ? "end" : "start"}>{k.t}</text>
            <text x={k.x + (k.n === 5 ? -22 : 22)} y={k.y + 10} className="kunter"
                  textAnchor={k.n === 5 ? "end" : "start"}>{k.u}</text>
          </g>
        ))}
      </svg>
      <div className={"kfrage" + (wach !== null ? " an" : "")}>
        {wach !== null ? <><b>{KURVE[wach].n}</b> {KURVE[wach].frage}</> : "punkt antippen — dann steht hier die frage dazu."}
      </div>
    </div>
  );
}

// aufklappbare verwaltungs-karte für listen (wheel-wendungen, orakel-impulse, hts-hooks)
// zeile antippen -> ändern (wenn onEdit da), enter speichert / esc bricht ab, ✕ löscht.
function VerwaltKarte({ titel, leer, liste, label, keyOf, wert, setWert, onAdd, onWeg, onEdit, platzhalter, nurLesen, hinweis }) {
  const [auf, setAuf] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editWert, setEditWert] = useState("");
  const starteEdit = (x) => { setEditId(keyOf(x)); setEditWert(label(x)); };
  const speichereEdit = (x) => { const v = editWert.trim(); if (v && v !== label(x)) onEdit(x, v); setEditId(null); };
  return (
    <div className="vkarte">
      <button className="vkopf" onClick={() => setAuf((v) => !v)}>
        <span className="vchev">{auf ? "▾" : "▸"}</span>
        <span className="vtitel">{titel}</span>
        <span className="vzahl">{liste.length}</span>
      </button>
      {auf && (
        <div className="vbody">
          {!nurLesen && (
            <div className="vadd">
              <input className="ti" value={wert} onChange={(e) => setWert(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onAdd()} placeholder={platzhalter} />
              <button className="btn" onClick={onAdd}>+ hinzu</button>
            </div>
          )}
          {hinweis && <p className="vhinweis">{hinweis}</p>}
          {!liste.length && <p className="vleer">{leer}</p>}
          {liste.map((x) => (
            <div className="vzeile" key={keyOf(x)}>
              {editId === keyOf(x) ? (
                <input className="ti vedit" autoFocus value={editWert}
                  onChange={(e) => setEditWert(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") speichereEdit(x); if (e.key === "Escape") setEditId(null); }}
                  onBlur={() => speichereEdit(x)} />
              ) : (
                <span className={"vlabel" + (onEdit && !nurLesen ? " bearbeitbar" : "")}
                  onClick={() => onEdit && !nurLesen && starteEdit(x)}
                  title={onEdit && !nurLesen ? "antippen zum ändern" : undefined}>{label(x)}</span>
              )}
              {!nurLesen && <i onClick={() => onWeg(x)} title="löschen">✕</i>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pausenschirm({ springe, zuM42, zurPerson }) {
  const [ort, setOrt] = useState(RADAR_ORTE[0]);
  const [nm, setNm] = useState(25);
  const [flug, setFlug] = useState([]);
  const [stand, setStand] = useState({ t: "verbinde …", c: "work" });
  const [commits, setCommits] = useState(0);
  const [uptime, setUptime] = useState(0);
  const [buecher, setBuecher] = useState([]);
  const [jetzt, setJetzt] = useState(new Date());
  const startRef = useRef(Date.now());
  const [gedanken, setGedanken] = useState([]);
  const [neuerGedanke, setNeuerGedanke] = useState("");
  const [faeden, setFaeden] = useState({ commits: [], skripte: [], personen: [], fragen: [] });
  const [spruch, setSpruch] = useState(null);
  const [steckbriefe, setSteckbriefe] = useState([]);

  useEffect(() => {
    const iv = setInterval(() => { setUptime(Math.floor((Date.now() - startRef.current) / 1000)); setJetzt(new Date()); }, 1000);
    return () => clearInterval(iv);
  }, []);

  // die 00-mainstates der laufenden projekte — worum geht es gerade?
  // nur skripte mit echter arbeit: mainstate + mindestens ein weiteres kästchen —
  // sonst landen die zitat-parkplätze fürs orakel hier drin, doppelt zum orakel oben.
  useEffect(() => {
    dbGet("buecher", `${SUPABASE_URL}/rest/v1/skripte?select=id,name,matrix,hook&eltern_id=is.null&order=updated_at.desc&limit=30`)
      .then((d) => {
        const echte = (Array.isArray(d) ? d : []).filter((x) => {
          const m = Array.isArray(x.matrix) ? x.matrix : [];
          const hatMainstate = (m[4] || "").trim();
          const hatSonstWas = m.some((z, i) => i !== 4 && (z || "").trim());
          return hatMainstate && hatSonstWas;
        });
        setBuecher(echte.slice(0, 3));
      }).catch(() => {});
  }, []);

  // steckbriefe — die 5 personen mit den meisten fundstellen, projektübergreifend.
  // "kill your darlings": zeigt, welche figuren am häufigsten in den skripten auftauchen.
  useEffect(() => {
    Promise.all([
      dbGet("steckbrief-skripte", `${SUPABASE_URL}/rest/v1/skripte?select=id,matrix,texte`).catch(() => []),
      dbGet("steckbrief-personen", `${SUPABASE_URL}/rest/v1/things?select=id,name,rolle,archetyp,avatar,ordner_id&art=eq.person`).catch(() => []),
    ]).then(([sk, pe]) => {
      const skripte = Array.isArray(sk) ? sk : [];
      const zaehlen = (name) => {
        const low = (name || "").trim().toLowerCase();
        if (!low) return 0;
        let n = 0;
        skripte.forEach((s) => {
          for (let i = 0; i < 9; i++) {
            const m = (s.matrix?.[i] || ""), x = (s.texte?.[i] || "");
            if (x.toLowerCase().includes(low) || m.toLowerCase().includes(low)) n++;
          }
        });
        return n;
      };
      const mitZahl = (Array.isArray(pe) ? pe : [])
        .map((p) => ({ ...p, anzahl: zaehlen(p.name) }))
        .filter((p) => p.anzahl > 0)
        .sort((a, b) => b.anzahl - a.anzahl)
        .slice(0, 5);
      setSteckbriefe(mitZahl);
    }).catch(() => {});
  }, []);

  // gedanken-fang — lose gedanken, noch ohne commit-signatur
  const gedankenAusQueue = () => {
    try {
      return offQueue()
        .filter((op) => op.methode === "POST" && op.url.includes("/rest/v1/gedanken") && op.body)
        .map((op) => ({ id: op.body.id, text: op.body.text, created_at: new Date(op.t).toISOString() }));
    } catch { return []; }
  };
  const gedankenLaden = () => {
    dbGet("gedanken", `${SUPABASE_URL}/rest/v1/gedanken?select=*&order=created_at.desc&limit=12`)
      .then((d) => {
        const echte = Array.isArray(d) ? d : [];
        const wartend = gedankenAusQueue().filter((w) => !echte.some((e) => e.id === w.id));
        setGedanken([...wartend, ...echte]);
      }).catch(() => {});
  };
  useEffect(gedankenLaden, []);

  async function gedankeSpeichern() {
    const t = neuerGedanke.trim();
    if (!t) return;
    setNeuerGedanke("");
    const eigeneId = neueId();
    setGedanken((l) => [{ id: eigeneId, text: t, created_at: new Date().toISOString() }, ...l]);
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/gedanken`, { id: eigeneId, user_id: getUserId(), text: t });
    if (ok) gedankenLaden();
  }
  async function gedankeLoeschen(g) {
    setGedanken((l) => l.filter((x) => x.id !== g.id));
    await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/gedanken?id=eq.${g.id}`);
  }

  // offene fäden — was gerade unentschieden rumliegt, quer durchs projekt
  useEffect(() => {
    Promise.all([
      dbGet("faeden-commits", `${SUPABASE_URL}/rest/v1/commits?select=id,projekt&status=eq.pausiert`).catch(() => []),
      dbGet("faeden-skripte", `${SUPABASE_URL}/rest/v1/skripte?select=id,name,matrix&eltern_id=is.null&order=updated_at.desc&limit=30`).catch(() => []),
      dbGet("faeden-personen", `${SUPABASE_URL}/rest/v1/things?select=id,name,rolle&art=eq.person`).catch(() => []),
      dbGet("faeden-m42", `${SUPABASE_URL}/rest/v1/m42?select=id,frage&erledigt=eq.false&antwort=is.null`).catch(() => []),
    ]).then(([c, s, p, f]) => {
      setFaeden({
        commits: Array.isArray(c) ? c : [],
        skripte: (Array.isArray(s) ? s : []).filter((x) => {
          const m = Array.isArray(x.matrix) ? x.matrix : [];
          const hatMainstate = (m[4] || "").trim();
          const hatSonstWas = m.some((z, i) => i !== 4 && (z || "").trim());
          return !hatMainstate && hatSonstWas;
        }),
        personen: (Array.isArray(p) ? p : []).filter((x) => !x.rolle),
        fragen: Array.isArray(f) ? f : [],
      });
    }).catch(() => {});
  }, []);

  // orakel-impuls — eigene bearbeitbare sammlung
  const [orakelListe, setOrakelListe] = useState([]); // {id, spruch}
  const zitate = orakelListe.map((o) => o.spruch);
  const [neuerSpruch, setNeuerSpruch] = useState("");
  const orakelLaden = () => {
    dbGet("orakel", `${SUPABASE_URL}/rest/v1/orakel?select=id,spruch&order=created_at.desc&limit=300`)
      .then((d) => setOrakelListe(Array.isArray(d) ? d.filter((x) => (x.spruch || "").trim()) : []))
      .catch(() => {});
  };
  useEffect(orakelLaden, []);
  async function spruchAdd() {
    const t = neuerSpruch.trim();
    if (!t) return;
    setNeuerSpruch("");
    const id = neueId();
    setOrakelListe((l) => [{ id, spruch: t }, ...l]);
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/orakel`, { id, user_id: getUserId(), spruch: t });
    if (ok) orakelLaden();
  }
  async function spruchWeg(o) {
    setOrakelListe((l) => l.filter((x) => x.id !== o.id));
    await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/orakel?id=eq.${o.id}`);
  }
  async function spruchEdit(o, wert) {
    setOrakelListe((l) => l.map((x) => x.id === o.id ? { ...x, spruch: wert } : x));
    await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/orakel?id=eq.${o.id}`, { spruch: wert });
  }
  const orakelZiehen = () => {
    if (!zitate.length) return;
    const pool = zitate.length > 1 ? zitate.filter((z) => z !== spruch) : zitate;
    setSpruch(pool[Math.floor(Math.random() * pool.length)]);
  };
  // sobald sprüche da sind: sofort einen zeigen, danach automatisch alle 90s einen neuen
  useEffect(() => {
    if (!zitate.length) return;
    setSpruch((s) => (s ? s : zitate[Math.floor(Math.random() * zitate.length)]));
    const iv = setInterval(() => {
      setSpruch((s) => { const pool = zitate.length > 1 ? zitate.filter((z) => z !== s) : zitate; return pool[Math.floor(Math.random() * pool.length)]; });
    }, 90000);
    return () => clearInterval(iv);
  }, [orakelListe]);

  // hitch_wheel — deine eigene sammlung an wendungen, dreht wie das orakel
  const [wheelListe, setWheelListe] = useState([]); // {id, wendung}
  const wendungen = wheelListe.map((w) => w.wendung);
  const [wendung, setWendung] = useState(null);
  const [dreht, setDreht] = useState(false);
  const [neueWendung, setNeueWendung] = useState("");
  const wheelLaden = () => {
    dbGet("wheel", `${SUPABASE_URL}/rest/v1/wheel?select=id,wendung&order=created_at.desc&limit=300`)
      .then((d) => setWheelListe(Array.isArray(d) ? d.filter((x) => (x.wendung || "").trim()) : []))
      .catch(() => {});
  };
  useEffect(wheelLaden, []);
  async function wendungAdd() {
    const t = neueWendung.trim();
    if (!t) return;
    setNeueWendung("");
    const id = neueId();
    setWheelListe((l) => [{ id, wendung: t }, ...l]);
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/wheel`, { id, user_id: getUserId(), wendung: t });
    if (ok) wheelLaden();
  }
  async function wendungWeg(w) {
    setWheelListe((l) => l.filter((x) => x.id !== w.id));
    await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/wheel?id=eq.${w.id}`);
  }
  async function wendungEdit(w, wert) {
    setWheelListe((l) => l.map((x) => x.id === w.id ? { ...x, wendung: wert } : x));
    await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/wheel?id=eq.${w.id}`, { wendung: wert });
  }
  const drehen = () => {
    if (!wendungen.length) return;
    setDreht(true);
    setTimeout(() => {
      const pool = wendungen.length > 1 ? wendungen.filter((w) => w !== wendung) : wendungen;
      setWendung(pool[Math.floor(Math.random() * pool.length)]);
      setDreht(false);
    }, 550);
  };
  // eine zeigen sobald wendungen da sind — aber NICHT automatisch wechseln.
  // wendungen sind sachen zum einbauen; sie sollen nicht verschwinden, bevor du sie genutzt hast.
  useEffect(() => {
    if (!wendungen.length) return;
    setWendung((w) => (w ? w : wendungen[Math.floor(Math.random() * wendungen.length)]));
  }, [wendungen]);

  // hts_ultra · henkeltassen-schrank — gesendete hooks, zieht wie das orakel (king-konzept)
  const [htsListe, setHtsListe] = useState([]); // {id, hook}
  const htsHooks = htsListe.map((h) => h.hook);
  const [htsAktuell, setHtsAktuell] = useState(null);
  const [htsDreht, setHtsDreht] = useState(false);
  const [neuerHook, setNeuerHook] = useState("");
  const htsLaden = () => {
    dbGet("hts", `${SUPABASE_URL}/rest/v1/hts?select=id,hook&order=created_at.desc&limit=300`)
      .then((d) => setHtsListe(Array.isArray(d) ? d.filter((x) => (x.hook || "").trim()) : []))
      .catch(() => {});
  };
  useEffect(htsLaden, []);
  async function htsWeg(h) {
    setHtsListe((l) => l.filter((x) => x.id !== h.id));
    await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/hts?id=eq.${h.id}`);
  }
  async function htsAdd() {
    const t = neuerHook.trim();
    if (!t) return;
    setNeuerHook("");
    const id = neueId();
    setHtsListe((l) => [{ id, hook: t }, ...l]);
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/hts`, { id, user_id: getUserId(), hook: t });
    if (ok) htsLaden();
  }
  async function htsEdit(h, wert) {
    setHtsListe((l) => l.map((x) => x.id === h.id ? { ...x, hook: wert } : x));
    await dbSchreiben("PATCH", `${SUPABASE_URL}/rest/v1/hts?id=eq.${h.id}`, { hook: wert });
  }
  const htsDrehen = () => {
    if (!htsHooks.length) return;
    setHtsDreht(true);
    setTimeout(() => {
      const pool = htsHooks.length > 1 ? htsHooks.filter((h) => h !== htsAktuell) : htsHooks;
      setHtsAktuell(pool[Math.floor(Math.random() * pool.length)]);
      setHtsDreht(false);
    }, 550);
  };
  // eigenständig, aber versetzt: erst nach 40s einsteigen, dann alle 120s — nicht im gleichschritt
  useEffect(() => {
    if (!htsHooks.length) return;
    setHtsAktuell((h) => (h ? h : htsHooks[Math.floor(Math.random() * htsHooks.length)]));
    const start = setTimeout(function tick() {
      setHtsAktuell((h) => { const pool = htsHooks.length > 1 ? htsHooks.filter((x) => x !== h) : htsHooks; return pool[Math.floor(Math.random() * pool.length)]; });
    }, 40000);
    const iv = setInterval(() => {
      setHtsAktuell((h) => { const pool = htsHooks.length > 1 ? htsHooks.filter((x) => x !== h) : htsHooks; return pool[Math.floor(Math.random() * pool.length)]; });
    }, 120000);
    return () => { clearTimeout(start); clearInterval(iv); };
  }, [htsListe]);

  useEffect(() => {
    dbGet("commits-aktiv-count", `${SUPABASE_URL}/rest/v1/commits?select=id,prioritaet&status=eq.aktiv`)
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        // besetzte prioritäts-ebenen (1/2/3), nicht rohe commit-zahl —
        // 3× prio 1 + 1× prio 3 sind 2 belegte ebenen, nicht "4 von 3".
        const ebenen = new Set(arr.map((c) => c.prioritaet)).size;
        setCommits(ebenen);
      }).catch(() => {});
  }, []);

  useEffect(() => {
    let tot = false;
    const holen = async () => {
      const quellen = [`/api/flights?lat=${ort.lat}&lon=${ort.lon}&dist=${nm}`];
      for (const u of quellen) {
        try {
          const r = await fetch(u);
          if (!r.ok) continue;
          const d = await r.json();
          if (tot) return;
          const ac = (d.ac || []).filter((a) => a.lat != null && a.lon != null).map((a) => ({
            hex: a.hex, rufz: (a.flight || "").trim() || a.r || a.hex,
            typ: a.t || "—",
            hoehe: typeof a.alt_baro === "number" ? a.alt_baro : (a.alt_baro === "ground" ? 0 : null),
            speed: a.gs != null ? Math.round(a.gs) : null,
            kurs: a.track ?? 0,
            dist: entfernung(ort.lat, ort.lon, a.lat, a.lon),
            peil: peilung(ort.lat, ort.lon, a.lat, a.lon),
          })).filter((a) => a.dist <= nm).sort((a, b) => a.dist - b.dist);
          setFlug(ac);
          setStand({ t: ac.length + " kontakte", c: "ok" });
          return;
        } catch { /* nächste quelle */ }
      }
      if (!tot) setStand({ t: "kein signal — quelle nicht erreichbar", c: "err" });
    };
    setStand({ t: "scanne …", c: "work" });
    holen();
    const iv = setInterval(holen, 12000);
    return () => { tot = true; clearInterval(iv); };
  }, [ort, nm]);

  // Ein echter Radar zeigt nur, was der zeiger gerade gestreift hat.
  // Der punkt leuchtet auf, wenn der strahl vorbeikommt, und verblasst bis zur nächsten runde.
  const sweepRef = useRef(null);
  const punkte = useRef({});
  useEffect(() => {
    let raf; const PERIODE = 9000; // eine umdrehung
    const tick = () => {
      const w = ((Date.now() % PERIODE) / PERIODE) * 360;
      if (sweepRef.current) sweepRef.current.setAttribute("transform", "rotate(" + w + ")");
      flug.forEach((a) => {
        const el = punkte.current[a.hex];
        if (!el) return;
        const peil = (a.peil + 360) % 360;
        const seit = (w - peil + 360) % 360;      // grad, seit der strahl vorbei war
        const op = Math.max(0, 1 - seit / 330);   // frisch = hell, dann verblassen
        el.style.opacity = op;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flug]);

  const p2 = (n) => String(n).padStart(2, "0");
  const up = p2(Math.floor(uptime / 3600)) + ":" + p2(Math.floor((uptime % 3600) / 60)) + ":" + p2(uptime % 60);
  const R = 150; // radar-radius in px

  // jede zeile hat einen grün pulsierenden punkt. nur 17b kann kippen:
  // alle drei prioritätsplätze belegt = grün, sonst gelb.
  const ZEILEN = [
    ["deflektor", "aktiv"],
    ["reaktor", "aktiv"],
    ["am_enhancer", "1 : 3"],
    ["golden_glow", "pulsiert"],
    ["body_floor", "gesichert"],
    ["modul 17b", commits + " von 3 aktiv", commits >= 3 ? "" : "gelb"],
    ["loop", "läuft"],
    ["uptime", up],
  ];

  return (
    <>
      <div className="grouphead">☕️ THINK-PAD<span className="rule" /></div>

      <div className="pschirm">
        <div className="gfang">
          <input className="ti" value={neuerGedanke} onChange={(e) => setNeuerGedanke(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && gedankeSpeichern()}
            placeholder="ein gedanke, noch ohne commit-signatur …" />
          <button className="btn" onClick={gedankeSpeichern}>fangen</button>
        </div>

        <div className="raeder">
          <button className={"rad" + (dreht ? " dreht" : "")} onClick={orakelZiehen} disabled={!zitate.length} title="orakel · impuls ziehen">
            <span className="radkopf">📟 orakel</span>
            <span className="radtext" key={"o" + spruch}>{zitate.length ? (spruch || "…") : "— leer —"}</span>
          </button>
          <button className={"rad" + (htsDreht ? " dreht" : "")} onClick={htsDrehen} disabled={!htsHooks.length} title="hts_ultra · henkeltassen-schrank">
            <span className="radkopf">☕ hts_ultra</span>
            <span className="radtext" key={"h" + htsAktuell}>{htsHooks.length ? (htsAktuell || "…") : "— leer —"}</span>
          </button>
        </div>

        {!!gedanken.length && (
          <div className="gliste">
            {gedanken.map((g) => (
              <div className="geintrag" key={g.id}>
                <span>{g.text}</span>
                <i onClick={() => gedankeLoeschen(g)}>✕</i>
              </div>
            ))}
          </div>
        )}

        <div className="ptitel">worum es gerade geht</div>
        <div className="bgrid">
          {!buecher.length && <div className="pleer">noch kein projekt. die skripte warten.</div>}
          {buecher.map((b) => (
            <button className="bkarte" key={b.id} onClick={() => springe(b.id, 4)}
                    title="→ zum skript, wo das herkommt">
              <div className="bknr">00 ↗</div>
              <div className="bkname">{b.name || "unbenannt"}</div>
              <div className="bkmain" title={Array.isArray(b.matrix) ? b.matrix[4] : ""}>{ersteSaetze(Array.isArray(b.matrix) ? b.matrix[4] : "", 3) || "— noch kein mainstate —"}</div>
              {b.hook && <div className="bkhook">🎯 {b.hook}</div>}
            </button>
          ))}
        </div>

        {!!steckbriefe.length && (
          <>
            <div className="ptitel" style={{ marginTop: 22 }}>steckbriefe · kill your darlings</div>
            <div className="bgrid">
              {steckbriefe.map((p) => (
                <button className="skarte" key={p.id} onClick={() => zurPerson && zurPerson(p.id)} title="→ zur akte">
                  <div className="sav">{p.avatar ? <Avatar typ={p.avatar} size={40} /> : <span className="savleer">?</span>}</div>
                  <div className="sinfo">
                    <div className="sname">{p.name || "unbenannt"} <span className="sanzahl">{p.anzahl}×</span></div>
                    <div className="smeta">{[p.archetyp, p.rolle].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="pgrid">
          <div className="pradar">
            <svg viewBox={`0 0 ${R * 2 + 20} ${R * 2 + 20}`} className="rsvg">
              <defs>
                <radialGradient id="sweep">
                  <stop offset="0%" stopColor="rgba(53,255,111,.35)" />
                  <stop offset="100%" stopColor="rgba(53,255,111,0)" />
                </radialGradient>
              </defs>
              <g transform={`translate(${R + 10},${R + 10})`}>
                {[0.25, 0.5, 0.75, 1].map((f) => (
                  <circle key={f} r={R * f} fill="none" stroke="var(--line-hot)" strokeWidth="1" opacity={f === 1 ? 0.8 : 0.35} />
                ))}
                <line x1={-R} y1="0" x2={R} y2="0" stroke="var(--line-hot)" strokeWidth="1" opacity=".3" />
                <line x1="0" y1={-R} x2="0" y2={R} stroke="var(--line-hot)" strokeWidth="1" opacity=".3" />
                <g ref={sweepRef}>
                  <path d={`M 0 0 L 0 ${-R} A ${R} ${R} 0 0 0 ${-R * 0.34} ${-R * 0.94} Z`} fill="url(#sweep)" />
                  <line x1="0" y1="0" x2="0" y2={-R} stroke="var(--green)" strokeWidth="1.5" opacity=".9" />
                </g>
                <circle r="3" fill="var(--green)" className="mitte-punkt" />
                {flug.map((a) => {
                  const rr = (a.dist / nm) * R;
                  const x = rr * Math.sin(rad(a.peil)), y = -rr * Math.cos(rad(a.peil));
                  return (
                    <g key={a.hex} transform={`translate(${x},${y})`}
                       ref={(el) => { if (el) punkte.current[a.hex] = el; else delete punkte.current[a.hex]; }}
                       style={{ opacity: 0 }}>
                      <circle r="2.6" fill="var(--green)" />
                      <circle r="6" fill="none" stroke="var(--green)" strokeWidth=".6" opacity=".35" />
                      <text x="9" y="3.5" className="rtext">{a.rufz}</text>
                    </g>
                  );
                })}
                {[["N", 0, -R - 2], ["O", R + 2, 4], ["S", 0, R + 10], ["W", -R - 8, 4]].map(([s, x, y]) => (
                  <text key={s} x={x} y={y} className="rhimmel">{s}</text>
                ))}
              </g>
            </svg>
            <div className="rfuss">
              <select value={ort.n} onChange={(e) => setOrt(RADAR_ORTE.find((o) => o.n === e.target.value))}>
                {RADAR_ORTE.map((o) => <option key={o.n} value={o.n}>{o.n}</option>)}
              </select>
              <select value={nm} onChange={(e) => setNm(Number(e.target.value))}>
                {RADIEN.map((r) => <option key={r} value={r}>{r} nm</option>)}
              </select>
              <span className={"status " + stand.c}>{stand.t}</span>
            </div>
          </div>

          <div className="ppanel">
            <div className="ptitel">hitch_wheel</div>
            <button className={"wheel" + (dreht ? " dreht" : "")} onClick={drehen} disabled={!wendungen.length}
                    title={wendungen.length ? "dreh am rad" : "noch keine wendungen — unten bei der dramaturgie eintragen"}>
              <span className="wheeltext" key={wendung}>{wendungen.length ? (wendung || "…") : "— noch keine wendungen —"}</span>
              <span className="wheeldreh">↻ drehen</span>
            </button>
            <div className="ptitel" style={{ marginTop: 18 }}>systemstatus</div>
            {ZEILEN.map(([k, v, warn]) => (
              <div className="pzeile" key={k}>
                <span className={"ppunkt " + (warn || "")} />
                <span>{k}</span><i /><b className={warn || ""}>{v}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="ptitel" style={{ marginTop: 22 }}>offene fäden</div>
        <div className="faeden">
          {!faeden.commits.length && !faeden.skripte.length && !faeden.personen.length && !faeden.fragen.length && (
            <div className="pleer">nichts hängt gerade offen rum.</div>
          )}
          {faeden.commits.map((c) => (
            <div className="fzeile" key={"c" + c.id}><span className="ftag">pausiert</span>{c.projekt}</div>
          ))}
          {faeden.skripte.map((s) => (
            <button className="fzeile" key={"s" + s.id} onClick={() => springe(s.id, 4)}>
              <span className="ftag">ohne mainstate</span>{s.name || "unbenannt"}
            </button>
          ))}
          {faeden.personen.map((p) => (
            <div className="fzeile" key={"p" + p.id}><span className="ftag">ohne rolle</span>{p.name || "unbenannt"}</div>
          ))}
          {faeden.fragen.map((f) => (
            <button className="fzeile" key={"f" + f.id} onClick={() => zuM42 && zuM42()}>
              <span className="ftag">offene frage</span>{f.frage}
            </button>
          ))}
        </div>

        <div className="ptitel" style={{ marginTop: 22 }}>kontakte</div>
        <div className="pliste breit">
          {!flug.length && <div className="pleer">stille.</div>}
          {flug.map((a) => (
            <div className="pflug" key={a.hex}>
              <span className="prufz">{a.rufz}</span>
              <span className="ptyp">{a.typ}</span>
              <span className="pspeed">{a.speed != null ? a.speed + " kt" : "—"}</span>
              <span className="phoehe">{a.hoehe != null ? (a.hoehe === 0 ? "boden" : a.hoehe.toLocaleString("de-DE") + " ft") : "—"}</span>
              <span className="pdist">{a.dist.toFixed(0)} nm</span>
            </div>
          ))}
        </div>

        <Kurve />

        <VerwaltKarte titel="hitch_wheel · wendungen" leer="noch keine wendungen — trag welche ein."
          liste={wheelListe} label={(w) => w.wendung} keyOf={(w) => w.id}
          wert={neueWendung} setWert={setNeueWendung} onAdd={wendungAdd} onWeg={wendungWeg} onEdit={wendungEdit}
          platzhalter="neue wendung …" />

        <VerwaltKarte titel="orakel · impulse" leer="noch keine impulse — trag welche ein."
          liste={orakelListe} label={(o) => o.spruch} keyOf={(o) => o.id}
          wert={neuerSpruch} setWert={setNeuerSpruch} onAdd={spruchAdd} onWeg={spruchWeg} onEdit={spruchEdit}
          platzhalter="neuer impuls / spruch …" />

        <VerwaltKarte titel="hts_ultra · henkeltassen-schrank" leer="noch keine hooks — schick welche per ☕ rein oder trag hier ein."
          liste={htsListe} label={(h) => h.hook} keyOf={(h) => h.id}
          wert={neuerHook} setWert={setNeuerHook} onAdd={htsAdd} onWeg={htsWeg} onEdit={htsEdit}
          platzhalter="neuer hook …" hinweis="hooks aus den skripten landen automatisch hier. antippen zum kürzen, ✕ zum entfernen." />

        <div className="pfuss">// niemand kann dir sagen, was die matrix ist. du musst sie selbst sehen. 🐇</div>
      </div>
    </>
  );
}

// ============================================================
// APP
// ============================================================
export default function StricklieselApp() {
  const [session, setSession] = useState(() => supabase.auth.getSession());
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [gMsg, setGMsg] = useState({ t: "", c: "" });
  const [busy, setBusy] = useState(false);

  const [cfg, setCfg] = useState(DEFAULTS);
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setLayer = (i, k, v) => setCfg((c) => { const L = c.layers.map((x, n) => (n === i ? { ...x, [k]: v } : x)); return { ...c, layers: L }; });
  // affirmationen für die laufschrift im denkbrett verfügbar machen
  useEffect(() => { offSchreibenCache("konsole-cfg", { mode: cfg.mode, ketteText: cfg.ketteText, linksText: cfg.linksText, rechtsText: cfg.rechtsText, layers: cfg.layers }); }, [cfg.mode, cfg.ketteText, cfg.linksText, cfg.rechtsText, cfg.layers]);

  const [status, setStatus] = useState({ t: "bereit", c: "" });
  const [tts, setTts] = useState({ t: "» sätze werden gepackt · erzeugtes landet im cache", c: "" });
  const [dl, setDl] = useState(null);
  const [prog, setProg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gen, setGen] = useState(null);

  const [tab, setTab] = useState("konsole");
  const [sprung, setSprung] = useState(null);
  const [sprungPerson, setSprungPerson] = useState(null);
  // welches projekt gerade dran ist — teilen sich skripte und things
  const [projekt, setProjekt] = useState(() => { try { return localStorage.getItem("projekt") || ""; } catch { return ""; } });
  const setzeProjekt = (v) => { setProjekt(v); try { localStorage.setItem("projekt", v); } catch {} };

  // text aus den skripten direkt ins textfeld der konsole
  const zurKonsole = (txt) => {
    setCfg((c) => ({ ...c, mode: "kette", ketteText: txt }));
    A.current.kette = null; A.current.dur.kette = 0; // alte stimme passt nicht mehr
    setTab("konsole");
    setStatus({ t: "text aus den skripten übernommen — jetzt auf stimme erzeugen", c: "ok" });
  };
  const [abschreib, setAbschreib] = useState(null);
  const zeigeAbschreib = (txt) => setAbschreib((txt || "").trim() || null);
  const [progName, setProgName] = useState("");
  const [progList, setProgList] = useState([]);
  const [progSel, setProgSel] = useState("");

  // ---- ABLAUF: mehrere protokolle nacheinander ----
  const [queue, setQueue] = useState([]);
  const [queueLoop, setQueueLoop] = useState(true);
  const [queueIdx, setQueueIdx] = useState(-1);
  const qRef = useRef({ running: false, items: [], idx: 0, timer: null });

  const A = useRef({ bed: null, kette: null, links: null, rechts: null, layers: [null, null, null], dur: { kette: 0, links: 0, rechts: 0, layers: [0, 0, 0] } });
  const [durTick, setDurTick] = useState(0); // erzwingt neuzeichnen wenn dauer sich ändert
  const ctxRef = useRef(null);
  const analyser = useRef(null);
  const abortRef = useRef(false);

  // Gesamtlänge: einmal durch = so lang wie die botschaft, sonst der minuten-regler
  const totalSeconds = (c, a) => {
    if (c.playMode !== "einmal") return c.len * 60;
    const m = messageSeconds(c, a);
    return m ? m + Math.min(c.fade, m / 2) : 0;
  };

  const say = (t, c) => setStatus({ t, c: c || "" });
  const sayTts = (t, c) => setTts({ t, c: c || "" });

  // Token frisch halten
  useEffect(() => {
    if (!session) return;
    const iv = setInterval(async () => { const s = supabase.auth.getSession(); if (!s) { const r = await supabase.auth.refresh(); if (!r) setSession(null); } }, 4 * 60 * 1000);
    return () => clearInterval(iv);
  }, [session]);

  useEffect(() => { if (session) loadProgList(); }, [session]);

  const konfiguriert = SUPABASE_URL.indexOf("DEIN-PROJEKT") === -1;

  async function login() {
    if (!konfiguriert) { setGMsg({ t: "» supabase noch nicht konfiguriert — siehe README", c: "err" }); return; }
    if (!email.trim() || !pass) { setGMsg({ t: "» email und passwort eingeben", c: "err" }); return; }
    setBusy(true); setGMsg({ t: "» prüfe zugang …", c: "work" });
    try {
      const d = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
      if (d.access_token) { setSession(d); setGMsg({ t: "", c: "" }); setPass(""); }
      else setGMsg({ t: "» " + (d.error_description || d.msg || d.error || "login fehlgeschlagen"), c: "err" });
    } catch (e) { setGMsg({ t: "» " + (e?.message || e), c: "err" }); }
    finally { setBusy(false); }
  }

  async function logout() { await supabase.auth.signOut(); setSession(null); }

  // ---- PROGRAMME ----
  async function loadProgList() {
    try {
      const d = await dbGet("protokolle-namen", `${SUPABASE_URL}/rest/v1/protokolle?select=name&order=updated_at.desc`);
      setProgList(Array.isArray(d) ? d.map((x) => x.name) : []);
    } catch {}
  }
  async function saveProg() {
    const name = progName.trim();
    if (!name) { say("protokoll braucht einen namen", "err"); return; }
    const { ok } = await dbSchreiben("POST", `${SUPABASE_URL}/rest/v1/protokolle?on_conflict=user_id,name`,
      { user_id: getUserId(), name, settings: cfg, updated_at: new Date().toISOString() },
      { prefer: "resolution=merge-duplicates,return=minimal" });
    say(ok ? "protokoll gespeichert: " + name : "offline gespeichert: " + name + " — sync folgt", ok ? "ok" : "work");
    if (ok) loadProgList();
  }
  async function loadProg() {
    if (!progSel) { say("kein protokoll gewählt", "err"); return; }
    try {
      const d = await dbGet("protokoll-" + progSel, `${SUPABASE_URL}/rest/v1/protokolle?select=settings&name=eq.${encodeURIComponent(progSel)}`);
      if (!d?.[0]) throw new Error("nicht gefunden");
      setCfg({ ...DEFAULTS, ...d[0].settings });
      setProgName(progSel);
      say("protokoll geladen: " + progSel, "ok");
    } catch (e) { say("laden: " + (e?.message || e), "err"); }
  }
  async function delProg() {
    if (!progSel) { say("kein protokoll gewählt", "err"); return; }
    if (!confirm(`protokoll „${progSel}" wirklich löschen?`)) return;
    await dbSchreiben("DELETE", `${SUPABASE_URL}/rest/v1/protokolle?name=eq.${encodeURIComponent(progSel)}`);
    say("protokoll gelöscht: " + progSel, "ok"); setProgSel(""); loadProgList();
  }

  // ---- ABLAUF ----
  async function fetchProtokoll(name) {
    const d = await dbGet("protokoll-" + name, `${SUPABASE_URL}/rest/v1/protokolle?select=settings&name=eq.${encodeURIComponent(name)}`);
    if (!d?.[0]) throw new Error("nicht gefunden: " + name);
    return { ...DEFAULTS, ...d[0].settings };
  }

  // Stimmen für ein Protokoll bereitstellen (Cache macht das beim 2. Mal sofort).
  // Trägerbett-Datei wird geteilt — die liegt nur im RAM, nicht in Supabase.
  async function audioFor(c, label) {
    const out = { bed: A.current.bed, kette: null, links: null, rechts: null, layers: [null, null, null], dur: { kette: 0, links: 0, rechts: 0, layers: [0, 0, 0] } };
    const mk = async (text) => (text?.trim() ? await synthToWav(text, c.voice) : null);
    if (c.mode === "kette") { out.kette = await mk(c.ketteText); if (out.kette) out.dur.kette = await measure(out.kette); }
    else if (c.mode === "ichdu") {
      out.links = await mk(c.linksText); if (out.links) out.dur.links = await measure(out.links);
      out.rechts = await mk(c.rechtsText); if (out.rechts) out.dur.rechts = await measure(out.rechts);
    } else for (let i = 0; i < 3; i++) if (c.layers[i].on) { out.layers[i] = await mk(c.layers[i].text); if (out.layers[i]) out.dur.layers[i] = await measure(out.layers[i]); }
    return out;
  }

  async function startQueue() {
    if (!queue.length) { say("ablauf ist leer", "err"); return; }
    stopAll();
    abortRef.current = false;
    try {
      say("ablauf wird vorbereitet …", "work");
      const items = [];
      for (let i = 0; i < queue.length; i++) {
        const name = queue[i];
        sayTts(`» ${name} · lade protokoll`, "work");
        const c = await fetchProtokoll(name);
        const audio = await audioFor(c, name);
        items.push({ name, cfg: c, audio });
      }
      sayTts("» ablauf bereit", "ok");
      qRef.current = { running: true, items, idx: 0, timer: null };
      playQueueItem(0);
    } catch (e) { say("ablauf: " + (e?.message || e), "err"); stopAll(); }
  }

  async function playQueueItem(i) {
    const q = qRef.current;
    if (!q.running) return;
    if (i >= q.items.length) {
      if (!queueLoop) { say("ablauf beendet", "ok"); stopAll(); return; }
      i = 0;
    }
    q.idx = i; setQueueIdx(i);
    const it = q.items[i];
    try {
      if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: it.cfg.sr });
      ctxRef.current = ctx;
      const secs = totalSeconds(it.cfg, it.audio) || it.cfg.len * 60;
      const master = await build(ctx, secs, it.cfg, it.audio);
      const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0.8;
      master.connect(an); an.connect(ctx.destination);
      analyser.current = an; setPlaying(true);
      say(`ablauf ${i + 1}/${q.items.length} · ${it.name}`, "work");
      if (q.timer) clearTimeout(q.timer);
      q.timer = setTimeout(() => playQueueItem(i + 1), secs * 1000);
    } catch (e) { say("ablauf: " + (e?.message || e), "err"); stopAll(); }
  }

  function stopAll() {
    const q = qRef.current;
    if (q.timer) clearTimeout(q.timer);
    qRef.current = { running: false, items: [], idx: 0, timer: null };
    setQueueIdx(-1);
    stop();
  }

  // ---- TTS ----
  async function synthToWav(text, voice) {
    const useThorsten = voice === "thorsten";
    const synth = useThorsten ? null : await getSynth(sayTts);
    const chunks = chunkText(text);
    const parts = []; let hits = 0;
    const items = []; // {audio, sr} — rate pro häppchen, wird am ende angeglichen
    for (let ci = 0; ci < chunks.length; ci++) {
      if (abortRef.current) throw new Error("abgebrochen");
      const key = await keyFor(voice, chunks[ci]);
      let r = await cacheGet(key);
      if (r) { hits++; sayTts(`» ${ci + 1}/${chunks.length} · aus cache`, "work"); }
      else {
        sayTts(`» erzeuge … ${ci + 1}/${chunks.length}${hits ? " · " + hits + " aus cache" : ""}`, "work");
        const g = useThorsten ? await piperFloat(chunks[ci], sayTts) : await synth(chunks[ci]);
        r = { audio: g.audio, sampling_rate: g.sampling_rate };
        await cachePut(key, r);
      }
      items.push({ audio: r.audio, sr: r.sampling_rate });
      await new Promise((res) => setTimeout(res, 0));
    }
    if (!items.length) throw new Error("nichts erzeugt");

    // gemeinsame rate = die häufigste. abweichende häppchen werden angeglichen.
    const zaehl = {};
    items.forEach((it) => { zaehl[it.sr] = (zaehl[it.sr] || 0) + 1; });
    const target = Number(Object.keys(zaehl).sort((a, b) => zaehl[b] - zaehl[a])[0]);
    if (Object.keys(zaehl).length > 1) sayTts("» gleiche abtastraten an …", "work");

    items.forEach((it) => {
      parts.push(resample(it.audio, it.sr, target));
      parts.push(new Float32Array(Math.round(target * 0.35)));
    });
    let len = 0; parts.forEach((p) => (len += p.length));
    const all = new Float32Array(len); let o = 0;
    parts.forEach((p) => { all.set(p, o); o += p.length; });
    parts.length = 0; items.length = 0;
    if (useThorsten) killPiper(); // speicher zurückgeben
    return floatToWav(all, target);
  }

  async function generate(slot, text) {
    if (!text?.trim()) { sayTts("» kein text eingegeben", "err"); return; }
    if (gen === slot) { abortRef.current = true; sayTts("» breche ab …", "work"); return; }
    const n = chunkText(text).length;
    if (n > 400 && !confirm(`das sind ${n} häppchen — das dauert.\n\nweiter?`)) return;
    abortRef.current = false; setGen(slot);
    try {
      const ab = await synthToWav(text, cfg.voice);
      const d = await measure(ab);
      if (slot === "kette") { A.current.kette = ab; A.current.dur.kette = d; }
      else if (slot === "links") { A.current.links = ab; A.current.dur.links = d; }
      else if (slot === "rechts") { A.current.rechts = ab; A.current.dur.rechts = d; }
      else { const i = Number(slot.slice(-1)); A.current.layers[i] = ab; A.current.dur.layers[i] = d; }
      setDurTick((x) => x + 1);
      sayTts("» stimme erzeugt ✓ · spricht " + F.clock(d), "ok");
    } catch (e) {
      const raw = e?.message ?? e;
      const msg = typeof raw === "number" || /^\d+$/.test(String(raw))
        ? "wasm-abbruch (speicher) — fertige häppchen sind im cache, einfach nochmal auf erzeugen"
        : String(raw);
      sayTts("» " + msg, "err");
      killPiper();
    }
    finally { setGen(null); abortRef.current = false; }
  }

  const upload = (slot) => async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const ab = await f.arrayBuffer();
    if (slot === "bed") { A.current.bed = ab; say("geladen: " + f.name); return; }
    const d = await measure(ab);
    if (slot === "kette") { A.current.kette = ab; A.current.dur.kette = d; }
    else if (slot === "links") { A.current.links = ab; A.current.dur.links = d; }
    else if (slot === "rechts") { A.current.rechts = ab; A.current.dur.rechts = d; }
    else { const i = Number(slot.slice(-1)); A.current.layers[i] = ab; A.current.dur.layers[i] = d; }
    setDurTick((x) => x + 1);
    say("geladen: " + f.name + " · " + F.clock(d));
  };

  // ---- PLAY / RENDER ----
  function stop() {
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
    analyser.current = null; setPlaying(false);
  }
  async function play() {
    stop();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: cfg.sr });
      ctxRef.current = ctx;
      const secs = totalSeconds(cfg, A.current);
      if (!secs) throw new Error("keine botschaft — erst text erzeugen oder datei laden");
      const master = await build(ctx, secs, cfg, A.current);
      const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0.8;
      master.connect(an); an.connect(ctx.destination);
      analyser.current = an; setPlaying(true); say("spielt …", "work");
    } catch (e) { say(e?.message || e, "err"); stop(); }
  }
  async function render() {
    stop();
    try {
      setProg(8); say("rendere …", "work"); setDl(null);
      const EXPORT_MAX = 30 * 60;
      let seconds = totalSeconds(cfg, A.current);
      if (!seconds) throw new Error("keine botschaft — erst text erzeugen oder datei laden");
      const capped = seconds > EXPORT_MAX;
      if (capped) seconds = EXPORT_MAX;
      // "einmal durch" wird nur gekappt, wenn der text wirklich länger als 30 min ist
      const octx = new OfflineAudioContext(2, Math.ceil(seconds * cfg.sr), cfg.sr);
      const master = await build(octx, seconds, cfg, A.current);
      master.connect(octx.destination);
      setProg(30);
      const rendered = await octx.startRendering();
      setProg(80);
      const url = URL.createObjectURL(encodeWav(rendered));
      const name = "subconstructor_" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".wav";
      setProg(100);
      setDl({ url, name, min: seconds / 60, capped });
      say("fertig", "ok");
      setTimeout(() => setProg(0), 900);
    } catch (e) { say(e?.message || e, "err"); setProg(0); }
  }

  // ---- GATE ----
  if (!session) {
    return (
      <>
        <Styles />
        <Rain />
        <div id="gate">
          <div className="gatebox">
            <div className="gm">SUB<span className="slash">//</span>CONSTRUCTOR</div>
            <div className="gs">operator console · zugang</div>
            <input type="email" autoComplete="username" placeholder="email" value={email}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
            <input type="password" autoComplete="current-password" placeholder="passwort" value={pass}
              onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
            <button className="btn primary" disabled={busy} onClick={login}>» einloggen</button>
            <div id="gMsg" className={gMsg.c}>{gMsg.t}</div>
          </div>
        </div>
      </>
    );
  }

  // ---- KONSOLE ----
  const L = cfg.layers;
  void durTick; // dauer-anzeige aktuell halten
  return (
    <>
      <Styles />
      <Rain />
      <ScrollTop />
      <SchwebeFenster text={abschreib} onClose={() => setAbschreib(null)} />
      <div className="wrap">
        <header>
          <div className="wordmark">SUB<span className="slash">//</span>CONSTRUCTOR<span className="cursor" /><Uhr /></div>
          <div className="subline"><span><b>operator console</b> · subliminal-build · deflektionsreaktor_aura3</span><SyncStatus /><Wetter /></div>
          <Reaktorladung />
        </header>

        <Scope analyser={analyser} ctxRef={ctxRef} />
        <Laufschrift />

        <div className="tabs">
          <button aria-pressed={tab === "handbuch"} onClick={() => setTab("handbuch")}>handbuch</button>
          <button aria-pressed={tab === "konsole"} onClick={() => setTab("konsole")}>konsole</button>
          <button aria-pressed={tab === "17b"} onClick={() => setTab("17b")}>abteilung 17b</button>
          <button aria-pressed={tab === "m42"} onClick={() => setTab("m42")}>m42</button>
          <button aria-pressed={tab === "think"} onClick={() => setTab("think")}>denkbrett</button>
          <button aria-pressed={tab === "log"} onClick={() => setTab("log")}>log-files</button>
          <button aria-pressed={tab === "skripte"} onClick={() => setTab("skripte")}>skripte</button>
          <button aria-pressed={tab === "things"} onClick={() => setTab("things")}>things</button>
        </div>

        <Fehlerfang key={tab}>
        {tab === "handbuch" && <Handbuch />}
        {tab === "17b" && <Abteilung17b say={say} />}
        {tab === "m42" && <M42 />}
        {tab === "log" && <LogFiles zeigeAbschreib={zeigeAbschreib} />}
        {tab === "skripte" && <Skripte sprung={sprung} setSprung={setSprung} projekt={projekt} setProjekt={setzeProjekt} zurKonsole={zurKonsole} zeigeAbschreib={zeigeAbschreib} kette={cfg.ketteText} />}
        {tab === "things" && <Things springe={(id, i) => { setSprung({ id, i }); setTab("skripte"); }} projekt={projekt} setProjekt={setzeProjekt} sprungPerson={sprungPerson} setSprungPerson={setSprungPerson} />}
        {tab === "think" && <Pausenschirm springe={(id, i) => { setSprung({ id, i }); setTab("skripte"); }} zuM42={() => setTab("m42")} zurPerson={(id) => { setSprungPerson(id); setTab("things"); }} />}
        </Fehlerfang>

        {tab === "konsole" && <>
        <Panel title="PROTOKOLLE" sub="einstellungen & texte · gerätübergreifend">
          <div className="rezrow">
            <input placeholder="name des protokolls" value={progName} onChange={(e) => setProgName(e.target.value)} />
            <button className="btn" onClick={saveProg}>⇥ speichern</button>
          </div>
          <div className="rezrow" style={{ marginTop: 10 }}>
            <select value={progSel} onChange={(e) => setProgSel(e.target.value)}>
              <option value="">— gespeicherte protokolle —</option>
              {progList.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="btn" onClick={loadProg}>↑ laden</button>
            <button className="btn stop" onClick={delProg}>■ löschen</button>
          </div>
          <div className="whoami">
            <span>eingeloggt als {getEmail()}</span>
            <button onClick={logout}>logout</button>
            <button onClick={async () => { await cacheClear(); sayTts("» cache geleert", "ok"); }}>cache leeren</button>
          </div>
          <p className="hint">audiodateien werden nicht gespeichert — nur regler, schalter und texte.</p>

          <div className="divider">▼ ablauf · mehrere protokolle nacheinander</div>
          <div className="rezrow">
            <select value="" onChange={(e) => { if (e.target.value) setQueue([...queue, e.target.value]); }}>
              <option value="">— protokoll anhängen —</option>
              {progList.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Switch mini checked={queueLoop} onChange={setQueueLoop} />
              <span className="ltag">loop</span>
            </div>
          </div>

          {queue.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {queue.map((n, i) => (
                <div className="qitem" key={i + n}>
                  <span className="qnum">{i + 1}</span>
                  <span className={"qname" + (queueIdx === i ? " playing" : "")}>{n}</span>
                  {queueIdx === i && <span className="qlive">▶ läuft</span>}
                  <button onClick={() => { if (i === 0) return; const q = [...queue]; [q[i - 1], q[i]] = [q[i], q[i - 1]]; setQueue(q); }} disabled={i === 0}>↑</button>
                  <button onClick={() => { if (i === queue.length - 1) return; const q = [...queue]; [q[i + 1], q[i]] = [q[i], q[i + 1]]; setQueue(q); }} disabled={i === queue.length - 1}>↓</button>
                  <button onClick={() => setQueue(queue.filter((_, n2) => n2 !== i))}>✕</button>
                </div>
              ))}
              <div className="actions" style={{ marginTop: 10 }}>
                <button className="btn primary" onClick={startQueue}>▶ ablauf starten</button>
                <button className="btn stop" onClick={() => { stopAll(); say("ablauf gestoppt"); }}>■ stop</button>
              </div>
              <p className="hint">
                jedes protokoll läuft seine eigene länge, dann kommt das nächste{queueLoop ? " — und von vorn" : ""}.
                stimmen werden vorher erzeugt (aus dem cache geht das sofort). <b>das trägerbett ist geteilt</b> —
                audiodateien liegen nur im arbeitsspeicher, also gilt die datei, die gerade oben geladen ist.
              </p>
            </div>
          )}
        </Panel>

        {/* ============ DIE BOTSCHAFT ============ */}
        <div className="grouphead">DIE BOTSCHAFT 🐇<span className="rule" /></div>

        <Panel title="AFFIRMATIONEN" sub="hier passiert die arbeit">
          <div className="field">
            <label className="cap">projektionsmodus</label>
            <Seg value={cfg.mode} onChange={(v) => set("mode", v)}
              options={[{ v: "kette", t: "kette" }, { v: "ichdu", t: "ich ↔ du" }, { v: "geschichtet", t: "geschichtet" }]} />
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label className="cap">stimme</label>
            <Seg value={cfg.voice} onChange={(v) => set("voice", v)}
              options={[{ v: "mms", t: "weiblich · ilona" }, { v: "thorsten", t: "männlich · thorsten" }]} />
          </div>

          <div className={"ttsbar " + tts.c}>{tts.t}</div>

          <div className="row">
            <Slider label="pause zwischen wiederholungen" value={cfg.gap} onChange={(v) => set("gap", v)} min={0} max={12} step={0.5} fmt={F.sec} />
          </div>

          {cfg.mode === "kette" && (
            <div className="modeblock">
              <label className="cap">affirmations-text · läuft mittig als ein strom</label>
              <textarea className="ta" value={cfg.ketteText} onChange={(e) => set("ketteText", e.target.value)} placeholder="ich bin ruhig. ich bin stark. ich schlafe tief." />
              <button className="btn gen" onClick={() => generate("kette", cfg.ketteText)}>{gen === "kette" ? "■ abbrechen" : "» stimme erzeugen"}</button>
              <label className="cap" style={{ marginTop: 12 }}>oder fertige audiodatei laden</label>
              <input type="file" accept="audio/*" onChange={upload("kette")} />
              <div className="row" style={{ marginTop: 12 }}>
                <Slider label="geschwindigkeit" value={cfg.ketteSpeed} onChange={(v) => set("ketteSpeed", v)} min={0.5} max={2.5} step={0.05} fmt={F.spd} />
              </div>
            </div>
          )}

          {cfg.mode === "ichdu" && (
            <div className="modeblock">
              <div className="duo">
                <div className="field"><div className="chan">
                  <div className="tag">kanal L · links</div>
                  <label className="cap">text</label>
                  <textarea className="ta" value={cfg.linksText} onChange={(e) => set("linksText", e.target.value)} placeholder="ich bin mutig, stark und schön." />
                  <button className="btn gen" onClick={() => generate("links", cfg.linksText)}>{gen === "links" ? "■ abbrechen" : "» stimme erzeugen"}</button>
                  <label className="cap" style={{ marginTop: 10 }}>oder datei</label>
                  <input type="file" accept="audio/*" onChange={upload("links")} />
                  <label className="cap" style={{ marginTop: 10 }}>geschwindigkeit</label>
                  <div className="slider">
                    <input type="range" min={0.5} max={2.5} step={0.05} value={cfg.linksSpeed} onChange={(e) => set("linksSpeed", Number(e.target.value))} />
                    <span className="val">{F.spd(cfg.linksSpeed)}</span>
                  </div>
                </div></div>
                <div className="field"><div className="chan">
                  <div className="tag">kanal R · rechts</div>
                  <label className="cap">text</label>
                  <textarea className="ta" value={cfg.rechtsText} onChange={(e) => set("rechtsText", e.target.value)} placeholder="du bist mutig, stark und schön." />
                  <button className="btn gen" onClick={() => generate("rechts", cfg.rechtsText)}>{gen === "rechts" ? "■ abbrechen" : "» stimme erzeugen"}</button>
                  <label className="cap" style={{ marginTop: 10 }}>oder datei</label>
                  <input type="file" accept="audio/*" onChange={upload("rechts")} />
                  <label className="cap" style={{ marginTop: 10 }}>geschwindigkeit</label>
                  <div className="slider">
                    <input type="range" min={0.5} max={2.5} step={0.05} value={cfg.rechtsSpeed} onChange={(e) => set("rechtsSpeed", Number(e.target.value))} />
                    <span className="val">{F.spd(cfg.rechtsSpeed)}</span>
                  </div>
                </div></div>
              </div>
              <p className="hint">der klassische split: links <b>„ich bin mutig, stark und schön"</b> · rechts <b>„du bist mutig, stark und schön"</b> — hart auf die zwei ohren gelegt.</p>
            </div>
          )}

          {cfg.mode === "geschichtet" && (
            <div className="modeblock">
              <p className="hint">mehrere ebenen, <b>zeitversetzt</b> gestapelt — damit sich die stimmen zum teppich überlagern statt im gleichschritt zu marschieren. lädst du nur <b>eine</b> quelle, legt er sie automatisch über alle aktiven ebenen.</p>
              {L.map((lay, i) => (
                <div className="layer" key={i}>
                  <div className="lhead">
                    <Switch mini checked={lay.on} onChange={(v) => setLayer(i, "on", v)} />
                    <span className="ltag">ebene {i + 1}</span>
                  </div>
                  <label className="cap">text</label>
                  <textarea className="ta" value={lay.text} onChange={(e) => setLayer(i, "text", e.target.value)} placeholder={`affirmationen für ebene ${i + 1} …`} />
                  <button className="btn gen" onClick={() => generate("lay" + i, lay.text)}>{gen === "lay" + i ? "■ abbrechen" : "» stimme erzeugen"}</button>
                  <label className="cap" style={{ marginTop: 10 }}>oder datei</label>
                  <input type="file" accept="audio/*" onChange={upload("lay" + i)} />
                  <div className="mini-row">
                    <Slider label="zeitversatz" value={lay.off} onChange={(v) => setLayer(i, "off", v)} min={0} max={30} step={0.5} fmt={F.sec} />
                    <Slider label="panorama" value={lay.pan} onChange={(v) => setLayer(i, "pan", v)} min={-100} max={100} fmt={F.pan} />
                    <Slider label="pegel" value={lay.lvl} onChange={(v) => setLayer(i, "lvl", v)} min={-24} max={0} fmt={F.db} />
                    <Slider label="geschwindigkeit" value={lay.spd} onChange={(v) => setLayer(i, "spd", v)} min={0.5} max={2.5} step={0.05} fmt={F.spd} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="divider">▼ stimm-charakter</div>
          <div className="embed-row">
            <div className="embed" style={{ flex: "1 1 100%" }}>
              <div className="ehead">
                <Switch mini checked={cfg.opOn} onChange={(v) => set("opOn", v)} />
                <span className="ename">operator · lange leitung</span>
              </div>
              <div className="row">
                <Slider label="leitungslänge" value={cfg.opLine} onChange={(v) => set("opLine", v)} min={0} max={100} fmt={F.pct} />
                <Slider label="dreck" value={cfg.opDirt} onChange={(v) => set("opDirt", v)} min={0} max={100} fmt={F.pct} />
              </div>
              <p className="hint">telefon-band + sättigung + leitungswabern — macht aus jeder rohstimme den operator.</p>
            </div>
          </div>

          <div className="divider">▼ wie die botschaft eingebettet wird</div>
          <div className="embed-row">
            <div className="embed">
              <div className="ehead">
                <Switch mini checked={cfg.audOn} onChange={(v) => set("audOn", v)} />
                <span className="ename">hörbar-leise</span>
              </div>
              <label className="cap">pegel unter trägerbett</label>
              <div className="slider">
                <input type="range" min={-40} max={-3} value={cfg.audGain} onChange={(e) => set("audGain", Number(e.target.value))} />
                <span className="val">{F.db(cfg.audGain)}</span>
              </div>
            </div>
            <div className="embed">
              <div className="ehead">
                <Switch mini checked={cfg.ultraOn} onChange={(v) => set("ultraOn", v)} />
                <span className="ename">ultraschall</span>
              </div>
              <label className="cap">trägerfrequenz</label>
              <div className="slider">
                <input type="range" min={14000} max={19000} step={100} value={cfg.ultraFreq} onChange={(e) => set("ultraFreq", Number(e.target.value))} />
                <span className="val">{F.khz(cfg.ultraFreq)}</span>
              </div>
              <label className="cap" style={{ marginTop: 10 }}>pegel</label>
              <div className="slider">
                <input type="range" min={-24} max={0} value={cfg.ultraGain} onChange={(e) => set("ultraGain", Number(e.target.value))} />
                <span className="val">{F.db(cfg.ultraGain)}</span>
              </div>
            </div>
          </div>
          <p className="hint">ultraschall überlebt nur im wav-export — mp3 köpft alles über ~16 khz.</p>
        </Panel>

        {/* ============ DER KLANG ============ */}
        <div className="grouphead">DER KLANG<span className="rule" /></div>

        <Panel title="TRÄGERBETT" sub="der boden · was man bewusst hört">
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="cap">quelle</label>
            <Seg value={cfg.bedType} onChange={(v) => set("bedType", v)}
              options={[{ v: "music", t: "musik / ambient" }, { v: "noise", t: "rauschen" }, { v: "silent", t: "stille" }]} />
          </div>
          {cfg.bedType === "music" && (
            <div className="row"><div className="field"><label className="cap">audiodatei</label><input type="file" accept="audio/*" onChange={upload("bed")} /></div></div>
          )}
          {cfg.bedType === "noise" && (
            <div className="row"><div className="field"><label className="cap">rauschfarbe</label>
              <Seg value={cfg.noiseColor} onChange={(v) => set("noiseColor", v)}
                options={[{ v: "pink", t: "pink" }, { v: "brown", t: "brown" }, { v: "white", t: "weiß" }]} />
            </div></div>
          )}
          {cfg.bedType !== "silent" && (
            <div className="row" style={{ marginTop: 14 }}>
              <Slider label="lautstärke" value={cfg.bedVol} onChange={(v) => set("bedVol", v)} min={0} max={100} fmt={F.pct} />
            </div>
          )}
        </Panel>

        {/* ============ DER PULS ============ */}
        <div className="grouphead">DER PULS<span className="rule" /></div>

        <Panel title="JACK_IN" sub="entrainment · reitet unter allem mit"
          sw={<Switch checked={cfg.entOn} onChange={(v) => set("entOn", v)} />}>
          <div className={"pbody" + (cfg.entOn ? "" : " off")}>
            <div className="row">
              <div className="field"><label className="cap">art</label>
                <Seg value={cfg.entType} onChange={(v) => set("entType", v)}
                  options={[{ v: "binaural", t: "binaural · kopfhörer" }, { v: "isochron", t: "isochron · auch boxen" }]} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <div className="field" style={{ flex: "1 1 100%" }}>
                <label className="cap">bereich · nach absicht</label>
                <Seg value={cfg.entBand} onChange={(v) => { set("entBand", v); set("entBeat", BANDS[v].beat); }}
                  options={Object.keys(BANDS).map((k) => ({ v: k, t: k }))} />
              </div>
            </div>
            <div className="explain" dangerouslySetInnerHTML={{ __html: "<b>" + BANDS[cfg.entBand].txt.split(" — ")[0] + "</b> — " + BANDS[cfg.entBand].txt.split(" — ")[1] }} />
            <div className="row" style={{ marginTop: 14 }}>
              <Slider label="feinjustierung schwebung" value={cfg.entBeat} onChange={(v) => set("entBeat", v)} min={0.5} max={40} step={0.1} fmt={F.hz} />
              <Slider label="trägerton" value={cfg.entCarrier} onChange={(v) => set("entCarrier", v)} min={80} max={400} fmt={F.hzI} />
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <Slider label="pegel · hält sich dezent" value={cfg.entVol} onChange={(v) => set("entVol", v)} min={0} max={100} fmt={F.pct} />
            </div>
          </div>
        </Panel>

        {/* ============ AUSGABE ============ */}
        <Panel title="AUSGABE" sub="rendern & play">
          <div className="field" style={{ marginBottom: 14 }}>
            <label className="cap">länge</label>
            <Seg value={cfg.playMode} onChange={(v) => set("playMode", v)}
              options={[{ v: "einmal", t: "einmal durch" }, { v: "dauer", t: "auf dauer schleifen" }]} />
          </div>

          {(() => {
            const m = messageSeconds(cfg, A.current);
            const tot = totalSeconds(cfg, A.current);
            if (cfg.playMode !== "einmal") return null;
            return (
              <div className="explain">
                {m ? <>die botschaft läuft <b>{F.clock(m)}</b> einmal durch{cfg.fade > 0 && <> · mit ausblenden <b>{F.clock(tot)}</b></>} — dann ist schluss, kein anschnitt.</>
                   : <>noch keine botschaft — text erzeugen oder datei laden, dann steht hier die dauer.</>}
              </div>
            );
          })()}

          <div className="row" style={{ marginTop: 14 }}>
            {cfg.playMode !== "einmal" && <Slider label="gesamtlänge" value={cfg.len} onChange={(v) => set("len", v)} min={1} max={420} fmt={F.min} />}
            <Slider label="ein-/ausblenden" value={cfg.fade} onChange={(v) => set("fade", v)} min={0} max={20} fmt={F.secI} />
            <div className="field"><label className="cap">sample-rate</label>
              <Seg value={cfg.sr} onChange={(v) => set("sr", Number(v))}
                options={[{ v: 48000, t: "48 khz" }, { v: 44100, t: "44,1 khz" }]} />
            </div>
          </div>
          <div className="actions" style={{ marginTop: 18 }}>
            <button className="btn" disabled={playing} onClick={play}>▶ play</button>
            <button className="btn stop" disabled={!playing} onClick={() => { stopAll(); say("gestoppt"); }}>■ stop</button>
            <button className="btn primary" onClick={render}>⇥ wav rendern</button>
            <span className={"status " + status.c}>{status.t}</span>
          </div>
          {prog > 0 && <div className="progress show"><i style={{ width: prog + "%" }} /></div>}
          {dl && (
            <p className="hint">
              fertig — <a className="dl" href={dl.url} download={dl.name}>{dl.name}</a> · {dl.min} min · {cfg.sr / 1000} khz · 16-bit wav
              {dl.capped && <span style={{ color: "var(--amber)" }}> · export auf 30 min begrenzt (speicher) — play spielt die volle länge</span>}
            </p>
          )}
        </Panel>

        </>}

        <div className="rabbit">// <b>follow the white rabbit</b> 🐇</div>
      </div>
    </>
  );
}

// ============================================================
// STYLES
// ============================================================
function Styles() {
  return (
    <style>{`
  :root{
    --void:#040705; --panel:#08120c; --panel-2:#0b1d12;
    --line:#123a22; --line-hot:#1f6b3c;
    --ink:#c6f5d3; --muted:#5f9e77; --dim:#3a6b4c;
    --green:#35ff6f; --green-mid:#17b34a; --green-dim:#0a6e2e;
    --white:#eafff0; --amber:#e0b26a; --danger:#ff6b6b;
    --mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
    --term:"Share Tech Mono","JetBrains Mono",monospace;
    --glow:0 0 8px rgba(53,255,111,.45);
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  html{overflow-x:clip}
  body{background:var(--void);color:var(--ink);font-family:var(--mono);font-size:14px;
    line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100vh;overflow-x:clip;max-width:100vw}
  #rain{position:fixed;inset:0;z-index:0;opacity:.38;pointer-events:none}
  .hoch{position:fixed;right:18px;bottom:18px;z-index:20;width:38px;height:38px;border-radius:50%;
    background:var(--panel-2);border:1px solid var(--line-hot);color:var(--green);font-size:13px;
    cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4);text-shadow:var(--glow);
    display:flex;align-items:center;justify-content:center;animation:ankunft .3s ease-out}
  .hoch:hover{background:var(--panel);border-color:var(--green)}
  @media(max-width:640px){.hoch{right:14px;bottom:14px}}
  .wrap{position:relative;z-index:1;max-width:1020px;margin:0 auto;padding:26px 18px 90px}

  header{position:sticky;top:0;z-index:6;background:var(--void);
    padding-bottom:8px;margin-bottom:2px}
  .wordmark{font-family:var(--term);font-size:clamp(30px,6.2vw,52px);letter-spacing:.14em;
    color:var(--green);text-shadow:var(--glow);line-height:1;display:flex;align-items:center;flex-wrap:wrap}
  .wordmark .slash{color:var(--green-mid);opacity:.7}
  .cursor{display:inline-block;width:.5em;height:1em;background:var(--green);margin-left:.14em;
    translate:0 .12em;animation:blink 1.05s steps(1) infinite;box-shadow:var(--glow)}
  @keyframes blink{50%{opacity:0}}
  .uhr{margin-left:auto;font-family:var(--term);color:var(--green);text-shadow:var(--glow);
    letter-spacing:.1em;font-size:clamp(18px,3.4vw,30px);line-height:1;
    font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:14px}
  .uhr i{font-style:normal;opacity:.42;font-size:.68em}
  .subline{font-family:var(--term);color:var(--dim);font-size:13px;letter-spacing:.1em;margin-top:8px;
    display:flex;align-items:baseline;gap:14px}
  .syncstat{font-size:11px;letter-spacing:.08em;white-space:nowrap;padding:2px 7px;border-radius:4px;
    border:1px solid var(--line);cursor:default}
  .syncstat.offline{color:var(--dim)}
  .syncstat.wartet{color:var(--amber);border-color:var(--amber);animation:puls 2s ease-in-out infinite}
  .wetter{margin-left:auto;color:var(--ink);letter-spacing:.08em;white-space:nowrap;font-size:17px;
    font-variant-numeric:tabular-nums;cursor:default;display:inline-flex;align-items:center;gap:6px}
  .wetter i{font-style:normal;color:var(--green);text-shadow:var(--glow);font-size:22px;line-height:1}
  .subline b{color:var(--muted);font-weight:400}

  .scope{margin:16px 0 6px;border:1px solid var(--line);border-radius:6px;
    background:linear-gradient(180deg,#07130c,#050b07);overflow:hidden;position:relative}
  #spectrum{display:block;width:100%;height:118px}
  .scope-lbl{position:absolute;top:8px;left:12px;font-family:var(--term);font-size:11px;letter-spacing:.14em;color:var(--dim)}
  .scope-ultra{position:absolute;bottom:7px;right:12px;font-family:var(--term);font-size:10.5px;color:var(--green);letter-spacing:.06em}

  /* laufschrift unter dem scope */
  .lauf{margin:0 0 10px}
  .laufband{overflow:hidden;border:1px solid var(--line);border-radius:6px;background:var(--panel-2);
    height:30px;display:flex;align-items:center;position:relative}
  .laufinner{display:inline-flex;white-space:nowrap;will-change:transform}
  .laufinner span{padding:0 40px;font-family:var(--term);font-size:12.5px;letter-spacing:.14em;
    color:var(--green);text-shadow:var(--glow)}
  .laufinner.langsam{animation:laufen 34s linear infinite}
  .laufinner.schnell{animation:laufen 15s linear infinite}
  @keyframes laufen{from{transform:translateX(0)}to{transform:translateX(-50%)}}
  .laufleer{font-family:var(--term);font-size:11px;letter-spacing:.1em;color:var(--dim);padding:0 12px}
  .laufctrl{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px;align-items:center}
  .laufbtn{font-family:var(--term);font-size:10.5px;letter-spacing:.06em;background:transparent;
    border:1px solid var(--line);border-radius:4px;color:var(--dim);padding:3px 9px;cursor:pointer;transition:.12s}
  .laufbtn:hover{border-color:var(--line-hot);color:var(--green)}
  .laufbtn.on{color:var(--green);border-color:var(--line-hot);text-shadow:var(--glow)}
  .laufinput{flex:1 1 160px;min-width:0}
  @media(prefers-reduced-motion:reduce){.laufinner.langsam,.laufinner.schnell{animation:none}}

  /* reaktor-ladung · sanfter entlade-balken, sticky unterm header */
  .reaktor{margin:12px 0 0}
  .rkband{display:flex;gap:2px;height:22px;padding:3px;border:1px solid var(--line);border-radius:5px;background:var(--panel-2);align-items:stretch}
  .rkseg{flex:1;min-width:0;border-radius:1px;background:var(--line);opacity:.45;transition:background .5s ease-out,box-shadow .5s ease-out,opacity .5s ease-out}
  .rkseg.an{background:var(--green-mid);box-shadow:0 0 5px var(--green-dim);opacity:1}
  .reaktor.knapp .rkseg.an{background:var(--amber);box-shadow:0 0 6px var(--amber)}
  .reaktor.kuehlung .rkband{border-color:var(--amber)}
  .rkctrl{display:flex;gap:9px;align-items:center;margin-top:5px}
  .rklabel{font-family:var(--term);font-size:10.5px;letter-spacing:.1em;color:var(--dim);flex:1}
  .rklabel b{color:var(--green);font-variant-numeric:tabular-nums;font-weight:400}
  .reaktor.knapp .rklabel b{color:var(--amber)}
  .rkblink{color:var(--amber);text-shadow:0 0 8px var(--amber);animation:rkblink 1s step-end infinite}
  .reaktor.aus{opacity:.5}
  .reaktor.aus .rkseg{box-shadow:none}
  @keyframes rkblink{0%,49%{opacity:1}50%,100%{opacity:.15}}
  @media(prefers-reduced-motion:reduce){.rkblink{animation:none}}

  /* zugriff-verweigert-popup (wegklickbar, kein echtes sperren) */
  .rkpop{position:fixed;inset:0;z-index:200;background:rgba(2,4,3,.78);display:flex;align-items:center;justify-content:center;padding:24px;
    animation:rkein .18s ease-out}
  @keyframes rkein{from{opacity:0}to{opacity:1}}
  .rkpopbox{max-width:420px;width:100%;border:1px solid var(--danger);border-radius:8px;background:var(--panel);
    padding:26px 24px;text-align:center;box-shadow:0 0 40px rgba(255,107,107,.25)}
  .rkpoptitel{font-family:var(--term);font-size:22px;letter-spacing:.16em;color:var(--danger);
    text-shadow:0 0 14px rgba(255,107,107,.5);margin-bottom:14px;animation:rkblink 1.1s step-end 3}
  .rkpoptext{font-family:var(--mono);font-size:13.5px;line-height:1.7;color:var(--muted);margin-bottom:20px}
  .rkpopbox .btn{font-family:var(--mono)}
  @media(prefers-reduced-motion:reduce){.rkpoptitel{animation:none}}

  /* schwebe-fenster · text zum abschreiben */
  .schwebe{position:fixed;z-index:150;display:flex;flex-direction:column;
    min-width:240px;min-height:140px;overflow:hidden;border:1px solid var(--line-hot);border-radius:8px;
    background:var(--panel);box-shadow:0 14px 50px rgba(0,0,0,.6)}
  .schwebekopf{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;
    border-bottom:1px solid var(--line);background:var(--panel-2);user-select:none;touch-action:none}
  .schwebetitel{flex:1;font-family:var(--term);font-size:11px;letter-spacing:.14em;color:var(--green)}
  .schwebebtn{background:transparent;border:1px solid var(--line);border-radius:4px;color:var(--dim);
    width:26px;height:23px;cursor:pointer;font-size:12px;line-height:1;transition:.12s}
  .schwebebtn:hover{border-color:var(--line-hot);color:var(--green)}
  .schwebetext{flex:1;overflow:auto;padding:16px 18px;font-family:var(--mono);font-size:14px;
    line-height:1.7;color:var(--muted);white-space:pre-wrap;word-break:break-word;user-select:text}
  .schweberesize{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:2;touch-action:none;
    background:linear-gradient(135deg,transparent 46%,var(--green-mid) 46%,var(--green-mid) 56%,transparent 56%,transparent 68%,var(--green-mid) 68%,var(--green-mid) 78%,transparent 78%);opacity:.55}
  .schweberesize:hover{opacity:1}
  .logextra{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 10px}

  /* tabs unterm skope */
  .tabs{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 6px;border-bottom:1px solid var(--line);padding-bottom:0}
  .tabs button{flex:0 1 auto;min-width:0;font-family:var(--term);font-size:13px;letter-spacing:.1em;background:transparent;
    border:1px solid var(--line);border-bottom:0;border-radius:5px 5px 0 0;color:var(--dim);
    padding:9px 12px;cursor:pointer;transition:.12s;position:relative;top:1px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tabs button:hover{color:var(--green)}
  .tabs button[aria-pressed="true"]{background:var(--panel);color:var(--green);
    border-color:var(--line-hot);text-shadow:var(--glow)}

  /* eingabefelder abteilung 17b */
  .ti{width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;
    color:var(--ink);font-family:var(--mono);font-size:13px;padding:10px;
    caret-shape:block;caret-color:var(--green)}
  .ti:focus{outline:none;border-color:var(--line-hot)}
  .ti::placeholder{color:var(--dim)}
  .ti.sig{font-family:var(--term);letter-spacing:.16em;color:var(--green);flex:1 1 220px}
  .ti[type=date]{color-scheme:dark}

  .parambox{display:flex;flex-wrap:wrap;gap:6px}
  .parambtn{font-family:var(--mono);font-size:12.5px;color:var(--dim);background:var(--panel-2);
    border:1px solid var(--line);border-radius:5px;padding:7px 12px;cursor:pointer;user-select:none;transition:.12s}
  .parambtn:hover{color:var(--green)}
  .parambtn.on{background:var(--green-dim);color:var(--white);border-color:var(--line-hot)}

  .btn.big{padding:14px 26px;font-size:14px;letter-spacing:.08em}

  /* skripte */
  .seitenkopf{display:flex;align-items:center;gap:14px;margin:14px 0 14px}
  .seitenkopf .btn{padding:9px 16px;font-size:12.5px}
  .txtbtn{padding:9px 14px;font-size:12px;flex:0 0 auto;font-variant-numeric:tabular-nums}
  .txtbtn.klein{padding:9px 11px}
  .ebadge{font-family:var(--term);font-size:11px;letter-spacing:.08em;flex:0 0 auto;
    color:var(--lvl);border:1px solid var(--lvl);border-radius:3px;padding:3px 7px;opacity:.75;cursor:default}
  .xfiles{flex:1;min-width:0;text-align:center;font-family:var(--term);font-size:15px;letter-spacing:.34em;
    color:var(--green);text-shadow:var(--glow);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .seitenkopf > .xfiles:first-child{text-align:left;padding-left:2px}

  .otabs{display:flex;flex-wrap:wrap;gap:6px}
  .otab{display:inline-flex;align-items:center;background:var(--panel-2);border:1px solid var(--line);
    border-radius:5px;overflow:hidden;transition:.12s}
  .otab>button,.otab:not(:has(button)){font-family:var(--mono);font-size:12.5px;color:var(--muted);
    background:transparent;border:0;padding:7px 12px;cursor:pointer}
  button.otab{font-family:var(--mono);font-size:12.5px;color:var(--muted);padding:7px 12px;cursor:pointer}
  .otab:hover{border-color:var(--line-hot)}
  .otab:hover>button{color:var(--green)}
  .otab.on{background:var(--green-dim);border-color:var(--line-hot)}
  .otab.on>button{color:var(--white)}
  .otab.neu{color:var(--green);border-color:var(--line-hot)}
  .otab>i{font-style:normal;font-size:10px;color:var(--dim);padding:0 8px 0 2px;cursor:pointer}
  .otab>i:hover{color:var(--danger)}

  .krumen{font-family:var(--term);font-size:11px;letter-spacing:.06em;color:var(--dim);margin-top:12px;word-break:break-word}
  .krumen button{font-family:var(--term);font-size:11px;background:transparent;border:0;color:var(--muted);
    cursor:pointer;padding:0;letter-spacing:.06em}

  .krumen b{font-weight:400}
  .krumen button{opacity:.85}
  .krumen button:hover{opacity:1;text-shadow:0 0 7px currentColor}

  .baum{border:1px solid var(--line);border-radius:6px;background:var(--panel-2);margin-top:14px;
    max-height:46vh;overflow-y:auto;overflow-x:hidden;padding:4px 0}
  .baum::-webkit-scrollbar{width:8px}
  .baum::-webkit-scrollbar-track{background:transparent}
  .baum::-webkit-scrollbar-thumb{background:var(--green-dim);border-radius:4px}
  .bleer{font-size:11.5px;color:var(--dim);padding:14px}
  .bzeile{display:flex;align-items:center;gap:6px;padding-right:10px;transition:.1s;border-radius:4px;
    border-left:2px solid var(--lvl,var(--green))}
  .bzeile:hover{background:var(--panel)}
  .bzeile.on{background:color-mix(in srgb, var(--lvl) 22%, transparent)}
  .bzeile.on .bname{opacity:1;text-shadow:0 0 8px var(--lvl)}
  .bpfeil{font-family:var(--mono);font-size:10px;background:transparent;border:0;color:var(--lvl,var(--green-dim));opacity:.55;
    cursor:pointer;padding:4px 3px;flex:0 0 auto;width:18px}
  .bpfeil:hover:not(:disabled){opacity:1}
  .bpfeil:disabled{opacity:.3;cursor:default}
  .bhaupt{flex:1;min-width:0;display:flex;align-items:baseline;gap:9px;background:transparent;border:0;
    text-align:left;cursor:pointer;padding:6px 0}
  .bname{font-family:var(--term);font-size:12px;letter-spacing:.08em;color:var(--lvl,var(--muted));flex:0 0 auto;transition:.1s;opacity:.82}
  .bhaupt:hover .bname{opacity:1;text-shadow:0 0 7px var(--lvl)}
  .bsub{flex:1;min-width:0;font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bmeta{font-family:var(--term);font-size:10px;color:var(--lvl,var(--green-dim));opacity:.6;flex:0 0 auto}
  .bmove{font-family:var(--term);font-size:10px;letter-spacing:.05em;background:transparent;color:var(--dim);
    border:1px solid var(--line);border-radius:4px;padding:2px 4px;flex:0 0 auto;cursor:pointer;max-width:96px}
  .bmove:hover{color:var(--green);border-color:var(--line-hot)}

  .mx{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
  .zelle{position:relative;text-align:left;background:var(--panel);border:1px solid var(--line);
    border-radius:6px;padding:12px 12px 14px;min-height:96px;cursor:pointer;transition:.12s;
    display:flex;flex-direction:column;gap:7px}
  button.zelle:hover{border-color:var(--line-hot)}
  .zelle.voll{border-color:var(--green-dim)}
  .zelle.on{border-color:var(--green);box-shadow:0 0 0 1px var(--green-dim),var(--glow)}
  .zelle.mitte{background:var(--panel-2);border-color:var(--line-hot)}
  .zname{font-family:var(--term);font-size:11.5px;letter-spacing:.16em;color:var(--green);text-transform:uppercase}
  .ztext{font-size:12px;color:var(--muted);line-height:1.5;word-break:break-word;
    display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .zelle:not(.voll) .ztext{color:var(--dim)}
  .akt{position:absolute;top:9px;right:10px;font-family:var(--term);font-size:9px;letter-spacing:.1em;
    color:var(--dim);opacity:.55}
  /* auf seite 3 dieselbe größe wie auf seite 2 — sonst muss man die karte
     jedes mal neu lesen. nur nicht klickbar. */
  .mx.klein .zelle{cursor:pointer;text-align:left}
  .mx.klein .zelle:hover{border-color:var(--line-hot)}
  .zkind{font-family:var(--term);font-size:10px;letter-spacing:.06em;margin-top:auto;padding-top:6px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
  .zelle.hatkind{border-style:solid}

  .eingabe{background:var(--panel);border:1px solid var(--line-hot);border-radius:6px;padding:12px}
  .ekopf{display:flex;align-items:center;gap:12px;margin-bottom:8px}
  .ekopf .btn{margin-left:auto;padding:5px 11px;font-size:11.5px}
  .ekopf .zumraster{margin-left:6px}
  @media(min-width:641px){.ekopf .zumraster{display:none}}

  .hookzeile{font-size:13px;color:var(--muted);border-left:2px solid var(--green-dim);
    padding:4px 0 4px 12px;margin-bottom:14px;font-style:italic}

  .szene{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px;margin-bottom:10px}
  .szene.mitte{border-color:var(--line-hot);background:var(--panel-2)}
  .szene.blitz{border-color:var(--green);box-shadow:0 0 0 1px var(--green-dim),0 0 22px rgba(53,255,111,.3);
    animation:ankunft 1.6s ease-out}
  @keyframes ankunft{0%{box-shadow:0 0 0 3px var(--green),0 0 40px rgba(53,255,111,.7)}100%{box-shadow:0 0 0 1px var(--green-dim)}}
  .skopf{display:flex;align-items:baseline;gap:10px;margin-bottom:10px;flex-wrap:wrap;cursor:pointer}
  .snr{font-family:var(--term);font-size:11px;color:var(--green-dim);letter-spacing:.1em}
  .skopf .akt{position:static;opacity:.5}
  .smatrix{flex:1;font-size:12px;color:var(--ink);font-style:italic;min-width:120px}
  .szene.zu .smatrix{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* das feld wächst mit dem text — 200 wörter passen rein, ohne zu scrollen */
  .szene .ta{min-height:200px;overflow:hidden;resize:none}
  .szene .chev{color:var(--green-mid);font-size:12px;transition:transform .15s;margin-left:6px;flex:0 0 auto}
  .szene.zu .chev{transform:rotate(-90deg)}
  .szene.zu{padding-bottom:14px}
  .szene.zu .skopf{margin-bottom:0}
  .szu{font-family:var(--term);font-size:10.5px;color:var(--green-dim);flex:0 0 auto;
    font-variant-numeric:tabular-nums;margin-left:auto}
  .mshinweis{color:var(--dim);font-style:normal;font-size:10.5px;letter-spacing:.04em}
  .msuebersicht{background:var(--void);border:1px solid var(--line);border-radius:6px;padding:14px}
  .msvoll{font-size:13.5px;color:var(--ink);line-height:1.65;white-space:pre-wrap}
  .mserbe{margin-top:14px;padding-top:12px;border-top:1px dashed var(--line)}
  .mserbekopf{display:flex;align-items:baseline;gap:6px;font-family:var(--term);font-size:10.5px;
    letter-spacing:.08em;color:var(--dim);margin-bottom:8px}
  .mserbekopf b{color:var(--green);font-weight:400}
  .mserbekopf i{margin-left:auto;font-style:normal;color:var(--green-dim)}
  .mserbetext{font-size:12.5px;color:var(--muted);line-height:1.7;white-space:pre-wrap;
    max-height:260px;overflow-y:auto;padding-right:6px}
  .mserbetext::-webkit-scrollbar{width:7px}
  .mserbetext::-webkit-scrollbar-track{background:transparent}
  .mserbetext::-webkit-scrollbar-thumb{background:var(--green-dim);border-radius:4px}
  .zweig{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .zweigbtn{padding:5px 11px;font-size:11px;color:var(--dim);border-color:var(--line);
    background:transparent;opacity:.5;transition:.15s}
  .zweigbtn:hover{opacity:1;color:var(--green);border-color:var(--line-hot)}
  .kind{font-family:var(--mono);font-size:11.5px;background:var(--green-dim);border:1px solid var(--line-hot);
    color:var(--white);border-radius:4px;padding:6px 12px;cursor:pointer}
  .kind:hover{background:var(--green-mid);color:#04150a}

  @media(max-width:640px){
    /* einspaltig ergäbe die rasterreihenfolge — also die geschichte rückwärts.
       hier zählt die erzählreihenfolge: mainstate, anfang, 1. kat … */
    .mx{grid-template-columns:1fr}
    .mx .zelle{order:var(--o)}
    .seitenkopf{flex-wrap:wrap}
    .xfiles{order:-1;flex:1 1 100%;letter-spacing:.2em;font-size:13px;margin-bottom:4px}
    .otabs{max-width:100%}
    .gfang{flex-wrap:wrap}
    .gfang .ti{flex:1 1 100%}
    .m42eingabe{flex-wrap:wrap}
    .m42eingabe .ti{flex:1 1 100%}
  }

  /* things */
  .thing{background:var(--panel-2);border:1px solid var(--line);border-radius:6px;margin-bottom:8px;transition:.12s}
  .thing.on{border-color:var(--line-hot)}
  .thkopf{display:flex;align-items:baseline;gap:12px;padding:11px 12px;cursor:pointer}
  .thkopf:hover .thname{color:var(--green)}
  .thname{font-family:var(--term);font-size:13px;letter-spacing:.1em;color:var(--muted);flex:0 0 auto;transition:.12s}
  .thsub{flex:1;min-width:0;font-size:11.5px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .thing.on .thname{color:var(--green);text-shadow:var(--glow)}
  .thing .chev{color:var(--green-mid);font-size:12px;transition:transform .15s;flex:0 0 auto}
  .thing:not(.on) .chev{transform:rotate(-90deg)}
  .thbody{padding:2px 12px 14px;border-top:1px dashed var(--line);margin-top:2px}
  .ta.klein{min-height:56px;font-size:12.5px}

  /* pausenschirm */
  .pschirm{background:linear-gradient(180deg,#08120c,#050b07);border:1px solid var(--line);
    border-radius:6px;padding:20px 18px 16px}
  /* die laufenden bücher */
  .bgrid{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px}
  .bkarte{flex:1 1 220px;min-width:0;background:var(--panel-2);border:1px solid var(--line);
    border-radius:6px;padding:12px 13px;position:relative;transition:.15s;text-align:left;cursor:pointer}
  .bkarte:hover{border-color:var(--line-hot)}
  .bkarte:hover .bknr{color:var(--green)}
  .bknr{position:absolute;top:9px;right:11px;font-family:var(--term);font-size:10px;color:var(--green-dim);letter-spacing:.1em}
  .bkname{font-family:var(--term);font-size:12px;letter-spacing:.12em;color:var(--green);
    text-shadow:var(--glow);margin-bottom:7px;padding-right:22px}
  .bkmain{font-size:12.5px;color:var(--muted);line-height:1.55;
    display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
  .bkhook{font-size:11px;color:var(--dim);font-style:italic;margin-top:7px;
    border-left:2px solid var(--green-dim);padding-left:8px}

  /* m42 kommunikator */
  .m42karte{border:1px solid var(--line);border-radius:7px;background:var(--panel-2);
    padding:14px 15px;margin-bottom:12px}
  .m42karte.erledigt{opacity:.55}
  .m42zeile{display:flex;align-items:baseline;gap:9px;margin-top:10px}
  .m42zeile:first-child{margin-top:0}
  .m42zeile i{font-style:normal;font-size:10px;letter-spacing:.04em;color:var(--dim);margin-left:auto}
  .m42tag{font-family:var(--term);font-size:10.5px;letter-spacing:.1em}
  .m42frage .m42tag, .m42text.m42frage{color:#e88fc0}
  .m42antwort .m42tag, .m42text.m42antwort{color:#f0954a}
  .m42feedback .m42tag, .m42text.m42feedback{color:var(--muted)}
  .m42text{font-size:13px;line-height:1.5;margin-top:3px}
  .m42text.m42frage{text-shadow:0 0 8px rgba(232,143,192,.35)}
  .m42text.m42antwort{text-shadow:0 0 8px rgba(240,149,74,.3)}
  .m42eingabe{display:flex;gap:8px;margin-top:10px}
  .m42eingabe .ti{flex:1;min-width:0}

  /* gedanken-fang · orakel-impuls */
  .gfang{display:flex;gap:8px;margin-bottom:10px}
  .gfang .ti{flex:1;min-width:0}
  .oraklspruch{font-family:var(--mono);font-size:12.5px;font-style:italic;color:var(--green);
    text-shadow:var(--glow);background:var(--panel-2);border:1px solid var(--line-hot);border-radius:6px;
    padding:11px 13px;margin-bottom:12px;line-height:1.55;animation:ankunft .4s ease-out}
  .raeder{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
  .rad{flex:1 1 180px;min-width:0;text-align:left;border:1px solid var(--line-hot);border-radius:8px;
    background:var(--panel-2);padding:11px 13px;cursor:pointer;display:flex;flex-direction:column;gap:7px;
    transition:.15s;font-family:inherit}
  .rad:hover:not(:disabled){box-shadow:0 0 12px rgba(53,255,111,.16);border-color:var(--green)}
  .rad:disabled{cursor:default;opacity:.5}
  .radkopf{font-family:var(--term);font-size:10.5px;letter-spacing:.1em;color:var(--dim);text-transform:uppercase}
  .radtext{font-family:var(--mono);font-size:12.5px;line-height:1.5;color:var(--green);
    text-shadow:var(--glow);min-height:2.6em;transition:opacity .25s}
  .rad.dreht .radtext{opacity:.15}
  .gliste{display:flex;flex-direction:column;gap:5px;margin-bottom:22px}
  .geintrag{display:flex;align-items:baseline;gap:9px;font-size:12.5px;color:var(--muted);
    background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:7px 10px}
  .geintrag span{flex:1;min-width:0}
  .geintrag i{font-style:normal;color:var(--dim);cursor:pointer;opacity:.6;flex:0 0 auto}
  .geintrag i:hover{opacity:1;color:var(--amber)}

  /* offene fäden */
  .faeden{display:flex;flex-direction:column;gap:5px;margin-bottom:6px}
  .fzeile{display:flex;align-items:baseline;gap:10px;font-size:12.5px;color:var(--ink);
    background:transparent;border:0;border-bottom:1px dotted var(--line);text-align:left;
    padding:6px 2px;font-family:var(--mono);cursor:default}
  button.fzeile{cursor:pointer}
  button.fzeile:hover{color:var(--green)}
  .ftag{font-family:var(--term);font-size:9.5px;letter-spacing:.08em;color:var(--dim);
    border:1px solid var(--line);border-radius:3px;padding:2px 6px;flex:0 0 auto}

  /* dramaturgie */
  .kwrap{margin-top:26px;padding-top:20px;border-top:1px dashed var(--line)}
  .ksvg{width:100%;display:block}
  .kberg{fill:none;stroke:var(--green-dim);stroke-width:1;opacity:.5}
  .kbergtext{font-family:var(--term);font-size:9px;fill:var(--dim);text-anchor:middle;letter-spacing:.16em}
  .kkante line{stroke:var(--line-hot);stroke-width:1.5;transition:.2s}
  .kkante text{font-family:var(--term);font-size:9px;fill:var(--dim);text-anchor:middle;letter-spacing:.06em;transition:.2s}
  .kkante.an line{stroke:var(--green);filter:drop-shadow(0 0 5px rgba(53,255,111,.6))}
  .kkante.an text{fill:var(--muted)}
  .komg circle{fill:var(--amber);opacity:.9}
  .komg text{font-family:var(--term);font-size:9px;fill:var(--amber);letter-spacing:.08em;opacity:.85}
  .kknoten{cursor:pointer}
  .kknoten circle{fill:var(--panel);stroke:var(--green-mid);stroke-width:1.5;transition:.2s}
  .kknoten.an circle{stroke:var(--green);fill:var(--green-dim);filter:drop-shadow(0 0 8px rgba(53,255,111,.7))}
  .knr{font-family:var(--term);font-size:11px;fill:var(--green);text-anchor:middle}
  .ktitel{font-family:var(--term);font-size:10px;fill:var(--muted);letter-spacing:.06em}
  .kunter{font-family:var(--term);font-size:9px;fill:var(--dim);letter-spacing:.06em}
  .kakt{font-family:var(--term);font-size:10px;fill:var(--green);text-anchor:middle;letter-spacing:.2em;opacity:.7}
  .kfrage{font-family:var(--term);font-size:11.5px;color:var(--dim);letter-spacing:.05em;min-height:1.4em;
    border-left:2px solid var(--line);padding:5px 0 5px 12px;margin-top:6px;transition:.2s}
  .kfrage.an{color:var(--muted);border-color:var(--green)}
  .kfrage b{color:var(--green);font-weight:400;padding-right:5px}
  .pgrid{display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start;justify-content:space-between}
  .pradar{flex:1 1 300px;max-width:360px;margin:0;display:flex;flex-direction:column}
  .rsvg{width:100%;display:block;filter:drop-shadow(0 0 6px rgba(53,255,111,.18))}
  .mitte-punkt{animation:blink 1.4s ease-in-out infinite}
  .rtext{font-family:var(--term);font-size:8px;fill:var(--muted);letter-spacing:.06em}
  .rhimmel{font-family:var(--term);font-size:9px;fill:var(--dim);text-anchor:middle;letter-spacing:.1em}
  .rfuss{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:auto;padding-top:12px;flex-wrap:wrap}
  .rfuss select{flex:0 0 auto;background:var(--panel-2);border:1px solid var(--line);border-radius:4px;color:var(--green);
    font-family:var(--term);font-size:12px;letter-spacing:.1em;padding:5px 8px;cursor:pointer}
  .rfuss select:focus{outline:none;border-color:var(--line-hot)}
  .rradius{font-family:var(--term);font-size:10.5px;color:var(--dim);letter-spacing:.1em}
  .rfuss .status{font-size:10.5px}

  .ppanel{flex:1 1 300px;max-width:520px;min-width:0;display:flex;flex-direction:column;justify-content:center}
  .puhr{font-family:var(--term);color:var(--green);text-shadow:var(--glow);letter-spacing:.06em;
    font-variant-numeric:tabular-nums;line-height:1;font-size:clamp(38px,6.6vw,64px);margin-bottom:20px;text-align:left}
  .puhr i{font-style:normal;opacity:.42;font-size:.68em}
  .wheel{width:100%;text-align:left;border:1px solid var(--line-hot);border-radius:8px;
    background:var(--panel-2);padding:16px 16px 12px;margin-bottom:20px;cursor:pointer;
    display:flex;flex-direction:column;gap:10px;transition:.15s;font-family:inherit}
  .wheel:hover:not(:disabled){box-shadow:0 0 14px rgba(53,255,111,.18);border-color:var(--green)}
  .wheel:disabled{cursor:default;opacity:.6}
  .wheeltext{font-family:var(--mono);font-size:14px;line-height:1.5;color:var(--green);
    text-shadow:var(--glow);min-height:2.6em;transition:opacity .25s}
  .wheel.dreht .wheeltext{opacity:.15}
  .wheeldreh{font-family:var(--term);font-size:10.5px;letter-spacing:.1em;color:var(--dim);align-self:flex-end}
  .wheel.dreht .wheeldreh{animation:wheelspin .55s linear}
  @keyframes wheelspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  .wheelrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
  .wheelrow .ti{flex:1 1 200px;min-width:0}

  /* verwaltungs-karten (wheel · orakel) */
  .vkarte{border:1px solid var(--line);border-radius:7px;background:var(--panel-2);margin-top:12px;overflow:hidden}
  .vkopf{width:100%;display:flex;align-items:center;gap:10px;background:transparent;border:0;cursor:pointer;
    padding:11px 14px;font-family:var(--term);font-size:11px;letter-spacing:.18em;color:var(--green);text-transform:uppercase}
  .vchev{color:var(--dim);flex:0 0 auto}
  .vtitel{flex:1;text-align:left;text-shadow:var(--glow)}
  .vzahl{flex:0 0 auto;color:var(--dim);font-size:11px}
  .vbody{padding:0 14px 14px;border-top:1px dashed var(--line)}
  .vadd{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center}
  .vadd .ti{flex:1 1 200px;min-width:0}
  .vhinweis{font-size:11px;color:var(--dim);font-style:italic;margin:12px 0 8px}
  .vleer{font-family:var(--term);font-size:11px;color:var(--dim);letter-spacing:.08em;padding:8px 0}
  .vzeile{display:flex;align-items:baseline;gap:10px;font-size:12.5px;color:var(--muted);
    padding:6px 0;border-bottom:1px dotted var(--line)}
  .vzeile span{flex:1;min-width:0}
  .vzeile i{font-style:normal;color:var(--dim);cursor:pointer;opacity:.6;flex:0 0 auto}
  .vzeile i:hover{opacity:1;color:var(--amber)}
  .vlabel.bearbeitbar{cursor:text;border-bottom:1px dotted transparent;transition:.12s}
  .vlabel.bearbeitbar:hover{border-bottom-color:var(--line-hot);color:var(--green)}
  .vedit{flex:1 1 auto;min-width:0;font-size:12.5px;padding:4px 8px}
  .ptitel{font-family:var(--term);font-size:11px;letter-spacing:.24em;color:var(--green);
    text-shadow:var(--glow);margin-bottom:9px;text-transform:uppercase}
  .pzeile{display:flex;align-items:baseline;gap:7px;font-family:var(--term);font-size:12px;
    letter-spacing:.06em;padding:3px 0}
  .ppunkt{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--green);
    box-shadow:0 0 6px rgba(53,255,111,.7);animation:puls 2s ease-in-out infinite;transform:translateY(-1px)}
  .ppunkt.gelb{background:var(--amber);box-shadow:0 0 6px rgba(224,178,106,.7)}
  .pzeile b.gelb{color:var(--amber)}
  .pzeile span{color:var(--dim);flex:0 0 auto}
  .pzeile i{flex:1;border-bottom:1px dotted var(--line);opacity:.6;transform:translateY(-3px)}
  .pzeile b{color:var(--muted);font-weight:400;flex:0 0 auto;font-variant-numeric:tabular-nums}
  .pliste{border:1px solid var(--line);border-radius:5px;background:var(--panel-2);overflow:hidden}
  .pliste.breit{max-height:230px;overflow-y:auto}
  .pliste.breit::-webkit-scrollbar{width:8px}
  .pliste.breit::-webkit-scrollbar-track{background:transparent}
  .pliste.breit::-webkit-scrollbar-thumb{background:var(--green-dim);border-radius:4px}
  .pspeed{color:var(--dim);flex:0 0 56px;text-align:right;font-variant-numeric:tabular-nums}
  .pleer{font-family:var(--term);font-size:11px;color:var(--dim);padding:12px;letter-spacing:.1em}
  .pflug{display:flex;align-items:baseline;gap:8px;padding:6px 10px;border-bottom:1px solid var(--line);
    font-family:var(--term);font-size:11px;letter-spacing:.05em}
  .pflug:last-child{border-bottom:0}
  .prufz{color:var(--green);flex:0 0 66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ptyp{color:var(--dim);flex:0 0 42px}
  .phoehe{color:var(--muted);flex:1;text-align:right;font-variant-numeric:tabular-nums;min-width:70px}
  .pdist{color:var(--green-dim);flex:0 0 48px;text-align:right;font-variant-numeric:tabular-nums}
  .pfuss{font-family:var(--term);font-size:10.5px;color:var(--dim);letter-spacing:.1em;
    text-align:center;margin-top:18px;padding-top:12px;border-top:1px dashed var(--line)}

  /* fehlerfang */
  .absturz{background:var(--panel);border:1px solid var(--danger);border-radius:6px;padding:20px;margin-top:14px}
  .atitel{font-family:var(--term);font-size:14px;letter-spacing:.16em;color:var(--danger);margin-bottom:10px}
  .atext{font-size:13px;color:var(--ink);line-height:1.6;word-break:break-word}
  .astack{font-size:10.5px;color:var(--dim);background:var(--void);border:1px solid var(--line);
    border-radius:5px;padding:10px;margin-top:12px;overflow-x:auto;white-space:pre;line-height:1.5}
  .azeile{display:flex;gap:8px;margin-top:14px}

  /* besetzung */
  .besetzung{background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:14px;margin-top:14px}
  .bz{display:flex;align-items:baseline;gap:8px;padding:4px 0;flex-wrap:wrap}
  .bzrolle{font-family:var(--term);font-size:11.5px;letter-spacing:.08em;color:var(--green);flex:0 0 auto}
  .bz i{flex:1;border-bottom:1px dotted var(--line);opacity:.5;transform:translateY(-3px);min-width:20px}
  .bzname{font-family:var(--mono);font-size:12.5px;background:transparent;border:0;color:var(--ink);
    cursor:pointer;padding:0;flex:0 0 auto}
  .bzname:hover{color:var(--green);text-shadow:var(--glow)}
  .bzname em{font-style:normal;font-size:10.5px;color:var(--dim);padding-left:7px}
  .bz.frei .bzrolle{color:var(--dim)}
  .bzname.bzfrei{color:var(--dim);cursor:default;font-style:italic}
  .bzname.bzfrei:hover{color:var(--dim);text-shadow:none}
  .bzgrid{display:flex;flex-direction:column;gap:10px;margin-bottom:6px}
  .bzkarte{border:1px solid var(--line);border-radius:7px;background:var(--panel-2);padding:13px 15px;transition:.15s}
  .bzkarte.klick{cursor:pointer;text-align:left;font-family:inherit;width:100%;display:block}
  .bzkarte:not(.frei):hover{border-color:var(--line-hot)}
  .bzkarte.frei{border-style:dashed}
  .bzkarte.frei.klick:hover{border-color:var(--line-hot);border-style:solid}
  .bzkopf{display:flex;align-items:center;flex-wrap:wrap;gap:11px}
  .bzav{flex:0 0 auto;display:inline-flex}
  .bzav.leer{opacity:.4}
  .bzkarte .bzrolle{font-size:13px}
  .bzinfo{font-size:12px;color:var(--muted);line-height:1.55;margin-top:9px;padding-top:9px;border-top:1px dotted var(--line)}
  .avtrenn{width:1px;align-self:stretch;background:var(--line);margin:0 3px}
  .throlle{font-family:var(--term);font-size:10px;letter-spacing:.08em;color:var(--green);
    border:1px solid var(--line-hot);border-radius:3px;padding:1px 6px;flex:0 0 auto}
  .tharch{font-family:var(--term);font-size:10px;letter-spacing:.08em;color:var(--dim);flex:0 0 auto}

  /* avatare */
  .avatar .avl{fill:none;stroke:var(--green);stroke-width:1.4;opacity:.8;stroke-linejoin:round;stroke-linecap:round}
  .avatar .avf{fill:var(--green);opacity:.12}
  .avatar .aveye{fill:var(--green);opacity:.7}
  .thav{flex:0 0 auto;display:inline-flex;margin-right:2px}
  .avwahl{display:flex;gap:8px;flex-wrap:wrap}
  .avopt{width:46px;height:46px;border:1px solid var(--line);border-radius:6px;background:var(--panel-2);
    cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:15px;padding:0}
  .avopt:hover{border-color:var(--line-hot)}
  .avopt.on{border-color:var(--green);box-shadow:0 0 8px rgba(53,255,111,.3)}

  /* steckbriefe */
  .skarte{flex:1 1 200px;display:flex;align-items:center;gap:12px;border:1px solid var(--line);
    border-radius:7px;background:var(--panel-2);padding:11px 13px;cursor:pointer;text-align:left;
    font-family:inherit;transition:.12s}
  .skarte:hover{border-color:var(--line-hot)}
  .sav{flex:0 0 auto;width:40px;height:40px;display:flex;align-items:center;justify-content:center}
  .savleer{font-family:var(--term);font-size:20px;color:var(--dim);opacity:.5}
  .sinfo{min-width:0;flex:1}
  .sname{font-family:var(--mono);font-size:13px;color:var(--ink);display:flex;align-items:baseline;gap:8px}
  .sanzahl{font-family:var(--term);font-size:11px;color:var(--green);text-shadow:var(--glow);flex:0 0 auto}
  .smeta{font-family:var(--term);font-size:10.5px;letter-spacing:.06em;color:var(--dim);margin-top:3px}

  /* handbuch */
  .handbuch{margin:14px 0 0;padding:16px;background:var(--panel-2);border:1px solid var(--line);
    border-radius:6px;max-height:66vh;overflow:auto;white-space:pre-wrap;word-break:break-word;
    font-family:var(--mono);font-size:12.5px;line-height:1.7;color:var(--muted)}
  .handbuch::-webkit-scrollbar{width:9px}
  .handbuch::-webkit-scrollbar-track{background:var(--void)}
  .handbuch::-webkit-scrollbar-thumb{background:var(--green-dim);border-radius:5px}
  .handbuch::-webkit-scrollbar-thumb:hover{background:var(--green-mid)}

  /* monatsgitter */
  .mwrap{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px 16px 16px;margin-bottom:12px}
  .mnav{display:flex;align-items:center;gap:14px;margin-bottom:12px}
  .mnav button{font-family:var(--mono);font-size:12px;background:transparent;border:1px solid var(--line);
    color:var(--muted);border-radius:4px;padding:3px 10px;cursor:pointer;transition:.12s}
  .mnav button:hover:not(:disabled){border-color:var(--line-hot);color:var(--green)}
  .mnav button:disabled{opacity:.25;cursor:not-allowed}
  .mname{font-family:var(--term);font-size:14px;letter-spacing:.2em;color:var(--green);text-shadow:var(--glow)}
  .mgrid{display:flex;flex-wrap:wrap;gap:6px}
  .kasten{width:15px;height:30px;padding:0;border-radius:2px;cursor:pointer;transition:.15s;
    border:1px solid var(--line);background:transparent}
  .kasten:hover:not(:disabled){border-color:var(--line-hot)}
  .kasten.teil{border-color:var(--green-mid);box-shadow:inset 0 0 8px rgba(53,255,111,.4),0 0 5px rgba(53,255,111,.25)}
  .kasten.halb{background:var(--amber);border-color:var(--amber);box-shadow:0 0 8px rgba(224,178,106,.55)}
  .kasten.voll{background:var(--green);border-color:var(--green);box-shadow:var(--glow)}
  .kasten.heute{outline:1px dotted var(--green-mid);outline-offset:2px}
  .kasten.gewaehlt{outline:1px solid var(--green);outline-offset:3px}
  .kasten.zukunft{opacity:.2;cursor:not-allowed}

  /* suche + tags */
  .suchzeile{display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px dashed var(--line)}
  .suchzeile .btn{padding:9px 14px;font-size:12.5px;flex:0 0 auto}
  .ti.tags{font-family:var(--term);letter-spacing:.06em;color:var(--green);width:100%}
  .tagfeld{position:relative;flex:1 1 180px;min-width:140px}
  .tagliste{position:absolute;z-index:5;top:calc(100% + 5px);left:0;right:0;min-width:220px;
    background:var(--panel);border:1px solid var(--line-hot);border-radius:5px;padding:7px;
    box-shadow:0 8px 22px rgba(0,0,0,.6);display:flex;flex-wrap:wrap;gap:5px}
  .taghinweis{flex:1 1 100%;font-family:var(--term);font-size:9.5px;letter-spacing:.1em;color:var(--dim);
    margin-bottom:2px}
  .tagvor{font-family:var(--term);font-size:11px;letter-spacing:.08em;background:var(--panel-2);
    border:1px solid var(--line);color:var(--muted);border-radius:11px;padding:3px 10px;cursor:pointer;transition:.12s}
  .tagvor:hover{border-color:var(--line-hot);color:var(--green)}
  .tagvor.erst{border-color:var(--green-dim);color:var(--green)}
  .chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
  .chip{font-family:var(--term);font-size:11px;letter-spacing:.08em;background:transparent;
    border:1px solid var(--line);color:var(--dim);border-radius:11px;padding:3px 10px;cursor:pointer;transition:.12s}
  .chip:hover{border-color:var(--line-hot);color:var(--green)}
  .chip.on{background:var(--green-dim);border-color:var(--line-hot);color:var(--white)}
  .treffer{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px}
  .tkopf{font-family:var(--term);font-size:11px;letter-spacing:.12em;color:var(--dim);margin-bottom:8px}
  .tkopf b{color:var(--green);font-weight:400}
  .tzeile{display:flex;align-items:baseline;gap:12px;width:100%;text-align:left;background:transparent;
    border:0;border-bottom:1px solid var(--line);padding:9px 2px;cursor:pointer;transition:.12s}
  .tzeile:hover{background:var(--panel-2)}
  .tzeile:hover .tdatum{color:var(--green)}
  .tdatum{font-family:var(--term);font-size:11.5px;color:var(--muted);letter-spacing:.06em;flex:0 0 auto;transition:.12s}
  .tschnipsel{flex:1;font-size:12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .twoerter{font-family:var(--term);font-size:10.5px;color:var(--green-dim);flex:0 0 auto}

  /* log-files */
  .ta.log{min-height:340px;font-size:13.5px;line-height:1.65;overflow:hidden;resize:none}
  .logfoot{display:flex;align-items:center;gap:14px;margin-top:8px}
  .logbar{flex:1;height:2px;background:var(--line);overflow:hidden}
  .logbar i{display:block;height:100%;background:var(--green-mid);transition:width .3s}
  .logbar i.halb{background:var(--amber);box-shadow:0 0 8px rgba(224,178,106,.5)}
  .logbar i.voll{background:var(--white);box-shadow:0 0 10px var(--green)}
  .wcount{font-family:var(--term);font-size:12.5px;color:var(--muted);letter-spacing:.08em;
    white-space:nowrap;font-variant-numeric:tabular-nums;transition:.3s}
  .wcount .wziel{color:var(--dim)}
  .wcount.voll{color:var(--white);text-shadow:0 0 12px var(--green),0 0 24px rgba(53,255,111,.5);
    animation:fertig .5s ease-out}
  @keyframes fertig{0%{transform:scale(1)}40%{transform:scale(1.14)}100%{transform:scale(1)}}

  /* korrektur · lesefassung */
  .korr{margin-top:6px}
  .korrblock{margin-bottom:20px}
  .korrgruppe{font-family:var(--term);font-size:12px;letter-spacing:.16em;color:var(--green);
    margin:22px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line-hot)}
  .korrblock:first-child .korrgruppe{margin-top:4px}
  .korrlabel{display:flex;align-items:center;gap:12px;margin-bottom:6px}
  .korrnr{font-family:var(--term);font-size:11px;color:var(--green-mid);
    font-variant-numeric:tabular-nums;letter-spacing:.06em;flex:0 0 auto}
  .korrsub{flex:1;min-width:0;font-family:var(--mono);font-size:13px;color:var(--muted);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .korrw{font-family:var(--term);font-size:10.5px;color:var(--dim);letter-spacing:.08em;flex:0 0 auto}
  .korrta{font-size:15px;line-height:1.7;min-height:70px}

  /* commit-karten */
  .commit{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px;margin-bottom:10px}
  .commit.pausiert{opacity:.6}
  .commit.beendet{opacity:.38}
  .commit .chead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cdot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dim)}
  .cdot.aktiv{background:var(--green);box-shadow:var(--glow);animation:puls 2s ease-in-out infinite}
  .cdot.pausiert{background:var(--amber)}
  .cdot.beendet{background:var(--dim)}
  @keyframes puls{50%{opacity:.35}}
  .cprio{font-family:var(--term);font-size:12px;color:var(--green);letter-spacing:.1em;
    border:1px solid var(--line-hot);border-radius:3px;padding:1px 6px}
  .cprojekt{flex:1;font-size:14px;color:var(--ink);min-width:120px}
  .commit .chead{cursor:pointer}
  .commit .chev{color:var(--green-mid);font-size:12px;transition:transform .15s;flex:0 0 auto}
  .commit:not(.auf) .chev{transform:rotate(-90deg)}
  .cstatus{font-family:var(--term);font-size:10.5px;letter-spacing:.14em;color:var(--dim);text-transform:uppercase}
  .cmeta{font-size:11.5px;color:var(--dim);margin-top:8px;line-height:1.6}
  .cmeta b{color:var(--muted);font-weight:400}
  .csig{font-family:var(--term);font-size:11px;letter-spacing:.14em;color:var(--green-dim);margin-top:6px}
  .cfb{font-size:12.5px;color:var(--muted);line-height:1.6;margin-top:10px;white-space:pre-wrap;
    border-left:2px solid var(--green-dim);padding-left:10px}
  .cedit{margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)}
  .crec{display:flex;gap:6px;margin-top:12px}
  .crec button{font-family:var(--mono);font-size:13px;background:var(--panel-2);border:1px solid var(--line);
    color:var(--muted);border-radius:4px;padding:6px 14px;cursor:pointer;transition:.12s;min-width:44px}
  .crec button:hover:not(:disabled){border-color:var(--line-hot);color:var(--green)}
  .crec button:disabled{opacity:.25;cursor:not-allowed}
  .crec button.del{margin-left:auto;min-width:auto;padding:6px 10px}
  .crec button.del:hover{border-color:var(--danger);color:var(--danger)}

  .grouphead{display:flex;align-items:center;gap:14px;margin:30px 2px 12px;font-family:var(--term);
    font-size:15px;letter-spacing:.3em;color:var(--green);text-shadow:var(--glow)}
  .grouphead:before{content:"//";color:var(--green-mid);letter-spacing:0}
  .grouphead .rule{flex:1;height:1px;background:linear-gradient(90deg,var(--line-hot),transparent)}

  .panel{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:16px 16px 18px;margin-bottom:12px}
  .phead{display:flex;align-items:center;gap:10px;margin-bottom:14px;border-bottom:1px dashed var(--line);padding-bottom:10px;cursor:pointer}
  .phead .prompt{color:var(--green-mid);font-family:var(--term)}
  .phead .pid{font-family:var(--term);font-size:15px;letter-spacing:.1em;color:var(--green)}
  .phead .psub{color:var(--dim);font-size:11px;margin-left:auto;letter-spacing:.03em}
  .phead .chev{color:var(--green-mid);font-size:13px;margin-left:10px;transition:transform .15s;user-select:none}
  .panel.collapsed .chev{transform:rotate(-90deg)}
  .panel.collapsed .phead{margin-bottom:0;border-bottom:0;padding-bottom:0}

  .row{display:flex;flex-wrap:wrap;gap:14px}
  .field{flex:1 1 180px;min-width:150px}
  label.cap{display:block;font-size:11.5px;color:var(--muted);margin-bottom:6px;letter-spacing:.03em}
  label.cap:before{content:"> ";color:var(--green-dim)}

  .seg{display:inline-flex;flex-wrap:wrap;gap:4px;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:4px}
  .seg button{font-family:var(--mono);font-size:12.5px;color:var(--muted);background:transparent;border:0;
    border-radius:4px;padding:7px 12px;cursor:pointer;transition:.12s;letter-spacing:.02em}
  .seg button:hover{color:var(--green)}
  .seg button[aria-pressed="true"]{background:var(--green-dim);color:var(--white);box-shadow:inset 0 0 0 1px var(--line-hot)}

  input[type=file]{font-size:12px;color:var(--muted);max-width:100%}
  input[type=file]::file-selector-button{font-family:var(--mono);font-size:12px;color:var(--green);
    background:var(--panel-2);border:1px solid var(--line);border-radius:5px;padding:7px 11px;margin-right:10px;cursor:pointer}
  input[type=file]::file-selector-button:hover{border-color:var(--line-hot)}

  .slider{display:flex;align-items:center;gap:11px}
  input[type=range]{-webkit-appearance:none;appearance:none;flex:1;height:2px;background:var(--line);outline:none;min-width:70px}
  input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;background:var(--green);
    cursor:pointer;box-shadow:0 0 6px rgba(53,255,111,.6);border-radius:1px}
  input[type=range]::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:1px;background:var(--green);cursor:pointer}
  .val{font-family:var(--mono);font-size:12px;color:var(--green);min-width:62px;text-align:right}

  .switch{position:relative;width:42px;height:22px;flex:none;display:inline-block}
  .switch input{opacity:0;width:0;height:0}
  .track{position:absolute;inset:0;background:var(--panel-2);border:1px solid var(--line);border-radius:3px;transition:.18s;cursor:pointer}
  .track:before{content:"";position:absolute;width:14px;height:14px;left:3px;top:3px;background:var(--dim);border-radius:2px;transition:.18s}
  .switch input:checked + .track{background:var(--green-dim);border-color:var(--line-hot)}
  .switch input:checked + .track:before{transform:translateX(20px);background:var(--green);box-shadow:var(--glow)}
  .switch.mini{width:36px;height:20px}
  .switch.mini .track:before{width:12px;height:12px}
  .switch.mini input:checked + .track:before{transform:translateX(16px)}
  .pbody{transition:opacity .18s}
  .pbody.off{opacity:.3;pointer-events:none}

  .explain{font-size:12px;color:var(--muted);border-left:2px solid var(--green-dim);padding:4px 0 4px 12px;margin-top:12px;min-height:1.2em}
  .explain b{color:var(--green);font-weight:500}

  .modeblock{margin-top:14px}
  .ta{width:100%;min-height:72px;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;
    color:var(--ink);font-family:var(--mono);font-size:13px;padding:10px;resize:vertical;line-height:1.5;
    caret-shape:block;caret-color:var(--green)}
  .ta:focus{outline:none;border-color:var(--line-hot)}
  .ta::placeholder{color:var(--dim)}
  .btn.gen{margin-top:8px;font-size:13px;padding:9px 16px}
  .ttsbar{font-family:var(--term);font-size:11.5px;letter-spacing:.03em;color:var(--dim);
    border:1px dashed var(--line);border-radius:5px;padding:8px 10px;margin:14px 0}
  .ttsbar.work{color:var(--amber);border-color:var(--line-hot)}
  .ttsbar.ok{color:var(--green);border-color:var(--line-hot)}
  .ttsbar.err{color:var(--danger);border-color:var(--danger)}

  .duo{display:flex;flex-wrap:wrap;gap:12px}
  .duo .field{flex:1 1 240px}
  .chan{border:1px solid var(--line);border-radius:6px;padding:12px;background:var(--panel-2)}
  .chan .tag{font-family:var(--term);font-size:11px;letter-spacing:.12em;color:var(--green);margin-bottom:8px}
  .layer{border:1px solid var(--line);border-radius:6px;padding:12px;background:var(--panel-2);margin-bottom:10px}
  .layer .lhead{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .layer .ltag{font-family:var(--term);font-size:11px;letter-spacing:.1em;color:var(--muted)}
  .layer .mini-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}
  .layer .mini-row .field{min-width:120px}

  .divider{border-top:1px dashed var(--line);margin:18px 0 14px;padding-top:6px;
    font-family:var(--term);font-size:11px;letter-spacing:.14em;color:var(--dim)}
  .embed-row{display:flex;flex-wrap:wrap;gap:18px}
  .embed{flex:1 1 260px;border:1px solid var(--line);border-radius:6px;padding:12px}
  .embed .ehead{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .embed .ename{font-family:var(--term);font-size:12.5px;letter-spacing:.06em;color:var(--ink)}

  .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:6px}
  .btn{font-family:var(--mono);font-size:13.5px;letter-spacing:.03em;border-radius:5px;padding:12px 20px;cursor:pointer;
    border:1px solid var(--line);background:var(--panel-2);color:var(--ink);transition:.12s}
  .btn:hover{border-color:var(--line-hot);color:var(--green)}
  .btn.primary{background:var(--green-dim);border-color:var(--line-hot);color:var(--white);font-weight:500}
  .btn.primary:hover{background:var(--green-mid);color:#04150a}
  .btn.stop{border-color:var(--danger);color:var(--danger);background:transparent}
  .btn:disabled{opacity:.35;cursor:not-allowed}

  .status{font-family:var(--term);font-size:12.5px;color:var(--muted);margin-left:auto;text-align:right;letter-spacing:.03em}
  .status:before{content:"[ "}.status:after{content:" ]"}
  .status.work{color:var(--amber)} .status.ok{color:var(--green)} .status.err{color:var(--danger)}

  .hint{font-size:11.5px;color:var(--dim);margin-top:8px;line-height:1.5}
  .hint b{color:var(--muted);font-weight:400}
  a.dl{color:var(--green);text-decoration:none;border-bottom:1px solid var(--green-dim)}

  .progress{height:2px;background:var(--line);overflow:hidden;margin-top:14px}
  .progress i{display:block;height:100%;background:var(--green);box-shadow:var(--glow);transition:width .2s}

  .rabbit{text-align:center;color:var(--dim);font-size:11px;letter-spacing:.1em;margin-top:26px;font-family:var(--term)}
  .rabbit b{color:var(--green-dim)}

  #gate{position:fixed;inset:0;z-index:9;background:var(--void);display:flex;align-items:center;justify-content:center;padding:20px}
  .gatebox{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:22px}
  .gatebox .gm{font-family:var(--term);font-size:22px;letter-spacing:.12em;color:var(--green);text-shadow:var(--glow);margin-bottom:4px}
  .gatebox .gs{font-family:var(--term);font-size:11.5px;color:var(--dim);letter-spacing:.1em;margin-bottom:18px}
  .gatebox input{width:100%;background:var(--panel-2);border:1px solid var(--line);border-radius:5px;
    color:var(--ink);font-family:var(--mono);font-size:13px;padding:11px;margin-bottom:9px;
    caret-shape:block;caret-color:var(--green)}
  .gatebox input:focus{outline:none;border-color:var(--line-hot)}
  .gatebox input::placeholder{color:var(--dim)}
  .gatebox .btn{width:100%;margin-top:5px}
  #gMsg{font-family:var(--term);font-size:11.5px;color:var(--dim);margin-top:12px;min-height:1.2em;letter-spacing:.03em}
  #gMsg.err{color:var(--danger)} #gMsg.work{color:var(--amber)}

  .whoami{font-family:var(--term);font-size:11px;color:var(--dim);letter-spacing:.06em;
    display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
  .whoami button{font-family:var(--mono);font-size:11px;background:transparent;border:1px solid var(--line);
    color:var(--muted);border-radius:4px;padding:3px 9px;cursor:pointer}
  .whoami button:hover{border-color:var(--line-hot);color:var(--green)}
  .rezrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .rezrow input,.rezrow select{background:var(--panel-2);border:1px solid var(--line);border-radius:5px;
    color:var(--ink);font-family:var(--mono);font-size:12.5px;padding:9px 10px;min-width:130px;flex:1 1 150px;
    caret-shape:block;caret-color:var(--green)}
  .rezrow input:focus,.rezrow select:focus{outline:none;border-color:var(--line-hot)}
  .rezrow .btn{padding:9px 14px;font-size:12.5px;flex:0 0 auto}
  .qitem{display:flex;align-items:center;gap:8px;background:var(--panel-2);border:1px solid var(--line);
    border-radius:5px;padding:7px 10px;margin-bottom:6px}
  .qitem .qnum{font-family:var(--term);font-size:11px;color:var(--green-dim);min-width:14px}
  .qitem .qname{flex:1;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .qitem .qname.playing{color:var(--green);text-shadow:var(--glow)}
  .qitem .qlive{font-family:var(--term);font-size:10px;color:var(--green);letter-spacing:.08em}
  .qitem button{font-family:var(--mono);font-size:11px;background:transparent;border:1px solid var(--line);
    color:var(--muted);border-radius:4px;padding:2px 8px;cursor:pointer}
  .qitem button:hover:not(:disabled){border-color:var(--line-hot);color:var(--green)}
  .qitem button:disabled{opacity:.3;cursor:not-allowed}

  @media(prefers-reduced-motion:reduce){#rain{display:none}.cursor{animation:none}}
  @media(max-width:560px){.uhr{display:none}.subline{font-size:11px;gap:8px}.phead .psub{display:none}.phead .chev{margin-left:auto}.val{min-width:54px}}

  /* iOS zoomt beim antippen rein, wenn die schrift kleiner als 16px ist —
     und zoomt nie wieder raus. also: auf touch-geräten alle eingabefelder auf 16px. */
  @media(max-width:820px){
    .ta,.ti,.gatebox input,.rezrow input,.rezrow select,
    input[type=text],input[type=email],input[type=password],input[type=date],
    textarea,select{font-size:16px}
    .ta.klein,.ta.log{font-size:16px}
  }
    `}</style>
  );
}
