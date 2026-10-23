import React, { useEffect, useRef, useState } from 'react';
// Coastlines from Natural Earth (public domain), 1° precision, as flat [lng, lat, lng, lat, ...] lines
import land from './landOutline.json';

/**
 * Sanktuary's nodes: a spinning wireframe globe with every city on it, and a hologram of each city built from
 * its real buildings (public/nodes/*.bin, made by ops/nodes/build_cities.py from Overture Maps).
 * Drawn with WebGL2: glowing instanced lines over dark see-through building shells, bloom, then an old-screen pass.
 */

type V3 = [number, number, number];
/** Name, a line about it, latitude, longitude */
type Spot = [name: string, note: string, lat: number, lng: number];
interface City {
  name: string;
  short: string;
  lat: number;
  lng: number;
  tz: string;
  /** The stretch of the metro the hologram covers */
  area: string;
  /** Ten places that matter to the crew */
  spots: Spot[];
  /** Districts and landmarks to label: name, latitude, longitude */
  marks: [name: string, lat: number, lng: number][];
}

const CITIES: City[] = [
  {
    name: 'Twin Cities',
    short: 'MSP',
    lat: 44.9778,
    lng: -93.265,
    tz: 'America/Chicago',
    area: 'NW METRO TO ST PAUL',
    spots: [
      ['First Avenue', "Prince's club: the Purple Rain stage, Rhymesayers shows, stars on the wall", 44.9785, -93.276],
      ['Cedar-Riverside', 'The heart of Somali Minneapolis and The Cedar, the global roots venue', 44.969, -93.2475],
      ['Walker Art Center', 'Contemporary art and the Spoonbridge and Cherry in the sculpture garden', 44.9682, -93.2886],
      ['North Loop', 'Old brick warehouses full of streetwear shops, studios and galleries', 44.987, -93.277],
      ['Midtown Global Market', 'The old Sears building on Lake Street, now East African, Latino and Native makers', 44.9485, -93.2605],
      ['Mia and MCAD', 'The art museum next door to the art and design college', 44.9586, -93.2738],
      ['George Floyd Square', 'The memorial at 38th and Chicago, murals and community art', 44.9343, -93.262],
      ['Penumbra Theatre', "St. Paul's Black theater since 1976, where August Wilson got his start, in historic Rondo", 44.9497, -93.1269],
      ['Lowertown', "St. Paul's warehouse lofts, the Art Crawl and Union Depot", 44.95, -93.086],
      ['Paisley Park', "Prince's studio and home, out in Chanhassen", 44.8617, -93.5592],
    ],
    marks: [
      ['MINNEAPOLIS', 44.977, -93.268],
      ['ST PAUL', 44.946, -93.093],
      ['BROOKLYN PARK', 45.094, -93.356],
      ['MAPLE GROVE', 45.072, -93.456],
      ['ROSEVILLE', 45.006, -93.156],
    ],
  },
  {
    name: 'Seattle',
    short: 'SEA',
    lat: 47.6062,
    lng: -122.3321,
    tz: 'America/Los_Angeles',
    area: 'SEATTLE TO TACOMA',
    spots: [
      ['The Crocodile', 'The Belltown club where grunge broke out', 47.6145, -122.348],
      ['Central District', "Black Seattle's historic heart: Quincy Jones and Hendrix grew up here; Wa Na Wari gallery", 47.6098, -122.3013],
      ['International District', 'Chinatown, Japantown and Little Saigon, and the Wing Luke Museum', 47.5982, -122.3233],
      ['KEXP', 'The listener-powered radio station, with a live room at Seattle Center', 47.6216, -122.354],
      ['Capitol Hill', 'Pike/Pine nightlife: Neumos, Chop Suey and the record shops', 47.6141, -122.3196],
      ['Pike Place Market', 'The public market over the bay since 1907: artisans, printmakers, buskers', 47.6097, -122.3422],
      ['MoPOP', 'The Museum of Pop Culture: Hendrix, Northwest hip-hop, Afrofuturism', 47.6215, -122.3481],
      ['Pioneer Square', "The city's oldest blocks and the First Thursday gallery walk", 47.6005, -122.3335],
      ['Olympic Sculpture Park', "The Seattle Art Museum's park stepping down to the bay", 47.6166, -122.3553],
      ['Columbia City', 'Little Ethiopia along Rainier Ave and the old Columbia City Theater', 47.5596, -122.2866],
    ],
    marks: [
      ['SEATTLE', 47.6062, -122.3321],
      ['BELLEVUE', 47.6101, -122.2015],
      ['SEA-TAC', 47.4502, -122.3088],
      ['RENTON', 47.4829, -122.2171],
      ['KENT', 47.3809, -122.2348],
      ['FEDERAL WAY', 47.3223, -122.3126],
      ['TACOMA', 47.2529, -122.4443],
    ],
  },
  {
    name: 'Philadelphia',
    short: 'PHL',
    lat: 39.9526,
    lng: -75.1652,
    tz: 'America/New_York',
    area: 'PHILADELPHIA AND CAMDEN',
    spots: [
      [
        'Sigma Sound',
        "Where Gamble and Huff made the Sound of Philadelphia: the O'Jays, Teddy Pendergrass, Patti LaBelle",
        39.956,
        -75.159,
      ],
      ['Clef Club of Jazz', "The jazz home started by the Black musicians' union, Local 274", 39.9418, -75.1655],
      ['South Street', 'Vintage, streetwear and the Magic Gardens mosaics', 39.9427, -75.1593],
      ['Franklin Music Hall', 'The old Electric Factory, home of the neo-soul and club nights', 39.959, -75.149],
      ['African American Museum', 'The first city-funded museum of Black life in the US, near Mother Bethel AME', 39.9533, -75.1528],
      ['Barnes Foundation', 'Modern art and African sculpture on the Parkway', 39.9606, -75.1727],
      ['Village of Arts and Humanities', 'Community-built sculpture parks and studios in North Philly', 39.9905, -75.1475],
      ['ICA', 'Contemporary art at Penn, where Warhol had his first museum show', 39.954, -75.1945],
      ['Reading Terminal Market', 'The food hall under the old train shed, by the Chinatown Friendship Gate', 39.9533, -75.159],
      ['Bok Building', 'A 1938 trade school turned into studios for designers, makers and filmmakers', 39.9265, -75.1593],
    ],
    marks: [
      ['CENTER CITY', 39.9524, -75.1636],
      ['NORTH PHILLY', 39.99, -75.155],
      ['SOUTH PHILLY', 39.925, -75.17],
      ['WEST PHILLY', 39.957, -75.21],
      ['FISHTOWN', 39.9725, -75.1335],
      ['CAMDEN', 39.9259, -75.1196],
    ],
  },
  {
    name: 'London',
    short: 'LDN',
    lat: 51.5074,
    lng: -0.1278,
    tz: 'Europe/London',
    area: 'CENTRAL LONDON',
    spots: [
      ['Soho', "Ronnie Scott's, the record shops on Berwick Street and the old studios", 51.5136, -0.1355],
      ['Brixton', 'Windrush Square, the Black Cultural Archives and the sound-system lineage', 51.4612, -0.115],
      ['Brick Lane', 'Banglatown, street art, and the roots of garage, grime and jungle', 51.5215, -0.0717],
      ['Barbican', 'The Brutalist arts centre: experimental music, film and exhibitions', 51.5201, -0.0937],
      ['Tate Modern', 'The power station turned museum; the Tanks show live and sound art', 51.5076, -0.0994],
      ['Somerset House', 'London Fashion Week shows and the 1-54 Contemporary African Art Fair', 51.511, -0.1172],
      ['Fabric', 'The club in the old Smithfield cold stores that shaped drum and bass and dubstep', 51.5196, -0.1025],
      ['Peckham', 'Rye Lane, "Little Lagos", the Bussey Building and rooftop nights', 51.4697, -0.0688],
      ['Central Saint Martins', "The fashion school at King's Cross: McQueen, Wales Bonner, Mowalola", 51.5354, -0.1253],
      ['Camden', 'Camden Market, the canal and the Roundhouse', 51.5432, -0.1519],
    ],
    marks: [
      ['THE CITY', 51.5155, -0.0922],
      ['WEST END', 51.5115, -0.134],
      ["KING'S CROSS", 51.5308, -0.1238],
      ['SHOREDITCH', 51.5255, -0.0786],
      ['CANARY WHARF', 51.5054, -0.0235],
      ['THE SHARD', 51.5045, -0.0865],
    ],
  },
  {
    name: 'Riyadh',
    short: 'RUH',
    lat: 24.7136,
    lng: 46.6753,
    tz: 'Asia/Riyadh',
    area: 'CENTRAL RIYADH',
    spots: [
      ['JAX District', "Diriyah's warehouse arts district and home of the Diriyah Contemporary Art Biennale", 24.74, 46.577],
      ['XP Music Futures', "MDLBEAST's music conference and studios in JAX: Arab hip-hop and electronic", 24.739, 46.579],
      ['SAMoCA', 'The Saudi Arabia Museum of Contemporary Art, in JAX', 24.738, 46.576],
      ['National Museum', 'Saudi history from prehistory to today, by Murabba Palace', 24.6475, 46.7105],
      ['Al-Batha', 'Markets shaped by Sudanese, Yemeni, Egyptian and South Asian communities', 24.634, 46.718],
      ['Souq Al-Zal', 'The old market by Masmak Fortress: Sadu weaving, bishts, ouds', 24.63, 46.713],
      ['Noor Riyadh', 'The yearly light-art festival that takes over towers, wadis and courtyards', 24.69, 46.685],
      ['At-Turaif', 'The UNESCO mud-brick city in Diriyah, birthplace of the first Saudi state', 24.734, 46.573],
      ['KAFD', 'The King Abdullah Financial District, its plazas and new towers', 24.763, 46.64],
      ['Tuwaiq Palace', "Frei Otto's long stone wall and white tents over the cliffs of Wadi Hanifah", 24.683, 46.621],
    ],
    marks: [
      ['KINGDOM CENTRE', 24.7114, 46.6744],
      ['OLD RIYADH', 24.631, 46.713],
      ['AL MALAZ', 24.664, 46.733],
      ['KING SAUD UNIVERSITY', 24.7166, 46.6198],
      ['AL YASMIN', 24.82, 46.64],
    ],
  },
  {
    name: 'Houston',
    short: 'HOU',
    lat: 29.7604,
    lng: -95.3698,
    tz: 'America/Chicago',
    area: 'DOWNTOWN TO KATY',
    spots: [
      ['Project Row Houses', "Rick Lowe and fellow artists' Third Ward shotgun houses, art and community since 1993", 29.734, -95.36],
      ['Screwed Up Records', "DJ Screw's shop on the South Side, home of chopped and screwed and the S.U.C.", 29.69, -95.338],
      ['Emancipation Park', 'Bought by freed Texans in 1872 for Juneteenth, across from the Eldorado Ballroom', 29.731, -95.356],
      ['Menil and Rothko Chapel', 'The Menil Collection and the Rothko Chapel', 29.7375, -95.3985],
      ['TSU and S.H.A.P.E.', "Texas Southern's John Biggers murals and the S.H.A.P.E. Community Center", 29.7225, -95.36],
      ['Museum District', 'The MFAH and the Contemporary Arts Museum', 29.7256, -95.3905],
      ['POST Houston', 'The old post office on the bayou, now 713 Music Hall and a rooftop park', 29.765, -95.366],
      ['Fifth Ward', 'The DeLuxe Theater on Lyons Ave, Peacock Records and the Geto Boys', 29.778, -95.333],
      ["Freedmen's Town", 'Brick streets laid by freed Black craftsmen after 1865, just west of downtown', 29.755, -95.383],
      ['Southwest Houston', 'Alief and Asiatown: Nigerian, Vietnamese and Latin American Houston', 29.705, -95.545],
    ],
    marks: [
      ['DOWNTOWN', 29.7604, -95.3698],
      ['GALLERIA', 29.739, -95.463],
      ['ENERGY CORRIDOR', 29.7835, -95.6316],
      ['KATY', 29.7858, -95.8245],
      ['SUGAR LAND', 29.6197, -95.6349],
    ],
  },
  {
    name: 'Atlanta',
    short: 'ATL',
    lat: 33.749,
    lng: -84.388,
    tz: 'America/New_York',
    area: 'DOWNTOWN TO BUCKHEAD',
    spots: [
      [
        'Sweet Auburn',
        "Dr. King's street: the APEX Museum, the Curb Market and WERD, the first Black-owned radio station",
        33.7552,
        -84.377,
      ],
      ['Trap Music Museum', "T.I.'s museum to trap music on the Westside", 33.7811, -84.4113],
      ['Atlanta University Center', 'Morehouse, Spelman and Clark Atlanta, and the Spelman College Museum of Fine Art', 33.746, -84.413],
      ['Hammonds House', 'African American and diaspora art in a West End house museum', 33.7385, -84.421],
      ['SCAD FASH', 'The fashion and film museum in Midtown', 33.792, -84.388],
      ['High Museum', "The Southeast's big art museum, on Peachtree", 33.79, -84.3856],
      ['Castleberry Hill', 'Lofts, galleries and studios on the edge of downtown', 33.748, -84.4],
      ['Little Five Points', 'Criminal Records, the Variety Playhouse, vintage shops and murals', 33.7645, -84.349],
      ['Patchwerk Studios', 'Where OutKast, TLC, Goodie Mob and Young Thug cut records', 33.784, -84.407],
      ['Cascade', "Cascade Family Skating in Southwest Atlanta, a home of the city's music and dance", 33.723, -84.503],
    ],
    marks: [
      ['DOWNTOWN', 33.7537, -84.3901],
      ['MIDTOWN', 33.7838, -84.383],
      ['BUCKHEAD', 33.8384, -84.3797],
      ['WEST END', 33.7366, -84.4155],
      ['DECATUR', 33.7748, -84.2963],
    ],
  },
];

