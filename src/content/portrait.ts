/** User-supplied preview placeholder; provenance and exact hashes live in content/photos.placeholders.json. */
export const sergioPortrait = {
  src: 'placeholders/sergio-portrait-1072.webp',
  width: 1072,
  height: 1356,
  sources: [
    { src: 'placeholders/sergio-portrait-480.webp', width: 480 },
    { src: 'placeholders/sergio-portrait-800.webp', width: 800 },
    { src: 'placeholders/sergio-portrait-1072.webp', width: 1072 },
  ],
  placeholder: 'sergio-portrait' as const,
  alt: 'Chef Sergio in a black chef jacket, standing in a kitchen. Placeholder portrait.',
  caption: 'Placeholder portrait · supplied for this preview.',
}
