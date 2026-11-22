import { HOTEL_SUPPLY, HOUSE_SUPPLY, JAIL_FINE, SALARY } from "@/lib/board";
import { MAX_OBSERVERS, MAX_PLAYERS, MIN_PLAYERS } from "@/lib/marchipoly";

/** Short rules, collapsed by default. */
export function Rules() {
  return (
    <details className="text-sm text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer font-semibold">Reguli</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Joacă între {MIN_PLAYERS} și {MAX_PLAYERS} prieteni, fiecare pe telefonul lui; până la {MAX_OBSERVERS} spectatori pot privi. Host-ul alege
          cu câți bani începe fiecare, salariul de la Start, dacă se face licitație, timpul pe decizie și cum se termină jocul.
        </li>
        <li>
          La rândul tău dai cu două zaruri și muți piesa. Cu o dublă mai dai o dată; a treia dublă la rând te trimite la închisoare. Când treci pe la
          Start încasezi salariul ales de host (implicit {SALARY}).
        </li>
        <li>
          Pe un oraș, o gară sau o uzină fără proprietar o poți cumpăra. Dacă nu vrei, se licitează între toți (dacă licitația e pornită) sau
          rămâne la bancă.
        </li>
        <li>
          Pe proprietatea altcuiva plătești chirie. Cine are toată regiunea (aceeași culoare) ia chirie dublă și poate construi case, uniform,
          până la 4 pe fiecare oraș, apoi un hotel. Banca are doar {HOUSE_SUPPLY} de case și {HOTEL_SUPPLY} hoteluri; clădirile se vând înapoi la
          jumătate de preț.
        </li>
        <li>
          Gările iau 25, 50, 100 sau 200, după câte are proprietarul. Uzinele iau de 4 ori zarurile, sau de 10 ori dacă proprietarul le are pe
          amândouă.
        </li>
        <li>
          Ipotecă: iei jumătate din preț, dar nu mai încasezi chirie pe ea până o răscumperi (cu 10% în plus). Poți ipoteca doar dacă regiunea nu
          are clădiri. Cine primește o proprietate ipotecată (prin schimb sau la faliment) plătește imediat băncii 10% din ipotecă.
        </li>
        <li>
          Schimburi: în tura ta propui unui jucător proprietăți (fără clădiri în regiune), bani sau cărți de ieșire din închisoare; el acceptă
          sau refuză.
        </li>
        <li>
          Taxele, amenzile și plățile din cărți se strâng la <b>Parcare</b>. Cine se oprește acolo le ia pe toate.
        </li>
        <li>
          Din închisoare ieși cu o dublă (ai 3 încercări, apoi plătești {JAIL_FINE}), plătind {JAIL_FINE} sau cu o carte de ieșire. În închisoare
          încasezi chirie ca de obicei.
        </li>
        <li>
          Dacă nu ai bani de plată, vinzi clădiri, ipotechezi sau faci un schimb. Dacă tot nu ajung, dai faliment: dacă datorai unui jucător, el
          ia tot ce aveai; altfel proprietățile se întorc la bancă.
        </li>
        <li>
          Finalul: fie până rămâne un singur jucător, fie cu limită de timp. La limită se termină runda începută și câștigă averea cea mai mare
          (bani, proprietăți la preț, cele ipotecate la jumătate, clădiri la cost).
        </li>
        <li>
          Fiecare decizie are un timp (îl alege host-ul). Când expiră, jocul o ia automat: dă cu zarul, nu cumpără, renunță la licitație, refuză
          schimbul, încheie tura sau strânge banii pentru datorie. Cine pleacă din joc dă faliment.
        </li>
      </ol>
    </details>
  );
}
