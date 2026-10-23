import React, { useEffect, useRef, useState } from 'react';
// Coastlines from Natural Earth (public domain), 1° precision, as flat [lng, lat, lng, lat, ...] lines
import land from './landOutline.json';

/**
 * Sanktuary's nodes: a spinning wireframe globe with every city on it, and a hologram of each city's skyline.
 * Plain canvas with a hand-rolled projection; the skylines are generated around a few real landmarks per city.
 */

type V3 = [number, number, number];
type Shape = (g: Geo) => void;
interface City {
  name: string;
  short: string;
  lat: number;
  lng: number;
  tz: string;
  /** Street grid angle in radians, and how tall and wide the downtown is */
  grid: number;
  peak: number;
  spread: number;
  /** Extra downtowns: [x, z, peak, spread] */
  more?: [number, number, number, number][];
  /** Rivers and shorelines: polyline in ground coordinates, and its width (0 = shoreline) */
  water?: { pts: [number, number][]; width: number; side?: 1 | -1 }[];
  landmarks: Shape[];
  /** Ten places to highlight: name, a line about it, ground position, and the height of its landmark if it has one */
  spots: Spot[];
}
type Spot = [name: string, note: string, x: number, z: number, top?: number];

// Edge kinds, drawn in this order
const GROUND = 0,
  WATER = 1,
  BUILDING = 2,
  LANDMARK = 3,
  SPOT = 4;
const KINDS = 5;

class Geo {
  v: number[] = [];
  e: number[] = [];
  pt(p: V3) {
    this.v.push(...p);
    return this.v.length / 3 - 1;
  }
  line(pts: V3[], kind: number, closed = false) {
    const ids = pts.map((p) => this.pt(p));
    for (let i = 0; i < ids.length - (closed ? 0 : 1); i++) this.e.push(ids[i], ids[(i + 1) % ids.length], kind);
  }
  /** A footprint extruded from y0 to y1, its top scaled toward the centre; rings adds floor lines */
  prism(base: [number, number][], x: number, z: number, y0: number, y1: number, top = 1, kind = BUILDING, rings = 0) {
    const at = (y: number, s: number) => base.map(([bx, bz]) => [x + bx * s, y, z + bz * s] as V3);
    const lo = at(y0, 1).map((p) => this.pt(p));
    const hi = at(y1, top).map((p) => this.pt(p));
    const n = base.length;
    for (let i = 0; i < n; i++) this.e.push(lo[i], lo[(i + 1) % n], kind, hi[i], hi[(i + 1) % n], kind, lo[i], hi[i], kind);
    for (let r = 1; r <= rings; r++) {
      const t = r / (rings + 1);
      this.line(at(y0 + (y1 - y0) * t, 1 + (top - 1) * t), kind, true);
    }
  }
}

const ngon = (n: number, r: number, rot = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
const rect = (w: number, d: number, rot = 0): [number, number][] =>
  (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as [number, number][]
  ).map(([x, z]) => [x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)]);
/** A circle standing up, facing along z (a Ferris wheel, a sphere's rings) */
const hoop = (x: number, y: number, z: number, r: number, turn = 0, n = 20): V3[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [x + Math.cos(a) * r * Math.cos(turn), y + Math.sin(a) * r, z + Math.cos(a) * r * Math.sin(turn)];
  });
const spire =
  (x: number, z: number, y0: number, y1: number): Shape =>
  (g) =>
    g.line(
      [
        [x, y0, z],
        [x, y1, z],
      ],
      LANDMARK,
    );

