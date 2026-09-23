/**
 * Video collections for the three community folders.
 * 
 * To add a new video, just push an entry into the appropriate collection's `videos` array.
 * YouTube URLs should use the embed format: https://www.youtube.com/embed/VIDEO_ID
 * Other sources can use direct embed URLs.
 */

export interface Video {
  id: string;
  title: string;
  src: string;            // Embed URL (YouTube /embed/..., Vimeo /video/..., or direct)
  thumbnail?: string;     // Optional thumbnail URL — auto-generated for YouTube if omitted
  duration?: string;      // e.g. "12:34"
  artist?: string;        // Creator / channel name
  description?: string;
}

export interface VideoCollection {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  color: string;          // Accent color for the folder
  videos: Video[];
}

/** Helper: extract YouTube video ID from various URL formats */
function ytId(src: string): string | null {
  const m = src.match(/(?:embed\/|watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Auto-generate YouTube thumbnail if none provided */
export function getThumbnail(video: Video): string {
  if (video.thumbnail) return video.thumbnail;
  const id = ytId(video.src);
  if (id) return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
  return '/images/icons/video-32x32.png';
}

// ──────────────────────────────────────────────
// 4 D PPL — Community Artists & Resources
// ──────────────────────────────────────────────
const fourDPpl: VideoCollection = {
  id: '4-d-ppl',
  name: '4 D PPL',
  subtitle: 'Community Artists & Resources',
  description: 'A curated collection of community artists, creative resources, and cultural expression.',
  color: '#c44020',
  videos: [
    {
      id: '4dp-1',
      title: 'The Art of Storytelling',
      src: 'https://www.youtube.com/embed/RQaW2bFieo8',
      artist: 'Community Arts',
      duration: '8:24',
    },
    {
      id: '4dp-2',
      title: 'Street Art Documentary',
      src: 'https://www.youtube.com/embed/0RMoWMpjziI',
      artist: 'Creative Voices',
      duration: '15:02',
    },
    {
      id: '4dp-3',
      title: 'Music Production Basics',
      src: 'https://www.youtube.com/embed/rgaTLrZGlk0',
      artist: 'Beat Culture',
      duration: '22:10',
    },
  ],
};

// ──────────────────────────────────────────────
// WE D PPL — Educational, Politics, Socioeconomic
// ──────────────────────────────────────────────
const weDPpl: VideoCollection = {
  id: 'we-d-ppl',
  name: 'WE D PPL',
  subtitle: 'Education · Politics · Socioeconomic',
  description: 'Documentaries, lectures, and discussions on education, politics, and socioeconomic topics.',
  color: '#2060a8',
  videos: [
    {
      id: 'wdp-1',
      title: 'Understanding Economics',
      src: 'https://www.youtube.com/embed/PHe0bXAIuk0',
      artist: 'CrashCourse',
      duration: '11:23',
    },
    {
      id: 'wdp-2',
      title: 'History of Civil Rights',
      src: 'https://www.youtube.com/embed/URxwe6LPvkM',
      artist: 'Documentary Hub',
      duration: '45:00',
    },
    {
      id: 'wdp-3',
      title: 'Community Building & Leadership',
      src: 'https://www.youtube.com/embed/18WXHSL3vmY',
      artist: 'TEDx Talks',
      duration: '18:45',
    },
    {
      id: 'wdp-4',
      title: "The Ballot or the Bullet",
      src: 'https://www.youtube.com/embed/0ymPLDO0pOA',
      artist: 'Malcolm X',
      duration: '1:12:24',
    },
  ],
};

// ──────────────────────────────────────────────
// BY D PPL — Community Creations & Curations
// ──────────────────────────────────────────────
const byDPpl: VideoCollection = {
  id: 'by-d-ppl',
  name: 'BY D PPL',
  subtitle: 'Creations · Curations · Gallery',
  description: 'Community-based creations, curations, artists, art, gallery exhibits, and creative expression.',
  color: '#20884a',
  videos: [
    {
      id: 'bdp-1',
      title: 'Local Gallery Exhibition',
      src: 'https://www.youtube.com/embed/4Hg1Kudd_x4',
      artist: 'Art Gallery',
      duration: '6:30',
    },
    {
      id: 'bdp-2',
      title: 'Independent Film Showcase',
      src: 'https://www.youtube.com/embed/gYO1uk7vPzk',
      artist: 'Indie Creatives',
      duration: '14:22',
    },
    {
      id: 'bdp-3',
      title: 'Poetry & Spoken Word',
      src: 'https://www.youtube.com/embed/dVxGS4ULJuY',
      artist: 'Community Stage',
      duration: '9:15',
    },
  ],
};

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────
export const VIDEO_COLLECTIONS: Record<string, VideoCollection> = {
  '4-d-ppl': fourDPpl,
  'we-d-ppl': weDPpl,
  'by-d-ppl': byDPpl,
};

export default VIDEO_COLLECTIONS;
