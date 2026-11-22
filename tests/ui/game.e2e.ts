// Two real browsers (= two phones) and two API bots play a live game: every decision shows "Tura ta" on the
// actor's screen and "Tura lui <name>" on the others, without a reload. Then everyone else leaves, the host
// wins, sees the standings and starts a new game.
import { expect, test } from "@playwright/test";
import { createRoom, joinBot, joinRoom, leaveAll, leaveBot, playSteps, REALTIME_MS, startGame, withPlayers } from "./helpers";

test("4 players: turns live on every screen, standings, new game", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [ana, bob] = players;
    room.code = await createRoom(ana);
    await joinRoom(bob, room.code);
    const bots = [await joinBot(room.code, "Cip"), await joinBot(room.code, "Dan")];
    await startGame(players, 4);

    // My own panel is at the bottom; the 3 others are on top.
    await expect(ana.page.getByTestId("my-panel")).toContainText("Ana");
    await expect(ana.page.getByTestId("player-strip").locator("[data-testid^=player-]")).toHaveCount(3);
    await expect(bob.page.getByTestId("my-panel")).toContainText("Bob");

    await playSteps(room.code, players, bots, 16);

    // Everyone but the host leaves: the host is the last one standing.
    for (const b of bots) await leaveBot(room.code, b);
    await leaveAll([bob]);
    await expect(ana.page.getByTestId("standings")).toContainText("Ana a câștigat!", { timeout: REALTIME_MS });

    await ana.page.getByTestId("new-game").click();
    await expect(ana.page.getByTestId("start-game")).toBeVisible({ timeout: REALTIME_MS });
    await leaveAll([ana]);
    room.closed = true;
  });
});
