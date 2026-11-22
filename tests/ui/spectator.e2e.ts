// A spectator joins mid-game: no action bar, sees every turn live, switches between "Toată tabla" and any
// player at the bottom, and queues for the next game.
import { expect, test } from "@playwright/test";
import { createRoom, joinBot, joinRoom, leaveAll, leaveBot, playSteps, REALTIME_MS, startGame, withPlayers } from "./helpers";

test("spectator: live turns, view switcher, queue", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "desktop only");
  await withPlayers(browser, ["Ana", "Spec"], async (players, room) => {
    const [ana, spec] = players;
    room.code = await createRoom(ana);
    const bots = [await joinBot(room.code, "Bob"), await joinBot(room.code, "Cip"), await joinBot(room.code, "Dan")];
    await startGame([ana], 4);

    await joinRoom(spec, room.code, "observer");
    await expect(spec.page.getByTestId("observer-panel")).toBeVisible();
    await expect(spec.page.getByTestId("action-bar")).toHaveCount(0);

    // "Toată tabla": nobody at the bottom, all 4 on top.
    await expect(spec.page.getByTestId("my-panel")).toHaveCount(0);
    await expect(spec.page.getByTestId("player-strip").locator("[data-testid^=player-]")).toHaveCount(4);
    // Pick Bob: Bob at the bottom, the other 3 on top.
    await spec.page.getByTestId("view-switcher").getByText("Bob").click();
    await expect(spec.page.getByTestId("my-panel")).toContainText("Bob");
    await expect(spec.page.getByTestId("player-strip").locator("[data-testid^=player-]")).toHaveCount(3);
    await spec.page.getByTestId("view-all").click();
    await expect(spec.page.getByTestId("my-panel")).toHaveCount(0);

    await playSteps(room.code, [ana], bots, 8, [spec]);

    await spec.page.getByTestId("queue-toggle").click();
    await expect(spec.page.getByTestId("observer-panel")).toContainText("Ești la coadă", { timeout: REALTIME_MS });

    for (const b of bots) await leaveBot(room.code, b);
    await expect(spec.page.getByTestId("standings")).toContainText("Ana a câștigat!", { timeout: REALTIME_MS });
    await ana.page.getByTestId("new-game").click();
    // The queued spectator is seated for the next game.
    await expect(spec.page.getByTestId("lobby-players")).toContainText("Spec", { timeout: REALTIME_MS });
    await leaveAll([spec, ana]);
    room.closed = true;
  });
});
