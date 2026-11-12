# MS Kompasset 🧭

En rolig app til hverdagen med MS. Ditte registrerer aktiviteter og energi, mad, træning og bekymringer,
og appen lærer hendes rytme og minder hende om pauser. Peter har sin egen konto, ser hendes status,
registrerer mad og støtter, men får ikke hendes påmindelser og kan ikke se hendes notater.

Bygget som vinappen: en web-app (PWA) på GitHub Pages med Supabase som database.

- **Opsætning:** [docs/OPSAETNING.md](docs/OPSAETNING.md)
- **Logo og ikoner:** [branding/README.md](branding/README.md)
- **Demo med testdata:** åbn appen med `?demo` i adressen

## Moduler

| Modul | Forside | Hvad |
|---|---|---|
| Aktivitet (energi) | Gæt på energien som tekst | Start/stop aktiviteter, energi 1–5, glemt at stoppe, hjernepause med tjek efter 15 min, faste pauser (hverdage / weekend og helligdage), forslag om hjernepause ud fra mønstre, dagsevaluering |
| Sundhed og kost | Rød/gul/grøn | Mindst 30 forskellige råvarer pr. rullende 7 dage, heraf bælgfrugter og nødder/kerner, trend og advarsel, protein |
| Træning | Rød/gul/grøn | Ugeplan for romaskine, balance og muskeltræning, én samlet påmindelse |
| Notater og bekymringer | Vises ikke | Daglig note (kladden gemmes), historik og analyse med Claude |

## Struktur

```
index.html, styles.css      – skærmen
js/app.js                   – skærme og flows
js/store.js                 – lokal kopi og synkronisering med Supabase (virker offline)
js/logic.js                 – beregninger (kost, træning, energi-læring)
js/push.js                  – notifikationer på iPhone
sw.js, manifest.json        – PWA (offline, notifikationer, hjemmeskærm)
config.js                   – Supabase-adresse og offentlige nøgler
branding/                   – logo og ikoner (kan udskiftes uden kodeændringer)
supabase/migrations/        – database, deling og sikkerhed (Row Level Security)
supabase/functions/notify   – sender påmindelser hvert minut (Web Push)
supabase/functions/analyze-notes – analyse af bekymringer med Claude
supabase/functions/_shared  – kalender (helligdage), aktiviteter, påmindelseslogik, Web Push
tests/                      – tests: node --test, RLS-test mod Postgres, røgtest af notify
```

## Test

```
npm test
```
Kører logik- og påmindelsestests, en røgtest af notifikationsserveren og en test af databasens
adgangsregler mod en lokal Postgres 16.
