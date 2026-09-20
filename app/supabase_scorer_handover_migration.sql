-- Scorer handover: lets the person scoring a match pass scoring to someone else via a one-time code.
--   scorer_code  : set when the current scorer taps "Hand over"; cleared when someone redeems it
--   scorer_epoch : bumped on every takeover; the previous scorer's device is rejected (409) once it is stale
alter table matches add column if not exists scorer_code  text;
alter table matches add column if not exists scorer_epoch integer not null default 0;
create unique index if not exists matches_scorer_code_idx on matches(scorer_code) where scorer_code is not null;
