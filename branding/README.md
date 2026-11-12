# Logo og ikoner

Alt, der har med logoet at gøre, ligger i denne mappe. Koden skal ikke ændres, når logoet skiftes.

| Fil | Bruges til | Størrelse |
|---|---|---|
| `logo.png` | Logoet inde i appen (i toppen og på login-skærmen) | 512 × 512 px, kvadratisk |
| `icon-180.png` | Ikonet på iPhonens hjemmeskærm | 180 × 180 px |
| `icon-192.png` | Ikon til notifikationer og Android | 192 × 192 px |
| `icon-512.png` | Stort ikon (fx ved installation) | 512 × 512 px |
| `logo-placeholder.svg` | Pladsholderen (kompasset), som filerne ovenfor er lavet ud fra | |

## Sådan skifter du til det rigtige logo

1. Læg dit logo i denne mappe med de fire filnavne ovenfor (samme navne, PNG, kvadratiske).
   Har du kun én stor PNG, kan ikonerne laves automatisk: `node scripts/make-icons.mjs sti/til/logo.png`
   (kræver Node og `npm i -D playwright`). Eller send logoet til Claude, så laver den filerne.
2. Læg filerne op på GitHub (commit og push).
3. Logoet inde i appen skifter af sig selv næste gang appen åbnes.
4. Ikonet på hjemmeskærmen gemmer iPhonen, da appen blev lagt der. Det nye ikon kommer frem,
   når appen fjernes fra hjemmeskærmen og lægges på igen (Del → Føj til hjemmeskærm). Data forsvinder ikke.

Tip: iPhone runder selv hjørnerne på ikonet, så brug et fyldt, kvadratisk billede uden gennemsigtighed.
