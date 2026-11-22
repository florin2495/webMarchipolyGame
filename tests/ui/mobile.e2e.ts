// Phone layout: no sideways scrolling on home / lobby / game, big enough buttons, and a touch tap plays a move.
import { expect, test } from "@playwright/test";
import { createRoom, expectNoHorizontalScroll, gameState, joinBot, leaveAll, leaveBot, playSteps, startGame, withPlayers } from "./helpers";

test("phone: layout and touch", async ({ browser }) => {
  test.skip(test.info().project.name !== "iphone-webkit", "iPhone only");
  await withPlayers(browser, ["Ana"], async (players, room) => {
    const [ana] = players;
    await ana.page.goto("./");
    await expectNoHorizontalScroll(ana.page);
    room.code = await createRoom(ana);
    await expectNoHorizontalScroll(ana.page);
    const bots = [await joinBot(room.code, "Bob"), await joinBot(room.code, "Cip"), await joinBot(room.code, "Dan")];
    await startGame([ana], 4);
    await expectNoHorizontalScroll(ana.page);

    // Ana sits first: her screen has the roll button.
    const roll = ana.page.getByTestId("act-roll");
    await expect(roll).toBeVisible();
    const box = await roll.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
    const [res] = await Promise.all([ana.page.waitForResponse((r) => r.url().includes("/action")), roll.tap()]);
    expect(res.status()).toBe(200);
    const { game } = await gameState(room.code, bots[0]);
    expect(game!.phase).not.toBe("over");

    // A square opens its card.
    await ana.page.getByTestId("square-39").tap();
    await expect(ana.page.getByTestId("property-dialog")).toContainText("Primăverii");
    await ana.page.getByTestId("property-dialog").getByText("Închide").tap();

    await playSteps(room.code, [ana], bots, 6);
    await expectNoHorizontalScroll(ana.page);

    for (const b of bots) await leaveBot(room.code, b);
    await leaveAll([ana]);
    room.closed = true;
  });
});
