#!/usr/bin/env python3
"""
Builds the real skylines for Nodes: public/nodes/<city>.bin

Pulls buildings, building parts, water and major roads around each city from Overture Maps
(OpenStreetMap, Microsoft, Google Open Buildings and LiDAR heights, ODbL) and packs them small
enough to ship. The tallest towers keep their own outlines and parts; every other building is
summed into a grid of cells, drawn as one block per cell sized by how built-up it is.

    python -m venv .venv && .venv/bin/pip install overturemaps shapely numpy
    .venv/bin/python ops/nodes/build_cities.py [MSP SEA ...]

File format (little-endian), x east and z south of the centre, in 1/q metre units:
    'HOLO' u8 version 2, f32 centre lat, f32 centre lng, u16 radius in metres,
        f32 q (units per metre), f32 height exaggeration
    u16 shape count, then per shape: u8 vertex count, u8 tier (1 tower, 0 block),
        u16 base height, u16 top height, i16 x,z of the first vertex, then i16 deltas
    u16 line count, then per line: u8 kind (1 water, 2 road), u16 vertex count, i16 x,z then i16 deltas
"""
import math
import os
import struct
import sys

import numpy as np
import shapely
from overturemaps import core
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon

RELEASE = os.environ.get('OVERTURE_RELEASE', '2026-10-21.0')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'nodes')

# Centre, radius in metres, default height for buildings with no height or floors.
# The radius takes in a slice of each metro, not just downtown.
CITIES = {
    # Maple Grove and Brooklyn Park across to downtown St Paul
    'MSP': (45.0000, -93.2750, 18000, 7),
    # Downtown Seattle and Bellevue down through Kent to Tacoma
    'SEA': (47.4300, -122.3300, 23000, 7),
    'PHL': (39.9600, -75.1650, 8000, 8),
    'LDN': (51.5080, -0.1100, 9000, 11),
    'RUH': (24.7200, 46.6800, 12000, 8),
    # Downtown Houston out west along I-10 to Katy
    'HOU': (29.7700, -95.5900, 25000, 6),
    'ATL': (33.7700, -84.3900, 10000, 7),
}
TOWER = 35  # metres; the tallest buildings above this keep their own outline
MAX_TOWERS = 400
MAX_CELLS = 2600


def fetch(kind, lat, lng, r):
    dlat, dlng = r / 110540, r / (111320 * math.cos(math.radians(lat)))
    reader = core.record_batch_reader(kind, bbox=(lng - dlng, lat - dlat, lng + dlng, lat + dlat), release=RELEASE)
    if reader:
        yield from reader


def local(lat0, lng0):
    kx, kz = 111320 * math.cos(math.radians(lat0)), 110540
    return lambda g: shapely.transform(g, lambda c: np.column_stack([(c[:, 0] - lng0) * kx, -(c[:, 1] - lat0) * kz]))


def polys(g):
    return [p for p in (g.geoms if isinstance(g, MultiPolygon) else [g]) if isinstance(p, Polygon) and not p.is_empty]


def lines(g):
    if isinstance(g, (Polygon, MultiPolygon)):
        return [LineString(p.exterior.coords) for p in polys(g)]
    if isinstance(g, MultiLineString):
        return list(g.geoms)
    return [g] if isinstance(g, LineString) and not g.is_empty else []


def heights(batch, default):
    h = np.nan_to_num(batch.column('height').to_numpy(zero_copy_only=False).astype(float))
    floors = np.nan_to_num(batch.column('num_floors').to_numpy(zero_copy_only=False).astype(float))
    return np.minimum(np.where(h > 0, h, np.where(floors > 0, floors * 3.6, default)), 600)


def tidy(p, tol):
    p = p.simplify(tol, preserve_topology=True)
    if p.is_empty or not isinstance(p, Polygon) or p.area < 30:
        return None
    box = p.minimum_rotated_rectangle
    return box if box.area and p.area / box.area >= 0.82 else p


