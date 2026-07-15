# stricklisel.app

SubConstructor — private Operator-Konsole.
**Gleicher Aufbau wie Lenormandia**: React + Vite, eine App-Datei, handgeschriebener
Supabase-Zugang über `fetch`, Session in `localStorage["sb_session"]`.

Eigenes Repo, eigenes Vercel-Projekt, eigenes Supabase. **Null Verbindung zu Lenormandia.**

```
stricklisel/
├── package.json
├── vite.config.js
├── index.html
├── .gitignore
├── supabase.sql              ← einmal im SQL Editor ausführen
└── src/
    ├── main.jsx
    └── stricklisel-app.jsx   ← die Konsole (wie lenormand-app.jsx)
```

---

## Lokal arbeiten

```
npm install
npm run dev
```

## Supabase (einmalig)

1. **SQL Editor** → Inhalt von `supabase.sql` → **Run**
2. **Authentication → Users → Add user** → deine Email + Passwort
3. **Authentication → Providers → Email** → „Confirm email" **aus**
4. **Sign In / Providers** → „Allow new users to sign up" **AUS** ← der eigentliche Riegel

Die Schlüssel stehen schon oben in `stricklisel-app.jsx`.
Der publishable key darf im Quelltext stehen — geschützt wird durch RLS + Signup-aus.

## Vercel

- **Add New → Project** → Repo importieren
- Framework Preset: **Vite** (erkennt er meist selbst)
- Build Command: `npm run build` · Output Directory: `dist`
- Deploy

## Was wo passiert

| | wo |
|---|---|
| Login, Programme | Supabase |
| Audio erzeugen, mischen, rendern | **nur dein Browser** |
| Sprachmodelle (Ilona / Thorsten) | **nur dein Browser** |
| Deine Audiodateien | **verlassen das Gerät nie** |

Programme speichern Einstellungen und Texte — **keine Audiodateien**.

## TTS

- **Sätze werden gepackt** (bis 180 Zeichen) → ca. 3,5× weniger Modellaufrufe als Satz-für-Satz.
- **Cache** (IndexedDB): jedes erzeugte Häppchen wird gemerkt. Abbruch oder Neuladen
  kostet nichts — beim nächsten Versuch kommen die fertigen Häppchen sofort zurück.
  „cache leeren" sitzt im PROGRAMME-Panel.
- **Ilona** (Xenova/mms-tts-deu) und **Thorsten** (Piper, `de_DE-thorsten-medium`) laden
  beim ersten Klick einmalig, danach aus dem Browser-Speicher.

## Ehrliche Grenzen

- **Handy bleibt zäh.** Die Sprachmodelle rechnen auf dem Gerät, nicht auf dem Server.
- **Export gekappt bei 30 min.** Play kann 7 h, die WAV-Datei nicht.
- **Ultraschall nur im WAV.** MP3 köpft alles über ~16 kHz.

## WRITING später rüberholen

In Lenormandia ist WRITING keine eigene Komponente, sondern ~50 State-Variablen
(`writingHook`, `writingCards`, `writingNotes` …) verteilt in `LenormandApp`.
Gleiche Sprache heißt: **ausschneiden und einfügen** statt neu schreiben.
Gebraucht werden jeweils: der State-Block, der JSX-Block, die Save-Funktionen.