// Line kinds; each has its own colour, width and strength in the shaders below
const GROUND = 0,
  WATER = 1,
  BLOCK = 2,
  TOWER = 3,
  SPOT = 4,
  ROAD = 5;
const RADIUS = 120;

/** Segments as [x0, y0, z0, x1, y1, z1, kind] runs */
class Lines {
  d: number[] = [];
  seg(a: V3, b: V3, kind: number) {
    this.d.push(...a, ...b, kind);
  }
  line(pts: V3[], kind: number, closed = false) {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) this.seg(pts[i], pts[(i + 1) % pts.length], kind);
  }
}
const ring = (r: number, n: number, y = 0, x = 0, z = 0): V3[] =>
  Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * r, y, z + Math.sin((i / n) * Math.PI * 2) * r]);

const GLOBE_R = 100;
const sphere = (lat: number, lng: number, r = GLOBE_R): V3 => {
  const [la, ln] = [(lat * Math.PI) / 180, (lng * Math.PI) / 180];
  return [r * Math.cos(la) * Math.sin(ln), r * Math.sin(la), r * Math.cos(la) * Math.cos(ln)];
};
const buildGlobe = () => {
  const g = new Lines();
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
      TOWER,
    );
  }
  return new Float32Array(g.d);
};

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
type Scene = {
  lines: Float32Array<ArrayBuffer>;
  /** Wall and roof triangles as [x, y, z, nx, ny, nz] per vertex */
  hull: Float32Array<ArrayBuffer>;
  /** Where each spot sits; spots beyond the disc stand on its rim, with how far off they really are */
  spots: { x: number; z: number; away: string }[];
  marks: { name: string; at: V3 }[];
};

