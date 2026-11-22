# webMarchipolyGame

**Marchipoly**: joc de cumpărat și închiriat proprietăți, între **4 și 6 jucători**, pe telefon, cu până la
**16 spectatori** pe cameră. Jocul 14 din hub-ul [haiLaTăticu](https://games.hailatat.icu).
Adresă: **https://games.hailatat.icu/marchipoly**


## Pe scurt
- Host-ul creează camera și alege banii de start ai fiecărui jucător, licitația (pornită/oprită), timpul pe tură și
  finalul jocului (până rămâne unul nefalimentat sau limită de timp, câștigă averea netă cea mai mare).
- Proprietăți, chirii, case și hoteluri construite uniform, închisoare, cartonașe, ipoteci, schimburi între jucători,
  banii din taxe strânși la Parcare. Tablă, nume și texte proprii.
- Fiecare jucător se vede jos, ceilalți 3–5 sus, în ordinea în care urmează după el. Spectatorii aleg pe cine văd jos
  sau privesc toată tabla.

## Reguli

1. Host-ul creează camera și alege: banii de start (500–10.000, din 100 în 100), salariul de la Start (0–2.000, din 50 în 50, implicit 200), licitația (pornită / oprită), timpul pe
   decizie (30 s – 2 min) și finalul (până rămâne unul, sau limită de timp 30–180 min). Le poate schimba în lobby.
2. Jocul pornește cu 4–6 jucători. Ordinea: host-ul primul, apoi ordinea din lobby (host-ul o poate aranja).
   Cine intră după start e spectator; spectatorii se pot pune la coadă pentru jocul următor.
3. La rând dai cu două zaruri. Dublă = mai dai o dată; a treia dublă la rând = închisoare. Treci pe la Start: +200.
4. Pe o proprietate fără proprietar: o cumperi la preț sau o refuzi. Refuzată: licitație între toți (de la 1 leu,
   oricine poate urca cu cel puțin 1 leu) dacă e pornită; altfel rămâne la bancă și jocul merge mai departe.
5. Chirie: de bază; dublă pentru toată regiunea; cu case (1–4) și hotel după tabel. Gări: 25 / 50 / 100 / 200. Uzine:
   de 4 ori zarurile, de 10 ori cu amândouă.
6. Construiești doar cu toată regiunea, fără ipoteci în ea, uniform. Banca are 32 de case și 12 hoteluri. Clădirile se
   vând înapoi la jumătate.
7. Ipotecă: primești jumătate din preț, nu mai iei chirie pe ea; răscumperi cu 10% în plus. Cine primește o proprietate
   ipotecată (prin schimb sau la faliment) plătește imediat băncii 10% dobândă din valoarea ipotecii.
8. Schimburi: în tura ta (sau când ai o datorie) propui proprietăți fără clădiri în regiune, bani și cărți de ieșire
   din închisoare; celălalt acceptă sau refuză.
9. Impozitul pe venit: alegi între 200 și 10% din avere (bani + proprietăți la preț, chiar și ipotecate + clădiri la
   cost, rotunjit în jos); înainte să alegi îți poți calcula averea. Taxa de lux: 100. Taxele, amenzile și plățile din
   cărți merg la Parcare; cine se oprește acolo le ia.
10. Închisoare: ieși cu dublă (3 încercări, apoi plătești 50 și muți), plătind 50 sau cu o carte.
11. Datorii: vinzi, ipotechezi, schimbi; dacă nu ajunge, faliment. Datorai unui jucător: el ia tot. Băncii: proprietățile
    se întorc la bancă (și se licitează, dacă licitația e pornită). Cine pleacă din joc dă faliment.
12. Timp pe decizie: la expirare jocul decide automat (dă cu zarul, nu cumpără, renunță la licitație, refuză schimbul,
    încheie tura, strânge banii sau declară faliment). Host-ul poate sări peste un jucător blocat.
13. Final cu limită de timp: după limită se termină runda începută; câștigă averea cea mai mare (bani, proprietăți la
    preț, ipotecate la jumătate, clădiri la cost).

## Stack
Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast, tabele `marchipoly_`), Vercel `fra1`,
`basePath: "/marchipoly"` (hub-ul face proxy pe `/marchipoly/*`).

## Setup Vercel
1. Import `florin2495/webMarchipolyGame`, numele proiectului `014_web-marchipoly-game`
   (domeniul devine `014web-marchipoly-game.vercel.app`).
2. Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (aceleași ca la celelalte jocuri).
3. Deploy. `vercel.json` fixează framework-ul și regiunea `fra1`.
4. Supabase: `supabase/schema.sql` rulat o dată în SQL Editor (creează doar `marchipoly_rooms` și `marchipoly_players`).

## Teste
Doar în GitHub Actions (manual): „Check code”, „Unit tests”, „E2E”, „E2E UI (Playwright)”. Vezi `CLAUDE.md`.
