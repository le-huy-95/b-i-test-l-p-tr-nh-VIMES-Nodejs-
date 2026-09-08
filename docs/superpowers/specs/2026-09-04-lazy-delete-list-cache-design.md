# Lazy delete list/report cache (phương án B)

**Date:** 2026-09-04  
**Status:** Implemented

## Goal

Khi create / update / delete: chỉ **xóa** cache Redis liên quan.  
Khi gọi API list/report: miss → query DB → `set` lại (`getOrSet`).

Không eager refresh, không Redis Stream sync cho list cache (Redis đã shared).

## Behavior

| Event | Action |
|-------|--------|
| Write (master / stock docs / stock mutations) | `invalidatePattern` theo prefix + tenant |
| Read list/report | `getOrSet` — hit trả cache, miss load DB rồi ghi cache |

## Changes

- `cache-invalidation.ts`: chỉ `invalidatePattern`; bỏ refresh handlers + publish stream
- Services (product, customer, supplier, warehouse, contact, report): bỏ `refreshListCache` / `registerCacheRefreshHandler`
- `index.ts`: không start cache invalidation stream consumer
- `ListCache`: bỏ `refreshPattern`
- `redis-streams.ts`: giữ file, không wire

## Out of scope

- Permission cache (`redis-permission-cache`) — cơ chế riêng, không đổi
