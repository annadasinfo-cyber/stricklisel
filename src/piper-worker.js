// Piper läuft in einem eigenen Worker.
//
// Warum: vits-web baut bei JEDEM predict() eine neue InferenceSession mit dem
// kompletten Modell auf und gibt sie nie frei. Nach ein paar Dutzend Häppchen
// kippt WASM um und wirft einen nackten Speicherzeiger als "Fehler".
//
// Einen Worker kann man abschießen — das gibt seinen gesamten Speicher frei,
// WASM inklusive. Die App recycelt ihn deshalb regelmäßig.

import * as tts from "@diffusionstudio/vits-web";

self.onmessage = async (e) => {
  const { id, text, voiceId } = e.data;
  try {
    const blob = await tts.predict({ text, voiceId });
    const ab = await blob.arrayBuffer();
    self.postMessage({ id, ok: true, ab }, [ab]);
  } catch (err) {
    // Emscripten wirft manchmal eine nackte Zahl statt einer Meldung.
    const raw = err?.message ?? err;
    const msg = typeof raw === "number" || /^\d+$/.test(String(raw))
      ? "wasm-abbruch (speicher) bei: " + String(text).slice(0, 40) + "…"
      : String(raw);
    self.postMessage({ id, ok: false, err: msg });
  }
};