/** Unpacks a city file (format in ops/nodes/build_cities.py) into lines and shells */
const decodeCity = (buf: ArrayBuffer, c: City): Scene => {
  const v = new DataView(buf);
  const [lat0, lng0, r] = [v.getFloat32(5, true), v.getFloat32(9, true), v.getUint16(13, true)];
  // Units per metre, and how much to stretch heights so a metro-wide view still has a skyline
  const [q, lift] = [v.getFloat32(15, true), v.getFloat32(19, true)];
  let o = 23;
  const s = RADIUS / r / q;
  const g = new Lines();
  const hull: number[] = [];
  const tops: V3[] = [];
  const read = (n: number) => {
    const pts: [number, number][] = [];
    let [x, z] = [0, 0];
    for (let i = 0; i < n; i++, o += 4) {
      x += v.getInt16(o, true);
      z += v.getInt16(o + 2, true);
      pts.push([x * s, z * s]);
    }
    return pts;
  };
  for (let n = v.getUint16(o, true), i = (o += 2) * 0; i < n; i++) {
    const [count, tier, b, t] = [v.getUint8(o), v.getUint8(o + 1), v.getUint16(o + 2, true), v.getUint16(o + 4, true)];
    o += 6;
    const pts = read(count);
    const [y0, y1] = [b * s * lift, Math.max(t * s * lift, 0.6)];
    const kind = tier ? TOWER : BLOCK;
    let convex = true;
    pts.forEach(([x, z], k) => {
      const [nx, nz] = pts[(k + 1) % count];
      const [px, pz] = pts[(k + count - 1) % count];
      g.seg([x, y1, z], [nx, y1, nz], kind);
      if (tier || y0 > 0) g.seg([x, y0, z], [nx, y0, nz], kind);
      // Uprights only where the outline turns, so round towers get ribs instead of a solid wall
      const [ax, az, bx, bz] = [x - px, z - pz, nx - x, nz - z];
      const turn = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
      if (turn < 0.94) g.seg([x, y0, z], [x, y1, z], kind);
      if (ax * bz - az * bx < 0 !== pts.length > 0 && ax * bz - az * bx !== 0) convex &&= true;
      const len = Math.hypot(bx, bz) || 1;
      const [wx, wz] = [bz / len, -bx / len];
      hull.push(x, y0, z, wx, 0, wz, nx, y0, nz, wx, 0, wz, nx, y1, nz, wx, 0, wz);
      hull.push(x, y0, z, wx, 0, wz, nx, y1, nz, wx, 0, wz, x, y1, z, wx, 0, wz);
      tops.push([x, y1, z]);
    });
    // Roofs as a fan; only for convex outlines, where a fan stays inside the shape
    const cross = pts.map(([x, z], k) => {
      const [nx, nz] = pts[(k + 1) % count];
      const [mx, mz] = pts[(k + 2) % count];
      return Math.sign((nx - x) * (mz - nz) - (nz - z) * (mx - nx));
    });
    convex = cross.every((c) => c >= 0) || cross.every((c) => c <= 0);
    if (convex)
      for (let k = 1; k < count - 1; k++)
        hull.push(pts[0][0], y1, pts[0][1], 0, 1, 0, pts[k][0], y1, pts[k][1], 0, 1, 0, pts[k + 1][0], y1, pts[k + 1][1], 0, 1, 0);
  }
  for (let n = v.getUint16(o, true), i = (o += 2) * 0; i < n; i++) {
    const [kind, count] = [v.getUint8(o), v.getUint16(o + 1, true)];
    o += 3;
    const y = kind === 1 ? 0.3 : 0.15;
    g.line(
      read(count).map(([x, z]) => [x, y, z]),
      kind === 1 ? WATER : ROAD,
    );
  }

  // The projector pad: rings and ticks on the ground
  g.line(ring(RADIUS, 96), GROUND, true);
  g.line(ring(RADIUS + 4, 96), GROUND, true);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    g.seg(
      [Math.cos(a) * (RADIUS + 4), 0, Math.sin(a) * (RADIUS + 4)],
      [Math.cos(a) * (RADIUS + 10), 0, Math.sin(a) * (RADIUS + 10)],
      GROUND,
    );
  }

  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180) * (RADIUS / r);
  const kz = 110540 * (RADIUS / r);
  const place = (lat: number, lng: number) => [(lng - lng0) * kx, -(lat - lat0) * kz];
  const spots: Scene['spots'] = [];
  for (const [, , lat, lng] of c.spots) {
    let [x, z] = place(lat, lng);
    let away = '';
    const d = Math.hypot(x, z);
    if (d > RADIUS - 4) {
      const km = (d / RADIUS) * (r / 1000);
      away = `${km < 10 ? km.toFixed(1) : Math.round(km)} km ${COMPASS[Math.round(((Math.atan2(x, -z) / Math.PI) * 4 + 8) % 8) % 8]}`;
      let a = Math.atan2(z, x);
      // Neighbours on the rim step aside so their beacons don't stack
      while (spots.some((p) => p.away && Math.hypot(p.x - Math.cos(a) * (RADIUS + 8), p.z - Math.sin(a) * (RADIUS + 8)) < 10)) a += 0.07;
      [x, z] = [Math.cos(a) * (RADIUS + 8), Math.sin(a) * (RADIUS + 8)];
    }
    spots.push({ x, z, away });
    g.line(ring(4, 12, 0.3, x, z), SPOT, true);
    g.seg([x, 0, z], [x, 11, z], SPOT);
    const diamond: V3[] = [
      [x + 2.4, 14, z],
      [x, 14, z + 2.4],
      [x - 2.4, 14, z],
      [x, 14, z - 2.4],
    ];
    g.line(diamond, SPOT, true);
    for (const p of diamond) {
      g.seg(p, [x, 17.5, z], SPOT);
      g.seg(p, [x, 10.5, z], SPOT);
    }
  }
  const marks = c.marks.map(([name, lat, lng]) => {
    const [x, z] = place(lat, lng);
    const top = tops.reduce((h, t) => (Math.hypot(t[0] - x, t[2] - z) < 3 ? Math.max(h, t[1]) : h), 4);
    return { name, at: [x, top + 5, z] as V3 };
  });
  return { lines: new Float32Array(g.d), hull: new Float32Array(hull), spots, marks };
};

// --- WebGL2 ---------------------------------------------------------------------------------------------------

