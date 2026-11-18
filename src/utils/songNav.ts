/** Open one song's page in Music (now, or when Music next opens), e.g. from the Operations board or the calendar. */
let wish: { release: string; track?: string } | null = null;
export const showSong = (release: string, track?: string) => {
  wish = { release, track };
  window.dispatchEvent(new Event('sk:tracks-song'));
};
export const takeSongWish = () => {
  const w = wish;
  wish = null;
  return w;
};
