// Faste lister: aktiviteter, energiniveauer og sunde råvarer.

/** Aktiviteter. k = drain (tager energi) eller gain (giver energi). */
export const ACT = {
  solo: { l: "Arbejde alene", k: "drain", def: 90 },
  mode: { l: "Arbejdsmøde", k: "drain", def: 45 },
  transport: { l: "Transport", k: "drain", def: 60 },
  rengoring: { l: "Rengøring / aktiv", k: "drain", def: 45 },
  gaester: { l: "Få gæster", k: "drain", def: 90 },
  mange: { l: "Mange gæster", k: "drain", def: 50 },
  byen: { l: "I byen", k: "drain", def: 60 },
  event: { l: "Koncert / event", k: "drain", def: 60 },
  rejse: { l: "Rejse", k: "drain", def: 75 },
  samtale: { l: "Samtale", k: "drain", def: 60 },
  spis: { l: "Spisning", k: "gain" },
  hvil: { l: "Pause", k: "gain" },
  pause: { l: "Hjernepause", k: "gain", check: 15 }, // spørger efter 15 min om hun er færdig
  fast: { l: "Fast pause", k: "gain", hidden: true }, // startes kun fra påmindelsen
};

export const DRAIN = Object.keys(ACT).filter((k) => ACT[k].k === "drain");
export const GAIN_START = ["spis", "hvil", "pause"];

export const LV = { 5: "Fuld af energi", 4: "Godt med energi", 3: "Middel", 2: "Træt", 1: "Helt udmattet" };

export const MOODS = {
  balance: { l: "I balance", c: 4 },
  hard: { l: "Hård", c: 2 },
  energy: { l: "Masser af energi", c: 5 },
};

export const CATS = {
  veg: { l: "Grøntsager", s: "Grønt", i: "veg" },
  fruit: { l: "Frugt", s: "Frugt", i: "fruit" },
  leg: { l: "Bælgfrugter", s: "Bælg", i: "leg", key: true },
  nut: { l: "Nødder & kerner", s: "Nødder", i: "nut", key: true },
  grain: { l: "Fuldkorn & andet", s: "Korn m.m.", i: "grain" },
};

export const PROT = { fish: "Fisk", meat: "Kød", poultry: "Fjerkræ" };

const RAW = {
  veg: "Tomat,Agurk,Gulerod,Broccoli,Blomkål,Spidskål,Hvidkål,Rødkål,Grønkål,Rosenkål,Savojkål,Spinat,Salat,Rucola,Løg,Rødløg,Skalotteløg,Porre,Hvidløg,Forårsløg,Peberfrugt,Chili,Squash,Aubergine,Kartoffel,Søde kartofler,Rødbede,Pastinak,Persillerod,Knoldselleri,Bladselleri,Fennikel,Asparges,Champignon,Shiitake,Østershatte,Kantareller,Majs,Ærter,Sukkerærter,Grønne bønner,Græskar,Radiser,Ingefær,Pak choi,Jordskokker,Kålrabi,Glaskål,Artiskok,Persille,Basilikum,Koriander,Dild,Mynte,Purløg,Timian,Rosmarin,Oregano,Tang",
  fruit: "Æble,Pære,Banan,Appelsin,Mandarin,Grapefrugt,Citron,Lime,Kiwi,Ananas,Mango,Blåbær,Hindbær,Jordbær,Brombær,Solbær,Ribs,Stikkelsbær,Kirsebær,Blommer,Fersken,Nektarin,Vindruer,Melon,Vandmelon,Granatæble,Avocado,Rosiner,Dadler,Figner,Abrikoser,Tranebær,Papaya,Passionsfrugt,Rabarber,Oliven",
  leg: "Kidneybønner,Kikærter,Edamamebønner,Sorte bønner,Hvide bønner,Røde linser,Grønne linser,Belugalinser,Brune bønner,Limabønner,Mungbønner,Tofu,Tempeh,Flækærter,Borlottibønner,Hestebønner,Sojabønner",
  nut: "Mandler,Valnødder,Hasselnødder,Cashewnødder,Pistacienødder,Pekannødder,Paranødder,Macadamia,Peanuts,Græskarkerner,Solsikkekerner,Hørfrø,Chiafrø,Sesamfrø,Hampefrø,Pinjekerner,Kokos",
  grain: "Havregryn,Rugbrød (fuldkorn),Fuldkornspasta,Brune ris,Vilde ris,Quinoa,Bulgur,Perlebyg,Boghvede,Hirse,Spelt,Mørk chokolade,Kakao,Rugkerner,Byggryn,Fuldkornsmel,Popcorn",
};

/** Standardråvarer: navn → kategori */
export const BASE_FOODS = {};
for (const [c, s] of Object.entries(RAW)) for (const n of s.split(",")) BASE_FOODS[n] = c;
