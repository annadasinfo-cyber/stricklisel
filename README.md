# stricklisel.app

SubConstructor als private Operator-Konsole.
Eigenes Repo, eigenes Vercel-Projekt, eigenes Supabase. Null Verbindung zu Lenormandia.

```
stricklisel/
├── index.html      ← die Konsole (alles drin, kein Build)
├── supabase.sql    ← einmal im SQL Editor ausführen
└── README.md       ← das hier
```

---

## 1 · Supabase-Projekt anlegen

1. supabase.com → **New project** (Free). Name z. B. `stricklisel`.
2. **SQL Editor** → New query → Inhalt von `supabase.sql` einfügen → **Run**.
3. **Authentication → Providers → Email**: „Confirm email" **aus** (spart dir den Bestätigungsklick).
4. **Authentication → Users → Add user** → deine Email + Passwort. Das ist dein Zugang.
5. **Authentication → Sign In / Providers → Allow new users to sign up: AUS.**
   → Damit kann sich **niemand** außer dir jemals einen Account anlegen. Das ist die eigentliche Tür.

## 2 · Schlüssel eintragen

Supabase → **Project Settings → API**. Dort stehen zwei Werte.
In `index.html` ganz oben im Script-Block eintragen:

```js
const SUPA_URL = "https://xxxxxxxx.supabase.co";   // Project URL
const SUPA_KEY = "eyJhbGciOi...";                  // anon / public key
```

Der anon-key **darf** im Quelltext stehen — er ist öffentlich gedacht.
Geschützt wird durch RLS (siehe `supabase.sql`) und dadurch, dass Signup aus ist.

## 3 · GitHub

Neues Repo `stricklisel` (privat). Die drei Dateien rein.

## 4 · Vercel

1. vercel.com → **Add New → Project** → Repo `stricklisel` importieren.
2. Framework Preset: **Other**. Kein Build Command, kein Output Directory.
3. Deploy.
4. **Settings → Domains** → `stricklisel.app` verbinden.

Kein Build, kein Framework, keine Env-Variablen. Vercel liefert die HTML-Datei aus, fertig.

---

## Was wo passiert

| | wo |
|---|---|
| Login | Supabase |
| Rezepte (Regler, Schalter, Texte) | Supabase |
| Audio erzeugen, mischen, rendern | **nur dein Browser** |
| Sprachmodelle (Ilona / Thorsten) | **nur dein Browser** |
| Deine Audiodateien | **verlassen das Gerät nie** |

Rezepte speichern Einstellungen und Texte — **keine Audiodateien**.
Am Mac gebaut, am iPad geladen.

## Ehrliche Grenzen

- **Handy bleibt zäh.** Die Sprachmodelle rechnen auf dem Gerät, nicht auf dem Server. Deployen macht die Konsole überall *erreichbar* — schwere Arbeit bleibt Mac-Arbeit.
- **Export gekappt bei 30 min.** Play kann 7 h, die WAV-Datei nicht.
- **Ultraschall nur im WAV.** MP3 köpft alles über ~16 kHz.

## Später mal

Struktur von Lenormandia ausleihen heißt: **Muster kopieren, nicht Daten teilen.**
Gleicher Tabellenaufbau, gleiches RLS-Pattern — aber eigene Datenbank.
Wenn hier was kracht, kracht hier was.
