# webMarchipolyGame

**Marchipoly**: joc de cumpărat și închiriat proprietăți, între **4 și 6 jucători**, pe telefon, cu până la
**16 spectatori** pe cameră. Jocul 14 din hub-ul [haiLaTăticu](https://games.hailatat.icu).
Adresă: **https://games.hailatat.icu/marchipoly**

> Stare: schelet. Jocul e în lucru; acum se vede doar o pagină „în curând”.

## Ce va avea
- Host-ul creează camera și alege banii de start ai fiecărui jucător, licitația (pornită/oprită), timpul pe tură și
  finalul jocului (până rămâne unul nefalimentat sau limită de timp, câștigă averea netă cea mai mare).
- Proprietăți, chirii, case și hoteluri construite uniform, închisoare, cartonașe, ipoteci, schimburi între jucători,
  banii din taxe strânși la Parcare. Tablă, nume și texte proprii.
- Fiecare jucător se vede jos, ceilalți 3–5 sus, în ordinea în care urmează după el. Spectatorii aleg pe cine văd jos
  sau privesc toată tabla.

## Stack
Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast, tabele `marchipoly_`), Vercel `fra1`,
`basePath: "/marchipoly"` (hub-ul face proxy pe `/marchipoly/*`).

## Setup Vercel
1. Import `florin2495/webMarchipolyGame`, numele proiectului `014_web-marchipoly-game`
   (domeniul devine `014web-marchipoly-game.vercel.app`).
2. Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   (aceleași ca la celelalte jocuri).
3. Deploy. `vercel.json` fixează framework-ul și regiunea `fra1`.