const LINE_VS = `#version 300 es
layout(location=0) in vec2 a_quad;
layout(location=1) in vec3 i_p0;
layout(location=2) in vec3 i_p1;
layout(location=3) in float i_kind;
uniform mat4 u_mvp;
uniform vec2 u_res;
uniform float u_rise, u_globe, u_dim, u_px;
uniform vec3 u_eye;
out float v_cross, v_glow;
flat out int v_kind;
const float W[6] = float[6](1.1, 1.6, 1.1, 1.9, 2.2, 1.3);
// The skyline rises from the middle of the pad outwards
vec3 lift(vec3 p) { return vec3(p.x, p.y * clamp(u_rise * 1.35 - length(p.xz) / 120.0 * 0.35, 0.0, 1.0), p.z); }
void main() {
  vec4 c0 = u_mvp * vec4(lift(i_p0), 1.0), c1 = u_mvp * vec4(lift(i_p1), 1.0);
  if (c0.w < 1.0 && c1.w < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (c0.w < 1.0) c0 = mix(c0, c1, (1.0 - c0.w) / (c1.w - c0.w));
  else if (c1.w < 1.0) c1 = mix(c1, c0, (1.0 - c1.w) / (c0.w - c1.w));
  vec2 dir = normalize((c1.xy / c1.w - c0.xy / c0.w) * u_res + vec2(1e-5, 0.0));
  v_kind = int(i_kind + 0.5);
  vec4 c = mix(c0, c1, a_quad.x);
  c.xy += vec2(-dir.y, dir.x) * a_quad.y * W[v_kind] * u_px / u_res * c.w;
  c.z -= 0.0006 * c.w;
  v_cross = a_quad.y;
  // On the globe, lines on the far side are faint
  float facing = u_globe > 0.5 && dot(mix(i_p0, i_p1, a_quad.x), u_eye) < 0.0 ? 0.16 : 1.0;
  // Spot beacons show through the buildings in front of them
  v_glow = facing * (v_kind == 4 ? max(u_dim, 0.6) : u_dim);
  gl_Position = c;
}`;
const LINE_FS = `#version 300 es
precision mediump float;
in float v_cross, v_glow;
flat in int v_kind;
uniform float u_flicker;
out vec4 o;
const vec3 C[6] = vec3[6](vec3(0.16, 0.56, 0.72), vec3(0.23, 0.45, 1.0), vec3(0.08, 0.42, 0.85), vec3(0.16, 0.76, 1.0), vec3(0.75, 0.96, 1.0), vec3(0.11, 0.38, 0.72));
const float A[6] = float[6](0.55, 0.9, 0.55, 0.8, 1.0, 0.6);
void main() {
  float core = smoothstep(1.0, 0.0, abs(v_cross));
  vec3 col = mix(C[v_kind], vec3(0.85, 0.97, 1.0), pow(core, 4.0) * 0.6);
  o = vec4(col * core * A[v_kind] * v_glow * u_flicker * HEADROOM, 1.0);
}`;
const HULL_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_n;
uniform mat4 u_mvp;
uniform float u_rise;
out vec3 v_n, v_pos;
void main() {
  vec3 p = vec3(a_pos.x, a_pos.y * clamp(u_rise * 1.35 - length(a_pos.xz) / 120.0 * 0.35, 0.0, 1.0), a_pos.z);
  v_n = a_n;
  v_pos = p;
  gl_Position = u_mvp * vec4(p, 1.0);
}`;
// Dark glass that hides what's behind it, glowing where you see it edge-on
const HULL_FS = `#version 300 es
precision mediump float;
in vec3 v_n, v_pos;
uniform vec3 u_eye;
uniform float u_flicker;
out vec4 o;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(v_n), normalize(u_eye - v_pos))), 2.5);
  o = vec4((vec3(0.027, 0.1, 0.22) + vec3(0.16, 0.76, 1.0) * rim * 0.3) * HEADROOM, 0.72 * u_flicker);
}`;
const MOTE_VS = `#version 300 es
layout(location=0) in vec4 a_m;
uniform mat4 u_mvp;
uniform float u_time, u_px;
out float v_a;
void main() {
  float y = mod(a_m.y + u_time * a_m.w, 130.0);
  v_a = 0.25 + 0.5 * sin(y / 130.0 * 3.14159);
  gl_Position = u_mvp * vec4(a_m.x, y, a_m.z, 1.0);
  gl_PointSize = 2.0 * u_px;
}`;
const MOTE_FS = `#version 300 es
precision mediump float;
in float v_a;
uniform float u_flicker;
out vec4 o;
void main() { o = vec4(vec3(0.62, 0.91, 1.0) * v_a * u_flicker * HEADROOM, 1.0); }`;
const FULL_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
// Dual Kawase blur: cheap wide bloom from a couple of small passes
const DOWN_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
out vec4 o;
void main() {
  vec2 d = u_texel;
  o = (texture(u_tex, v_uv) * 4.0 + texture(u_tex, v_uv - d) + texture(u_tex, v_uv + d) + texture(u_tex, v_uv + vec2(d.x, -d.y)) + texture(u_tex, v_uv + vec2(-d.x, d.y))) / 8.0;
}`;
const UP_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
out vec4 o;
void main() {
  vec2 d = u_texel;
  vec4 s = texture(u_tex, v_uv + vec2(-d.x * 2.0, 0.0)) + texture(u_tex, v_uv + vec2(d.x * 2.0, 0.0));
  s += texture(u_tex, v_uv + vec2(0.0, d.y * 2.0)) + texture(u_tex, v_uv + vec2(0.0, -d.y * 2.0));
  s += (texture(u_tex, v_uv + vec2(-d.x, d.y)) + texture(u_tex, v_uv + d) + texture(u_tex, v_uv + vec2(d.x, -d.y)) + texture(u_tex, v_uv - d)) * 2.0;
  o = s / 12.0;
}`;
// The old screen: background glow, colour fringing, scanlines, a rolling band, dithering and the odd signal slip
const SCREEN_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_scene, u_bloom;
uniform vec2 u_res;
uniform float u_time, u_glitch, u_calm, u_warp, u_slide, u_crush;
out vec4 o;
float hash(float n) { return fract(sin(n) * 43758.5453); }
// The picture at one point, with the colour fringe pulling wider as you travel
vec3 look(vec2 uv) {
  vec2 sh = (uv - 0.5) * (0.004 + 0.018 * u_warp);
  vec3 mid = texture(u_scene, uv).rgb;
  vec3 c = vec3(texture(u_scene, uv - sh).r * 0.6 + mid.r * 0.4, mid.g, max(texture(u_scene, uv - sh).b, texture(u_scene, uv + sh).b));
  return (c + texture(u_bloom, uv).rgb) / HEADROOM;
}
void main() {
  vec2 uv = v_uv;
  uv.x += u_glitch * step(0.8, hash(floor(uv.y * 28.0) + floor(u_time * 16.0))) * 0.012;
  // Switching off like an old set: the picture squeezes down to a bright line
  float k = u_crush;
  uv = vec2(0.5 + (uv.x - 0.5) / (1.0 - 0.6 * k * k), 0.5 + (uv.y - 0.5) / max(1.0 - k, 0.015));
  vec3 c = vec3(0.0);
  if (u_warp > 0.01) {
    // Flying in: smear everything outward from the middle of the screen
    for (int i = 0; i < 12; i++) c += look(uv - (uv - 0.5) * (float(i) / 11.0) * 0.24 * u_warp);
    c *= (1.0 + 0.5 * u_warp) / 12.0;
  } else if (abs(u_slide) > 0.01) {
    // Whipping across to the next city: streak sideways
    for (int i = 0; i < 12; i++) c += look(uv + vec2((float(i) / 11.0 - 0.5) * 0.18 * u_slide, 0.0));
    c *= (1.0 + 0.4 * abs(u_slide)) / 12.0;
  } else c = look(uv);
  c *= (1.0 + 2.5 * k) * step(abs(uv.y - 0.5), 0.5) * step(abs(uv.x - 0.5), 0.5);
  c += vec3(0.6, 0.9, 1.0) * smoothstep(0.8, 1.0, k) * exp(-abs(v_uv.y - 0.5) * u_res.y * 0.25);
  // Soft knee: dense downtowns stay blue instead of burning out to white, with a little white in the hottest spots
  float m = max(c.b, max(c.g, c.r));
  if (m > 0.7) c *= (0.7 + 0.3 * (1.0 - exp((0.7 - m) / 0.3))) / m;
  c = mix(c, vec3(0.9, 0.98, 1.0), smoothstep(1.2, 3.0, m) * 0.35);
  float d = length((uv - vec2(0.5, 0.3)) * vec2(u_res.x / u_res.y, 1.0));
  c += mix(vec3(0.03, 0.12, 0.19), vec3(0.008, 0.024, 0.051), smoothstep(0.0, 0.8, d));
  float roll = fract(uv.y + u_time * 0.12 * (1.0 - u_calm));
  c *= (0.86 + 0.14 * sin(gl_FragCoord.y * 1.5708)) * (1.0 + 0.1 * smoothstep(0.1, 0.0, abs(roll - 0.5)));
  ivec2 p = ivec2(gl_FragCoord.xy) % 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  c += (float(b[p.y * 4 + p.x]) / 16.0 - 0.5) / 64.0;
  o = vec4(c, 1.0);
}`;

const program = (gl: WebGL2RenderingContext, vs: string, fs: string) => {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    // Everything renders at under half strength so overlapping glow has room before the 8-bit buffers clip
    gl.shaderSource(s, src.replace('es\n', 'es\n#define HEADROOM 0.45\n'));
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program');
  const loc: Record<string, WebGLUniformLocation | null> = {};
  return { p, u: (name: string) => (name in loc ? loc[name] : (loc[name] = gl.getUniformLocation(p, name))) };
};

/** A render target: a texture, plus a depth buffer for the scene */
const target = (gl: WebGL2RenderingContext, w: number, h: number, depth = false) => {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb: WebGLRenderbuffer | null = null;
  if (depth) {
    rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  return { tex, fb, w, h, free: () => (gl.deleteTexture(tex), gl.deleteFramebuffer(fb), rb && gl.deleteRenderbuffer(rb)) };
};

type View = { mode: 'globe' | 'city'; city: number };
const CAM = {
  globe: { min: 230, max: 700, start: 380, target: 0 },
  city: { min: 90, max: 460, start: 300, target: 18 },
};

const time = (tz: string) => new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });

