import type { Scale } from './types'
import { centsFromRatios } from './tuning'

/**
 * Factory tuning library.
 *
 * Naming note: several entries are labelled as 12-TET approximations of
 * pentatonic collections associated with particular musical traditions.
 * A static pitch set is not a musical system — real practice involves
 * ornament, intonation, context, and modal function that a note list cannot
 * capture. The labels here are entry points, not definitions.
 *
 * Future: Scala .scl/.kbm import produces the same `Scale` shape (cents +
 * optional ratios), so importers only need to fill this interface.
 */
const tet = (steps: number[], div = 12, period = 1200) => steps.map((s) => (s * period) / div)

export const SCALES: Scale[] = [
  {
    id: '12tet',
    name: '12-TET chromatic',
    description: 'Twelve equal steps of 100 cents.',
    cents: tet([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  },
  {
    id: 'major',
    name: 'Major (12-TET)',
    cents: tet([0, 2, 4, 5, 7, 9, 11]),
  },
  {
    id: 'minor',
    name: 'Natural minor (12-TET)',
    cents: tet([0, 2, 3, 5, 7, 8, 10]),
  },
  {
    id: 'penta-major',
    name: 'Major pentatonic (12-TET)',
    cents: tet([0, 2, 4, 7, 9]),
  },
  {
    id: 'penta-minor',
    name: 'Minor pentatonic (12-TET)',
    cents: tet([0, 3, 5, 7, 10]),
  },
  {
    id: 'ji-major',
    name: 'Just intonation major (5-limit)',
    description: 'Ptolemy intense diatonic: pure thirds and fifths.',
    ratios: ['1/1', '9/8', '5/4', '4/3', '3/2', '5/3', '15/8'],
    cents: centsFromRatios(['1/1', '9/8', '5/4', '4/3', '3/2', '5/3', '15/8']),
    source: 'Ptolemy / common 5-limit diatonic',
  },
  {
    id: 'pythagorean',
    name: 'Pythagorean diatonic (3-limit)',
    description: 'Chain of pure 3/2 fifths; wide major thirds (81/64).',
    ratios: ['1/1', '9/8', '81/64', '4/3', '3/2', '27/16', '243/128'],
    cents: centsFromRatios(['1/1', '9/8', '81/64', '4/3', '3/2', '27/16', '243/128']),
  },
  {
    id: 'ji-harmonic-8-16',
    name: 'Harmonic series 8–16',
    description: 'Partials 8 through 15 as one octave. Strongly consonant with bell/glass timbres.',
    ratios: ['8/8', '9/8', '10/8', '11/8', '12/8', '13/8', '14/8', '15/8'],
    cents: centsFromRatios(['8/8', '9/8', '10/8', '11/8', '12/8', '13/8', '14/8', '15/8']),
  },
  {
    id: 'jp-in-approx',
    name: 'Japanese "in"-style pentatonic (12-TET approx.)',
    description:
      'A semitone-pentatonic collection (0 1 5 7 8) often cited in relation to Japanese scale theory. 12-TET approximation only; not a representation of any complete tradition.',
    cents: tet([0, 1, 5, 7, 8]),
    approximation: true,
    source: 'Common textbook approximation',
  },
  {
    id: 'jp-yo-approx',
    name: 'Japanese "yo"-style pentatonic (12-TET approx.)',
    description: 'Anhemitonic collection (0 2 5 7 9). 12-TET approximation only.',
    cents: tet([0, 2, 5, 7, 9]),
    approximation: true,
    source: 'Common textbook approximation',
  },
  {
    id: 'ryukyu-approx',
    name: 'Ryukyu-style pentatonic (12-TET approx.)',
    description: 'Collection (0 4 5 7 11). 12-TET approximation only.',
    cents: tet([0, 4, 5, 7, 11]),
    approximation: true,
  },
  {
    id: 'unequal-5',
    name: 'Unequal 5-tone (example)',
    description:
      'An unequal pentatonic with steps 231/231/253/231/254 cents. Inspired by the family of near-equidistant 5-tone tunings studied in gamelan research, but this is an illustrative example, not a measured instrument.',
    cents: [0, 231, 462, 715, 946],
    approximation: true,
  },
  {
    id: 'unequal-7',
    name: 'Unequal 7-tone (example)',
    description:
      'An unequal heptatonic with alternating narrow/wide steps (approx. 90/230/90/90/230/90/380 cents), an illustrative example only.',
    cents: [0, 90, 320, 410, 500, 730, 820],
    approximation: true,
  },
  {
    id: 'maqam-rast-approx',
    name: 'Rast-style (quarter-tone approx.)',
    description: '24-TET approximation with neutral thirds/sevenths (0 200 350 500 700 900 1050). Illustrative only.',
    cents: [0, 200, 350, 500, 700, 900, 1050],
    approximation: true,
  },
  {
    id: 'bohlen-pierce',
    name: 'Bohlen–Pierce (9 of 13, tritave)',
    description: 'Non-octave scale: 13 equal steps of a 3/1 tritave; Lambda mode (9 notes).',
    cents: tet([0, 2, 3, 5, 6, 8, 9, 11, 12], 13, 1901.955),
    period: 1901.955,
  },
  {
    id: '19tet',
    name: '19-TET chromatic',
    cents: tet([...Array(19).keys()], 19),
  },
]

export function getScale(id: string): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]
}