def build(code):
    lat, lng, r, default = CITIES[code]
    to_local = local(lat, lng)
    disc = Point(0, 0).buffer(r, 128)
    cell = r / 55
    n = int(2 * r / cell) + 1
    built = np.zeros((n, n))  # footprint area per cell
    volume = np.zeros((n, n))  # footprint area x height per cell
    tall = []  # (height, id, local geometry, min height)

    for batch in fetch('building', lat, lng, r):
        geoms = to_local(shapely.from_wkb(batch.column('geometry').to_numpy(zero_copy_only=False)))
        h = heights(batch, default)
        under = np.array(batch.column('is_underground').to_pylist(), dtype=bool)
        area = shapely.area(geoms)
        c = shapely.get_coordinates(shapely.centroid(geoms))
        keep = ~under & (np.hypot(c[:, 0], c[:, 1]) < r) & (area > 20)
        for k in np.flatnonzero(keep & (h >= TOWER)):
            tall.append((h[k], batch.column('id')[k].as_py(), geoms[k], batch.column('min_height')[k].as_py() or 0))
        low = keep & (h < TOWER)
        ix = ((c[low, 0] + r) // cell).astype(int)
        iz = ((c[low, 1] + r) // cell).astype(int)
        np.add.at(built, (ix, iz), area[low])
        np.add.at(volume, (ix, iz), area[low] * h[low])

    # Towers beyond the cap are counted in their cell like any other building
    tall.sort(key=lambda t: -t[0])
    for h, _, g, _ in tall[MAX_TOWERS:]:
        x, z = g.centroid.x, g.centroid.y
        built[int((x + r) // cell), int((z + r) // cell)] += g.area
        volume[int((x + r) // cell), int((z + r) // cell)] += g.area * h
    tall = tall[:MAX_TOWERS]
    tall_ids = {t[1] for t in tall}

    shapes = []  # (polygon, base, top, tier)
    has_parts = set()
    for batch in fetch('building_part', lat, lng, r):
        ids = batch.column('building_id').to_pylist()
        rows = [k for k, i in enumerate(ids) if i in tall_ids]
        if not rows:
            continue
        geoms = to_local(shapely.from_wkb(batch.column('geometry').to_numpy(zero_copy_only=False)[rows]))
        h = heights(batch, default)[rows]
        base = batch.column('min_height').to_pylist()
        for g, k, hk in zip(geoms, rows, h):
            for p in polys(g.intersection(disc)):
                p = tidy(p, 0.8)
                if p:
                    has_parts.add(ids[k])
                    shapes.append((p, base[k] or 0, hk, 1))
    for h, i, g, base in tall:
        if i not in has_parts:
            for p in polys(g.intersection(disc)):
                p = tidy(p, 1.0)
                if p:
                    shapes.append((p, base, h, 1))

    # Everything else: one block per cell, wider the more of the cell is built on
    blocks = []
    for ix, iz in zip(*np.nonzero(built)):
        cover = built[ix, iz] / cell**2
        x, z = (ix + 0.5) * cell - r, (iz + 0.5) * cell - r
        if cover < 0.06 or math.hypot(x, z) > r - cell:
            continue
        h = volume[ix, iz] / built[ix, iz]
        side = cell * min(0.9, 0.25 + math.sqrt(cover))
        blocks.append((cover * h, Polygon.from_bounds(x - side / 2, z - side / 2, x + side / 2, z + side / 2), h))
    blocks.sort(key=lambda b: -b[0])
    shapes += [(p, 0, h, 0) for _, p, h in blocks[:MAX_CELLS]]

    out, runs = [], []
    for batch in fetch('water', lat, lng, r):
        geoms = to_local(shapely.from_wkb(batch.column('geometry').to_numpy(zero_copy_only=False)))
        subtype = batch.column('subtype').to_pylist()
        for g, sub in zip(geoms, subtype):
            if isinstance(g, (LineString, MultiLineString)) and sub not in ('river', 'canal'):
                continue
            if isinstance(g, (Polygon, MultiPolygon)) and g.area < (r / 90) ** 2:
                continue
            for line in lines(g.intersection(disc)):
                # Drop the stretches that only trace the edge of the disc, and the long straight edges
                # of bay and harbour areas drawn out over open water
                run = []
                for c in line.simplify(r / 900).coords:
                    if math.hypot(*c) >= r * 0.995 or (run and math.dist(run[-1], c) > r / 4.4):
                        runs.append(run)
                        run = []
                    if math.hypot(*c) < r * 0.995:
                        run.append(c)
                runs.append(run)
    for run in runs:
        if len(run) > 1 and LineString(run).length > r / 40:
            out.append((1, run))
    roads = ('motorway', 'trunk') if r > 11000 else ('motorway', 'trunk', 'primary')
    for batch in fetch('segment', lat, lng, r):
        cls = batch.column('class').to_pylist()
        sub = batch.column('subtype').to_pylist()
        rows = [k for k in range(len(cls)) if sub[k] == 'road' and cls[k] in roads]
        if not rows:
            continue
        geoms = to_local(shapely.from_wkb(batch.column('geometry').to_numpy(zero_copy_only=False)[rows]))
        for g in geoms:
            for line in lines(g.intersection(disc)):
                pts = list(line.simplify(r / 600).coords)
                if len(pts) > 1:
                    out.append((2, pts))

    q = min(2.0, 30000 / r)
    lift = 3 * (r / 2000) ** 0.6
    buf = bytearray(b'HOLO\x02') + struct.pack('<ffHff', lat, lng, r, q, lift)
    kept = [s for s in shapes if 3 <= len(s[0].exterior.coords) - 1 <= 255]
    buf += struct.pack('<H', len(kept))
    segs = 0
    for p, base, top, tier in kept:
        pts = [(round(x * q), round(z * q)) for x, z in list(p.exterior.coords)[:-1]]
        buf += struct.pack('<BBHH', len(pts), tier, round(base * q), round(top * q))
        buf += vertices(pts)
        segs += len(pts) * (3 if tier else 2)
    buf += struct.pack('<H', len(out))
    for kind, pts in out:
        v = [(round(x * q), round(z * q)) for x, z in pts][:65535]
        buf += struct.pack('<BH', kind, len(v)) + vertices(v)
        segs += len(v) - 1
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{code.lower()}.bin'), 'wb') as f:
        f.write(buf)
    towers = sum(1 for s in kept if s[3])
    print(f'{code}: {towers} towers/parts, {len(kept) - towers} cells, {len(out)} lines, ~{segs} segments, {len(buf) / 1024:.0f} kB')


def vertices(pts):
    b = bytearray(struct.pack('<hh', *pts[0]))
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        b += struct.pack('<hh', x1 - x0, z1 - z0)
    return b


if __name__ == '__main__':
    for code in sys.argv[1:] or CITIES:
        build(code)
