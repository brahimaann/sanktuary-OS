import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWindowManager } from '../wm/manager';
import { vfs } from '../vfs/fs';
import {
  TIMELINE_EVENTS,
  REGION_META,
  CULTURAL_THREADS,
  HISTORICAL_THREADS,
  getFilteredEvents,
  getYearRange,
  type Region,
  type TimelineEvent,
} from './pplsStoryData';

// ──────────────────────────────────────────────
// Civic Alert System Data
// ──────────────────────────────────────────────

export interface CivicAlert {
  id: string;
  type: 'Legislative' | 'Economic' | 'Civic' | 'Cultural';
  title: string;
  details: string;
  connectedEventId: string;
}

export const CIVIC_ALERTS: CivicAlert[] = [
  {
    id: 'tenant-rights',
    type: 'Legislative',
    title: 'Tenant Rights Bill Vote at City Hall',
    details: 'A bill affecting local tenant rights and eviction protections is up for a vote at City Hall on Tuesday. Renters are organizing public comments to demand municipal support.\n\nHistorical Connection: This struggle reclaims the Manden Charter\'s 1236 declaration of the right to life and physical integrity (Article 5), establishing collective societal protection for all members.',
    connectedEventId: 'manden-charter-kurukan-fuga'
  },
  {
    id: 'grant-withholding',
    type: 'Economic',
    title: 'Small Business Grant Policy Shift',
    details: 'Notice: Major corporate tax withholding changes are affecting local small business grants for minority creators. Public comments on redistributing city funds end this Friday.\n\nHistorical Connection: Relates to the Asiento de Negros (1518), which institutionalized the commodification of human bodies and resources, showing the roots of racial capitalism.',
    connectedEventId: 'asiento-de-negros'
  },
  {
    id: 'redistricting',
    type: 'Civic',
    title: 'District Redrawing Public Hearing',
    details: 'Your district is undergoing border redistribution. Public comment period ends Friday. Community members are mobilizing to prevent political gerrymandering.\n\nHistorical Connection: Connects to the Spanish colonial Sistema de Castas (1540), which legally engineered division to maintain minority control and prevent democratic coalition building.',
    connectedEventId: 'sistema-de-castas'
  },
  {
    id: 'artist-land-trust',
    type: 'Cultural',
    title: 'Land Trust Meeting & Local Art Showcase',
    details: 'Community land trust meeting and local artist showcase tonight at the Neighborhood Arts Center. Discussions will focus on protecting creative spaces from rising displacement.\n\nHistorical Connection: Echoes the Aboriginal Songlines (65,000 BCE) mapping of geographic space through ecological stewardship and collective care rather than private ownership.',
    connectedEventId: 'aboriginal-songlines'
  }
];

// ──────────────────────────────────────────────
// Bootstrap VFS artifacts
// ──────────────────────────────────────────────

let vfsBootstrapped = false;

function bootstrapVFS() {
  if (vfsBootstrapped) return;
  vfsBootstrapped = true;
  try {
    vfs.mkdir('C:/Ppls_Story');
    
    // Write timeline events text files
    TIMELINE_EVENTS.forEach((evt) => {
      if (evt.primarySourceText && evt.mediaPayload && evt.mediaPayload.startsWith('C:/')) {
        vfs.writeFile(evt.mediaPayload, evt.primarySourceText);
      }
    });

    // Write general Pulse log
    const pulseText = `THE PULSE — CIVIC ALERT NOTIFIER\n` +
      `══════════════════════════════════════════\n\n` +
      CIVIC_ALERTS.map(alert => 
        `[${alert.type.toUpperCase()} ALERT]: ${alert.title}\n` +
        `------------------------------------------\n` +
        `${alert.details}\n`
      ).join('\n\n');
    vfs.writeFile('C:/Ppls_Story/Pulse.txt', pulseText);

    // Write individual alerts
    CIVIC_ALERTS.forEach((alert) => {
      const filename = `Alert_${alert.id.replace(/-/g, '_')}.txt`;
      vfs.writeFile(`C:/Ppls_Story/${filename}`, 
        `${alert.title.toUpperCase()}\n` +
        `Category: ${alert.type}\n` +
        `══════════════════════════════════════════\n\n` +
        `${alert.details}\n`
      );
    });
  } catch (e) {
    console.error('Failed to bootstrap Ppls_Story VFS:', e);
  }
}

// ──────────────────────────────────────────────
// World-Map Constants & Helper
// ──────────────────────────────────────────────

const geoToXY = (lat: number, lng: number) => {
  // SVG internal coordinate space: 1000 x 500
  const x = (lng + 180) * (1000 / 360);
  const y = (90 - lat) * (500 / 180);
  return { x, y };
};

