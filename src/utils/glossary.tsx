import React from 'react';
import { dialog } from './dialog';
import { isTouch } from '../apps/fileTypes';

/** Plain-English meanings of the music-business and audio terms Sanktuary uses. */
export const GLOSSARY: Record<string, string> = {
  ISRC: 'The ID for one recording (a specific master). Every version of a song, like a remix or live take, gets its own. Your distributor gives you one per track.',
  ISWC: 'The ID for the song itself (the composition, not the recording). BMI assigns it after you register the work.',
  UPC: "The release's barcode: one per album, EP or single. Your distributor gives it to you.",
  IPI: 'Your ID number as a songwriter or publisher at a PRO (BMI, ASCAP...). It is on your BMI account page. Also called CAE.',
  PRO: 'Performing rights organization (BMI, ASCAP, SESAC...): collects money when your songs are played on radio, TV, streaming and live.',
  'Songwriter splits': "Who wrote the song and each person's share of it. This is the composition side, registered with BMI.",
  'Master splits':
    "Who owns the recording and each person's share of it: artist, featured artists, producer points, the label. Separate from the songwriter splits.",
  'Sign-off':
    'Each person on the master split confirms in Sanktuary that they agree to these exact shares. Changing any share asks everyone again.',
  MLC: 'The Mechanical Licensing Collective: collects the "mechanical" royalties streaming services owe songwriters in the US.',
  SoundExchange:
    'Collects royalties for recordings played on digital radio (Pandora, SiriusXM, web radio). Artists and master owners register there.',
  'Content ID': "YouTube's system that finds your music in other people's videos and pays you for it. Set it up through your distributor.",
  Explicit: 'Whether the song has explicit lyrics. Stores and streaming services require this flag.',
  LUFS: 'Loudness Units relative to Full Scale: how loud the whole track feels. Streaming services turn loud masters down to around -14 LUFS.',
  dBTP: 'True peak: the loudest instant after conversion. Keep it at -1 dBTP or lower so MP3/AAC versions on streaming services do not distort.',
  LRA: 'Loudness range: how much the loudness changes across the track. Low means very even, high means very dynamic.',
  Mono: 'Both speakers playing the same signal, like a phone speaker or many club systems. Mixes should still sound right in mono.',
};

/**
 * A term with its meaning one hover away (dotted underline, like Windows help); on phones, tap to read it.
 * <Term>ISRC</Term>, or <Term k="IPI">IPI/CAE #</Term> when the label differs from the glossary key.
 */
export const Term: React.FC<{ k?: string; children: React.ReactNode }> = ({ k, children }) => {
  const key = k || String(children);
  const meaning = GLOSSARY[key];
  if (!meaning) return <>{children}</>;
  return (
    <abbr
      title={meaning}
      style={{ textDecoration: 'underline dotted', cursor: 'help' }}
      onClick={isTouch ? () => dialog.alert(meaning, { title: key, icon: 'info' }) : undefined}
    >
      {children}
    </abbr>
  );
};