const CITIES: City[] = [
  {
    name: 'Twin Cities',
    short: 'MSP',
    lat: 44.9778,
    lng: -93.265,
    tz: 'America/Chicago',
    grid: Math.PI / 4,
    peak: 55,
    spread: 34,
    more: [[60, 28, 32, 20]],
    water: [
      {
        pts: [
          [-10, -110],
          [5, -60],
          [18, -25],
          [22, 5],
          [35, 45],
          [70, 60],
          [105, 52],
        ],
        width: 7,
      },
    ],
    spots: [
      ['IDS Center', "Minneapolis's tallest tower, over the Crystal Court", -18, 0, 80],
      ['First Avenue', "Prince's club and the Purple Rain stage, stars on the wall", -36, 14],
      ['Stone Arch Bridge', 'The old rail bridge across the Mississippi at St. Anthony Falls', 18, -26, 7],
      ['Walker Art Center', 'Modern art and the Spoonbridge and Cherry in the sculpture garden', -66, 24],
      ['Guthrie Theater', 'The riverfront theater with the Endless Bridge cantilevered over the water', 6, -44],
      ['Cedar-Riverside', "Riverside Plaza's towers, the Cedar Cultural Center and the city's East African heart", 36, -4],
      ['Lake Street', 'Midtown Global Market and the corridor that rebuilt itself', -24, 66],
      ['Paisley Park', "Prince's studio and home, out in Chanhassen", -100, 58],
      ['Rondo', "St. Paul's historic Black neighborhood, remembered every July at Rondo Days", 34, 62],
      ['Cathedral of Saint Paul', 'The copper dome on Summit Hill, looking over downtown St. Paul', 52, 44, 28],
    ],
    landmarks: [
      // IDS Center, the tallest in Minneapolis, with its notched corners
      (g) => {
        g.prism(ngon(8, 7, Math.PI / 8), -18, 0, 0, 80, 1, LANDMARK, 7);
      },
      // Cathedral of Saint Paul: a drum and a dome
      (g) => {
        g.prism(ngon(12, 7), 52, 44, 0, 14, 1, LANDMARK);
        g.prism(ngon(12, 7), 52, 44, 14, 24, 0.55, LANDMARK);
        g.prism(ngon(12, 3.8), 52, 44, 24, 28, 0.3, LANDMARK);
      },
      // Stone Arch Bridge over the Mississippi
      (g) => {
        for (const side of [-2, 2])
          g.line(
            Array.from(
              { length: 25 },
              (_, i) => [8 + i * 0.9 + side * 0.4, 2 + Math.abs(Math.sin((i / 24) * 4 * Math.PI)) * 2.5, -32 + i * 0.5 + side] as V3,
            ),
            LANDMARK,
          );
      },
    ],
  },
  {
    name: 'Seattle',
    short: 'SEA',
    lat: 47.6062,
    lng: -122.3321,
    tz: 'America/Los_Angeles',
    grid: -0.55,
    peak: 70,
    spread: 30,
    water: [
      {
        pts: [
          [-40, -120],
          [-52, -60],
          [-38, -10],
          [-30, 30],
          [-50, 80],
          [-60, 120],
        ],
        width: 0,
        side: 1,
      },
    ],
    spots: [
      ['Space Needle', "The 1962 World's Fair tower over Seattle Center", -15, -62, 70],
      ['Columbia Center', 'The tallest tower in Seattle, three-lobed and black', 10, 10, 102],
      ['Pike Place Market', 'The public market on the waterfront since 1907', -28, -12],
      ['MoPOP', 'The Museum of Pop Culture: Hendrix, Nirvana, sci-fi and games', -4, -74],
      ['The Crocodile', 'The Belltown club where grunge broke out', -24, -38],
      ['Capitol Hill', 'Nightlife, record shops and the Pike/Pine venues', 38, -28],
      ['Central District', "Black Seattle's historic heart, home to Quincy Jones and Jimi Hendrix", 50, 26],
      ['Pioneer Square', "The city's oldest blocks, galleries and First Thursday art walks", -12, 42],
      ['International District', 'Chinatown, Japantown and Little Saigon around the Wing Luke Museum', 18, 58],
      ['Lumen Field', 'Home of the Seahawks and the Sounders', -6, 82],
    ],
    landmarks: [
      // Space Needle
      (g) => {
        const x = -15,
          z = -62;
        g.prism(ngon(3, 5, Math.PI / 2), x, z, 0, 30, 0.25, LANDMARK, 2);
        g.prism(ngon(3, 1.3, Math.PI / 2), x, z, 30, 52, 1.2, LANDMARK);
        g.prism(ngon(16, 6), x, z, 52, 56, 1.4, LANDMARK);
        g.prism(ngon(16, 8.4), x, z, 56, 59, 0.45, LANDMARK);
        spire(x, z, 59, 70)(g);
      },
      // Columbia Center, the tall black three-lobed tower
      (g) => {
        g.prism(ngon(3, 9, Math.PI / 6), 10, 10, 0, 92, 1, LANDMARK, 3);
        g.prism(ngon(6, 6.5), 10, 10, 0, 102, 1, LANDMARK, 0);
      },
    ],
  },
  {
    name: 'Philadelphia',
    short: 'PHL',
    lat: 39.9526,
    lng: -75.1652,
    tz: 'America/New_York',
    grid: 0,
    peak: 62,
    spread: 32,
    water: [
      {
        pts: [
          [-80, -120],
          [-70, -40],
          [-78, 30],
          [-72, 120],
        ],
        width: 6,
      },
      {
        pts: [
          [95, -120],
          [82, -20],
          [88, 60],
          [100, 120],
        ],
        width: 10,
      },
    ],
    spots: [
      ['City Hall', 'William Penn on top of the tower at the center of the grid', 0, 0, 56],
      ['Comcast Technology Center', 'The tallest tower in Philadelphia', 26, -14, 104],
      ['Liberty Place', 'The Chrysler-style spire that broke the height rule in 1987', -24, -6, 96],
      ['LOVE Park', 'The LOVE statue and the skate plaza that made it famous', -16, -26],
      ['Art Museum and Rocky Steps', 'The museum steps everyone runs up, over the Schuylkill', -58, -72],
      ['Independence Hall', 'The Liberty Bell and where the Declaration was signed', 56, 14],
      ['Reading Terminal Market', 'The food hall under the old train shed', 22, 12],
      ['Avenue of the Arts', 'The Kimmel Center and the theaters along South Broad', -4, 34],
      ['South Street', "Punk, cheesesteaks and Magic Gardens' mosaics", 40, 62],
      ['The Met Philadelphia', 'The restored opera house on North Broad, now a big concert hall', 4, -84],
    ],
    landmarks: [
      // City Hall with William Penn on top
      (g) => {
        g.prism(rect(26, 26), 0, 0, 0, 16, 1, LANDMARK, 1);
        g.prism(rect(7, 7), 0, 0, 16, 40, 1, LANDMARK, 2);
        g.prism(ngon(8, 4.2, Math.PI / 8), 0, 0, 40, 50, 0.4, LANDMARK);
        spire(0, 0, 50, 56)(g);
      },
      // Comcast Technology Center
      (g) => {
        g.prism(rect(13, 13), 26, -14, 0, 104, 0.9, LANDMARK, 6);
      },
      // Liberty Place, the Chrysler-style spire
      (g) => {
        g.prism(rect(12, 12), -24, -6, 0, 70, 1, LANDMARK, 3);
        g.prism(rect(12, 12), -24, -6, 70, 88, 0.15, LANDMARK, 2);
        spire(-24, -6, 88, 96)(g);
      },
    ],
  },
  {
    name: 'London',
    short: 'LDN',
    lat: 51.5074,
    lng: -0.1278,
    tz: 'Europe/London',
    grid: 0.2,
    peak: 38,
    spread: 52,
    water: [
      {
        pts: [
          [-120, 10],
          [-80, 30],
          [-48, 5],
          [-30, -30],
          [5, -12],
          [40, 18],
          [80, 10],
          [120, 30],
        ],
        width: 9,
      },
    ],
    spots: [
      ['The Shard', 'The glass spire over London Bridge, tallest in the UK', 35, 34, 98],
      ['Big Ben', 'Elizabeth Tower at Westminster', -72, 40, 40],
      ['London Eye', 'The big wheel on the South Bank', -48, -14, 34],
      ['The Gherkin', '30 St Mary Axe in the City', 16, -40, 66],
      ['Tate Modern', 'The power station turned art museum on Bankside', 12, 14],
      ['Brixton', 'Windrush Square, Electric Brixton and the heart of Black British culture', -22, 96],
      ['Notting Hill', 'Home of Carnival every August bank holiday', -106, -52],
      ['Camden', "Camden Market, the Roundhouse and the city's rock and punk venues", -58, -96],
      ['Shoreditch', 'Street art, studios and Boxpark', 44, -72],
      ['Peckham', 'Galleries, rooftop bars and south London Afrobeats', 58, 86],
    ],
    landmarks: [
      // The Shard
      (g) => {
        g.prism(ngon(4, 11, Math.PI / 4), 35, 34, 0, 98, 0.04, LANDMARK, 6);
      },
      // Elizabeth Tower (Big Ben)
      (g) => {
        g.prism(rect(5, 5), -72, 40, 0, 30, 1, LANDMARK, 3);
        g.prism(rect(5, 5), -72, 40, 30, 40, 0.1, LANDMARK);
      },
      // London Eye
      (g) => {
        const [x, z] = [-48, -14];
        g.line(hoop(x, 18, z, 16, 0.6, 28), LANDMARK, true);
        g.line(hoop(x, 18, z, 15, 0.6, 28), LANDMARK, true);
        g.line(
          [
            [x - 6, 0, z - 4],
            [x, 18, z],
            [x + 6, 0, z + 4],
          ],
          LANDMARK,
        );
      },
      // The Gherkin
      (g) => {
        const r = [4, 6, 6.6, 6.2, 5, 3, 0.4];
        for (let i = 0; i < r.length - 1; i++) g.prism(ngon(12, r[i]), 16, -40, i * 11, (i + 1) * 11, r[i + 1] / r[i], LANDMARK);
      },
    ],
  },
  {
    name: 'Riyadh',
    short: 'RUH',
    lat: 24.7136,
    lng: 46.6753,
    tz: 'Asia/Riyadh',
    grid: 0.62,
    peak: 34,
    spread: 48,
    spots: [
      ['Kingdom Centre', 'The tower with the sky bridge across its arch', -10, -20, 102],
      ['Al Faisaliah', 'The pyramid with the golden globe near its tip', 36, 32, 86],
      ['Tahlia Street', 'Cafés, shops and the late-night drive', -40, 18],
      ['Masmak Fortress', 'The mud-brick fort where the modern kingdom began', 18, 88],
      ['National Museum', 'Saudi history from prehistory to today, in the Murabba district', 40, 64],
      ['Diriyah (At-Turaif)', 'UNESCO-listed mud-brick city, birthplace of the first Saudi state', -104, -34],
      ['JAX District', "Diriyah's arts district and home of the Diriyah Contemporary Art Biennale", -96, 8],
      ['Boulevard City', 'Riyadh Season concerts, events and the giant screens', -30, -94],
      ['KAFD', 'King Abdullah Financial District and its new towers', 62, -72],
      ['Wadi Hanifah', 'The green valley that runs along the west of the city', -74, 70],
    ],
    landmarks: [
      // Kingdom Centre: a tower that opens into a parabolic arch with a sky bridge
      (g) => {
        const [x, z] = [-10, -20];
        g.prism(rect(22, 10), x, z, 0, 62, 0.86, LANDMARK, 5);
        for (const dz of [-4.3, 4.3]) {
          const arch = (s: number) =>
            Array.from({ length: 11 }, (_, i) => {
              const t = i / 10;
              return [x + s * (9.5 - 9 * t * t), 62 + t * 40, z + dz] as V3;
            });
          g.line(arch(1), LANDMARK);
          g.line(arch(-1), LANDMARK);
          g.line(
            Array.from({ length: 13 }, (_, i) => {
              const t = (i / 12) * 2 - 1;
              return [x + t * 5, 70 + 22 * (1 - t * t), z + dz] as V3;
            }),
            LANDMARK,
            true,
          );
          g.line(
            [
              [x - 3, 84, z + dz],
              [x + 3, 84, z + dz],
            ],
            LANDMARK,
          );
        }
      },
      // Al Faisaliah: a pyramid holding a golden globe
      (g) => {
        const [x, z] = [36, 32];
        g.prism(ngon(4, 13, Math.PI / 4), x, z, 0, 86, 0.02, LANDMARK, 4);
        for (const t of [0, Math.PI / 3, (2 * Math.PI) / 3]) g.line(hoop(x, 62, z, 5, t, 16), LANDMARK, true);
      },
    ],
  },
  {
    name: 'Houston',
    short: 'HOU',
    lat: 29.7604,
    lng: -95.3698,
    tz: 'America/Chicago',
    grid: 0.6,
    peak: 82,
    spread: 26,
    more: [[-80, 40, 40, 12]],
    water: [
      {
        pts: [
          [-120, -40],
          [-60, -48],
          [-20, -36],
          [20, -44],
          [60, -30],
          [120, -38],
        ],
        width: 5,
      },
    ],
    spots: [
      ['Chase Tower', 'Five-sided, the tallest in Texas', 6, 6, 112],
      ['Williams Tower', 'The Uptown tower with the rooftop beacon', -80, 40, 96],
      ['Third Ward', "Emancipation Park, Project Row Houses and Houston's Black cultural heart", 42, 58],
      ['Screwed Up Records', "DJ Screw's shop on the South Side, home of chopped and screwed", 26, 98],
      ['Fifth Ward', "Frenchtown, zydeco and the Bloody Nickel's rap history", 56, -64],
      ['Museum District', 'The MFAH, the Menil and nineteen museums in walking distance', -12, 72],
      ['Discovery Green', 'The downtown park where the festivals happen', 28, 24],
      ['Daikin Park', 'The Astros ballpark in the old Union Station', 38, -12],
      ['Buffalo Bayou', 'The bayou park and trails along the north of downtown', -40, -44],
      ['NRG Park', 'The Astrodome, NRG Stadium and the Houston Rodeo', -22, 106],
    ],
    landmarks: [
      // JPMorgan Chase Tower, five-sided
      (g) => {
        g.prism(ngon(5, 11, -Math.PI / 2), 6, 6, 0, 112, 1, LANDMARK, 7);
      },
      // Williams Tower out in Uptown
      (g) => {
        g.prism(rect(12, 12, Math.PI / 4), -80, 40, 0, 88, 1, LANDMARK, 5);
        g.prism(rect(12, 12, Math.PI / 4), -80, 40, 88, 96, 0.2, LANDMARK);
      },
      // The 610 Loop
      (g) =>
        g.line(
          hoop(-20, 0, 10, 112, Math.PI / 2, 48).map(([x, , z]) => [x, 0, z] as V3),
          GROUND,
          true,
        ),
    ],
  },
  {
    name: 'Atlanta',
    short: 'ATL',
    lat: 33.749,
    lng: -84.388,
    tz: 'America/New_York',
    grid: 0.1,
    peak: 64,
    spread: 34,
    more: [[10, -70, 48, 18]],
    spots: [
      ['Bank of America Plaza', 'The tallest tower in the Southeast, gold-tipped spire', 4, -40, 122],
      ['Westin Peachtree Plaza', 'The glass cylinder downtown', -6, 4, 76],
      ['Mercedes-Benz Stadium', 'Falcons and Atlanta United under the pinwheel roof', -72, 34, 16],
      ['Centennial Olympic Park', 'The 1996 Olympic park, next to the Georgia Aquarium', -36, 8],
      ['Sweet Auburn', "Dr. King's birthplace, Ebenezer Baptist Church and the old Black Wall Street", 46, 14],
      ['Atlanta University Center', 'Morehouse, Spelman and Clark Atlanta', -72, 78],
      ['Fox Theatre', 'The 1929 movie palace on Peachtree', 24, -60],
      ['Ponce City Market', 'The old Sears building on the BeltLine', 62, -52],
      ['Little Five Points', 'Vintage stores, murals and the independent music scene', 90, 22],
      ['Castleberry Hill', 'Lofts, galleries, studios and the Westside art walks', -32, 52],
    ],
    landmarks: [
      // Bank of America Plaza: pyramid top and gold spire
      (g) => {
        g.prism(rect(14, 14, Math.PI / 4), 4, -40, 0, 96, 1, LANDMARK, 6);
        g.prism(rect(14, 14, Math.PI / 4), 4, -40, 96, 108, 0.3, LANDMARK);
        spire(4, -40, 108, 122)(g);
      },
      // Westin Peachtree Plaza, the glass cylinder
      (g) => {
        g.prism(ngon(16, 8), -6, 4, 0, 76, 1, LANDMARK, 5);
      },
      // Mercedes-Benz Stadium and its pinwheel roof
      (g) => {
        const [x, z] = [-72, 34];
        g.prism(ngon(8, 20, Math.PI / 8), x, z, 0, 14, 1.1, LANDMARK, 1);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.line(
            [
              [x + Math.cos(a) * 22, 15.4, z + Math.sin(a) * 22],
              [x + Math.cos(a + 1) * 6, 15.4, z + Math.sin(a + 1) * 6],
            ],
            LANDMARK,
          );
        }
      },
    ],
  },
];

