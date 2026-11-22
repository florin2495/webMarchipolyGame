import { type Action, act, parseAction, RuleError } from "@/lib/marchipoly";
import { secureRandom } from "@/lib/server/crypto";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

/** A malformed action is a bad request (400); a well-formed one that breaks the rules is a 409 later. */
function parse(body: unknown): Action {
  try {
    return parseAction(body);
  } catch (err) {
    if (err instanceof RuleError) fail(400, err.message);
    throw err;
  }
}

// POST /api/rooms/[code]/action  { kind, square?, amount?, to?, give?, get? } - every move of a seated player:
// roll, payJail, useCard, buy, decline, bid, pass, build, sell, mortgage, unmortgage, pay, bankrupt, end,
// propose (trade), accept, reject, cancel. The rules in lib/marchipoly.ts decide whether it is allowed now.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/action">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "action", (game, { seat, body, now }) => {
    if (seat < 0) fail(403, "Ești spectator: nu joci în acest joc.");
    return act(game, seat, parse(body), now, secureRandom);
  });
}
