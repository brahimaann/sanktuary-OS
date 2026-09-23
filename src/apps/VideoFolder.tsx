import React from 'react';
import { useWindowManager } from '../wm/manager';
import { VIDEO_COLLECTIONS, getThumbnail, type Video } from './videoData';

interface VideoFolderProps {
  collectionId: string;
}

/**
 * Win98 Explorer–style folder view for a video collection.
 * Shows video thumbnails in a grid; double-clicking opens the video
 * in a Windows Media Player–style window.
 */
const VideoFolder: React.FC<VideoFolderProps> = ({ collectionId }) => {
  const { openWindow } = useWindowManager();
  const collection = VIDEO_COLLECTIONS[collectionId];

  if (!collection) {
    return <div style={{ padding: 16, fontFamily: 'MS Sans Serif, Arial, sans-serif', fontSize: 12 }}>Collection not found.</div>;
  }

  const openVideo = (video: Video) => {
    openWindow({
      id: `video-${video.id}`,
      title: `${video.title} — Media Player`,
      appType: 'video-player',
      icon: '/images/icons/media-player-16x16.png',
      appProps: { videoSrc: video.src, videoTitle: video.title, videoArtist: video.artist },
      width: 640,
      height: 480,
    });
  };

  return (
    <div style={shell}>
      {/* ── Toolbar ── */}
      <div style={toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          <img src="/images/icons/folder-16x16.png" style={{ width: 16, height: 16 }} alt="" />
          <span style={{ fontWeight: 700, fontSize: 12 }}>{collection.name}</span>
          <span style={{ color: '#666', fontSize: 11, marginLeft: 4 }}>— {collection.subtitle}</span>
        </div>
        <span style={{ fontSize: 10, color: '#888' }}>{collection.videos.length} video{collection.videos.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Description banner ── */}
      <div style={{
        padding: '6px 12px', background: collection.color, color: '#fff',
        fontSize: 11, lineHeight: 1.4, borderBottom: '1px solid #808080',
      }}>
        {collection.description}
      </div>

      {/* ── Video grid ── */}
      <div style={grid}>
        {collection.videos.length === 0 ? (
          <div style={{ padding: 24, color: '#888', fontSize: 12, textAlign: 'center', gridColumn: '1 / -1' }}>
            This folder is empty. Add videos to <code>videoData.ts</code> to see them here.
          </div>
        ) : (
          collection.videos.map((video) => (
            <div
              key={video.id}
              style={card}
              onDoubleClick={() => openVideo(video)}
              title={`Double-click to play: ${video.title}`}
            >
              {/* Thumbnail */}
              <div style={thumbWrap}>
                <img
                  src={getThumbnail(video)}
                  alt=""
                  style={thumbImg}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/images/icons/media-player-32x32.png';
                    (e.target as HTMLImageElement).style.objectFit = 'contain';
                    (e.target as HTMLImageElement).style.padding = '12px';
                  }}
                />
                {/* Play button overlay */}
                <div style={playOverlay}>
                  <div style={playBtn}>▶</div>
                </div>
                {/* Duration badge */}
                {video.duration && (
                  <div style={durationBadge}>{video.duration}</div>
                )}
              </div>

              {/* Info */}
              <div style={{ padding: '6px 6px 4px', overflow: 'hidden' }}>
                <div style={titleText}>{video.title}</div>
                {video.artist && <div style={artistText}>{video.artist}</div>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Status bar ── */}
      <div style={statusBar}>
        <div style={statusSeg}>{collection.videos.length} object(s)</div>
        <div style={{ ...statusSeg, flex: 0, width: 160, borderLeft: '1px solid #808080' }}>Double-click to play</div>
      </div>
    </div>
  );
};

/* ── Styles ── */
const shell: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
  background: '#c0c0c0', fontFamily: '"MS Sans Serif", Arial, sans-serif',
  fontSize: 11, overflow: 'hidden',
};
const toolbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '4px 8px',
  background: '#c0c0c0', borderBottom: '1px solid #808080',
  flexShrink: 0,
};
const grid: React.CSSProperties = {
  flex: 1, overflow: 'auto', padding: 10,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: 10, alignContent: 'start',
  background: '#fff', border: '2px inset #808080',
  margin: '0 2px',
};
const card: React.CSSProperties = {
  background: '#f0f0f0', border: '1px solid #c0c0c0',
  borderRadius: 0, cursor: 'default', overflow: 'hidden',
  transition: 'border-color 0.12s',
};
const thumbWrap: React.CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: '16/9',
  background: '#000', overflow: 'hidden',
};
const thumbImg: React.CSSProperties = {
  width: '100%', height: '100%', objectFit: 'cover', display: 'block',
};
const playOverlay: React.CSSProperties = {
  position: 'absolute', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.3)',
  opacity: 0.7,
  transition: 'opacity 0.15s',
};
const playBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  background: 'rgba(0,0,0,0.7)', border: '2px solid rgba(255,255,255,0.8)',
  color: '#fff', fontSize: 16,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  paddingLeft: 3,
};
const durationBadge: React.CSSProperties = {
  position: 'absolute', bottom: 4, right: 4,
  background: 'rgba(0,0,0,0.8)', color: '#fff',
  padding: '1px 5px', fontSize: 10, fontFamily: 'monospace',
};
const titleText: React.CSSProperties = {
  fontWeight: 700, fontSize: 11, lineHeight: 1.3,
  overflow: 'hidden', textOverflow: 'ellipsis',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
};
const artistText: React.CSSProperties = {
  fontSize: 10, color: '#666', marginTop: 2,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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

export default VideoFolder;