// Deterministic per city, so a skyline looks the same every visit
const rng = (seed: string) => {
  let a = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const distToLine = (x: number, z: number, pts: [number, number][]) => {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i],
      [bx, bz] = pts[i + 1];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
  }
  return best;
};
/** Which side of a shoreline a point is on (sign of the cross product with the nearest segment) */
const sideOf = (x: number, z: number, pts: [number, number][]) => {
  let best = Infinity,
    side = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i],
      [bx, bz] = pts[i + 1];
    const d = Math.hypot((ax + bx) / 2 - x, (az + bz) / 2 - z);
    if (d < best) [best, side] = [d, Math.sign((bx - ax) * (z - az) - (bz - az) * (x - ax))];
  }
  return side;
};
const offset = (pts: [number, number][], d: number): V3[] =>
  pts.map(([x, z], i) => {
    const [ax, az] = pts[Math.max(0, i - 1)],
      [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    return [x + ((bz - az) / len) * d, 0, z - ((bx - ax) / len) * d];
  });

const RADIUS = 120;
const buildCity = (c: City) => {
  const g = new Geo();
  const rand = rng(c.name);
  // The projector pad: rings and ticks on the ground
  for (const r of [RADIUS, RADIUS + 4])
    g.line(
      hoop(0, 0, 0, r, Math.PI / 2, 72).map(([x, , z]) => [x, 0, z] as V3),
      GROUND,
      true,
    );
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    g.line(
      [
        [Math.cos(a) * (RADIUS + 4), 0, Math.sin(a) * (RADIUS + 4)],
        [Math.cos(a) * (RADIUS + 10), 0, Math.sin(a) * (RADIUS + 10)],
      ],
      GROUND,
    );
  }
  for (const w of c.water || []) {
    if (w.width) {
      g.line(offset(w.pts, w.width / 2), WATER);
      g.line(offset(w.pts, -w.width / 2), WATER);
    } else
      g.line(
        w.pts.map(([x, z]) => [x, 0, z] as V3),
        WATER,
      );
  }
  const wet = (x: number, z: number) =>
    (c.water || []).some((w) =>
      w.width ? distToLine(x, z, w.pts) < w.width / 2 + 4 : sideOf(x, z, w.pts) === w.side || distToLine(x, z, w.pts) < 4,
    );
  // Blocks on the street grid, tallest at each downtown's centre
  const centres: [number, number, number, number][] = [[0, 0, c.peak, c.spread], ...(c.more || [])];
  const step = 13,
    cos = Math.cos(c.grid),
    sin = Math.sin(c.grid);
  for (let i = -9; i <= 9; i++)
    for (let j = -9; j <= 9; j++) {
      const lx = i * step + (rand() - 0.5) * 3,
        lz = j * step + (rand() - 0.5) * 3;
      const x = lx * cos - lz * sin,
        z = lx * sin + lz * cos;
      if (Math.hypot(x, z) > RADIUS - 10 || wet(x, z)) continue;
      const h = Math.max(...centres.map(([cx, cz, p, s]) => p * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s))));
      const tall = h * (0.35 + rand() * 0.9) + 2 + rand() * 4;
      if (tall < 4 && rand() < 0.5) continue;
      const w = 5 + rand() * 4,
        d = 5 + rand() * 4;
      const round = tall > 30 && rand() < 0.12;
      g.prism(
        round ? ngon(10, w / 2) : rect(w, d, c.grid),
        x,
        z,
        0,
        tall,
        tall > 40 && rand() < 0.3 ? 0.75 : 1,
        BUILDING,
        tall > 28 ? Math.floor(tall / 22) : 0,
      );
    }
  c.landmarks.forEach((l) => l(g));
  // A ring on the ground at each highlighted place, and a floating diamond where there's no landmark to mark it
  for (const [, , x, z, top] of c.spots) {
    g.line(
      ngon(12, top ? 8 : 4).map(([a, b]) => [x + a, 0.3, z + b] as V3),
      SPOT,
      true,
    );
    if (top) continue;
    g.line(
      [
        [x, 0, z],
        [x, 11, z],
      ],
      SPOT,
    );
    g.prism(ngon(4, 2.4), x, z, 14, 17.5, 0, SPOT);
    g.prism(ngon(4, 2.4), x, z, 14, 11, 0, SPOT);
  }
  return g;
};

