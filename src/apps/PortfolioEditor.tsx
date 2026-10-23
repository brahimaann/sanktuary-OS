import React, { useState } from 'react';
import { Block, Portfolio } from '../utils/profiles';
import { button } from './TeamFiles';

// Profile > My portfolio: the page's look, and its blocks as tiles you drag around like Lego. The tiles are laid
// out the way the public page lays them out (wide spans two columns, tall two rows), in the same order.
const KINDS: [Block['type'], string][] = [
  ['text', 'Text'],
  ['photo', 'Photo'],
  ['video', 'Video'],
  ['link', 'Link'],
  ['about', 'About me'],
  ['music', 'Music'],
];
const label = (t: Block['type']) => KINDS.find(([k]) => k === t)![1];
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

const PortfolioEditor: React.FC<{ who: string; value: Portfolio; onChange: (patch: Partial<Portfolio>) => void }> = ({
  who,
  value: pf,
  onChange,
}) => {
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [pics, setPics] = useState<Record<string, string>>({}); // pictures picked this session, before they're saved
  const [msg, setMsg] = useState('');
  const blocks = pf.blocks;
  const b = blocks.find((x) => x.id === sel);

  const setBlock = (id: string, patch: Partial<Block>) => onChange({ blocks: blocks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const move = (id: string, to: number) => {
    const rest = blocks.filter((x) => x.id !== id);
    rest.splice(
      Math.max(0, Math.min(to, rest.length)),
      0,
      blocks.find((x) => x.id === id)!,
    );
    onChange({ blocks: rest });
  };
  const add = (type: Block['type']) => {
    const id = newId();
    onChange({ blocks: [...blocks, { id, type, size: type === 'music' ? 'wide' : 'normal', title: '', text: '', url: '' }] });
    setSel(id);
  };
  const upload = async (id: string, file?: File) => {
    if (!file) return;
    setMsg('Uploading...');
    const res = await fetch(`/api/profiles/me/portfolio/${id}`, { method: 'PUT', body: file });
    if (!res.ok) return setMsg(await res.text());
    setPics((p) => ({ ...p, [id]: URL.createObjectURL(file) }));
    setMsg('Picture added. Save to keep it.');
  };
  const thumb = (x: Block) => pics[x.id] || (x.type === 'photo' ? `/api/public/portfolios/${who}/img/${x.id}` : '');

  return (
    <fieldset style={group}>
      <legend>My portfolio</legend>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }} title="Visitors find it on sanktuary.studio/portfolios">
        <input type="checkbox" checked={pf.live} onChange={(e) => onChange({ live: e.target.checked })} />
        Live (shown to everyone on the portfolios page, with your display name, role, links and public photo)
      </label>
      <label style={row}>
        Headline
        <input
          value={pf.headline}
          placeholder="e.g. Producer and engineer from North Minneapolis"
          onChange={(e) => onChange({ headline: e.target.value })}
          style={input}
        />
      </label>
      <label style={row}>
        Contact
        <input
          value={pf.contact}
          placeholder="email for bookings and press (shown publicly)"
          onChange={(e) => onChange({ contact: e.target.value })}
          style={input}
        />
      </label>
      <label style={row}>
        Look
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={pf.theme} onChange={(e) => onChange({ theme: e.target.value as Portfolio['theme'] })} style={input}>
            <option value="paper">Paper (light, serif)</option>
            <option value="night">Night (dark gallery)</option>
            <option value="bold">Bold (white, heavy type)</option>
          </select>
          Accent
          <input type="color" value={pf.accent || '#8a5a12'} onChange={(e) => onChange({ accent: e.target.value })} />
          {pf.accent && (
            <button style={button} onClick={() => onChange({ accent: '' })}>
              Theme colour
            </button>
          )}
        </span>
      </label>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ marginRight: 4 }}>Blocks</b>
        {KINDS.map(([k, name]) => (
          <button key={k} style={button} onClick={() => add(k)} disabled={blocks.length >= 40}>
            + {name}
          </button>
        ))}
      </div>
      <div style={{ color: '#444' }}>Drag blocks to rearrange them. Click one to edit it or change its size.</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridAutoRows: 58,
          gridAutoFlow: 'dense',
          gap: 4,
          padding: 4,
          background: '#808080',
          border: '2px inset #808080',
        }}
      >
        {blocks.map((x, i) => (
          <div
            key={x.id}
            draggable
            onDragStart={(e) => (setDrag(x.id), e.dataTransfer.setData('text/plain', x.id))}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drag !== x.id) move(drag, i);
              setDrag(null);
            }}
            onClick={() => setSel(sel === x.id ? null : x.id)}
            style={{
              gridColumn: x.size === 'wide' ? 'span 2' : undefined,
              gridRow: x.size === 'tall' ? 'span 2' : undefined,
              background: x.id === sel ? '#000080' : '#fff',
              color: x.id === sel ? '#fff' : '#000',
              opacity: drag === x.id ? 0.4 : 1,
              border: '2px outset #fff',
              padding: 4,
              cursor: 'grab',
              overflow: 'hidden',
              display: 'flex',
              gap: 6,
              position: 'relative',
            }}
            title="Drag to move, click to edit"
          >
            {thumb(x) && (
              <img
                src={thumb(x)}
                alt=""
                style={{ height: '100%', aspectRatio: '1', objectFit: 'cover', flexShrink: 0 }}
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.7 }}>{label(x.type)}</div>
              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {x.title ||
                  (x.type === 'about' ? 'Your About me' : x.type === 'music' ? 'Your public releases' : x.url || x.text || '(empty)')}
              </div>
            </div>
          </div>
        ))}
      </div>

      {b && (
        <div style={{ background: '#fff', border: '2px inset #808080', padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ marginRight: 'auto' }}>{label(b.type)} block</b>
            <select value={b.size} onChange={(e) => setBlock(b.id, { size: e.target.value as Block['size'] })} style={input}>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
              <option value="tall">Tall</option>
            </select>
            <button style={button} title="Move earlier" onClick={() => move(b.id, blocks.indexOf(b) - 1)}>
              ←
            </button>
            <button style={button} title="Move later" onClick={() => move(b.id, blocks.indexOf(b) + 1)}>
              →
            </button>
            <button style={button} onClick={() => (onChange({ blocks: blocks.filter((x) => x.id !== b.id) }), setSel(null))}>
              Remove
            </button>
          </div>
          <label style={row}>
            {b.type === 'about' || b.type === 'music' ? 'Heading (optional)' : 'Title'}
            <input value={b.title} onChange={(e) => setBlock(b.id, { title: e.target.value })} style={input} />
          </label>
          {(b.type === 'video' || b.type === 'link') && (
            <label style={row}>
              {b.type === 'video' ? 'YouTube link' : 'Link'}
              <input value={b.url} placeholder="https://..." onChange={(e) => setBlock(b.id, { url: e.target.value })} style={input} />
            </label>
          )}
          {b.type === 'photo' && (
            <label style={row}>
              Picture
              <input type="file" accept="image/*" onChange={(e) => upload(b.id, e.target.files?.[0])} />
            </label>
          )}
          {b.type === 'about' && <div style={{ color: '#444' }}>Shows your About me from above.</div>}
          {b.type === 'music' && <div style={{ color: '#444' }}>Shows public releases credited to your display name.</div>}
          {b.type !== 'about' && b.type !== 'music' && (
            <label style={{ ...row, alignItems: 'start' }}>
              {b.type === 'text' ? 'Text' : 'Caption'}
              <textarea
                value={b.text}
                rows={b.type === 'text' ? 5 : 2}
                onChange={(e) => setBlock(b.id, { text: e.target.value })}
                style={{ ...input, resize: 'vertical' }}
              />
            </label>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ color: '#444', flex: 1 }}>{msg || 'Save below, then open it to see the result.'}</span>
        <a href={`/portfolios/${who}`} target="_blank" rel="noopener noreferrer">
          {pf.live ? 'View my portfolio' : 'Preview my portfolio'}
        </a>
      </div>
    </fieldset>
  );
};

const group: React.CSSProperties = {
  border: '2px groove #fff',
  margin: 0,
  padding: '2px 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '130px 1fr', alignItems: 'center', gap: 6 };
const input: React.CSSProperties = { fontFamily: 'inherit', fontSize: 12, padding: '2px 4px', border: '2px inset #808080', minWidth: 0 };

export default PortfolioEditor;