const pointsToPath = (points: [number, number][]) => {
  return points
    .map((p, idx) => {
      const { x, y } = geoToXY(p[1], p[0]);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ') + ' Z';
};

interface ContinentShape {
  id: string;
  name: string;
  region: Region;
  points: [number, number][];
}

const CONTINENTS_DATA: ContinentShape[] = [
  {
    id: 'africa',
    name: 'Africa',
    region: 'Africa',
    points: [
      [-17, 14], [-16, 20], [-14, 25], [-10, 35], [5, 36], [11, 37], [15, 32], 
      [30, 31], [32, 30], [34, 27], [40, 20], [43, 12], [51, 11], [46, -3], 
      [40, -15], [33, -27], [28, -32], [20, -34], [18, -34], [15, -23], 
      [12, -12], [9, -1], [5, 4], [-8, 4], [-13, 9], [-17, 14]
    ]
  },
  {
    id: 'madagascar',
    name: 'Madagascar',
    region: 'Africa',
    points: [
      [49, -12], [50, -16], [47, -25], [43, -25], [44, -20], [49, -12]
    ]
  },
  {
    id: 'north_america',
    name: 'North America',
    region: 'Americas',
    points: [
      [-168, 65], [-150, 70], [-120, 70], [-100, 68], [-83, 65], [-80, 51], 
      [-75, 52], [-64, 60], [-55, 53], [-52, 47], [-60, 46], [-70, 42], 
      [-74, 40], [-77, 34], [-80, 25], [-85, 30], [-97, 26], [-105, 20], 
      [-88, 16], [-83, 9], [-77, 7], [-90, 14], [-105, 22], [-110, 23], 
      [-115, 32], [-124, 40], [-125, 50], [-135, 57], [-145, 60], [-160, 55], 
      [-168, 65]
    ]
  },
  {
    id: 'south_america',
    name: 'South America',
    region: 'Americas',
    points: [
      [-77, 7], [-72, 12], [-60, 6], [-50, 0], [-35, -5], [-39, -13], 
      [-43, -23], [-48, -27], [-55, -34], [-63, -40], [-65, -50], [-67, -55], 
      [-74, -45], [-72, -30], [-70, -20], [-81, -5], [-80, 1], [-77, 7]
    ]
  },
  {
    id: 'cuba',
    name: 'Cuba',
    region: 'Americas',
    points: [
      [-84, 22], [-80, 22], [-75, 20], [-77, 20], [-84, 22]
    ]
  },
  {
    id: 'hispaniola',
    name: 'Hispaniola',
    region: 'Americas',
    points: [
      [-74, 20], [-70, 19], [-68, 18], [-72, 18], [-74, 20]
    ]
  },
  {
    id: 'eurasia',
    name: 'Eurasia',
    region: 'Global',
    points: [
      [-9, 39], [-2, 43], [-5, 48], [2, 51], [5, 53], [8, 55], [14, 54], 
      [18, 59], [20, 65], [30, 70], [40, 68], [50, 68], [60, 70], [80, 75], 
      [100, 77], [120, 73], [140, 72], [170, 66], [180, 66], [170, 60], 
      [160, 55], [142, 53], [135, 48], [125, 38], [120, 38], [122, 30], 
      [110, 20], [105, 10], [100, 5], [98, 10], [88, 22], [80, 13], [77, 8], 
      [73, 18], [67, 24], [58, 25], [50, 26], [48, 30], [35, 12], [43, 12], 
      [35, 27], [32, 30], [34, 32], [36, 36], [28, 36], [26, 40], [22, 38], 
      [16, 40], [12, 42], [9, 44], [3, 41], [-2, 37], [-9, 39]
    ]
  },
  {
    id: 'australia',
    name: 'Australia',
    region: 'Global',
    points: [
      [113, -26], [115, -32], [120, -34], [130, -32], [138, -35], [145, -38], 
      [150, -34], [153, -28], [145, -15], [136, -12], [130, -15], [122, -18], 
      [113, -26]
    ]
  },
  {
    id: 'greenland',
    name: 'Greenland',
    region: 'Global',
    points: [
      [-60, 80], [-50, 83], [-30, 83], [-20, 75], [-40, 60], [-50, 64], 
      [-55, 74], [-60, 80]
    ]
  },
  {
    id: 'uk',
    name: 'United Kingdom',
    region: 'Global',
    points: [
      [-5, 50], [-2, 50], [1, 51], [1, 53], [-2, 57], [-4, 58], [-6, 57], 
      [-5, 55], [-3, 53], [-5, 50]
    ]
  },
  {
    id: 'ireland',
    name: 'Ireland',
    region: 'Global',
    points: [
      [-10, 52], [-9, 54], [-7, 55], [-6, 54], [-6, 52], [-8, 51], [-10, 52]
    ]
  },
  {
    id: 'japan',
    name: 'Japan',
    region: 'Global',
    points: [
      [140, 45], [145, 44], [142, 40], [140, 35], [135, 34], [130, 31], 
      [132, 33], [140, 45]
    ]
  }
];

// ──────────────────────────────────────────────
// Navigable World Map Component
// ──────────────────────────────────────────────

interface WorldMapProps {
  selectedRegion: Region | 'All';
  onSelectRegion: (r: Region | 'All') => void;
  selectedEvent: TimelineEvent | null;
  onSelectEvent: (id: string) => void;
  filteredEvents: TimelineEvent[];
  sliderYear: number;
  onAdjustYear: (year: number) => void;
  activeThreadId: string | null;
}

const WorldMap: React.FC<WorldMapProps> = ({
  selectedRegion,
  onSelectRegion,
  selectedEvent,
  onSelectEvent,
  filteredEvents,
  sliderYear,
  onAdjustYear,
  activeThreadId,
}) => {
  const [zoom, setZoom] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const [hoveredRegion, setHoveredRegion] = useState<Region | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);
  const [hoveredPos, setHoveredPos] = useState({ x: 0, y: 0 });

  const svgRef = useRef<SVGSVGElement>(null);

  // Auto-center (fly-to) when selectedEvent changes
  useEffect(() => {
    if (!selectedEvent) return;
    const { lat, lng } = selectedEvent.location;
    const { x, y } = geoToXY(lat, lng);
    
    const targetZoom = 3.5;
    let tx = 1000 / 2 - x * targetZoom;
    let ty = 500 / 2 - y * targetZoom;
    
    // Clamp within 1000x500 map bounds
    tx = Math.max(1000 * (1 - targetZoom), Math.min(0, tx));
    ty = Math.max(500 * (1 - targetZoom), Math.min(0, ty));
    
    setZoom(targetZoom);
    setTranslateX(tx);
    setTranslateY(ty);
  }, [selectedEvent]);

  // Compute points of events in the active thread
  const activeThreadPoints = useMemo(() => {
    if (!activeThreadId) return null;
    const thread = CULTURAL_THREADS.find((t) => t.id === activeThreadId);
    if (!thread) return null;
    return thread.connectedEventIds
      .map((id) => {
        const evt = TIMELINE_EVENTS.find((e) => e.id === id);
        if (!evt) return null;
        return geoToXY(evt.location.lat, evt.location.lng);
      })
      .filter((p): p is { x: number; y: number } => p !== null);
  }, [activeThreadId]);

  // Handle manual pan / dragging
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return; // Left click only
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragOffset({ x: translateX, y: translateY });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    const dx = (e.clientX - dragStart.x) * (1000 / rect.width);
    const dy = (e.clientY - dragStart.y) * (500 / rect.height);
    
    let newTx = dragOffset.x + dx;
    let newTy = dragOffset.y + dy;
    
    newTx = Math.max(1000 * (1 - zoom), Math.min(0, newTx));
    newTy = Math.max(500 * (1 - zoom), Math.min(0, newTy));
    
    setTranslateX(newTx);
    setTranslateY(newTy);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Handle scroll wheel zoom relative to cursor
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const svgX = (clientX / rect.width) * 1000;
    const svgY = (clientY / rect.height) * 500;

    const zoomFactor = 1.15;
    let nextZoom = e.deltaY < 0 ? zoom * zoomFactor : zoom / zoomFactor;
    nextZoom = Math.max(1, Math.min(8, nextZoom));

    const mapX = (svgX - translateX) / zoom;
    const mapY = (svgY - translateY) / zoom;

    let newTx = svgX - mapX * nextZoom;
    let newTy = svgY - mapY * nextZoom;

    newTx = Math.max(1000 * (1 - nextZoom), Math.min(0, newTx));
    newTy = Math.max(500 * (1 - nextZoom), Math.min(0, newTy));

    setZoom(nextZoom);
    setTranslateX(newTx);
    setTranslateY(newTy);
  };

  // Zoom buttons centered on view center
  const handleZoomStep = (factor: number) => {
    let nextZoom = zoom * factor;
    nextZoom = Math.max(1, Math.min(8, nextZoom));

    const centerX = 1000 / 2;
    const centerY = 500 / 2;

    const mapX = (centerX - translateX) / zoom;
    const mapY = (centerY - translateY) / zoom;

    let newTx = centerX - mapX * nextZoom;
    let newTy = centerY - mapY * nextZoom;

    newTx = Math.max(1000 * (1 - nextZoom), Math.min(0, newTx));
    newTy = Math.max(500 * (1 - nextZoom), Math.min(0, newTy));

    setZoom(nextZoom);
    setTranslateX(newTx);
    setTranslateY(newTy);
  };

  const resetZoom = () => {
    setZoom(1);
    setTranslateX(0);
    setTranslateY(0);
  };

  // Handle clicking a pin
  const handlePinClick = (evt: TimelineEvent, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering region toggle
    if (evt.year > sliderYear) {
      onAdjustYear(evt.year);
    }
    if (selectedRegion !== 'All' && selectedRegion !== evt.region) {
      onSelectRegion('All');
    }
    onSelectEvent(evt.id);
  };

  const handlePinMouseEnter = (e: React.MouseEvent<SVGGElement>, evt: TimelineEvent) => {
    const pinEl = e.currentTarget;
    const svgEl = svgRef.current;
    if (svgEl) {
      const pinRect = pinEl.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      setHoveredEvent(evt);
      setHoveredPos({
        x: pinRect.left - svgRect.left + pinRect.width / 2,
        y: pinRect.top - svgRect.top,
      });
    }
  };

  const handlePinMouseLeave = () => {
    setHoveredEvent(null);
  };

  const handleContinentClick = (region: Region) => {
    if (selectedRegion === region) {
      onSelectRegion('All');
    } else {
      onSelectRegion(region);
    }
  };

  const isAnimating = !isDragging;

  return (
    <div style={mapContainer} className="ppls-map-container">
      {/* Zoom controls (Win98 retro buttons) */}
      <div style={zoomControls}>
        <button onClick={() => handleZoomStep(1.4)} style={retroBtn} title="Zoom In">+</button>
        <button onClick={() => handleZoomStep(1 / 1.4)} style={retroBtn} title="Zoom Out">-</button>
        <button onClick={resetZoom} style={{ ...retroBtn, fontSize: 8 }} title="Zoom to Fit">Fit</button>
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 1000 500"
        style={{ width: '100%', height: '100%', display: 'block', cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Navy ocean background */}
        <rect width="1000" height="500" fill="#000040" />

        {/* Dynamic zooming group */}
        <g
          style={{
            transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isAnimating ? 'transform 0.6s cubic-bezier(0.1, 0.8, 0.2, 1)' : 'none',
          }}
        >
          {/* Latitude & Longitude grid lines */}
          {Array.from({ length: 11 }, (_, i) => {
            const lat = -75 + i * 15;
            const { y } = geoToXY(lat, 0);
            return (
              <line key={`lat-${lat}`} x1="0" y1={y} x2="1000" y2={y} stroke="#000060" strokeWidth="0.5" />
            );
          })}
          {Array.from({ length: 11 }, (_, i) => {
            const lng = -150 + i * 30;
            const { x } = geoToXY(0, lng);
            return (
              <line key={`lng-${lng}`} x1={x} y1="0" x2={x} y2="500" stroke="#000060" strokeWidth="0.5" />
            );
          })}

          {/* Continent shapes */}
          {CONTINENTS_DATA.map((continent) => {
            const isSelected = selectedRegion === 'All' || selectedRegion === continent.region;
            const isHovered = hoveredRegion === continent.region;
            const meta = REGION_META[continent.region];

            let fill = '#303030';
            let stroke = '#505050';
            let strokeWidth = 1.0;

            if (isSelected) {
              fill = isHovered ? meta.accentLight : meta.color;
              stroke = meta.accentLight;
              strokeWidth = isHovered ? 2.0 : 1.5;
            } else if (isHovered) {
              fill = '#454545';
              stroke = '#656565';
              strokeWidth = 1.5;
            }

            return (
              <path
                key={continent.id}
                d={pointsToPath(continent.points)}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                style={{ transition: 'fill 0.2s, stroke 0.2s', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinentClick(continent.region);
                }}
                onMouseEnter={() => setHoveredRegion(continent.region)}
                onMouseLeave={() => setHoveredRegion(null)}
              />
            );
          })}

          {/* Thread connection path line (Marching Ants effect) */}
          {activeThreadPoints && activeThreadPoints.length > 1 && (
            <g>
              <polyline
                points={activeThreadPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#ffcc00"
                strokeWidth="4"
                strokeOpacity="0.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={activeThreadPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#ff3333"
                strokeWidth="2.0"
                strokeDasharray="4,4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <animate attributeName="stroke-dashoffset" values="0;20" dur="3s" repeatCount="indefinite" />
              </polyline>
            </g>
          )}

          {/* Event pins */}
          {TIMELINE_EVENTS.map((evt) => {
            const isActive = filteredEvents.some((e) => e.id === evt.id);
            const isSelected = selectedEvent?.id === evt.id;
            const { x, y } = geoToXY(evt.location.lat, evt.location.lng);

            return (
              <g
                key={evt.id}
                transform={`translate(${x}, ${y}) scale(${1 / zoom})`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => handlePinClick(evt, e)}
                onMouseEnter={(e) => handlePinMouseEnter(e, evt)}
                onMouseLeave={handlePinMouseLeave}
              >
                {/* Glow for selected pin */}
                {isSelected && (
                  <circle cx="0" cy="0" r="14" fill="none" stroke="#ff3333" strokeWidth="2">
                    <animate attributeName="r" values="8;16;8" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Drop shadow */}
                <circle cx="0.5" cy="0.5" r="4.5" fill="rgba(0,0,0,0.5)" />

                {/* Marker body */}
                <circle
                  cx="0"
                  cy="0"
                  r={isSelected ? 5.5 : 4}
                  fill={isActive ? (isSelected ? '#ff3333' : '#ffcc00') : '#708090'}
                  stroke={isSelected ? '#ffffff' : '#000000'}
                  strokeWidth={isSelected ? 1.5 : 1}
                />

                {/* Inner dot for active pins */}
                {isActive && (
                  <circle cx="0" cy="0" r="1.2" fill={isSelected ? '#ffffff' : '#ff3333'} />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Retro-styled tooltip */}
      {hoveredEvent && (
        <div
          style={{
            position: 'absolute',
            left: hoveredPos.x,
            top: hoveredPos.y - 12,
            transform: 'translate(-50%, -100%)',
            background: '#ffffcc',
            border: '1px solid #000',
            padding: '4px 6px',
            boxShadow: '1px 1px 0 rgba(0,0,0,0.3)',
            fontFamily: '"MS Sans Serif", Arial, sans-serif',
            fontSize: 10,
            color: '#000',
            pointerEvents: 'none',
            zIndex: 100,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 'bold' }}>{hoveredEvent.year}: {hoveredEvent.title}</div>
          <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>📍 {hoveredEvent.location.name}</div>
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────

const PplsStory: React.FC = () => {
  const { openWindow } = useWindowManager();
  const [selectedRegion, setSelectedRegion] = useState<Region | 'All'>('All');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const yearRange = useMemo(() => getYearRange(), []);
  const [sliderYear, setSliderYear] = useState(yearRange.max);

  // Phase 2 & 3 State variables
  const [navMode, setNavMode] = useState<'index' | 'threads'>('index');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showPulsePanel, setShowPulsePanel] = useState(false);
  const [pulseBlink, setPulseBlink] = useState(true);

  // Bootstrap VFS on mount
  useEffect(() => { bootstrapVFS(); }, []);

  // Pulse blinking effect
  useEffect(() => {
    const interval = setInterval(() => setPulseBlink((b) => !b), 700);
    return () => clearInterval(interval);
  }, []);

  // Listen for external thread selection events
  useEffect(() => {
    const handleSelectEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.eventId) {
        const eventId = customEvent.detail.eventId;
        const targetEvt = TIMELINE_EVENTS.find((evt) => evt.id === eventId);
        if (targetEvt) {
          if (targetEvt.year > sliderYear) {
            setSliderYear(targetEvt.year);
          }
          setSelectedRegion('All');
          setNavMode('index');
          setSelectedEventId(eventId);
        }
      }
    };
    window.addEventListener('ppls-story-select-event', handleSelectEvent);
    return () => window.removeEventListener('ppls-story-select-event', handleSelectEvent);
  }, [sliderYear]);

  // Filtered events
  const filteredEvents = useMemo(
    () => getFilteredEvents(selectedRegion, yearRange.min, sliderYear),
    [selectedRegion, sliderYear, yearRange.min]
  );

  // Selected event
  const selectedEvent = useMemo(
    () => {
      if (navMode === 'threads' && activeThreadId) {
        const thread = CULTURAL_THREADS.find((t) => t.id === activeThreadId);
        if (thread && thread.connectedEventIds.includes(selectedEventId || '')) {
          return TIMELINE_EVENTS.find((e) => e.id === selectedEventId) || null;
        }
      }
      return filteredEvents.find((e) => e.id === selectedEventId) || filteredEvents[0] || null;
    },
    [filteredEvents, selectedEventId, navMode, activeThreadId]
  );

  const connectedOppressionThread = useMemo(() => {
    if (!selectedEvent) return null;
    return HISTORICAL_THREADS.find((t) => t.connectedEventIds.includes(selectedEvent.id)) || null;
  }, [selectedEvent]);

  // Auto-select first event when filter changes
  useEffect(() => {
    if (navMode === 'index') {
      if (filteredEvents.length > 0 && !filteredEvents.find((e) => e.id === selectedEventId)) {
        setSelectedEventId(filteredEvents[0].id);
      }
    }
  }, [filteredEvents, selectedEventId, navMode]);

  // ── Cross-routing handlers ──
  const launchVideo = useCallback((evt: TimelineEvent) => {
    openWindow({
      id: `ppls-video-${evt.id}`,
      title: `${evt.title} — Media Player`,
      appType: 'video-player',
      icon: '/images/icons/media-player-16x16.png',
      appProps: {
        videoSrc: evt.mediaPayload,
        videoTitle: evt.title,
        videoArtist: evt.artist || evt.region,
      },
      width: 640,
      height: 480,
    });
  }, [openWindow]);

  const launchDocument = useCallback((evt: TimelineEvent) => {
    if (evt.primarySourceText && evt.mediaPayload && evt.mediaPayload.startsWith('C:/')) {
      const vfsPath = evt.mediaPayload;
      try {
        vfs.writeFile(vfsPath, evt.primarySourceText);
      } catch (_) { /* already exists */ }
      openWindow({
        id: `ppls-doc-${evt.id}`,
        title: `${evt.title} - Notepad`,
        appType: 'notepad',
        icon: '/images/icons/notepad-16x16.png',
        appProps: { filePath: vfsPath },
        width: 560,
        height: 420,
      });
    }
  }, [openWindow]);

  const launchExplorer = useCallback(() => {
    openWindow({
      id: 'ppls-explorer',
      title: 'C:\\Ppls_Story',
      appType: 'explorer',
      icon: '/images/icons/folder-16x16.png',
      appProps: { path: 'C:/Ppls_Story' },
      width: 640,
      height: 480,
    });
  }, [openWindow]);

  const launchThreadViewer = useCallback((threadId: string) => {
    const thread = HISTORICAL_THREADS.find((t) => t.id === threadId);
    if (!thread) return;
    openWindow({
      id: `ppls-thread-viewer-${thread.id}`,
      title: `${thread.title} — Diagnostic Tool`,
      appType: 'ppls-thread-viewer',
      icon: '/images/icons/my-computer-16x16.png',
      appProps: { threadId },
      width: 480,
      height: 380,
    });
  }, [openWindow]);

  // Handle clicking on a Pulse Alert item
  const handleAlertClick = useCallback((alert: CivicAlert) => {
    // 1. Write the target warning text file to the VFS
    const filename = `Alert_${alert.id.replace(/-/g, '_')}.txt`;
    const vfsPath = `C:/Ppls_Story/${filename}`;
    try {
      vfs.writeFile(vfsPath, 
        `THE PULSE — CIVIC NOTIFICATION\n` +
        `Category: ${alert.type}\n` +
        `Subject: ${alert.title}\n` +
        `══════════════════════════════════════════\n\n` +
        `${alert.details}\n\n` +
        `------------------------------------------\n` +
        `ENCYCLOPEDIA REFERENCE:\n` +
        `The encyclopedia has been automatically focused on the connected entry:\n` +
        `Entry ID: ${alert.connectedEventId}\n` +
        `Please refer to 'Ppls Library' window to explore the historical roots of this issue.`
      );
    } catch (_) {}

    // 2. Launch Notepad with the file path
    openWindow({
      id: `ppls-pulse-${alert.id}`,
      title: `${alert.title} — Notifier`,
      appType: 'notepad',
      icon: '/images/icons/notepad-16x16.png',
      appProps: { filePath: vfsPath },
      width: 480,
      height: 360,
    });

    // 3. Shift app filters to focus connected event
    const connectedEvt = TIMELINE_EVENTS.find((e) => e.id === alert.connectedEventId);
    if (connectedEvt) {
      if (connectedEvt.year > sliderYear) {
        setSliderYear(connectedEvt.year);
      }
      setSelectedRegion('All');
      setNavMode('index');
      setSelectedEventId(connectedEvt.id);
    }

    // 4. Close notification popup
    setShowPulsePanel(false);
  }, [openWindow, sliderYear]);

  return (
    <div style={shell}>
      {/* ── Menu bar ── */}
      <div style={menuBar}>
        <span style={menuItem}>File</span>
        <span style={menuItem}>View</span>
        <span style={menuItem}>Navigate</span>
        <span style={menuItem}>Help</span>
        <div style={{ flex: 1 }} />
        <span style={{ ...menuItem, color: '#666', cursor: 'pointer' }} onClick={launchExplorer} title="Open C:\Ppls_Story in Explorer">
          📂 Browse Files
        </span>
      </div>

      {/* ── Top section: Map + Slider ── */}
      <div style={topSection}>
        <WorldMap
          selectedRegion={selectedRegion}
          onSelectRegion={setSelectedRegion}
          selectedEvent={selectedEvent}
          onSelectEvent={setSelectedEventId}
          filteredEvents={filteredEvents}
          sliderYear={sliderYear}
          onAdjustYear={setSliderYear}
          activeThreadId={activeThreadId}
        />

        {/* Region tabs */}
        <div style={regionTabs}>
          {(['All', 'Africa', 'Americas', 'Global', 'Asia', 'Oceania'] as const).map((r) => (
            <button
              key={r}
              onClick={() => {
                setSelectedRegion(r);
                if (navMode === 'threads') {
                  setNavMode('index');
                  setActiveThreadId(null);
                }
              }}
              style={{
                ...regionTab,
                background: selectedRegion === r && navMode === 'index' ? (r === 'All' ? '#c0c0c0' : REGION_META[r as Region].color) : '#c0c0c0',
                color: selectedRegion === r && r !== 'All' && navMode === 'index' ? '#fff' : '#000',
                borderBottom: selectedRegion === r && navMode === 'index' ? '2px solid transparent' : '2px solid #808080',
                fontWeight: selectedRegion === r && navMode === 'index' ? 700 : 400,
              }}
            >
              {r === 'All' ? '🌍 All Regions' : `${r === 'Africa' ? '🌍' : r === 'Americas' ? '🗽' : r === 'Asia' ? '🌏' : r === 'Oceania' ? '🌊' : '🌐'} ${REGION_META[r as Region].displayName}`}
            </button>
          ))}
        </div>

        {/* Chronology slider */}
        <div style={sliderRow}>
          <span style={sliderLabel}>{yearRange.min}</span>
          <input
            type="range"
            min={yearRange.min}
            max={yearRange.max}
            value={sliderYear}
            onChange={(e) => {
              setSliderYear(Number(e.target.value));
              if (navMode === 'threads') {
                setNavMode('index');
                setActiveThreadId(null);
              }
            }}
            style={sliderInput}
            title={`Showing entries up to ${sliderYear}`}
          />
          <span style={sliderLabel}>{yearRange.max}</span>
          <span style={sliderValue}>Up to {sliderYear}</span>
        </div>
      </div>

      {/* ── Bottom section: Index + Content ── */}
      <div style={bottomSection}>
        {/* Left sidebar pane: Index / Threads selection */}
        <div style={indexPane}>
          <div style={sidebarTabs}>
            <button
              onClick={() => {
                setNavMode('index');
                setActiveThreadId(null);
              }}
              style={{
                ...sidebarTab,
                background: navMode === 'index' ? '#fff' : '#c0c0c0',
                borderBottom: navMode === 'index' ? 'none' : '1.5px solid #808080',
                fontWeight: navMode === 'index' ? 700 : 400,
              }}
            >
              📋 Index
            </button>
            <button
              onClick={() => {
                setNavMode('threads');
                if (!activeThreadId && CULTURAL_THREADS.length > 0) {
                  setActiveThreadId(CULTURAL_THREADS[0].id);
                  if (CULTURAL_THREADS[0].connectedEventIds.length > 0) {
                    setSelectedEventId(CULTURAL_THREADS[0].connectedEventIds[0]);
                  }
                }
              }}
              style={{
                ...sidebarTab,
                background: navMode === 'threads' ? '#fff' : '#c0c0c0',
                borderBottom: navMode === 'threads' ? 'none' : '1.5px solid #808080',
                fontWeight: navMode === 'threads' ? 700 : 400,
              }}
            >
              🧵 Threads
            </button>
          </div>

          <div style={indexList}>
            {navMode === 'index' ? (
              filteredEvents.length === 0 ? (
                <div style={{ padding: 12, color: '#888', textAlign: 'center', fontSize: 11 }}>
                  No entries found for this selection.
                </div>
              ) : (
                filteredEvents.map((evt) => {
                  const isSelected = evt.id === selectedEvent?.id;
                  return (
                    <div
                      key={evt.id}
                      onClick={() => setSelectedEventId(evt.id)}
                      style={{
                        ...indexItem,
                        background: isSelected ? 'var(--sabr-title-active-start)' : 'transparent',
                        color: isSelected ? '#fff' : '#000',
                      }}
                    >
                      <span style={indexYear}>{evt.year}</span>
                      <span style={indexTitle}>{evt.title}</span>
                      <span style={{
                        ...indexBadge,
                        background: REGION_META[evt.region].color,
                        color: '#fff',
                      }}>
                        {evt.region.substring(0, 3).toUpperCase()}
                      </span>
                    </div>
                  );
                })
              )
            ) : (
              CULTURAL_THREADS.map((thread) => {
                const isThreadSelected = activeThreadId === thread.id;
                return (
                  <div key={thread.id} style={{ borderBottom: '1.5px solid #808080' }}>
                    <div
                      onClick={() => {
                        setActiveThreadId(isThreadSelected ? null : thread.id);
                        if (!isThreadSelected && thread.connectedEventIds.length > 0) {
                          setSelectedEventId(thread.connectedEventIds[0]);
                        }
                      }}
                      style={{
                        ...threadHeader,
                        background: isThreadSelected ? 'var(--sabr-title-active-start)' : '#e0e0e0',
                        color: isThreadSelected ? '#fff' : '#000',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 10 }}>{thread.title}</div>
                      <div style={{ fontSize: 8, color: isThreadSelected ? '#e0e0e0' : '#555', marginTop: 2 }}>
                        {thread.description}
                      </div>
                    </div>
                    {isThreadSelected && (
                      <div style={{ background: '#f5f5f5' }}>
                        {thread.connectedEventIds.map((eventId) => {
                          const evt = TIMELINE_EVENTS.find((e) => e.id === eventId);
                          if (!evt) return null;
                          const isEventSelected = selectedEvent?.id === evt.id;
                          return (
                            <div
                              key={evt.id}
                              onClick={() => setSelectedEventId(evt.id)}
                              style={{
                                ...indexItem,
                                background: isEventSelected ? 'var(--sabr-title-active-start)' : 'transparent',
                                color: isEventSelected ? '#fff' : '#000',
                                paddingLeft: 12,
                                borderBottom: '1px solid #d0d0d0',
                              }}
                            >
                              <span style={indexYear}>{evt.year}</span>
                              <span style={indexTitle}>{evt.title}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Content Viewer (right pane) */}
        <div style={contentPane}>
          {selectedEvent ? (
            <>
              {/* Event header */}
              <div style={{
                ...contentHeader,
                borderLeft: `4px solid ${REGION_META[selectedEvent.region].color}`,
              }}>
                <div style={contentTitle}>{selectedEvent.title}</div>
                <div style={contentMeta}>
                  <span style={{
                    ...contentBadge,
                    background: REGION_META[selectedEvent.region].color,
                  }}>
                    {REGION_META[selectedEvent.region].displayName}
                  </span>
                  <span style={contentYear}>{selectedEvent.year}</span>
                  {selectedEvent.tags && selectedEvent.tags.slice(0, 3).map((tag) => (
                    <span key={tag} style={contentTag}>#{tag}</span>
                  ))}
                </div>
              </div>

              {/* Summary text */}
              <div style={contentBody}>
                <p style={contentSummary}>{selectedEvent.summary}</p>

                {/* Primary source excerpt preview */}
                {selectedEvent.primarySourceText && (
                  <div style={sourcePreview}>
                    <div style={sourcePreviewHeader}>📜 Primary Source Excerpt</div>
                    <div style={sourcePreviewText}>
                      {selectedEvent.primarySourceText.substring(0, 300)}...
                    </div>
                  </div>
                )}

                {/* Reflect terminal prompt box */}
                {selectedEvent.principle && (
                  <div style={reflectBox}>
                    <div style={reflectHeader}>
                      💭 Historical Principle: {selectedEvent.principle.corePrinciple}
                    </div>
                    <div style={reflectBody}>
                      <div style={{ marginBottom: 6 }}>
                        <strong>System of Restraint:</strong> {selectedEvent.principle.systemOfRestraint}
                      </div>
                      <div style={{ marginBottom: 6 }}>
                        <strong>Cultural Expression:</strong> {selectedEvent.principle.culturalExpression}
                      </div>
                      <div style={reflectPrompt}>
                        <strong>Reflect:</strong> {selectedEvent.principle.inferencePrompt}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Launch buttons */}
              <div style={actionBar}>
                {selectedEvent.mediaType === 'video' && (
                  <button style={actionBtn} onClick={() => launchVideo(selectedEvent)} title="Open in Windows Media Player">
                    <span style={{ marginRight: 6 }}>▶</span> Watch Video
                  </button>
                )}
                {selectedEvent.primarySourceText && (
                  <button style={actionBtnAlt} onClick={() => launchDocument(selectedEvent)} title="Open in Notepad">
                    <span style={{ marginRight: 6 }}>📄</span> Read Full Source
                  </button>
                )}
                {connectedOppressionThread && (
                  <button style={actionBtnTrace} onClick={() => launchThreadViewer(connectedOppressionThread.id)} title="Trace the System of Oppression">
                    <span style={{ marginRight: 6 }}>🔍</span> Trace the System
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button style={actionBtnSmall} onClick={launchExplorer} title="Browse C:\Ppls_Story">
                  📂 Explore Files
                </button>
              </div>
            </>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: '#888', fontSize: 12 }}>
              Select a region on the map and an event from the index to begin.
            </div>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={statusBar}>
        <div style={statusSeg}>
          <span style={{ color: '#008000', marginRight: 4 }}>●</span>
          Ready
        </div>
        <div style={{ ...statusSeg, flex: 0, width: 140, borderLeft: '1px solid #808080', justifyContent: 'center' }}>
          Region: {selectedRegion}
        </div>
        <div style={{ ...statusSeg, flex: 0, width: 100, borderLeft: '1px solid #808080', justifyContent: 'center' }}>
          {filteredEvents.length} entries
        </div>
        {/* Blinking system tray Pulse notifier */}
        <div
          onClick={() => setShowPulsePanel(!showPulsePanel)}
          style={{
            ...statusSeg,
            flex: 0,
            width: 120,
            borderLeft: '1px solid #808080',
            justifyContent: 'center',
            background: showPulsePanel ? '#fff' : '#c0c0c0',
            cursor: 'pointer',
            fontWeight: 700,
          }}
          title="Click to view local civic alerts"
        >
          <span style={{ opacity: pulseBlink ? 1 : 0.2, color: '#ff0000', marginRight: 4, transition: 'opacity 0.25s' }}>🚨</span>
          <span>The Pulse</span>
        </div>
      </div>

      {/* ── The Pulse alerts popup menu ── */}
      {showPulsePanel && (
        <div style={pulsePanel}>
          <div style={pulsePanelHeader}>
            <span style={{ fontWeight: 700 }}>🚨 The Pulse: Local Civic Alerts</span>
            <button onClick={() => setShowPulsePanel(false)} style={pulseCloseBtn}>×</button>
          </div>
          <div style={pulsePanelBody}>
            <div style={{ fontSize: 9, color: '#666', marginBottom: 8, borderBottom: '1px solid #c0c0c0', paddingBottom: 4 }}>
              Click an alert to open in Notepad & focus historical context.
            </div>
            {CIVIC_ALERTS.map((alert) => (
              <div
                key={alert.id}
                onClick={() => handleAlertClick(alert)}
                style={pulseAlertItem}
              >
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                  <span style={alertBadgeStyle(alert.type)}>{alert.type.toUpperCase()}</span>
                  <strong style={{ fontSize: 10 }}>{alert.title}</strong>
                </div>
                <div style={{ fontSize: 9, color: '#444' }}>
                  {alert.details.substring(0, 110)}...
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const shell: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
  background: '#c0c0c0', fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11, overflow: 'hidden', color: '#000', position: 'relative',
};

const menuBar: React.CSSProperties = {
  display: 'flex', gap: 0, padding: '2px 4px',
  background: '#c0c0c0', borderBottom: '1px solid #808080',
  flexShrink: 0, alignItems: 'center',
};

const menuItem: React.CSSProperties = {
  padding: '1px 8px', cursor: 'default', fontSize: 11,
};

const topSection: React.CSSProperties = {
  flexShrink: 0, borderBottom: '2px solid #808080',
};

const mapContainer: React.CSSProperties = {
  height: 220, background: '#000020',
  border: '2px inset #808080', margin: '2px',
  overflow: 'hidden', position: 'relative',
};

const zoomControls: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  top: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  zIndex: 10,
};

const retroBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  fontSize: 12,
  fontWeight: 'bold',
  background: '#c0c0c0',
  color: '#000',
  border: '2px outset #ffffff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  outline: 'none',
  fontFamily: '"MS Sans Serif", Arial',
};

const regionTabs: React.CSSProperties = {
  display: 'flex', gap: 0, padding: '0 2px',
  background: '#c0c0c0',
};

const regionTab: React.CSSProperties = {
  flex: 1, padding: '4px 6px', fontSize: 10,
  border: '1px solid #808080', borderBottom: 'none',
  cursor: 'pointer', textAlign: 'center',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
  outline: 'none',
};

const sliderRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '4px 8px', background: '#d4d0c8',
  borderTop: '1px solid #fff',
};

const sliderLabel: React.CSSProperties = {
  fontSize: 10, fontFamily: 'monospace', color: '#444',
  minWidth: 32, textAlign: 'center',
};

const sliderInput: React.CSSProperties = {
  flex: 1, height: 14, cursor: 'pointer',
  accentColor: 'var(--sabr-title-active-start)',
};

const sliderValue: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--sabr-title-active-start)',
  minWidth: 70, textAlign: 'right',
  fontFamily: 'monospace',
};

const bottomSection: React.CSSProperties = {
  flex: 1, display: 'flex', overflow: 'hidden',
  minHeight: 0,
};

const indexPane: React.CSSProperties = {
  width: 200, minWidth: 160, display: 'flex', flexDirection: 'column',
  borderRight: '2px solid #808080',
  background: '#c0c0c0',
};

const sidebarTabs: React.CSSProperties = {
  display: 'flex', borderBottom: '1.5px solid #808080',
  background: '#d4d0c8', flexShrink: 0,
};

const sidebarTab: React.CSSProperties = {
  flex: 1, padding: '4px 2px', fontSize: 10,
  border: '1.5px outset #ffffff', borderBottom: 'none',
  cursor: 'pointer', textAlign: 'center',
  fontFamily: '"MS Sans Serif", Arial', outline: 'none',
};

const indexList: React.CSSProperties = {
  flex: 1, overflow: 'auto',
  background: '#fff', border: '2px inset #808080',
  margin: '2px',
};

const indexItem: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '4px 6px', cursor: 'pointer',
  borderBottom: '1px solid #e8e8e8',
  fontSize: 11, lineHeight: 1.3,
};

const indexYear: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 10, fontWeight: 700,
  minWidth: 32, flexShrink: 0,
};

const indexTitle: React.CSSProperties = {
  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const indexBadge: React.CSSProperties = {
  fontSize: 8, padding: '1px 3px', fontWeight: 700,
  flexShrink: 0, letterSpacing: 0.5,
};

const threadHeader: React.CSSProperties = {
  padding: '6px 8px', cursor: 'pointer',
  borderBottom: '1.5px solid #808080', transition: 'background 0.2s',
  lineHeight: 1.3,
};

const contentPane: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
  overflow: 'hidden', background: '#fff',
  border: '2px inset #808080', margin: '2px 2px 2px 0',
};

const contentHeader: React.CSSProperties = {
  padding: '10px 12px 8px', borderBottom: '1px solid #d0d0d0',
  background: '#f8f6f2', flexShrink: 0,
  paddingLeft: 16,
};

const contentTitle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, lineHeight: 1.3,
  marginBottom: 4,
};

const contentMeta: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  flexWrap: 'wrap',
};

const contentBadge: React.CSSProperties = {
  color: '#fff', fontSize: 9, padding: '1px 6px',
  fontWeight: 700,
};

const contentYear: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
  color: '#444',
};

const contentTag: React.CSSProperties = {
  fontSize: 9, color: '#666', fontStyle: 'italic',
};

const contentBody: React.CSSProperties = {
  flex: 1, overflow: 'auto', padding: '10px 14px',
};

const contentSummary: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.6, color: '#222',
  margin: '0 0 12px 0',
};

const sourcePreview: React.CSSProperties = {
  background: '#f5f0e8', border: '1px solid #d0c8b8',
  padding: 0, marginTop: 8,
};

const sourcePreviewHeader: React.CSSProperties = {
  padding: '4px 8px', fontWeight: 700, fontSize: 10,
  background: '#e8e0d0', borderBottom: '1px solid #d0c8b8',
};

const sourcePreviewText: React.CSSProperties = {
  padding: '8px 10px', fontSize: 10, lineHeight: 1.5,
  fontFamily: '"Courier New", monospace', color: '#444',
  whiteSpace: 'pre-wrap',
};

const reflectBox: React.CSSProperties = {
  background: '#ffffe0', border: '2px solid #808000',
  boxShadow: '2px 2px 0 rgba(0,0,0,0.1)',
  margin: '12px 0 4px', padding: 0,
};

const reflectHeader: React.CSSProperties = {
  background: '#808000', color: '#fff',
  padding: '3px 8px', fontWeight: 700, fontSize: 10,
  fontFamily: '"MS Sans Serif", Arial',
};

const reflectBody: React.CSSProperties = {
  padding: '8px 10px', fontSize: 11, lineHeight: 1.4,
  color: '#000',
};

const reflectPrompt: React.CSSProperties = {
  borderTop: '1px dashed #808000', paddingTop: 6,
  marginTop: 6, color: '#800000', fontStyle: 'italic',
};

const actionBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 10px', borderTop: '1px solid #d0d0d0',
  background: '#e8e8e8', flexShrink: 0,
};

const actionBtn: React.CSSProperties = {
  padding: '4px 14px', fontSize: 11, fontWeight: 700,
  background: 'var(--sabr-title-active-start)', color: '#fff',
  border: '2px outset var(--sabr-title-active-end)', cursor: 'pointer',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
};

const actionBtnAlt: React.CSSProperties = {
  padding: '4px 14px', fontSize: 11, fontWeight: 700,
  background: '#c0c0c0', color: '#000',
  border: '2px outset #e0e0e0', cursor: 'pointer',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
};

const actionBtnSmall: React.CSSProperties = {
  padding: '3px 8px', fontSize: 10,
  background: '#c0c0c0', color: '#444',
  border: '1px outset #e0e0e0', cursor: 'pointer',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
};

const actionBtnTrace: React.CSSProperties = {
  padding: '4px 14px', fontSize: 11, fontWeight: 700,
  background: '#800000', color: '#fff',
  border: '2px outset #ff4040', cursor: 'pointer',
  fontFamily: '"MS Sans Serif", Arial, sans-serif',
};

const statusBar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', flexShrink: 0,
  background: '#c0c0c0', borderTop: '1px solid #fff', height: 20,
};

const statusSeg: React.CSSProperties = {
  flex: 1, padding: '0 6px', fontSize: 10,
  border: '1px inset #808080', height: '100%',
  display: 'flex', alignItems: 'center',
  overflow: 'hidden', whiteSpace: 'nowrap',
};

const pulsePanel: React.CSSProperties = {
  position: 'absolute', right: 4, bottom: 22,
  width: 280, background: '#c0c0c0',
  border: '2px outset #ffffff', zIndex: 1000,
  boxShadow: '3px 3px 0 rgba(0,0,0,0.3)',
  display: 'flex', flexDirection: 'column',
};

const pulsePanelHeader: React.CSSProperties = {
  background: 'var(--sabr-title-active-start)', color: '#fff',
  padding: '4px 8px', display: 'flex',
  justifyContent: 'space-between', alignItems: 'center',
  fontSize: 10, fontWeight: 'bold',
};

const pulseCloseBtn: React.CSSProperties = {
  background: '#c0c0c0', border: '1px outset #ffffff',
  fontSize: 10, width: 14, height: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', outline: 'none', color: '#000', paddingBottom: 2,
};

const pulsePanelBody: React.CSSProperties = {
  padding: '8px', overflowY: 'auto', maxHeight: 280,
  background: '#fff', border: '2px inset #808080', margin: '2px',
};

const pulseAlertItem: React.CSSProperties = {
  padding: '6px 8px', borderBottom: '1px solid #e8e8e8',
  cursor: 'pointer', transition: 'background 0.1s',
  lineHeight: 1.3,
};

const alertBadgeStyle = (type: CivicAlert['type']): React.CSSProperties => {
  let bg = '#7f7f7f';
  if (type === 'Legislative') bg = '#c00000';
  else if (type === 'Economic') bg = '#006000';
  else if (type === 'Civic') bg = '#0000c0';
  else if (type === 'Cultural') bg = '#800080';

  return {
    background: bg, color: '#fff',
    fontSize: 7, fontWeight: 700,
    padding: '1px 3px', borderRadius: 1,
    textTransform: 'uppercase', marginRight: 4,
    display: 'inline-block',
  };
};

export default PplsStory;