const Nodes: React.FC = () => {
  const glRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ mode: 'globe', city: 0 });
  const [, tick] = useState(0);
  const go = useRef<(v: View, dir?: number) => void>(() => {});
  const zoomBy = useRef<(factor: number) => void>(() => {});
  const pick = useRef<(spot: number) => void>(() => {});
  const [spot, setSpot] = useState(-1);
  const [away, setAway] = useState<string[]>([]);
  const [status, setStatus] = useState<'ready' | 'loading' | 'lost' | 'no-webgl'>('ready');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const gl = glRef.current!.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) return setStatus('no-webgl');
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const lineP = program(gl, LINE_VS, LINE_FS),
      hullP = program(gl, HULL_VS, HULL_FS),
      moteP = program(gl, MOTE_VS, MOTE_FS),
      downP = program(gl, FULL_VS, DOWN_FS),
      upP = program(gl, FULL_VS, UP_FS),
      screenP = program(gl, FULL_VS, SCREEN_FS);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]), gl.STATIC_DRAW);
    /** Uploads a scene's lines and shells into their own vertex arrays */
    const upload = (lines: Float32Array, hull = new Float32Array()) => {
      const lineVao = gl.createVertexArray()!;
      gl.bindVertexArray(lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, lines, gl.STATIC_DRAW);
      for (const [i, size, off] of [
        [1, 3, 0],
        [2, 3, 12],
        [3, 1, 24],
      ]) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, size, gl.FLOAT, false, 28, off);
        gl.vertexAttribDivisor(i, 1);
      }
      const hullVao = gl.createVertexArray()!;
      gl.bindVertexArray(hullVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, hull, gl.STATIC_DRAW);
      for (const [i, off] of [
        [0, 0],
        [1, 12],
      ]) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, off);
      }
      gl.bindVertexArray(null);
      return { lineVao, segs: lines.length / 7, hullVao, tris: hull.length / 6 };
    };
    const globe = upload(buildGlobe());
    // Dust drifting up through the projection
    const moteVao = gl.createVertexArray()!;
    gl.bindVertexArray(moteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(
        Array.from({ length: 160 }, () => {
          const [a, r] = [Math.random() * Math.PI * 2, Math.sqrt(Math.random()) * RADIUS];
          return [Math.cos(a) * r, Math.random() * 130, Math.sin(a) * r, 4 + Math.random() * 10];
        }).flat(),
      ),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    const emptyVao = gl.createVertexArray();
    gl.bindVertexArray(null);

    const scenes = new Map<number, Scene & ReturnType<typeof upload>>();
    const loading = new Set<number>();
    const load = (i: number) => {
      if (scenes.has(i) || loading.has(i)) return;
      loading.add(i);
      fetch(`/nodes/${CITIES[i].short.toLowerCase()}.bin`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((buf) => {
          const s = decodeCity(buf, CITIES[i]);
          scenes.set(i, { ...s, ...upload(s.lines, s.hull) });
          if (cur.mode === 'city' && cur.city === i) {
            cam.born = performance.now();
            setStatus('ready');
            setAway(s.spots.map((p) => p.away));
          }
        })
        .catch(() => cur.city === i && setStatus('lost'))
        .finally(() => loading.delete(i));
    };

    const cam = { yaw: 0, pitch: 0.35, dist: CAM.globe.start, born: performance.now(), tx: 0, tz: 0, gx: 0, gz: 0 };
    // Where the camera is heading; it eases there every frame, so nothing jumps
    const aim = { yaw: 0, pitch: 0.35, dist: CAM.globe.start };
    let spin = 0; // yaw speed left over from a drag, fading out
    // Each way of moving has its own transition: a warp from the globe into a city, a sideways whip from
    // city to city, and an old-TV switch-off from a city back out to the globe. `trip` is the way out of
    // where you are, `fx` the way into where you land; `dir` is which way a whip goes.
    type Fx = { kind: 'warp' | 'slide' | 'crush'; at: number; len: number; dir: number };
    let trip: (Fx & { to: View }) | undefined;
    let fx: Fx | undefined;
    let cur: View = { mode: 'globe', city: 0 };
    let sel = -1,
      touched = 0,
      overscroll = 0,
      W = 0,
      H = 0,
      raf = 0,
      last = performance.now();
    let hits: { i: number; x: number; y: number }[] = [];
    let tour: Scene['spots'][number] | undefined;
    let fbs: ReturnType<typeof target>[] = [];

    const show = (v: View, dir = 1) => {
      const from = cur;
      const now = performance.now();
      cur = v;
      cam.born = performance.now();
      overscroll = 0;
      sel = -1;
      Object.assign(cam, { tx: 0, tz: 0, gx: 0, gz: 0 });
      setSpot(-1);
      if (v.mode === 'globe') {
        // Pull back out of the city you were in, still facing it
        const c = CITIES[v.city];
        Object.assign(aim, { yaw: (-c.lng * Math.PI) / 180, pitch: (c.lat * Math.PI) / 180, dist: CAM.globe.start });
        Object.assign(cam, { yaw: aim.yaw, pitch: aim.pitch, dist: from.mode === 'city' ? GLOBE_R * 1.6 : cam.dist });
        if (from.mode === 'city') fx = { kind: 'crush', at: now, len: 600, dir };
        setStatus('ready');
      } else if (from.mode === 'city') {
        // The next city swings in from the side you're heading
        Object.assign(aim, { yaw: cam.yaw, pitch: 0.5, dist: CAM.city.start * (W < H ? 1.15 : 1) });
        Object.assign(cam, { yaw: aim.yaw - dir * 1.1, pitch: 0.5, dist: aim.dist * 1.15 });
        fx = { kind: 'slide', at: now, len: 550, dir };
      } else {
        // Arrive from high above and dive in through the blur
        Object.assign(aim, { yaw: -0.5, pitch: 0.5, dist: CAM.city.start * (W < H ? 1.15 : 1) });
        Object.assign(cam, { yaw: aim.yaw - 0.5, pitch: 1.25, dist: aim.dist * 3.2 });
        fx = { kind: 'warp', at: now, len: 1300, dir };
        const s = scenes.get(v.city);
        setStatus(s ? 'ready' : 'loading');
        setAway(s ? s.spots.map((p) => p.away) : []);
        load(v.city);
      }
      setView(v);
    };
    const travel = (v: View, dir = 1) => {
      if (trip) return;
      if (calm || (v.mode === cur.mode && v.city === cur.city)) return show(v, dir);
      const at = performance.now();
      if (v.mode === 'city') load(v.city);
      if (cur.mode === 'globe') {
        // Turn the globe to face the city and rush in
        const c = CITIES[v.city];
        const yaw = (-c.lng * Math.PI) / 180;
        aim.yaw = cam.yaw + ((((yaw - cam.yaw) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        Object.assign(aim, { pitch: (c.lat * Math.PI) / 180, dist: GLOBE_R * 1.08 });
        trip = { kind: 'warp', at, len: 700, dir, to: v };
      } else if (v.mode === 'city') {
        // Whip the camera round and away
        aim.yaw += dir * 1.1;
        spin = 0;
        trip = { kind: 'slide', at, len: 300, dir, to: v };
      } else trip = { kind: 'crush', at, len: 380, dir, to: v };
    };
    go.current = travel;

    const select = (i: number) => {
      const p = scenes.get(cur.city)?.spots[i];
      sel = p ? i : -1;
      [cam.gx, cam.gz] = p ? [p.x, p.z] : [0, 0];
      if (p) aim.dist = Math.min(aim.dist, 200);
      touched = performance.now();
      setSpot(sel);
    };
    pick.current = select;

    const zoom = (factor: number) => {
      const lim = CAM[cur.mode];
      const want = aim.dist * factor;
      aim.dist = Math.max(lim.min, Math.min(lim.max, want));
      touched = performance.now();
      // Keep zooming past the limit to move between the globe and a city
      if (want > lim.max && cur.mode === 'city') overscroll += want - lim.max;
      else if (want < lim.min && cur.mode === 'globe') overscroll += lim.min - want;
      else overscroll = 0;
      if (overscroll < 90) return;
      if (cur.mode === 'city') travel({ mode: 'globe', city: cur.city });
      else {
        const near = [...hits].sort((a, b) => Math.hypot(a.x - W / 2, a.y - H / 2) - Math.hypot(b.x - W / 2, b.y - H / 2))[0];
        if (near) travel({ mode: 'city', city: near.i });
      }
    };
    zoomBy.current = zoom;

    // The city's name floats over it as a hologram of its own: a sign in the scene that turns with
    // the city, always facing the side you're on so it reads left to right
    const stripes = document.createElement('canvas');
    [stripes.width, stripes.height] = [1, 4];
    const sc = stripes.getContext('2d')!;
    sc.fillStyle = '#e8fbff';
    sc.fillRect(0, 0, 1, 3);
    sc.fillStyle = 'rgba(95,216,255,0.45)';
    sc.fillRect(0, 3, 1, 1);
    const ink = ctx.createPattern(stripes, 'repeat')!;
    const sign = (
      text: string,
      now: number,
      alpha: number,
      dpr: number,
      eye: number[],
      project: (x: number, y: number, z: number) => readonly [number, number, number],
    ) => {
      const px = 40;
      ctx.font = `${px}px "Fixedsys Excelsior", "Courier New", monospace`;
      const tw = ctx.measureText(text).width;
      const tall = Math.min(17, (130 * px) / tw);
      const half = (tall * tw) / px / 2;
      const y = 72 + Math.sin(now / 900) * 1.5;
      const d = eye[2] >= 0 ? 1 : -1;
      const [o, r, t] = [project(-half * d, y, 0), project(half * d, y, 0), project(-half * d, y + tall, 0)];
      if (o[2] <= 1 || r[2] <= 1 || t[2] <= 1) return;
      ctx.save();
      ctx.setTransform(
        ((r[0] - o[0]) / tw) * dpr,
        ((r[1] - o[1]) / tw) * dpr,
        ((o[0] - t[0]) / px) * dpr,
        ((o[1] - t[1]) / px) * dpr,
        o[0] * dpr,
        o[1] * dpr,
      );
      ctx.textAlign = 'left';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * (0.85 + 0.15 * Math.sin(now / 70));
      ctx.shadowColor = '#5fd8ff';
      ctx.shadowBlur = 18 * dpr;
      ctx.fillStyle = ink;
      ctx.fillText(text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.globalAlpha *= 0.5;
      ctx.strokeStyle = '#5fd8ff';
      ctx.lineWidth = 1;
      ctx.strokeText(text, 0, 0);
      ctx.restore();
    };

    const mvp = new Float32Array(16);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!calm && !trip && now - touched > 2500) aim.yaw += dt * (cur.mode === 'globe' ? 0.12 : 0.1);
      if (!pointers.size) aim.yaw += spin * dt;
      spin *= Math.exp(-dt * 3);
      if (trip && now - trip.at > trip.len) {
        show(trip.to, trip.dir);
        trip = undefined;
      }
      // Ease toward the aim; slower while arriving, so the dive into a city settles gently
      const settle = cur.mode === 'city' && now - cam.born < 1600 ? 2.2 : 7;
      const ease = (k: number) => 1 - Math.exp(-dt * k);
      cam.yaw += (aim.yaw - cam.yaw) * ease(trip ? 5 : settle + 3);
      cam.pitch += (aim.pitch - cam.pitch) * ease(trip ? 5 : settle);
      cam.dist += (aim.dist - cam.dist) * ease(trip ? 3.5 : settle);
      // How far into the current transition: rising on the way out, falling on the way in
      const fxNow = trip ?? fx;
      const amount = !fxNow ? 0 : trip ? Math.min(1, (now - trip.at) / trip.len) ** 2 : Math.max(0, 1 - (now - fxNow.at) / fxNow.len) ** 2;
      const [warp, slide, crush] = (['warp', 'slide', 'crush'] as const).map((k) =>
        fxNow?.kind === k ? amount * (k === 'slide' ? -fxNow.dir : 1) : 0,
      );
      canvas.style.opacity = String(1 - Math.min(1, Math.max(crush, Math.abs(slide)) * 1.5));
      // Left alone in a city, the camera drifts from one hidden spot to the next as it circles
      const idle = cur.mode === 'city' && sel < 0 && !calm ? now - touched - 6000 : -1;
      const near = scenes.get(cur.city)?.spots.filter((p) => !p.away) ?? [];
      tour = idle > 0 && near.length ? near[Math.floor(idle / 9000) % near.length] : undefined;
      const [gx, gz, rate] = tour ? [tour.x * 0.35, tour.z * 0.35, 0.5] : [cam.gx, cam.gz, 3];
      cam.tx += (gx - cam.tx) * Math.min(1, dt * rate);
      cam.tz += (gz - cam.tz) * Math.min(1, dt * rate);
      const dpr = Math.min(2, devicePixelRatio || 1);
      // The hologram renders at a little under screen resolution: lighter on phones, and softer like an old tube
      const [gw, gh] = [Math.max(1, Math.round(W * dpr * 0.75)), Math.max(1, Math.round(H * dpr * 0.75))];
      const glc = gl.canvas as HTMLCanvasElement;
      if (glc.width !== gw || glc.height !== gh || !fbs.length) {
        [glc.width, glc.height] = [gw, gh];
        fbs.forEach((f) => f.free());
        fbs = [
          target(gl, gw, gh, true),
          target(gl, gw >> 1 || 1, gh >> 1 || 1),
          target(gl, gw >> 2 || 1, gh >> 2 || 1),
          target(gl, gw >> 1 || 1, gh >> 1 || 1),
        ];
      }
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr))
        [canvas.width, canvas.height] = [Math.round(W * dpr), Math.round(H * dpr)];

      const scene = cur.mode === 'city' ? scenes.get(cur.city) : undefined;
      const grow = Math.min(1, (now - cam.born) / 1100);
      const rise = cur.mode === 'city' ? 1 - (1 - grow) ** 3 : 1;
      const flicker = (0.9 + 0.1 * Math.sin(now / 47) * Math.sin(now / 131)) * Math.min(1, grow * 1.6);

      // Camera: orbit (yaw, pitch) at a distance around the target point
      const [cy, sy, cp, sp] = [Math.cos(cam.yaw), Math.sin(cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch)];
      const t: V3 = [cam.tx, CAM[cur.mode].target, cam.tz];
      const R = [
        [cy, 0, sy],
        [sp * sy, cp, -sp * cy],
        [-cp * sy, sp, cp * cy],
      ];
      const tr = R.map((r) => -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]));
      const f = Math.min(W, H) * 1.15;
      const [a, b, n, fa] = [f / (W / 2), f / (H / 2), 1, 3000];
      const [A, B] = [-(fa + n) / (fa - n), (-2 * fa * n) / (fa - n)];
      const rows = [
        [...R[0].map((k) => k * a), tr[0] * a],
        [...R[1].map((k) => k * b), tr[1] * b],
        [...R[2].map((k) => k * A), (tr[2] - cam.dist) * A + B],
        [...R[2].map((k) => -k), -(tr[2] - cam.dist)],
      ];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mvp[c * 4 + r] = rows[r][c];
      const eye: V3 = [t[0] + R[2][0] * cam.dist, t[1] + R[2][1] * cam.dist, t[2] + R[2][2] * cam.dist];
      const project = (x: number, y: number, z: number) => {
        const v = rows.map((r) => r[0] * x + r[1] * y + r[2] * z + r[3]);
        return [W / 2 + (v[0] / v[3]) * (W / 2), H / 2 - (v[1] / v[3]) * (H / 2), v[3]] as const;
      };

      const [scn, half, quarter, bloom] = fbs;
      gl.bindFramebuffer(gl.FRAMEBUFFER, scn.fb);
      gl.viewport(0, 0, scn.w, scn.h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      // Now and then the signal slips sideways, like an old transmission
      const glitch = !calm && now % 5300 < 90 ? 1 : 0;
      const drawLines = (s: { lineVao: WebGLVertexArrayObject; segs: number }, dim: number, globeMode: number) => {
        gl.useProgram(lineP.p);
        gl.uniformMatrix4fv(lineP.u('u_mvp'), false, mvp);
        gl.uniform2f(lineP.u('u_res'), scn.w, scn.h);
        gl.uniform1f(lineP.u('u_rise'), rise);
        gl.uniform1f(lineP.u('u_globe'), globeMode);
        gl.uniform1f(lineP.u('u_dim'), dim);
        gl.uniform1f(lineP.u('u_px'), dpr * 0.75);
        gl.uniform1f(lineP.u('u_flicker'), flicker);
        gl.uniform3f(lineP.u('u_eye'), ...(globeMode ? (R[2] as V3) : eye));
        gl.bindVertexArray(s.lineVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.segs);
      };
      gl.enable(gl.BLEND);
      if (cur.mode === 'globe') {
        gl.disable(gl.DEPTH_TEST);
        gl.blendFunc(gl.ONE, gl.ONE);
        drawLines(globe, 1, 1);
      } else if (scene) {
        // Shells first so they hide what's behind them, then a faint see-through pass, then the lines that show
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(hullP.p);
        gl.uniformMatrix4fv(hullP.u('u_mvp'), false, mvp);
        gl.uniform1f(hullP.u('u_rise'), rise);
        gl.uniform3f(hullP.u('u_eye'), ...eye);
        gl.uniform1f(hullP.u('u_flicker'), flicker);
        gl.bindVertexArray(scene.hullVao);
        gl.drawArrays(gl.TRIANGLES, 0, scene.tris);
        gl.depthMask(false);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.disable(gl.DEPTH_TEST);
        drawLines(scene, 0.18, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        drawLines(scene, 1, 0);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(moteP.p);
        gl.uniformMatrix4fv(moteP.u('u_mvp'), false, mvp);
        gl.uniform1f(moteP.u('u_time'), now / 1000);
        gl.uniform1f(moteP.u('u_px'), dpr * 0.75);
        gl.uniform1f(moteP.u('u_flicker'), flicker);
        gl.bindVertexArray(moteVao);
        gl.drawArrays(gl.POINTS, 0, 160);
        gl.depthMask(true);
      }
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(emptyVao);
      const pass = (prog: ReturnType<typeof program>, from: typeof scn, to: typeof scn | null) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
        gl.viewport(0, 0, to ? to.w : gw, to ? to.h : gh);
        gl.useProgram(prog.p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform1i(prog.u('u_tex'), 0);
        gl.uniform2f(prog.u('u_texel'), 1 / from.w, 1 / from.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      pass(downP, scn, half);
      pass(downP, half, quarter);
      pass(upP, quarter, bloom);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gw, gh);
      gl.useProgram(screenP.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scn.tex);
      gl.uniform1i(screenP.u('u_scene'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloom.tex);
      gl.uniform1i(screenP.u('u_bloom'), 1);
      gl.uniform2f(screenP.u('u_res'), gw, gh);
      gl.uniform1f(screenP.u('u_time'), now / 1000);
      gl.uniform1f(screenP.u('u_glitch'), glitch);
      gl.uniform1f(screenP.u('u_calm'), calm ? 1 : 0);
      gl.uniform1f(screenP.u('u_warp'), warp);
      gl.uniform1f(screenP.u('u_slide'), slide);
      gl.uniform1f(screenP.u('u_crush'), crush);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Labels, beacons and the projector beam on the 2D layer above
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (glitch) ctx.translate((Math.random() - 0.5) * 8, 0);
      ctx.font = '12px "Fixedsys Excelsior", "Courier New", monospace';
      ctx.textAlign = 'center';
      hits = [];
      if (cur.mode === 'globe') {
        CITIES.forEach((c, i) => {
          if (trip) return; // the labels drop away as you fly in
          const p = sphere(c.lat, c.lng);
          if (p[0] * R[2][0] + p[1] * R[2][1] + p[2] * R[2][2] < 0) return;
          const [x, y] = project(...p);
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
      } else {
        // The projector: a lens below the pad throwing light up into the city, brightest at its source
        // and fading as it spreads, with a few rays flickering through it
        const rim = Array.from({ length: 48 }, (_, i) => {
          const ang = (i / 48) * Math.PI * 2;
          return project(Math.cos(ang) * RADIUS, 0, Math.sin(ang) * RADIUS);
        });
        const left = rim.reduce((a, b) => (b[0] < a[0] ? b : a));
        const right = rim.reduce((a, b) => (b[0] > a[0] ? b : a));
        const low = Math.max(...rim.map((p) => p[1]));
        const [ex, ey] = [(left[0] + right[0]) / 2, Math.min(H - 16, low + Math.max(40, (H - low) * 0.7))];
        const glow = Math.min(1, grow * 2) * flicker;
        const reach = Math.hypot(ex - left[0], ey - (left[1] + right[1]) / 2) * 1.1;
        ctx.globalCompositeOperation = 'lighter';
        // Three nested fans make the beam soft at its edges and strongest down the middle
        for (const [narrow, a] of [
          [1, 0.55],
          [0.65, 0.45],
          [0.3, 0.5],
        ]) {
          const light = ctx.createRadialGradient(ex, ey, 0, ex, ey, reach);
          light.addColorStop(0, 'rgba(225,250,255,0.5)');
          light.addColorStop(0.1, 'rgba(130,228,255,0.22)');
          light.addColorStop(0.55, 'rgba(95,216,255,0.06)');
          light.addColorStop(1, 'rgba(95,216,255,0)');
          ctx.fillStyle = light;
          ctx.globalAlpha = a * glow;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex + (left[0] - ex) * narrow, left[1]);
          for (let i = 0; i <= 12; i++) {
            const t = i / 12;
            ctx.lineTo(
              ex + (left[0] + (right[0] - left[0]) * t - ex) * narrow,
              left[1] + (right[1] - left[1]) * t + Math.sin(Math.PI * t) * (low - (left[1] + right[1]) / 2),
            );
          }
          ctx.closePath();
          ctx.fill();
        }
        for (let i = 0; i < 16; i++) {
          const t = (i + 0.5) / 16 + Math.sin(now / 1300 + i * 2.1) * 0.02;
          const [x, y] = [
            left[0] + (right[0] - left[0]) * t,
            left[1] + (right[1] - left[1]) * t + Math.sin(Math.PI * t) * (low - (left[1] + right[1]) / 2),
          ];
          const ray = ctx.createLinearGradient(ex, ey, x, y);
          ray.addColorStop(0, 'rgba(210,248,255,0.55)');
          ray.addColorStop(1, 'rgba(95,216,255,0)');
          ctx.strokeStyle = ray;
          ctx.lineWidth = 1 + (i % 3) * 0.6;
          ctx.globalAlpha = glow * (0.25 + 0.35 * (0.5 + 0.5 * Math.sin(now / (180 + i * 23) + i)));
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        // The lens itself
        const pulse = 1 + 0.06 * Math.sin(now / 240);
        const halo = ctx.createRadialGradient(ex, ey, 0, ex, ey, 46 * pulse);
        halo.addColorStop(0, 'rgba(235,252,255,0.9)');
        halo.addColorStop(0.2, 'rgba(140,230,255,0.45)');
        halo.addColorStop(1, 'rgba(95,216,255,0)');
        ctx.fillStyle = halo;
        ctx.globalAlpha = glow;
        ctx.beginPath();
        ctx.arc(ex, ey, 46 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8fe6ff';
        for (const [rx, a] of [
          [20, 0.7],
          [34, 0.3],
        ]) {
          ctx.globalAlpha = a * glow;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(ex, ey + 2, rx * pulse, rx * 0.26 * pulse, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        // The picked spot, or the one the camera is drifting past: a light column and a ring pulsing out from it
        const s = scene?.spots[sel] ?? tour;
        if (s) {
          const rr = 6 + ((now / 25) % 18);
          ctx.strokeStyle = '#e8fbff';
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = (1 - (rr - 6) / 18) * flicker;
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const ang = (i / 24) * Math.PI * 2;
            const [x, y] = project(s.x + Math.cos(ang) * rr, 0.5, s.z + Math.sin(ang) * rr);
            ctx[i ? 'lineTo' : 'moveTo'](x, y);
          }
          ctx.stroke();
          const [x0, y0] = project(s.x, 0, s.z);
          const [x1, y1] = project(s.x, 60, s.z);
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
        ctx.globalCompositeOperation = 'source-over';
        if (scene && grow === 1) {
          // District and landmark names stay faint
          ctx.fillStyle = '#5fd8ff';
          for (const m of scene.marks) {
            const [x, y, w] = project(...m.at);
            if (w <= 1) continue;
            ctx.globalAlpha = (sel >= 0 ? 0.25 : 0.55) * flicker;
            ctx.fillText(m.name, x, y);
          }
          // The spots are easter eggs: only a beacon until you find one
          scene.spots.forEach((p, i) => {
            const [x, y, w] = project(p.x, 16, p.z);
            if (w <= 1) return;
            hits.push({ i, x, y });
            if (i !== sel && p !== tour) return;
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = (i === sel ? 1 : 0.7) * flicker;
            ctx.fillText(CITIES[cur.city].spots[i][0].toUpperCase(), x, y - 14);
          });
        }
        if (scene) sign(CITIES[cur.city].name.toUpperCase(), now, rise * flicker, dpr, R[2], project);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    const resize = new ResizeObserver(() => ([W, H] = [canvas.clientWidth, canvas.clientHeight]));
    resize.observe(canvas);

    // One finger or the mouse turns it, a quick swipe sideways moves to the next city, two fingers pinch
    // to zoom, and a tap opens a city on the globe or finds a spot in one
    const pointers = new Map<number, { x: number; y: number; t: number }>();
    let pinch = 0,
      moved = 0,
      start = { x: 0, y: 0, t: 0 };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY, t: e.timeStamp });
      spin = 0;
      start = { x: e.offsetX, y: e.offsetY, t: performance.now() };
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
      aim.yaw += dx * 0.008;
      aim.pitch = Math.max(cur.mode === 'globe' ? -1.2 : 0.12, Math.min(cur.mode === 'globe' ? 1.2 : 1.35, aim.pitch + dy * 0.006));
      const gap = Math.max(8, e.timeStamp - p.t) / 1000;
      spin = Math.max(-4, Math.min(4, (dx * 0.008) / gap));
      p.t = e.timeStamp;
    };
    const up = (e: PointerEvent) => {
      const single = pointers.size === 1 && moved < 99;
      // Let go after holding still and it stays still; let go mid-drag and it glides on
      if (e.timeStamp - (pointers.get(e.pointerId)?.t ?? 0) > 80) spin = 0;
      pointers.delete(e.pointerId);
      pinch = 0;
      const [dx, dy] = [e.offsetX - start.x, e.offsetY - start.y];
      if (single && Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy) && performance.now() - start.t < 350) {
        const next = cur.mode === 'city' ? cur.city + (dx < 0 ? 1 : -1) : cur.city;
        travel({ mode: 'city', city: (next + CITIES.length) % CITIES.length }, dx < 0 ? 1 : -1);
        return;
      }
      if (moved > 8) return;
      const hit = hits.find((h) => Math.hypot(h.x - e.offsetX, h.y - e.offsetY) < 22);
      if (cur.mode === 'city') select(hit ? hit.i : -1);
      else if (hit) travel({ mode: 'city', city: hit.i });
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
    const clock = setInterval(() => tick((t) => t + 1), 20000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(clock);
      resize.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  const city = CITIES[view.city];
  const step = (d: number) => go.current({ mode: 'city', city: (view.city + d + CITIES.length) % CITIES.length }, d);
  const btn = 'lightweight w-8 h-8 grid place-items-center';

  return (
    <div
      className="nodes relative w-full h-full overflow-hidden bg-[#02060d] text-[14px] leading-tight text-[#bff4ff] select-none outline-none"
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
        /* The desktop's Win98 button style would turn these into grey boxes */
        .nodes button.lightweight { background: transparent; color: #bff4ff; border: 1px solid rgba(95, 216, 255, 0.5); min-width: 0; min-height: 0; line-height: 1; }
        .nodes button.lightweight:enabled:hover, .nodes button.lightweight:enabled:active { background: rgba(95, 216, 255, 0.2); border-color: #bff4ff; }
        .nodes button.nodes-arrow, .nodes button.nodes-arrow:enabled:hover, .nodes button.nodes-arrow:enabled:active { border-color: transparent; background: transparent; }
      `}</style>
      <canvas ref={glRef} className="absolute inset-0 w-full h-full" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing" />
      {/* Dark corners, like the edge of a tube */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55))]" />

      <div className="absolute top-2 left-3 right-3 flex items-start justify-between gap-2 pointer-events-none">
        <div>
          <div className="text-[#5fd8ff] tracking-[0.3em] text-[10px]">SANKTUARY // NODES</div>
          {view.mode === 'globe' ? (
            <div className="text-lg tracking-widest">{CITIES.length} CITIES</div>
          ) : (
            <div className="opacity-80 text-[12px] sm:text-[14px]">
              <div>
                NODE {String(view.city + 1).padStart(2, '0')}/{String(CITIES.length).padStart(2, '0')}
              </div>
              <div>{city.area}</div>
              <div>
                {Math.abs(city.lat).toFixed(2)}°{city.lat < 0 ? 'S' : 'N'} {Math.abs(city.lng).toFixed(2)}°{city.lng < 0 ? 'W' : 'E'} ·{' '}
                {time(city.tz)}
              </div>
              {status === 'loading' && <div className="mt-1 animate-pulse">RECEIVING TRANSMISSION...</div>}
              {status === 'lost' && <div className="mt-1">SIGNAL LOST. CHECK YOUR CONNECTION.</div>}
            </div>
          )}
          {status === 'no-webgl' && <div className="mt-1">This device can't show the hologram (no WebGL2).</div>}
          {view.mode === 'city' && spot >= 0 && (
            <div className="mt-2 max-w-[300px] border border-[#5fd8ff]/50 bg-[#020a12]/80 px-2 py-1">
              <div className="text-white">FOUND: {city.spots[spot][0].toUpperCase()}</div>
              <div className="opacity-80">{city.spots[spot][1]}</div>
              {away[spot] && <div className="opacity-60">Off the map: {away[spot]}</div>}
            </div>
          )}
        </div>
        <div className="flex gap-1 pointer-events-auto">
          {view.mode === 'city' && (
            <button className={btn} onClick={() => go.current({ mode: 'globe', city: view.city })} aria-label="Globe">
              ◎
            </button>
          )}
          <button className={btn} onClick={() => zoomBy.current(0.8)} aria-label="Zoom in">
            +
          </button>
          <button className={btn} onClick={() => zoomBy.current(1.25)} aria-label="Zoom out">
            −
          </button>
        </div>
      </div>

      {/* Arrows to swipe between the cities */}
      {(['‹', '›'] as const).map((a, i) => (
        <button
          key={a}
          className="lightweight nodes-arrow absolute top-1/2 -translate-y-1/2 px-2 py-6 text-5xl opacity-60 hover:opacity-100 active:opacity-100 [text-shadow:0_0_12px_#5fd8ff]"
          style={{ [i ? 'right' : 'left']: 0 }}
          onClick={() => step(i ? 1 : -1)}
          aria-label={i ? 'Next city' : 'Previous city'}
        >
          {a}
        </button>
      ))}
      {view.mode === 'city' && (
        <div className="absolute bottom-1 left-2 right-2 text-[10px] opacity-40 pointer-events-none">
          Buildings © OpenStreetMap contributors, Overture Maps Foundation (ODbL), Google Open Buildings (CC BY 4.0)
        </div>
      )}
    </div>
  );
};

export default Nodes;
