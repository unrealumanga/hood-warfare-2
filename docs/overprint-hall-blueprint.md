# Overprint Hall blueprint

Written before implementation, 2026-11-25. Coordinates are metres; feet are y=0,
negative z is north, UPPER_Y=3.6. Bell Yard remains the default.

## Intent and plan

A 52 × 44 m indoor newspaper press room. A stationary central press interrupts
long shots through the direct printing aisle. The west packing flank has tight
pallet cover; the east dispatch lane is wider. Two partial maintenance galleries
are reached independently by stairs. A six-metre gap between them accepts a
Sketch Plank, making a useful shortcut without making objectives inaccessible.
Grapple brackets offer alternate access. Movable explosive barrels stay in side
bays. A marked north-east dispatch shutter reserves the boss entrance. The
health booster sits at the centre press's accessible south console.

```
                        NORTH (-z)
     x -26       -16      -8   0   8      16       26
z -22 +-----------------------------------SHUTTER--+
      |            north cross aisle        B     |
  -17 | PACKING     +------G--:--G------+  DISPATCH |
      | flank      | west : gap: east |   lane    |
  -10 |     wall   +--S---+ : +---S---+            |
      | PPP |        S    PRESS    S       PP     |
    0 | bay :door    S    PRESS    S              |
      |  b  |             PRESS          PP      |
    6 |                 H / M0            b      |
      |      direct printing aisle               |
   16 | C C C    south cross aisle    M1    V V V |
   22 +------------------------------------------+
         |-----| 10 m; diagram labels approximate
```

C/V: crew spawns; S: stairs; G: galleries; ':' gallery gap / packing door;
PPP/PP: newsprint pallets; b: barrels; H: booster; B: boss entry.

## Exact geometry

AABBs are listed as x range / y range / z range. All are solid unless noted.

| ID | x | y | z | kind / signage |
|---|---|---|---|---|
| hall_floor | -26..26 | -1..0 | -22..22 | ground |
| hall_west | -26..-25.5 | 0..9 | -22..22 | building, PACKING / +x |
| hall_east | 25.5..26 | 0..9 | -22..22 | building, DISPATCH / -x |
| hall_south | -26..26 | 0..9 | 21.5..22 | building, OVERPRINT HALL / -z |
| hall_north_w | -26..14 | 0..9 | -22..-21.5 | building |
| hall_north_e | 20..26 | 0..9 | -22..-21.5 | building |
| dispatch_shutter | 14..20 | 0..5 | -22..-21.5 | cover, DISPATCH 02 / +z |
| shutter_lintel | 14..20 | 5..9 | -22..-21.5 | building |
| hall_roof | -26..26 | 9..9.4 | -22..22 | canopy |
| centre_press | -3..3 | 0..2.8 | -6..3 | cover, PRESS 01 / +z |
| packing_wall_n | -12..-11 | 0..3 | -11..-2 | cover |
| packing_wall_s | -12..-11 | 0..3 | 2..9 | cover |
| packing_pallet | -21..-18 | 0..1.4 | -6..2 | cover |
| dispatch_pallet_n | 19..21 | 0..1.4 | -7..-3 | cover |
| dispatch_pallet_s | 19..21 | 0..1.4 | 4..8 | cover |
| gallery_w | -10..-3 | 3.2..3.6 | -17..-10 | deck |
| gallery_e | 3..10 | 3.2..3.6 | -17..-10 | deck |

Stairs: two flights centred x=-8,+8, width 2.8, climbing north from
z=-2 to -10. For i=0..11 each AABB has x=center±1.4, y=0..0.3(i+1),
z=-2-(i+1)*8/12 .. -2-i*8/12. Riser=0.3 <= PLAYER_STEP_HEIGHT.
Player safety bounds: x=-25..25, z=-21..21. Bell Yard bounds unchanged.

## Exact spawns and graph

Crew 0 spawns (-23,0,-16), (-23,0,0), (-23,0,16), yaw=-pi/2.
Crew 1 spawns (23,0,-16), (23,0,0), (23,0,16), yaw=pi/2.

