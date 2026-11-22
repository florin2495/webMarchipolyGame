-- Marchipoly (property trading, 4-6 players + up to 16 spectators) - Supabase schema
-- Every object is prefixed with marchipoly_ because the Supabase project is shared by all hailatat.icu
-- mini-games. Keep the prefix on anything new: tables, constraints, indexes.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It is idempotent; re-running drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- marchipoly_rooms: one row per room. The whole running game (board, money, deeds, houses, cards, trades,
-- auctions) lives in `game` as jsonb and is only ever read by the server. `version` is an optimistic lock:
-- every write is "update ... where version = <read value>", so two actions at once cannot both apply.
-- ---------------------------------------------------------------------------
create table if not exists public.marchipoly_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null
                   constraint marchipoly_rooms_code_key unique
                   constraint marchipoly_rooms_code_check check (code ~ '^[A-Z2-9]{6}$'),
  name             text not null constraint marchipoly_rooms_name_check check (char_length(name) between 1 and 40),
  password_hash    text,                                     -- scrypt hash, null = no password
  status           text not null default 'lobby'
                   constraint marchipoly_rooms_status_check check (status in ('lobby', 'playing', 'finished')),
  round            integer not null default 1 constraint marchipoly_rooms_round_check check (round >= 1),  -- game number in this room
  host_player_id   uuid,
  settings         jsonb not null default '{}'::jsonb,       -- starting money, auctions on/off, turn timer, end mode
  game             jsonb,                                    -- null in the lobby
  version          integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()        -- idle rooms are deleted lazily
);
create index if not exists marchipoly_rooms_status_activity_idx on public.marchipoly_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- marchipoly_players: members of a room, players (4-6 per game) and spectators (role 'observer', max 16).
-- Identity = random token kept by the browser, only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.marchipoly_players (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null constraint marchipoly_players_room_id_fkey references public.marchipoly_rooms (id) on delete cascade,
  nickname          text not null constraint marchipoly_players_nickname_check check (char_length(nickname) between 1 and 20),
  token_hash        text not null constraint marchipoly_players_token_hash_key unique,
  is_host           boolean not null default false,
  role              text not null default 'player' constraint marchipoly_players_role_check check (role in ('player', 'observer')),
  joined_at         timestamptz not null default now(),
  kick_requested_at timestamptz,                             -- pending kick during a game (null = none)
  last_seen_at      timestamptz not null default now(),      -- presence: rejoin the same seat
  device_hash       text,                                    -- sha256 of the browser's device id
  seat              integer,                                 -- host-chosen order of the players
  queued_at         timestamptz                              -- spectator queued for the next game
);
create unique index if not exists marchipoly_players_room_nickname_uq on public.marchipoly_players (room_id, lower(nickname));
create index if not exists marchipoly_players_room_idx on public.marchipoly_players (room_id);
create index if not exists marchipoly_players_room_seen_idx on public.marchipoly_players (room_id, last_seen_at);

do $$ begin
  alter table public.marchipoly_rooms
    add constraint marchipoly_rooms_host_fk foreign key (host_player_id) references public.marchipoly_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write nothing.
-- Only the service role (the Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.marchipoly_rooms   enable row level security;
alter table public.marchipoly_players enable row level security;

revoke all on public.marchipoly_rooms, public.marchipoly_players from anon, authenticated;

-- Let the Data API (PostgREST) see the new tables immediately.
notify pgrst, 'reload schema';

-- Check: should list the 2 marchipoly_ tables, both with rowsecurity = true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'marchipoly\_%' order by 1;
