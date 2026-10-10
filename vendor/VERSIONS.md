# Vendor-Bibliotheken: Version und Prüfsumme

Selbst gehostet statt CDN (Anforderungsliste "Bibliotheken lokal statt per CDN"). Jede Datei
hier manuell heruntergeladen und geprüft, kein automatischer Build-Schritt. Bei jedem Update
diese Tabelle mitpflegen (Security-Audit vom 10.10.2026, Befund B8).

| Datei | Version | Quelle | SHA-256 |
|---|---|---|---|
| `lucide.min.js` | 1.53.0 | npm `lucide` (UMD-Build) | `b7e205738fa535ceda36f106852f29248e03b462d44656e74974622502caaa1d` |
| `mammoth.browser.min.js` | 1.13.0 (entspricht aktueller npm-Version; im Bundle selbst nicht ausgewiesen) | npm `mammoth` (Browser-Build) | `2a0c24d419b8b6b307b2c59dcad9ac045ef43c29fdb23f3b0f2e82d5b09287fe` |
| `xlsx.full.min.js` | 0.20.3 | `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` (offizielles SheetJS-CDN -- die npm-Version endet bei 0.18.5 und wird dort nicht mehr gepflegt) | `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` |
| `jszip.min.js` | 3.10.1 | npm `jszip` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |
| `dompurify.min.js` | 3.4.16 | npm `dompurify` (UMD-Build) | `2c90a9b46d6463f26038a29b686e82bc91de01fdac9d5229e7cfe3b360134ea2` |

## Hinweis zu xlsx.full.min.js (Security-Audit B8)

Version 0.18.5 (vorheriger Stand) war von CVE-2023-30533 (Prototype Pollution) und
CVE-2024-22363 (ReDoS) betroffen. Aktualisiert auf 0.20.3, in der beide behoben sind.

## Integrität prüfen

```bash
sha256sum vendor/*.js
```

Die Ausgabe muss mit der Tabelle oben übereinstimmen.
