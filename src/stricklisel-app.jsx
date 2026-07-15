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
          if (payload.exp && payload.exp < Date.now() / 1000) return null;
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
function Switch({ checked, onChange, mini }) {
  return (
    <label className={"switch" + (mini ? " mini" : "")} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
    </label>
  );
}

function Panel({ id, title, sub, sw, children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={"panel" + (open ? "" : " collapsed")}>
      <div className="phead" onClick={() => setOpen(!open)}>
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
        g.fillStyle = Math.random() < 0.09 ? "rgba(235,255,240,1)" : "rgba(70,255,135,1)";
        g.fillText(t, i * fs, drops[i] * fs);
        if (drops[i] * fs > c.height && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 0.5;
      }
    };
    timer = setInterval(draw, 70);
    return () => { clearInterval(timer); removeEventListener("resize", rs); };
  }, []);
  return <canvas id="rain" ref={ref} />;
}

function Scope({ analyser, ctxRef }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current, cx = cv.getContext("2d");
    let raf;
    const size = () => { const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener("resize", size);
    const idle = () => { const w = cv.clientWidth, h = cv.clientHeight; cx.clearRect(0, 0, w, h); cx.strokeStyle = "rgba(53,255,111,.12)"; cx.beginPath(); cx.moveTo(0, h - 1); cx.lineTo(w, h - 1); cx.stroke(); };
    const loop = () => {
      raf = requestAnimationFrame(loop);
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
    loop();
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); };
  }, [analyser, ctxRef]);
  return (
    <div className="scope">
      <canvas id="spectrum" ref={ref} />
      <div className="scope-lbl">FREQ.SCOPE</div>
      <div className="scope-ultra">▌ ultraschall &gt;15 khz</div>
    </div>
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

  const [status, setStatus] = useState({ t: "bereit", c: "" });
  const [tts, setTts] = useState({ t: "» sätze werden gepackt · erzeugtes landet im cache", c: "" });
  const [dl, setDl] = useState(null);
  const [prog, setProg] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gen, setGen] = useState(null);

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
      const r = await fetch(`${SUPABASE_URL}/rest/v1/protokolle?select=name&order=updated_at.desc`, { headers: dbHeaders(getToken()) });
      const d = await r.json();
      setProgList(Array.isArray(d) ? d.map((x) => x.name) : []);
    } catch {}
  }
  async function saveProg() {
    const name = progName.trim();
    if (!name) { say("protokoll braucht einen namen", "err"); return; }
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/protokolle?on_conflict=user_id,name`, {
        method: "POST",
        headers: { ...dbHeaders(getToken()), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ user_id: getUserId(), name, settings: cfg, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(await r.text());
      say("protokoll gespeichert: " + name, "ok"); loadProgList();
    } catch (e) { say("speichern: " + (e?.message || e), "err"); }
  }
  async function loadProg() {
    if (!progSel) { say("kein protokoll gewählt", "err"); return; }
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/protokolle?select=settings&name=eq.${encodeURIComponent(progSel)}`, { headers: dbHeaders(getToken()) });
      const d = await r.json();
      if (!d?.[0]) throw new Error("nicht gefunden");
      setCfg({ ...DEFAULTS, ...d[0].settings });
      setProgName(progSel);
      say("protokoll geladen: " + progSel, "ok");
    } catch (e) { say("laden: " + (e?.message || e), "err"); }
  }
  async function delProg() {
    if (!progSel) { say("kein protokoll gewählt", "err"); return; }
    if (!confirm(`protokoll „${progSel}" wirklich löschen?`)) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/protokolle?name=eq.${encodeURIComponent(progSel)}`, { method: "DELETE", headers: dbHeaders(getToken()) });
      say("protokoll gelöscht: " + progSel, "ok"); setProgSel(""); loadProgList();
    } catch (e) { say("löschen: " + (e?.message || e), "err"); }
  }

  // ---- ABLAUF ----
  async function fetchProtokoll(name) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/protokolle?select=settings&name=eq.${encodeURIComponent(name)}`, { headers: dbHeaders(getToken()) });
    const d = await r.json();
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
      <div className="wrap">
        <header>
          <div className="wordmark">SUB<span className="slash">//</span>CONSTRUCTOR<span className="cursor" /></div>
          <div className="subline"><b>operator console</b> · lokaler subliminal-build · nichts verlässt diese maschine</div>
        </header>

        <Scope analyser={analyser} ctxRef={ctxRef} />

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
  body{background:var(--void);color:var(--ink);font-family:var(--mono);font-size:14px;
    line-height:1.5;-webkit-font-smoothing:antialiased;min-height:100vh}
  #rain{position:fixed;inset:0;z-index:0;opacity:.38;pointer-events:none}
  .wrap{position:relative;z-index:1;max-width:940px;margin:0 auto;padding:26px 18px 90px}

  .wordmark{font-family:var(--term);font-size:clamp(30px,6.2vw,52px);letter-spacing:.14em;
    color:var(--green);text-shadow:var(--glow);line-height:1;display:flex;align-items:center;flex-wrap:wrap}
  .wordmark .slash{color:var(--green-mid);opacity:.7}
  .cursor{display:inline-block;width:.5em;height:1em;background:var(--green);margin-left:.14em;
    translate:0 .12em;animation:blink 1.05s steps(1) infinite;box-shadow:var(--glow)}
  @keyframes blink{50%{opacity:0}}
  .subline{font-family:var(--term);color:var(--dim);font-size:13px;letter-spacing:.1em;margin-top:8px}
  .subline b{color:var(--muted);font-weight:400}

  .scope{margin:16px 0 6px;border:1px solid var(--line);border-radius:6px;
    background:linear-gradient(180deg,#07130c,#050b07);overflow:hidden;position:relative}
  #spectrum{display:block;width:100%;height:118px}
  .scope-lbl{position:absolute;top:8px;left:12px;font-family:var(--term);font-size:11px;letter-spacing:.14em;color:var(--dim)}
  .scope-ultra{position:absolute;bottom:7px;right:12px;font-family:var(--term);font-size:10.5px;color:var(--green);letter-spacing:.06em}

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
    color:var(--ink);font-family:var(--mono);font-size:13px;padding:10px;resize:vertical;line-height:1.5}
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
    color:var(--ink);font-family:var(--mono);font-size:13px;padding:11px;margin-bottom:9px}
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
    color:var(--ink);font-family:var(--mono);font-size:12.5px;padding:9px 10px;min-width:130px;flex:1 1 150px}
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
  @media(max-width:560px){.phead .psub{display:none}.phead .chev{margin-left:auto}.val{min-width:54px}}
    `}</style>
  );
}
