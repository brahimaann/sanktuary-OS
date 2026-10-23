#!/usr/bin/env python3
"""
Builds the real skylines for Nodes: public/nodes/<city>.bin

Pulls buildings, building parts, water and major roads around each city centre from
Overture Maps (OpenStreetMap, Microsoft, Google Open Buildings and LiDAR heights,
ODbL) and packs them small enough to ship: towers keep their own outlines and parts,
everything else is merged into blocks by height band.

    python -m venv .venv && .venv/bin/pip install overturemaps shapely numpy
    .venv/bin/python ops/nodes/build_cities.py [MSP SEA ...]

File format (little-endian), coordinates in 0.5 m units, x east and z south of the centre:
    'HOLO' u8 version, f32 centre lat, f32 centre lng, u16 radius in metres
    u16 shape count, then per shape: u8 vertex count, u8 tier (1 tower, 0 block),
        u16 base height, u16 top height (0.5 m units), i16 x,z of the first vertex, then i16 deltas
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

# Centre, radius in metres, default height for buildings with no height or floors
CITIES = {
    'MSP': (44.9780, -93.2640, 1900, 9),
    'SEA': (47.6080, -122.3380, 2200, 9),
    'PHL': (39.9524, -75.1636, 2300, 10),
    'LDN': (51.5080, -0.0990, 2500, 12),
    'RUH': (24.7000, 46.6800, 2200, 9),
    'HOU': (29.7580, -95.3660, 1800, 8),
    'ATL': (33.7700, -84.3870, 2200, 9),
}
TOWER = 40  # metres; the tallest buildings above this keep their own outline
MAX_BLOCKS = 900
MAX_TOWERS = 250
Q = 2  # quantisation: units per metre


def fetch(kind, lat, lng, r):
    dlat, dlng = r / 110540, r / (111320 * math.cos(math.radians(lat)))
    reader = core.record_batch_reader(kind, bbox=(lng - dlng, lat - dlat, lng + dlng, lat + dlat), release=RELEASE)
    return reader.read_all().to_pylist() if reader else []


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


def height(row, default):
    h = row.get('height')
    if h and h > 0:
        return min(float(h), 600.0)
    return (row.get('num_floors') or 0) * 3.6 or default


def tidy(p, tol):
    p = p.simplify(tol, preserve_topology=True)
    if p.is_empty or not isinstance(p, Polygon) or p.area < 30:
        return None
    box = p.minimum_rotated_rectangle
    return box if box.area and p.area / box.area >= 0.82 else p


def build(code):
    lat, lng, r, default = CITIES[code]
    to_local = local(lat, lng)
    disc = Point(0, 0).buffer(r, 64)
    shapes = []  # (polygon, base, top, tier)

    buildings = [row for row in fetch('building', lat, lng, r) if not row.get('is_underground')]
    # Only the tallest buildings in each city keep their own outline and parts, so a dense
    # downtown still reads as a skyline instead of a wall
    tall = sorted((row for row in buildings if height(row, default) >= TOWER), key=lambda row: -height(row, default))
    tall = {row['id'] for row in tall[:MAX_TOWERS]}

    has_parts = set()
    for row in fetch('building_part', lat, lng, r):
        if row.get('building_id') not in tall:
            continue
        has_parts.add(row.get('building_id'))
        for p in polys(to_local(shapely.from_wkb(row['geometry'])).intersection(disc)):
            p = tidy(p, 0.8)
            if p:
                shapes.append((p, row.get('min_height') or 0, height(row, default), 1))

    blocks = {}
    for row in buildings:
        if row['id'] in has_parts:
            continue
        h = height(row, default)
        for p in polys(to_local(shapely.from_wkb(row['geometry'])).intersection(disc)):
            if row['id'] in tall:
                p = tidy(p, 1.0)
                if p:
                    shapes.append((p, row.get('min_height') or 0, h, 1))
            elif p.area >= 45:
                blocks.setdefault(min(64, max(8, round(h / 8) * 8)), []).append(p)

    # Lower buildings: close the gaps between neighbours of similar height into city blocks
    merged = []
    for band, group in blocks.items():
        union = shapely.union_all([p.buffer(2.5, join_style='mitre') for p in group]).buffer(-2.5, join_style='mitre')
        for p in polys(union):
            p = tidy(Polygon(p.exterior), 1.6)
            if p and p.area >= 90:
                weight = 1 - 0.5 * p.centroid.distance(Point(0, 0)) / r
                merged.append((p.area * band * weight, p, band))
    merged.sort(key=lambda m: -m[0])
    shapes += [(p, 0, band, 0) for _, p, band in merged[:MAX_BLOCKS]]

    out, runs = [], []
    for row in fetch('water', lat, lng, r):
        for line in lines(to_local(shapely.from_wkb(row['geometry'])).intersection(disc)):
            # Drop the stretches that only trace the edge of the disc, and the long straight edges
            # of bay and harbour areas drawn out over open water
            run = []
            for c in line.simplify(3).coords:
                if math.hypot(*c) >= r * 0.995 or (run and math.dist(run[-1], c) > 500):
                    runs.append(run)
                    run = []
                if math.hypot(*c) < r * 0.995:
                    run.append(c)
            runs.append(run)
    for run in runs:
        if len(run) > 1 and LineString(run).length > 60:
            out.append((1, run))
    for row in fetch('segment', lat, lng, r):
        if row.get('subtype') == 'road' and row.get('class') in ('motorway', 'trunk', 'primary'):
            for line in lines(to_local(shapely.from_wkb(row['geometry'])).intersection(disc)):
                pts = list(line.simplify(4).coords)
                if len(pts) > 1:
                    out.append((2, pts))

    buf = bytearray(b'HOLO\x01') + struct.pack('<ffH', lat, lng, r)
    kept = [s for s in shapes if 3 <= len(s[0].exterior.coords) - 1 <= 255]
    buf += struct.pack('<H', len(kept))
    segs = 0
    for p, base, top, tier in kept:
        pts = [(round(x * Q), round(z * Q)) for x, z in list(p.exterior.coords)[:-1]]
        buf += struct.pack('<BBHH', len(pts), tier, round(base * Q), round(top * Q))
        buf += vertices(pts)
        segs += len(pts) * (3 if tier else 2)
    buf += struct.pack('<H', len(out))
    for kind, pts in out:
        q = [(round(x * Q), round(z * Q)) for x, z in pts][:65535]
        buf += struct.pack('<BH', kind, len(q)) + vertices(q)
        segs += len(q) - 1
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f'{code.lower()}.bin'), 'wb') as f:
        f.write(buf)
    towers = sum(1 for s in kept if s[3])
    print(f'{code}: {towers} towers/parts, {len(kept) - towers} blocks, {len(out)} lines, ~{segs} segments, {len(buf) / 1024:.0f} kB')


def vertices(pts):
    b = bytearray(struct.pack('<hh', *pts[0]))
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
        b += struct.pack('<hh', x1 - x0, z1 - z0)
    return b


if __name__ == '__main__':
    for code in sys.argv[1:] or CITIES:
        build(code)
