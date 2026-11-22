import type { GameView, Settings } from "./marchipoly";

export type RoomStatus = "lobby" | "playing" | "finished";
/** "observer" = spectator in the UI. */
export type Role = "player" | "observer";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  role: Role;
  /** Ms left of a pending kick (host kicked this player during a game), null when none. */
  kickRemainingMs: number | null;
  /** Seen in the last 301 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
  /** Spectator waiting for the next game ("Intră în jocul următor"). */
  queued: boolean;
}

/** What a member sees of the running game: everything but the order of the card decks. */
export interface PublicGame extends GameView {
  /** My seat, or null for spectators. */
  mySeat: number | null;
  /** Seat that has to act now (null when the game is over). */
  actor: number | null;
  /** Identifies the current decision, sent back with a timeout / skip. */
  turnKey: string;
  /** ms epoch when the current decision is played automatically. */
  turnDeadline: number | null;
}

/** What GET /api/rooms/[code]/state returns to a member. */
export interface RoomState {
  /** Room write counter: a state older than the one on screen is never shown. */
  version: number;
  room: {
    id: string;
    code: string;
    name: string;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
    settings: Settings;
  };
  /** Seat order while a game exists (spectators last), join order in the lobby. */
  players: PublicPlayer[];
  me: PublicPlayer;
  game: PublicGame | null;
  /** Server clock, to correct timers on devices with a wrong clock. */
  serverNow: number;
  /** Client only: serverNow minus the device clock when this state arrived. */
  clockOffset?: number;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  status: RoomStatus;
  hasPassword: boolean;
  players: number;
  observers: number;
  settings: Settings;
}

export interface Session {
  playerId: string;
  token: string;
}
