import type { Scale } from './types'
import { centsFromRatios } from './tuning'

/**
 * Factory tuning library: eight scales from living musical traditions.
 *
 * A static pitch set is not a musical system — real practice involves
 * ornament, intonation, context and modal function that a note list cannot
 * capture. Where a tradition has no single fixed tuning (gamelan, maqam) the
 * cents are representative measurements or common approximations, and the
 * entry says so. The labels here are entry points, not definitions.
 *
 * Scala .scl/.kbm import produces the same `Scale` shape (cents + optional
 * ratios), so importers only need to fill this interface.
 */
const tet = (steps: number[], div = 12, period = 1200) => steps.map((s) => (s * period) / div)
const ji = (ratios: string[]) => ({ ratios, cents: centsFromRatios(ratios) })

export const SCALES: Scale[] = [
  {
    id: 'in',
    name: '都節 In (Japan)',
    description: 'Miyako-bushi pentatonic (0 1 5 7 8): the semitone scale of koto and shamisen music. 12-TET approximation.',
    cents: tet([0, 1, 5, 7, 8]),
    approximation: true,
    source: 'Uehara Rokushirō, Zokugaku senritsu kō (1895)',
  },
  {
    id: 'yo',
    name: '民謡 Yo (Japan)',
    description: 'Anhemitonic min’yō pentatonic (0 2 5 7 9) of folk song and festival music. 12-TET approximation.',
    cents: tet([0, 2, 5, 7, 9]),
    approximation: true,
    source: 'Koizumi Fumio, tetrachord theory',
  },
  {
    id: 'ryukyu',
    name: '琉球 Ryukyu (Okinawa)',
    description: 'Okinawan pentatonic (0 4 5 7 11) with major third and leading tone. 12-TET approximation.',
    cents: tet([0, 4, 5, 7, 11]),
    approximation: true,
  },
  {
    id: 'gong',
    name: '宮調 Gong (China, 三分損益)',
    description: 'Chinese gong-mode pentatonic tuned by the sanfen sunyi (up-and-down thirds) method: a chain of pure 3/2 fifths.',
    ...ji(['1/1', '9/8', '81/64', '3/2', '27/16']),
    source: 'Guanzi (c. 7th c. BCE) / Lüshi Chunqiu',
  },
  {
    id: 'slendro',
    name: 'Sléndro (Java)',
    description: 'Near-equidistant five-tone gamelan tuning; every gamelan differs. Cents are a representative average of measured Central Javanese sets.',
    cents: [0, 231, 474, 717, 955],
    approximation: true,
    source: 'Kunst / Surjodiningrat et al., measured gamelan averages',
  },
  {
    id: 'pelog',
    name: 'Pélog (Bali / Java)',
    description: 'Seven-tone gamelan tuning with uneven steps; players use five- or six-tone subsets (pathet). Representative measured values.',
    cents: [0, 120, 270, 540, 670, 790, 950],
    approximation: true,
    source: 'Kunst / Surjodiningrat et al., measured gamelan averages',
  },
  {
    id: 'rast',
    name: 'Maqām Rāst (Arab / Turkish)',
    description: 'Rast with neutral (three-quarter-tone) third and seventh (0 200 350 500 700 900 1050). 24-TET approximation of a flexible intonation.',
    cents: [0, 200, 350, 500, 700, 900, 1050],
    approximation: true,
    source: 'Cairo Congress 1932 24-TET convention',
  },
  {
    id: 'bhairav',
    name: 'Rāga Bhairav (India)',
    description: 'Morning raga / thāt with flat second and sixth, in just intonation (shruti-based): 1 16/15 5/4 4/3 3/2 8/5 15/8.',
    ...ji(['1/1', '16/15', '5/4', '4/3', '3/2', '8/5', '15/8']),
    source: 'Bhatkhande thāt system; 5-limit shruti values',
  },
]

export function getScale(id: string): Scale {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]
}
