# Opsætning af MS Kompasset

Det her gøres én gang. Det tager ca. 20 minutter. De hemmelige nøgler står i filen
**HEMMELIGE-NOEGLER.md** i projektets filer hos Claude (ikke i GitHub).

Supabase-projekt: `https://zkicdizuvkkcjowbvrvj.supabase.co`
Appens adresse, når den er online: **https://petergrostoel.github.io/MS-Kompasset/**

## 1. Databasen

1. Åbn Supabase → dit projekt → **SQL Editor** → **New query**.
2. Kopiér hele indholdet af `supabase/migrations/20261113090000_init.sql` ind, og tryk **Run**.
   Der skal stå "Success". Filen kan køres igen uden at skade noget.

## 2. Login

1. **Authentication → URL Configuration**: sæt *Site URL* til `https://petergrostoel.github.io/MS-Kompasset/`
   og tilføj samme adresse under *Redirect URLs*. Så virker linket i bekræftelsesmailen.
2. (Senere, når I begge har oprettet jer: **Authentication → Sign In / Providers** → slå
   *Allow new users to sign up* fra, så ingen andre kan oprette sig.)

## 3. Serverfunktionerne (notifikationer og analyse)

Funktionerne sendes automatisk til Supabase fra GitHub, når du har givet GitHub en nøgle:

1. Lav en nøgle i Supabase: klik på dit profilbillede → **Account preferences → Access Tokens**
   (eller gå til supabase.com/dashboard/account/tokens) → **Generate new token**. Kopiér den.
2. I GitHub: repoet **MS-Kompasset → Settings → Secrets and variables → Actions → New repository secret**.
   Navn: `SUPABASE_ACCESS_TOKEN`, værdi: nøglen.
3. Gå til fanen **Actions → Deploy Supabase-funktioner → Run workflow**. Efter et minut er den grøn.

(Har du Supabase CLI fra vinappen, kan du i stedet køre
`supabase functions deploy notify --project-ref zkicdizuvkkcjowbvrvj` og det samme for `analyze-notes`.)

## 4. Hemmeligheder til funktionerne

Supabase → **Edge Functions → Secrets**: tilføj de fem værdier fra **HEMMELIGE-NOEGLER.md**
(`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `ANTHROPIC_API_KEY`).

`ANTHROPIC_API_KEY` er din egen nøgle fra console.anthropic.com. Den bruges kun, når Ditte trykker
"Lav analyse" under Noter. Hver analyse koster typisk under 10 øre.

## 5. Påmindelser hvert minut

Supabase → **SQL Editor** → kør SQL'en fra afsnittet "Cron-job" i **HEMMELIGE-NOEGLER.md**.
Den starter et job, der hvert minut spørger serverfunktionen, om der skal sendes påmindelser.

Tjek efter et par minutter med:
```sql
select status_code, content, created from net._http_response order by created desc limit 5;
```
Der skal stå `200` og fx `{"planned":0,"sent":0,"failed":0}`.

## 6. Læg appen online (GitHub Pages)

GitHub → repoet → **Settings → Pages** → *Source*: **Deploy from a branch**, *Branch*: `main` og `/ (root)` → **Save**.
Efter et par minutter ligger appen på https://petergrostoel.github.io/MS-Kompasset/

## 7. På jeres iPhones

1. Åbn adressen i **Safari** → tryk **Del** → **Føj til hjemmeskærm**. Åbn appen fra hjemmeskærmen.
2. Ditte: **Opret konto**, bekræft via mailen, log ind. Vælg "Jeg har MS", skriv navn, **Opret nyt hjem**.
   Under Indstillinger står nu en kode på 6 tegn.
3. Peter: **Opret konto**, log ind, vælg "Jeg er pårørende", skriv navn, **Jeg har en kode**, skriv koden.
4. Begge: **Indstillinger (tandhjulet) → Slå notifikationer til** → Tillad. Tryk **Send en test**.
5. Apple Watch: notifikationerne vises på uret, når iPhonen er låst, og uret er på håndleddet.
   Tjek evt. Watch-appen på iPhonen → **Notifikationer** → at MS Kompasset må spejles.

## Prøv appen uden login

https://petergrostoel.github.io/MS-Kompasset/?demo viser appen med testdata fra prototypen.
Intet gemmes online, og man kan skifte mellem Ditte og Peter under Indstillinger.

## Godt at vide

- **Lyd**: notifikationer bruger iPhonens normale notifikationslyd. Er appen åben, spiller den sin egen klokke.
- **Opdateringer** af appen sker af sig selv, når der lægges ny kode på GitHub.
- **Logo**: se `branding/README.md`.
