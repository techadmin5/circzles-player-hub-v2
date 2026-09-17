-- Phase 3I-A historical coupon compatibility preflight.
-- Run manually against Neon DEVELOPMENT before applying migration 0017.
-- This script is read-only and intentionally performs no backfill.

begin transaction isolation level repeatable read read only;

-- Canonical coupon definitions.
select
  count(*) as coupon_reward_definition_count
from reward_definitions
where reward_type = 'COUPON';

-- Migration decision summary. Schema-only migration is safe only when all
-- historical inventory ownership values below are zero.
select
  count(*) as coupon_inventory_row_count,
  coalesce(sum(pii.quantity), 0) as coupon_inventory_total_quantity,
  count(distinct pii.player_id) as affected_distinct_player_count
from player_inventory_items pii
inner join reward_definitions rd
  on rd.reward_definition_id = pii.reward_definition_id
where rd.reward_type = 'COUPON';

-- Historical audit-row totals.
select
  (
    select count(*)
    from inventory_grants ig
    inner join reward_definitions rd
      on rd.reward_definition_id = ig.reward_definition_id
    where rd.reward_type = 'COUPON'
  ) as coupon_inventory_grant_count,
  (
    select coalesce(sum(ig.quantity), 0)
    from inventory_grants ig
    inner join reward_definitions rd
      on rd.reward_definition_id = ig.reward_definition_id
    where rd.reward_type = 'COUPON'
  ) as coupon_inventory_granted_quantity,
  (
    select count(*)
    from inventory_consumptions ic
    inner join reward_definitions rd
      on rd.reward_definition_id = ic.reward_definition_id
    where rd.reward_type = 'COUPON'
  ) as coupon_inventory_consumption_count,
  (
    select coalesce(sum(ic.quantity), 0)
    from inventory_consumptions ic
    inner join reward_definitions rd
      on rd.reward_definition_id = ic.reward_definition_id
    where rd.reward_type = 'COUPON'
  ) as coupon_inventory_consumed_quantity;

-- Per-player and per-definition ownership detail.
select
  pii.player_inventory_item_id,
  pii.player_id,
  p.public_player_id,
  pii.reward_definition_id,
  rd.code as reward_code,
  rd.name as reward_name,
  pii.quantity,
  pii.first_acquired_at,
  pii.updated_at
from player_inventory_items pii
inner join reward_definitions rd
  on rd.reward_definition_id = pii.reward_definition_id
inner join players p
  on p.player_id = pii.player_id
where rd.reward_type = 'COUPON'
order by pii.player_id, pii.reward_definition_id;

-- Historical coupon grants needed to reconstruct deterministic issuance units.
select
  ig.inventory_grant_id,
  ig.player_id,
  p.public_player_id,
  ig.reward_definition_id,
  rd.code as reward_code,
  ig.source_type,
  ig.source_id,
  ig.quantity,
  ig.idempotency_key,
  ig.created_at
from inventory_grants ig
inner join reward_definitions rd
  on rd.reward_definition_id = ig.reward_definition_id
inner join players p
  on p.player_id = ig.player_id
where rd.reward_type = 'COUPON'
order by ig.player_id, ig.created_at, ig.inventory_grant_id;

-- Historical coupon consumptions, if any, needed to reconcile current quantity
-- with grant history before designing an automatic backfill.
select
  ic.inventory_consumption_id,
  ic.player_id,
  p.public_player_id,
  ic.player_inventory_item_id,
  ic.reward_definition_id,
  rd.code as reward_code,
  ic.quantity,
  ic.quantity_after,
  ic.reason,
  ic.idempotency_key,
  ic.created_at
from inventory_consumptions ic
inner join reward_definitions rd
  on rd.reward_definition_id = ic.reward_definition_id
inner join players p
  on p.player_id = ic.player_id
where rd.reward_type = 'COUPON'
order by ic.player_id, ic.created_at, ic.inventory_consumption_id;

rollback;
