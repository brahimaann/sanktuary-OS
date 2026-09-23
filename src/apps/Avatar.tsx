import React from 'react';

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#f032e6', '#9a6324'];
const colorFor = (name: string) => COLORS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

/** Member picture, or coloured initials when they haven't uploaded one. */
const Avatar: React.FC<{ username: string; avatar?: number; size?: number; online?: boolean }> = ({
  username,
  avatar,
  size = 24,
  online,
}) => (
  <span style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0 }}>
    {avatar ? (
      <img
        src={`/api/profiles/${username}/avatar?v=${avatar}`}
        alt=""
        style={{ width: size, height: size, objectFit: 'cover', border: '1px solid #808080' }}
      />
    ) : (
      <span
        style={{
          width: size,
          height: size,
          background: colorFor(username),
          color: '#fff',
          fontWeight: 700,
          fontSize: size * 0.42,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #808080',
          boxSizing: 'border-box',
        }}
      >
        {username.slice(0, 2).toUpperCase()}
      </span>
    )}
    {online !== undefined && (
      <span
        style={{
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: 8,
          height: 8,
          borderRadius: '50%',
          border: '1px solid #fff',
          background: online ? '#00c000' : '#a0a0a0',
        }}
      />
    )}
  </span>
);

export default Avatar;