const GLOBE_R = 100;
const sphere = (lat: number, lng: number, r = GLOBE_R): V3 => {
  const [la, ln] = [(lat * Math.PI) / 180, (lng * Math.PI) / 180];
  return [r * Math.cos(la) * Math.sin(ln), r * Math.sin(la), r * Math.cos(la) * Math.cos(ln)];
};
const buildGlobe = () => {
  const g = new Geo();
  for (let lat = -60; lat <= 60; lat += 30)
    g.line(
      Array.from({ length: 72 }, (_, i) => sphere(lat, i * 5)),
      GROUND,
      true,
    );
  for (let lng = 0; lng < 360; lng += 30)
    g.line(
      Array.from({ length: 37 }, (_, i) => sphere(-90 + i * 5, lng)),
      GROUND,
    );
  for (const l of land as number[][])
    g.line(
      Array.from({ length: l.length / 2 }, (_, i) => sphere(l[i * 2 + 1], l[i * 2], GLOBE_R + 0.3)),
      WATER,
    );
  // Every node is linked back to home, the Twin Cities, along a raised great-circle arc
  const home = sphere(CITIES[0].lat, CITIES[0].lng, 1);
  for (const c of CITIES.slice(1)) {
    const to = sphere(c.lat, c.lng, 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, home[0] * to[0] + home[1] * to[1] + home[2] * to[2])));
    g.line(
      Array.from({ length: 33 }, (_, i) => {
        const t = i / 32;
        const [a, b] = [Math.sin((1 - t) * ang) / Math.sin(ang), Math.sin(t * ang) / Math.sin(ang)];
        const r = GLOBE_R * (1 + 0.12 * ang * Math.sin(Math.PI * t));
        return [0, 1, 2].map((k) => (a * home[k] + b * to[k]) * r) as V3;
      }),
      LANDMARK,
    );
  }
  return g;
};