Waypoint IDs are contiguous; all positions below use y=0 unless marked 3.6.
Edges are undirected, enumerated once; each endpoint receives the reverse edge.

| ID | (x,y,z) | edges to higher IDs |
|---|---|---|
| 0 | (-23,0,16) | 3,28 |
| 1 | (-23,0,0) | 2,28 |
| 2 | (-23,0,-16) | 5 |
| 3 | (-16,0,16) | 6,29 |
| 4 | (-16,0,0) | 5,16,29 |
| 5 | (-16,0,-16) | 15 |
| 6 | (-8,0,16) | 8,23 |
| 7 | (0,0,6), mural 0 | 9,23,24 |
| 8 | (8,0,16) | 9,24 |
| 9 | (16,0,16), mural 1 | 10,22 |
| 10 | (23,0,16) | 11 |
| 11 | (23,0,0) | 12,22 |
| 12 | (23,0,-16) | 13 |
| 13 | (16,0,-16) | 14,22 |
| 14 | (8,0,-19) | 15,26 |
| 15 | (-8,0,-19) | 25 |
| 16 | (-8,0,0) | 18,23 |
| 17 | (8,0,0) | 20,22,24 |
| 18 | (-8,3.6,-11) | 19 |
| 19 | (-4,3.6,-14), mural 2 | none (Sketch edge to 21 only) |
| 20 | (8,3.6,-11) | 21 |
| 21 | (4,3.6,-14) | none |
| 22 | (16,0,0) | none |
| 23 | (-6,0,6) | 25 |
| 24 | (6,0,6) | 26 |
| 25 | (-6,0,-8) | 27 |
| 26 | (6,0,-8) | 27 |
| 27 | (0,0,-8) | none |
| 28 | (-23,0,8) | 29 |
| 29 | (-16,0,8) | none |

## Exact interaction definitions

- Sketch anchor `anchor_gallery_gap`: endpoints (-3,3.6,-14) and (3,3.6,-14),
  plank bounds x=-3..3, y=3.36..3.6, z=-15.2..-12.8; wpA=19, wpB=21.
- Grapple ledges: `ledge_gallery_w` (-8,3.95,-9.82),
  `ledge_gallery_e` (8,3.95,-9.82), `ledge_press` (0,3.15,3.18).
- Barrels IDs 1..3: (-16,0,4), (20,0,10), (20,0,-11).
- Mural 0 PRINTING AISLE: centre (0,0,6), radius 4, height 3;
  wall (0,1.4,3.04), facing +z.
- Mural 1 DISPATCH: centre (16,0,16), radius 4, height 3;
  wall (16,1.7,21.44), facing -z.
- Mural 2 MAINTENANCE: centre (-4,3.6,-14), radius 3, height 3;
  wall (-6,5.3,-21.44), facing +z (north wall art).
- Extraction vault (-6,3.6,-15.5), radius 2.4; exit (16,0,18), radius 3.2.
- Foundry centre (0,0,6), radius 3.6; scraps IDs 1..4:
  (-16,0,12), (16,0,12), (-6,3.6,-15), (6,3.6,-15).
- Anomaly: x=-10..10, y=-0.5..8.5, z=-8..10.
- Cable spline: startX=-8, endX=8, z=12, baseY=4.2, archY=1,
  halfW=1.45, halfD=1.15, thickness=0.28, cycleTicks=720.
- Booster (0,0,5), accessible south side of centre press.
- Boss entrance (17,0,-20), yaw=0, at dispatch shutter.

## Refactor and consumer audit

Read map.ts completely, including all 3 anchors, 6 ledges and mode fixtures.
Direct consumers: sim/physics.ts, sim/systems.ts, sim/index.ts,
client/yardDetails.ts. Re-export consumers that use map data include
client/main.ts, client/worldScene.ts and all three existing test files.
Server rooms/protocol and client netClient carry runtime options/snapshots.
Schema, inspectors, runtime and data.ts supply the difficulty/health contracts.

1. Add MapDef / MapId and MAPS in new sim/maps.ts. Bell Yard references its
   existing arrays without changing geometry or ordering; legacy map.ts exports
   and helper signatures retain Bell Yard defaults. Helpers accept waypoint lists.
