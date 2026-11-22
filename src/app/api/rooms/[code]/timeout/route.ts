import { forceAction, TIMEOUT_GRACE_MS, turnDeadline, turnKey } from "@/lib/marchipoly";
import { secureRandom } from "@/lib/server/crypto";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/timeout  { turn } - plays the current decision for a player who did not act:
//  - the turn timer ran out (anyone's device may trigger it): roll, decline the purchase, pass the auction,
//    reject the trade, end the turn, or raise the money for a debt (bankrupt if it cannot be raised);
//  - before that, only the host, to skip a stalled player.
// `turn` (see turnKey) makes a late or repeated request a no-op instead of skipping the next decision.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/timeout">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "timeout", (game, { isHost, body, now }) => {
    if (body.turn !== turnKey(game)) fail(409, "Tura s-a schimbat deja.");
    const deadline = turnDeadline(game);
    const expired = deadline !== null && now >= deadline + TIMEOUT_GRACE_MS;
    if (!expired && !isHost) fail(403, "Doar host-ul poate sări tura înainte de expirarea timpului.");
    return forceAction(game, now, secureRandom, expired ? "timeout" : "host");
  });
}