const COLORS = ['#2a8fb8', '#3a7cff', '#5fd8ff', '#bff4ff', '#e8fbff'];
type View = { mode: 'globe' | 'city'; city: number };
const CAM = {
  globe: { min: 230, max: 700, start: 380, target: 0 },
  city: { min: 110, max: 460, start: 310, target: 26 },
};

const time = (tz: string) => new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });

const Nodes: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ mode: 'globe', city: 0 });
  const [, tick] = useState(0);
  const go = useRef<(v: View) => void>(() => {});
  const zoomBy = useRef<(factor: number) => void>(() => {});
  const pick = useRef<(spot: number) => void>(() => {});
  const [spot, setSpot] = useState(-1);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const globe = buildGlobe();
    const cities = new Map<number, Geo>();
    // tx/tz is the point the camera circles, gliding toward gx/gz when a spot is picked
    const cam = { yaw: 0, pitch: 0.35, dist: CAM.globe.start, born: performance.now(), tx: 0, tz: 0, gx: 0, gz: 0 };
    let sel = -1;
    // Dust drifting up through the projection
    const motes = Array.from({ length: 140 }, () => {
      const [a, r] = [Math.random() * Math.PI * 2, Math.sqrt(Math.random()) * RADIUS];
      return [Math.cos(a) * r, Math.random() * 130, Math.sin(a) * r, 4 + Math.random() * 10];
    });
    let cur: View = { mode: 'globe', city: 0 };
    let touched = 0,
      overscroll = 0,
      W = 0,
      H = 0,
      raf = 0,
      last = performance.now();
    let hits: { i: number; x: number; y: number }[] = [];

    const show = (v: View) => {
      const from = cur;
      cur = v;
      cam.born = performance.now();
      overscroll = 0;
      sel = -1;
      Object.assign(cam, { tx: 0, tz: 0, gx: 0, gz: 0 });
      setSpot(-1);
      if (v.mode === 'globe') {
        // Come back out facing the city you were in
        const c = CITIES[v.city];
        Object.assign(cam, { yaw: (-c.lng * Math.PI) / 180, pitch: (c.lat * Math.PI) / 180, dist: CAM.globe.start });
      } else Object.assign(cam, { yaw: from.mode === 'city' ? cam.yaw : -0.5, pitch: 0.42, dist: CAM.city.start });
      setView(v);
    };
    go.current = show;

    const select = (i: number) => {
      const s = i >= 0 ? CITIES[cur.city].spots[i] : undefined;
      sel = s ? i : -1;
      [cam.gx, cam.gz] = s ? [s[2], s[3]] : [0, 0];
      if (s) cam.dist = Math.min(cam.dist, 220);
      touched = performance.now();
      setSpot(sel);
    };
    pick.current = select;

    const zoom = (factor: number) => {
      const lim = CAM[cur.mode];
      const want = cam.dist * factor;
      cam.dist = Math.max(lim.min, Math.min(lim.max, want));
      touched = performance.now();
      // Keep zooming past the limit to move between the globe and a city
      if (want > lim.max && cur.mode === 'city') overscroll += want - lim.max;
      else if (want < lim.min && cur.mode === 'globe') overscroll += lim.min - want;
      else overscroll = 0;
      if (overscroll < 90) return;
      if (cur.mode === 'city') show({ mode: 'globe', city: cur.city });
      else {
        const near = [...hits].sort((a, b) => Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2))[0];
        if (near) show({ mode: 'city', city: near.i });
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!calm && now - touched > 2500) cam.yaw += dt * (cur.mode === 'globe' ? 0.12 : 0.16);
      const dpr = Math.min(2, devicePixelRatio || 1);
      if (canvas.width !== Math.round(W * dpr)) [canvas.width, canvas.height] = [Math.round(W * dpr), Math.round(H * dpr)];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      cam.tx += (cam.gx - cam.tx) * Math.min(1, dt * 3);
      cam.tz += (cam.gz - cam.tz) * Math.min(1, dt * 3);
      // Now and then the signal slips sideways, like an old transmission
      if (!calm && now % 5300 < 90) ctx.translate((Math.random() - 0.5) * 8, 0);

      const g = cur.mode === 'globe' ? globe : (cities.get(cur.city) ?? cities.set(cur.city, buildCity(CITIES[cur.city])).get(cur.city)!);
      // The hologram builds up from the pad when it appears, and flickers a little
      const grow = Math.min(1, (now - cam.born) / 1100);
      const rise = cur.mode === 'city' ? 1 - (1 - grow) ** 3 : 1;
      const flicker = (0.9 + 0.1 * Math.sin(now / 47) * Math.sin(now / 131)) * Math.min(1, grow * 1.6);
      const f = Math.min(W, H) * 1.15;
      const [cy, sy, cp, sp] = [Math.cos(cam.yaw), Math.sin(cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch)];
      const target = CAM[cur.mode].target;
      const n = g.v.length / 3;
      const px = new Float32Array(n),
        py = new Float32Array(n),
        pz = new Float32Array(n);
      const project = (x: number, y: number, z: number, out: number) => {
        x -= cam.tx;
        z -= cam.tz;
        y = y * rise - target;
        const x1 = x * cy + z * sy,
          z1 = -x * sy + z * cy;
        const y2 = y * cp - z1 * sp,
          z2 = y * sp + z1 * cp;
        const d = cam.dist - z2;
        if (out < 0) return [W / 2 + (f * x1) / d, H / 2 - (f * y2) / d, z2, d] as const;
        px[out] = W / 2 + (f * x1) / d;
        py[out] = H / 2 - (f * y2) / d;
        pz[out] = d > 5 ? z2 : NaN;
        return null;
      };
      for (let i = 0; i < n; i++) project(g.v[i * 3], g.v[i * 3 + 1], g.v[i * 3 + 2], i);

      // The beam from the projector below up to the pad (the pad's outer ring is the city's first 72 points)
      if (cur.mode === 'city') {
        let [l, r, top] = [W, 0, H];
        for (let i = 0; i < 72; i++) [l, r, top] = [Math.min(l, px[i]), Math.max(r, px[i]), Math.min(top, py[i])];
        const beam = ctx.createLinearGradient(0, H, 0, top);
        beam.addColorStop(0, 'rgba(95,216,255,0.22)');
        beam.addColorStop(1, 'rgba(95,216,255,0)');
        ctx.fillStyle = beam;
        ctx.globalAlpha = flicker;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 30, H);
        ctx.lineTo(l, top + (H - top) * 0.45);
        ctx.lineTo(r, top + (H - top) * 0.45);
        ctx.lineTo(W / 2 + 30, H);
        ctx.fill();
      }

      // Lines facing away (the far side of the globe, the back of the city) are dimmer
      const back = cur.mode === 'globe' ? 0 : -RADIUS * 0.3;
      for (let k = 0; k < KINDS; k++)
        for (const near of [false, true]) {
          ctx.beginPath();
          for (let e = 0; e < g.e.length; e += 3) {
            if (g.e[e + 2] !== k) continue;
            const [a, b] = [g.e[e], g.e[e + 1]];
            if (isNaN(pz[a]) || isNaN(pz[b])) continue;
            if (pz[a] + pz[b] > back * 2 !== near) continue;
            ctx.moveTo(px[a], py[a]);
            ctx.lineTo(px[b], py[b]);
          }
          const strength = (near ? 1 : cur.mode === 'globe' ? 0.16 : 0.45) * flicker;
          ctx.strokeStyle = COLORS[k];
          ctx.globalAlpha = strength * 0.22;
          ctx.lineWidth = k >= LANDMARK ? 4 : 3;
          ctx.stroke();
          ctx.globalAlpha = strength * (k === GROUND ? 0.45 : k === BUILDING ? 0.55 : 0.9);
          ctx.lineWidth = k >= LANDMARK ? 1.3 : 0.8;
          ctx.stroke();
        }

      if (cur.mode === 'city') {
        ctx.fillStyle = '#9fe9ff';
        for (const m of motes) {
          m[1] = (m[1] + dt * m[3]) % 130;
          const [x, y, z] = project(m[0] + cam.tx, m[1], m[2] + cam.tz, -1)!;
          ctx.globalAlpha = (0.25 + 0.5 * Math.sin((m[1] / 130) * Math.PI)) * flicker;
          ctx.fillRect(Math.round(x), Math.round(y), z > 0 ? 2 : 1, z > 0 ? 2 : 1);
        }
        // The picked spot: a light column and a ring pulsing out from it
        const s = CITIES[cur.city].spots[sel];
        if (s) {
          const r = 6 + ((now / 25) % 18);
          ctx.strokeStyle = '#e8fbff';
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = (1 - (r - 6) / 18) * flicker;
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            const [x, y] = project(s[2] + Math.cos(a) * r, 0.5, s[3] + Math.sin(a) * r, -1)!;
            ctx[i ? 'lineTo' : 'moveTo'](x, y);
          }
          ctx.stroke();
          const [x0, y0] = project(s[2], 0, s[3], -1)!;
          const [x1, y1] = project(s[2], (s[4] ?? 18) + 40, s[3], -1)!;
          const col = ctx.createLinearGradient(x0, y0, x1, y1);
          col.addColorStop(0, 'rgba(232,251,255,0.5)');
          col.addColorStop(1, 'rgba(232,251,255,0)');
          ctx.strokeStyle = col;
          ctx.lineWidth = 6;
          ctx.globalAlpha = flicker;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '12px "Fixedsys Excelsior", "Courier New", monospace';
      ctx.textAlign = 'center';
      hits = [];
      if (cur.mode === 'globe') {
        CITIES.forEach((c, i) => {
          const [x, y, z] = project(...sphere(c.lat, c.lng), -1)!;
          if (z < 0) return;
          hits.push({ i, x, y });
          const pulse = 3 + 2 * Math.sin(now / 300 + i);
          ctx.globalAlpha = 0.35 * flicker;
          ctx.fillStyle = '#5fd8ff';
          ctx.beginPath();
          ctx.arc(x, y, 6 + pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = flicker;
          ctx.fillStyle = '#e8fbff';
          ctx.beginPath();
          ctx.arc(x, y, 2.6, 0, Math.PI * 2);
          ctx.fill();
          // Western labels go left, so the US cities don't print over each other
          ctx.textAlign = c.lng < -90 ? 'right' : 'left';
          ctx.fillText(c.short, x + (c.lng < -90 ? -10 : 10), y + 4);
        });
      } else if (grow === 1) {
        CITIES[cur.city].spots.forEach(([name, , sx, sz, top], i) => {
          const [x, y, z] = project(sx, (top ?? 18) + 5, sz, -1)!;
          hits.push({ i, x, y });
          const on = i === sel;
          ctx.fillStyle = on ? '#ffffff' : '#bff4ff';
          ctx.globalAlpha = (on ? 1 : sel >= 0 ? 0.35 : z > back ? 0.85 : 0.35) * flicker;
          // Only the picked spot spells out its name; the others show their number, so the middle of town stays readable
          if (on) ctx.fillText(`[${i + 1}] ${name.toUpperCase()}`, x, y);
          else {
            ctx.strokeStyle = ctx.fillStyle;
            ctx.lineWidth = 1;
            ctx.strokeRect(Math.round(x) - 8.5, Math.round(y) - 11.5, 17, 15);
            ctx.fillText(String(i + 1), x, y);
          }
        });
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    const resize = new ResizeObserver(() => ([W, H] = [canvas.clientWidth, canvas.clientHeight]));
    resize.observe(canvas);

    // One finger or the mouse turns it, two fingers pinch to zoom, a tap opens a city on the globe or picks a spot in one
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0,
      moved = 0;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      moved = pointers.size > 1 ? 99 : 0;
      touched = performance.now();
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const [dx, dy] = [e.offsetX - p.x, e.offsetY - p.y];
      p.x = e.offsetX;
      p.y = e.offsetY;
      touched = performance.now();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoom(pinch / d);
        pinch = d;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      cam.yaw += dx * 0.008;
      cam.pitch = Math.max(cur.mode === 'globe' ? -1.2 : 0.05, Math.min(cur.mode === 'globe' ? 1.2 : 1.35, cam.pitch + dy * 0.006));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
      if (moved > 8) return;
      const hit = hits.find((h) => Math.hypot(h.x - e.offsetX, h.y - e.offsetY) < 22);
      if (cur.mode === 'city') select(hit ? hit.i : -1);
      else if (hit) show({ mode: 'city', city: hit.i });
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(e.deltaY * 0.0015));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    zoomBy.current = zoom;
    const clock = setInterval(() => tick((t) => t + 1), 20000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(clock);
      resize.disconnect();
    };
  }, []);

  const city = CITIES[view.city];
  const step = (d: number) => go.current({ mode: 'city', city: (view.city + d + CITIES.length) % CITIES.length });
  const btn = 'px-2 py-1 border border-[#5fd8ff]/50 text-[#bff4ff] hover:bg-[#5fd8ff]/15 active:bg-[#5fd8ff]/30';

  return (
    <div
      className="nodes relative w-full h-full overflow-hidden bg-[#020a12] text-[14px] leading-tight text-[#bff4ff] select-none outline-none"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') step(1);
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'Escape') spot >= 0 ? pick.current(-1) : go.current({ mode: 'globe', city: view.city });
        else if (e.key === '+' || e.key === '=') zoomBy.current(0.85);
        else if (e.key === '-') zoomBy.current(1.18);
      }}
    >
      <style>{`
        @font-face {
          font-family: 'Fixedsys Excelsior';
          src: url('/font/fixedsys-excelsior/fsex300-webfont.woff') format('woff');
        }
        .nodes, .nodes button { font-family: 'Fixedsys Excelsior', 'Courier New', monospace; -webkit-font-smoothing: none; }
        .nodes .roll { animation: nodes-roll 7s linear infinite; }
        @keyframes nodes-roll { from { transform: translateY(-20%); } to { transform: translateY(520%); } }
        @media (prefers-reduced-motion: reduce) { .nodes .roll { display: none; } }
      `}</style>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_70%,rgba(40,140,200,0.25),transparent_65%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing" />
      {/* Old-screen look: scanlines, a bright band rolling down, dark corners */}
      <div className="absolute inset-0 pointer-events-none opacity-40 bg-[repeating-linear-gradient(0deg,transparent_0,transparent_2px,rgba(0,0,0,0.6)_3px)]" />
      <div className="roll absolute inset-x-0 top-0 h-1/5 pointer-events-none bg-[linear-gradient(transparent,rgba(95,216,255,0.06),transparent)]" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55))]" />

      <div className="absolute top-2 left-3 right-3 flex items-start justify-between gap-2 pointer-events-none">
        <div>
          <div className="text-[#5fd8ff] tracking-[0.3em] text-[10px]">SANKTUARY // NODES</div>
          {view.mode === 'globe' ? (
            <div className="text-lg tracking-widest">{CITIES.length} CITIES</div>
          ) : (
            <>
              <div className="text-lg tracking-widest">{city.name.toUpperCase()}</div>
              <div className="opacity-70">
                NODE {String(view.city + 1).padStart(2, '0')}/{String(CITIES.length).padStart(2, '0')} · {Math.abs(city.lat).toFixed(2)}°
                {city.lat < 0 ? 'S' : 'N'} {Math.abs(city.lng).toFixed(2)}°{city.lng < 0 ? 'W' : 'E'} · {time(city.tz)}
              </div>
            </>
          )}
        </div>
        <div className="flex gap-1 pointer-events-auto">
          <button className={btn} onClick={() => zoomBy.current(0.8)} aria-label="Zoom in">
            +
          </button>
          <button className={btn} onClick={() => zoomBy.current(1.25)} aria-label="Zoom out">
            −
          </button>
        </div>
      </div>

      <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-1">
        {view.mode === 'city' && spot >= 0 && (
          <div className="self-start max-w-[340px] border border-[#5fd8ff]/50 bg-[#020a12]/80 px-2 py-1">
            <div className="text-white">
              [{spot + 1}] {city.spots[spot][0].toUpperCase()}
            </div>
            <div className="opacity-80">{city.spots[spot][1]}</div>
          </div>
        )}
        {view.mode === 'city' && (
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {city.spots.map(([name], i) => (
              <button
                key={name}
                className={`${btn} shrink-0 py-0.5 ${spot === i ? 'bg-[#5fd8ff]/25 border-[#bff4ff] text-white' : 'opacity-80'}`}
                onClick={() => pick.current(spot === i ? -1 : i)}
              >
                {i + 1} {name}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <button className={btn} onClick={() => go.current({ mode: 'globe', city: view.city })} aria-label="Globe">
            ◎
          </button>
          <button className={btn} onClick={() => step(-1)} aria-label="Previous city">
            ‹
          </button>
          <div className="flex-1 flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {CITIES.map((c, i) => (
              <button
                key={c.short}
                className={`${btn} shrink-0 ${view.mode === 'city' && view.city === i ? 'bg-[#5fd8ff]/25 border-[#bff4ff]' : ''}`}
                onClick={() => go.current({ mode: 'city', city: i })}
              >
                {c.name}
              </button>
            ))}
          </div>
          <button className={btn} onClick={() => step(1)} aria-label="Next city">
            ›
          </button>
        </div>
      </div>
    </div>
  );
};

export default Nodes;
