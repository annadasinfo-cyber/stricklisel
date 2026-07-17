// Vercel holt die Flugdaten für uns.
//
// Warum: adsb.lol lässt Browser nicht direkt ran (CORS). Der Server darf.
// Läuft auf dem kostenlosen Vercel-Plan, braucht keinen Schlüssel.

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const dist = Math.min(Number(req.query.dist) || 100, 250);
  if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ ac: [], error: "lat/lon fehlt" });

  const quellen = [
    `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
    `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
    `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
  ];

  for (const u of quellen) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "stricklisel-thinkpad" } });
      if (!r.ok) continue;
      const d = await r.json();
      if (!d || !Array.isArray(d.ac)) continue;
      // 10 s zwischenspeichern — die community-quellen sollen nicht leiden
      res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
      return res.status(200).json({ ac: d.ac, quelle: new URL(u).hostname });
    } catch { /* nächste quelle */ }
  }
  return res.status(502).json({ ac: [], error: "keine quelle erreichbar" });
}