2. Map ID / pending ID mirror difficulty in state, StartMatch, runtime options,
   Boot and snapshots. Select each map from its own match resource; no mutable
   module-level active map. Health position comes from the definition, with the
   existing HEALTH_PICKUP_POS retained as the Bell Yard compatibility value.
3. Parameterize collision, bounds, anomaly, navigation, dynamic cable deck,
   objective checks, spawn/respawn, anchor/ledge/barrel and foundry lookups.
   Replace Bell-specific bot goal IDs only for the new map. Keep old defaults.
4. Client scene owns a disposable static geometry group and per-instance map.
   On map changes rebuild boxes, murals, anchor/ledge fixtures and cable rail;
   relocate objective markers and anomaly boundary, reset prediction. Add new
   batched newsprint layers/pallets, stationary press rollers, lamp rails and signs.
   Dressing is built once per change with no added per-frame allocations.
5. Add a small title map select beside the mode select. Persist a validated
   MapId in the existing profile. Offline runtime receives it. Online creator
   createRoom can trivially carry optional mapId into the room record/runtime;
   older clients default to Bell Yard. Joiners inherit the room's map.
6. New tests only: graph connectivity/reachability, spawn clearance, edge LOS at
   eye height, stair risers and movement, 600-tick six-bot runs, defaults and map
   reboot/isolation. Keep all 25 original tests unchanged. Verify tsc, vitest,
   lint, build unpiped and report Overprint's 600-tick kill count.

### Pre-existing Bell Yard graph conflict

Baseline: 25/25 tests pass before changes. Existing Bell Yard links 0–3, 0–14,
2–4, 3–4, 9–10, 10–19, 15–19, 9–21 fail the sim's LOS test at feet+1.56m.
Strictly requiring every Bell Yard link clear conflicts with preserving its exact
bot behavior. Clarification requested before changing these routes. Until answered,
keep the original graph; record known baseline obstructions explicitly in tests,
with zero exceptions allowed for Overprint Hall. No geometry changes to Bell Yard.


### Implementation audit refinements

The complete directed-edge audit also finds blocked 21→9 (pair 9–21); there are
eight existing blocked Bell Yard pairs, not seven. Bell Yard's graph also has
one-way links, so reciprocity is enforced for Overprint only. Directed BFS
reachability is checked for both maps. These findings do not change Bell Yard.

Overprint's expanded-slot spawn offset caps inward displacement at 0.8 m;
Bell Yard retains its exact original 1.1 m per-ring offset. Both retain z offset
+(ring*0.6) for even rings, -(ring*0.6) for odd rings. This avoids spawning large
bot populations inside packing pallets.


All remaining action clamps now live in MapDef as well. Overprint prop bounds
are x=-25..25,z=-21..21; free construction centres x=-24..24,z=-19.5..19.5;
smoke centres x=-24..24,z=-20..20; Foreman patrol x=-24..24,z=-20..20 with
solid collision. Bell Yard retains its exact old prop (-25.5..25.5,-16..19.5),
construction (-24..24,-15.5..18.5), smoke (-24..24,-15..18) and Foreman
(-10..10,-8..8) clamps. Client construction previews use the same bounds.

## Verification result

- `npx tsc --noEmit`: passes.
- `npx vitest run`: 40 tests pass (25 existing tests unchanged, 15 new).
- `npm run lint`: passes.
- `npm run build`: client and server pass; Vite emits its bundle-size advisory.
- Independent Overprint Hall soak, seed 1894, six bot slots, 600 successful
  updateSchedule ticks: 88 shots, **5 kills**.
- Online creator-selected, omitted-map and invalid-map rooms are covered,
  including joiner inheritance. Interleaved runtimes match standalone replays.
- No Bell Yard geometry, spawn arrays or waypoint graph changes. Its eight
  pre-existing blocked waypoint pairs remain explicit baseline exceptions in
  the LOS test; Overprint permits none. This is the outstanding conflict with
  the request for every Bell Yard link to be unobstructed.
- Browser rendering was not exercised in this environment; scene rebuilding
  and dressing compile in the production client build.
