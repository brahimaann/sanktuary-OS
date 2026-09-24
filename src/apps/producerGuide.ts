// The Producer window's Guide: effect chains, levels, working with references, genre notes, quick fixes and
// free tools. Ableton Live stock devices first (everyone on the team has them), common alternatives after.
// Numbers are starting points to adjust by ear.
export interface GuideItem {
  name: string;
  text?: string;
  steps?: string[];
  link?: string;
}
export interface GuideSection {
  title: string;
  intro?: string;
  items: GuideItem[];
}

export const GUIDE: GuideSection[] = [
  {
    title: 'Chains',
    intro: 'In order, top to bottom. Use the Tempo & key tab for delay and reverb times at your tempo.',
    items: [
      {
        name: 'Lead vocal',
        steps: [
          'Utility: set the level so the loudest phrases peak around -10 to -6 dBFS before any effects.',
          'EQ Eight: high-pass around 80-100 Hz; dip 200-400 Hz if it sounds boxy or muddy; find harshness at 2-5 kHz and notch it narrowly.',
          'Compressor: 3:1 to 4:1, attack 5-15 ms, release timed to the song (1/16 or 1/8 note), 3-6 dB of gain reduction on the loud parts.',
          'De-essing: Multiband Dynamics with only the top band working (about 5-9 kHz), or a dedicated de-esser.',
          'Saturator (soft sine, low drive) for warmth and presence, mixed in gently.',
          'A second, faster compressor or Glue Compressor catching 1-3 dB to make it steady.',
          'Sends, not inserts: a plate reverb and a 1/8 or 1/4 note Echo/Delay. High-pass and low-pass the returns so the effects sit behind the voice.',
        ],
      },
      {
        name: 'Background vocals and ad-libs',
        steps: [
          "High-pass higher than the lead (150-250 Hz) so they don't cloud the low mids.",
          'Compress harder than the lead so they stay level and tucked in.',
          'Soften 2-4 kHz a little so the lead owns that range.',
          'Widen: pan doubles left and right, or Utility width / Chorus-Ensemble on the bus.',
          'More reverb than the lead (hall or long plate) to push them back.',
        ],
      },
      {
        name: 'Drum bus',
        steps: [
          'EQ Eight: clean up anything below the kick with a high-pass around 25-30 Hz.',
          "Drum Buss: a little drive and crunch; tune Boom to the song's root note (see the key in Analyze) for low-end weight.",
          'Glue Compressor: ratio 2 or 4, attack 10-30 ms (lets transients through), release auto or 0.1-0.2 s, 2-4 dB of reduction.',
          'Optional parallel: send to a heavily compressed copy and blend it underneath for density.',
        ],
      },
      {
        name: 'Log drum, 808 and bass',
        steps: [
          'Tune it: the note should match the key. Check with Tuner or the Analyze tab.',
          "EQ Eight: high-pass at 25-30 Hz to remove rumble you can't hear but the limiter can.",
          'Saturator or Roar: add upper harmonics so the bass line is heard on phones and earbuds.',
          "Compressor with sidechain from the kick (fast attack, release to the groove) so kick and bass don't fight.",
          'Keep it mono below about 120 Hz (Utility: Bass Mono).',
        ],
      },
      {
        name: 'Percussion and shakers',
        steps: [
          'High-pass generously: most shakers and hats have nothing useful below 300-500 Hz.',
          'Shape transients (Drum Buss Transients) instead of boosting treble.',
          'Spread parts across the stereo field and keep the kick, snare, bass and lead vocal in the centre.',
          'A short room reverb on a send glues loops recorded in different places.',
        ],
      },
      {
        name: 'Master bus (for checking mixes, not mastering)',
        steps: [
          'EQ Eight: broad, gentle moves only (under 2 dB).',
          'Glue Compressor: 1-2 dB of reduction, slow attack, auto release.',
          "Limiter: ceiling -1 dB so encoding to MP3/AAC doesn't clip.",
          'Meter loudness (Analyze tab or Youlean) and compare to references at the same loudness.',
        ],
      },
    ],
  },
  {
    title: 'Levels and loudness',
    items: [
      {
        name: 'Gain staging',
        text: 'Record and mix with headroom: tracks peaking around -10 to -6 dBFS, the mix bus peaking around -6 dBFS before any limiting. Plugins and your ears behave better, and there is room to master.',
      },
      {
        name: 'Streaming targets',
        text: 'Spotify, YouTube and Tidal play songs at about -14 LUFS, Apple Music at about -16. A louder master is turned down to that, so pushing past it mostly costs punch. Keep true peaks at or below -1 dBTP (Spotify suggests -2 dBTP for masters louder than -14 LUFS).',
      },
      {
        name: 'Check in mono',
        text: 'Club systems, phones and many speakers are mono. Flip the master to mono (Utility: Mono) now and then; if the vocal or bass drops out, something is out of phase. The Stereo number in Analyze warns you when it goes below 0.',
      },
    ],
  },
  {
    title: 'Working with references',
    items: [
      {
        name: 'Pick them early',
        text: 'Choose 2-3 released songs in the sound you are going for, before mixing. Put them in the session on a track that skips your master chain.',
      },
      {
        name: 'Match loudness first',
        text: "A louder song always sounds better for a moment. Turn the reference down to your mix's loudness (the Compare tab tells you by how many dB), then judge.",
      },
      {
        name: 'Compare one thing at a time',
        text: "Low end first (the Compare tab's Sub and Low bars), then vocal level against the beat, then brightness, then width. Short A/B switches, a few seconds each.",
      },
      {
        name: 'Test where people listen',
        text: 'Phone speaker, earbuds, a car, a laptop. If the bass line disappears on a phone, add harmonics (see the 808 chain).',
      },
    ],
  },
  {
    title: 'Afrobeats and Amapiano notes',
    items: [
      {
        name: 'Tempo',
        text: 'Afrobeats commonly sits around 95-115 BPM; Amapiano around 110-115 BPM. If Analyze shows half or double, use the alternative it lists.',
      },
      {
        name: 'Swing',
        text: "The bounce lives in the 16ths. Apply a swing groove from Ableton's Groove Pool to percussion and shakers (not always to the kick), and nudge individual hits by ear.",
      },
      {
        name: 'Log drum',
        text: 'Pitch the log drum to the key, give it glide between notes, saturate it for presence, and sidechain it lightly to the kick so both hit.',
      },
      {
        name: 'Space for the voice',
        text: 'Busy percussion and a vocal fight in the 2-5 kHz range. Carve a little there on percussion buses when the vocal comes in (automation or a sidechained EQ).',
      },
      {
        name: 'Call and response',
        text: 'Leave gaps in the lead for ad-libs, horns or a synth answer. Arrange for conversation between parts rather than stacking everything at once.',
      },
    ],
  },
  {
    title: 'Quick fixes',
    items: [
      {
        name: 'Muddy or boxy',
        text: "Cut 200-500 Hz on the instruments that don't need it (pads, guitars, background vocals) rather than on everything.",
      },
      {
        name: 'Harsh or tiring',
        text: 'Look at 2-5 kHz and 7-10 kHz: a narrow cut on the worst offender, or de-ess. Lower the treble on the mix bus only as a last resort.',
      },
      {
        name: 'Vocal buried',
        text: 'Automate the vocal level phrase by phrase before reaching for more compression; then carve 2-4 kHz on the beat.',
      },
      {
        name: 'Kick and bass fighting',
        text: 'Sidechain the bass to the kick, or give each its own frequency (kick punch around 60-80 Hz, bass fundamental above or below).',
      },
      {
        name: 'Mix sounds small',
        text: 'Check the Stereo number: near 1.0 is almost mono. Pan supporting parts wider, add a short stereo reverb, keep low end centred.',
      },
      {
        name: 'Master too quiet',
        text: "Aim for your references' loudness with a limiter doing 2-4 dB at most; if it needs more, the mix balance (usually the low end) is the problem.",
      },
    ],
  },
  {
    title: 'Free tools',
    items: [
      {
        name: 'Youlean Loudness Meter',
        text: 'LUFS and true-peak meter (free version).',
        link: 'https://youlean.co/youlean-loudness-meter/',
      },
      { name: 'Voxengo SPAN', text: 'Spectrum analyzer for comparing against references.', link: 'https://www.voxengo.com/product/span/' },
      { name: 'TDR Nova', text: 'Dynamic EQ: tame harshness or boom only when it happens.', link: 'https://www.tokyodawn.net/tdr-nova/' },
      {
        name: 'Valhalla Supermassive',
        text: 'Huge reverbs and delays for throws and atmospheres.',
        link: 'https://valhalladsp.com/shop/reverb/valhalla-supermassive/',
      },
      {
        name: 'MeldaProduction MFreeFXBundle',
        text: 'Dozens of free effects, including utilities and analyzers.',
        link: 'https://www.meldaproduction.com/MFreeFXBundle',
      },
      { name: 'Vital', text: 'Wavetable synth (free tier).', link: 'https://vital.audio/' },
      { name: 'Spitfire LABS', text: 'Free instruments: strings, keys, textures.', link: 'https://labs.spitfireaudio.com/' },
      {
        name: 'Ableton Live manual',
        text: 'What every stock device does, in detail.',
        link: 'https://www.ableton.com/en/manual/welcome-to-live/',
      },
    ],
  },
];
