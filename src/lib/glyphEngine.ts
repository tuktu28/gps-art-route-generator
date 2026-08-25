import { LatLng } from '../types/route';

/**
 * Continuous Eulerian Runner Glyph Engine
 * Generates continuous single-stroke GPS Art running paths where letters are traced
 * continuously without mid-air breaks, using real street stems, branch turnarounds,
 * baseline traverses, and a parallel return loop back to the start.
 */

// Continuous single-stroke orthogonal street-grid sequences:
// Every letter is strictly formed on a 3-row, 2-column street block grid:
// y=1.0 (Top street), y=0.5 (Middle street), y=0.0 (Bottom street)
// x=0.0 (Left street), x=0.5 (Center street), x=1.0 (Right street)
// Connecting across top street corridor and returning via bottom street corridor.
export const CONTINUOUS_GLYPHS: Record<string, [number, number][]> = {
  // 'E': Top bar, left stem to mid, mid bar, left stem to bottom, bottom bar, return up to top
  'E': [
    [0.0, 1.0],
    [1.0, 1.0],
    [0.0, 1.0],
    [0.0, 0.5],
    [0.85, 0.5],
    [0.0, 0.5],
    [0.0, 0.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'A': Down left stem to mid, cross middle bar, down right stem to bottom, up to top, top bar, down left stem
  'A': [
    [0.0, 1.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [1.0, 0.5],
    [1.0, 1.0],
    [0.0, 1.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'S': Top bar, down upper-left stem, middle crossbar, down lower-right stem, bottom bar, return to top
  'S': [
    [0.0, 1.0],
    [1.0, 1.0],
    [0.0, 1.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'T': Top crossbar, down center stem to bottom, up center stem back to top
  'T': [
    [0.0, 1.0],
    [1.0, 1.0],
    [0.5, 1.0],
    [0.5, 0.0],
    [0.5, 1.0],
    [1.0, 1.0],
  ],

  // 'H': Down left stem to bottom, up to mid, cross middle bar, down right stem to bottom, up to top
  'H': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'I': Top bar, down center stem to bottom bar, back up center stem to top
  'I': [
    [0.2, 1.0],
    [0.8, 1.0],
    [0.5, 1.0],
    [0.5, 0.0],
    [0.2, 0.0],
    [0.8, 0.0],
    [0.5, 0.0],
    [0.5, 1.0],
    [0.8, 1.0],
  ],

  // 'L': Down left stem to bottom, bottom bar, back up left stem to top
  'L': [
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'O': Top bar, down right stem, bottom bar, up left stem, top bar
  'O': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'R': Down left stem, up to mid, mid bar, down right leg, up right stem to top, top bar
  'R': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [1.0, 0.5],
    [1.0, 1.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'U': Down left stem, bottom bar, up right stem
  'U': [
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'N': Down left stem, up to mid, cross middle bar, up right stem to top, down right stem to bottom, up to top
  'N': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 1.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'C': Top bar, left stem to bottom, bottom bar, back up left stem to top
  'C': [
    [0.0, 1.0],
    [1.0, 1.0],
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'B': Down left stem, bottom bar, mid bar, top loop, top bar
  'B': [
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 1.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'D': Down left stem, bottom bar, up right stem, top bar
  'D': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.9, 0.0],
    [0.9, 1.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'F': Down left stem to mid, mid bar, down to bottom, up to top, top bar
  'F': [
    [0.0, 1.0],
    [0.0, 0.5],
    [0.85, 0.5],
    [0.0, 0.5],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'G': Top bar, left stem, bottom bar, up lower-right stem, mid bar, return to top
  'G': [
    [0.0, 1.0],
    [1.0, 1.0],
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 0.5],
    [0.5, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'J': Top bar, down right stem, bottom bar, lower-left hook, return up right stem
  'J': [
    [0.2, 1.0],
    [1.0, 1.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 0.4],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'K': Down left stem, up to mid, mid-center junction, up to top-right, down to bottom-right, return to top
  'K': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.0, 0.5],
    [0.5, 0.5],
    [1.0, 1.0],
    [0.5, 0.5],
    [1.0, 0.0],
    [0.5, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'M': Down left stem, up to top-center, down center stem, up to top-right, down right stem, up to top-right
  'M': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [0.5, 1.0],
    [0.5, 0.5],
    [0.5, 1.0],
    [1.0, 1.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'P': Down left stem, up to mid, mid bar, up upper-right stem, top bar
  'P': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 1.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'Q': Full perimeter loop with bottom-right tail
  'Q': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'V': Down left stem to bottom, bottom bar, up right stem to top
  'V': [
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'W': Down left stem, bottom to center, up center stem to mid, down to bottom, bottom to right, up right stem
  'W': [
    [0.0, 1.0],
    [0.0, 0.0],
    [0.5, 0.0],
    [0.5, 0.5],
    [0.5, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // 'X': Down left, bottom bar, up right, mid bar, top bar
  'X': [
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'Y': Down to mid-left, mid-center, up to top-right, down center stem to bottom, up to mid-center, up to top-right
  'Y': [
    [0.0, 1.0],
    [0.0, 0.5],
    [0.5, 0.5],
    [1.0, 1.0],
    [0.5, 0.5],
    [0.5, 0.0],
    [0.5, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // 'Z': Top bar, down right stem to mid, middle bar, down left stem to bottom, bottom bar, return to top-right
  'Z': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 0.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 1.0],
  ],

  // '0': Full perimeter
  '0': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // '1': Center vertical stem
  '1': [
    [0.5, 1.0],
    [0.5, 0.0],
    [0.5, 1.0],
    [1.0, 1.0],
  ],

  // '2': Top bar, down right to mid, middle bar, down left to bottom, bottom bar
  '2': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 0.0],
    [1.0, 0.0],
    [0.0, 0.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 1.0],
  ],

  // '3': Top bar, mid bar, bottom bar, right stem
  '3': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // '4': Left stem to mid, middle bar, up right stem to top, down right stem to bottom, up to top
  '4': [
    [0.0, 1.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 1.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // '5': Top bar, left stem to mid, middle bar, down right to bottom, bottom bar
  '5': [
    [0.0, 1.0],
    [1.0, 1.0],
    [0.0, 1.0],
    [0.0, 0.5],
    [1.0, 0.5],
    [1.0, 0.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // '6': Top bar, left stem, bottom bar, mid bar, lower-right stem
  '6': [
    [0.0, 1.0],
    [1.0, 1.0],
    [0.0, 1.0],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // '7': Top bar, right stem to bottom, back to top
  '7': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.0],
    [1.0, 1.0],
  ],

  // '8': Full double-box loop
  '8': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 0.0],
    [1.0, 0.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  // '9': Top box, right stem to bottom, back to top
  '9': [
    [0.0, 1.0],
    [1.0, 1.0],
    [1.0, 0.0],
    [1.0, 0.5],
    [0.0, 0.5],
    [0.0, 1.0],
    [1.0, 1.0],
  ],

  'HEART': [
    [0.5, 0.0],
    [0.0, 0.5],
    [0.0, 1.0],
    [0.5, 0.75],
    [1.0, 1.0],
    [1.0, 0.5],
    [0.5, 0.0],
  ],

  'STAR': [
    [0.5, 1.0],
    [0.62, 0.65],
    [0.98, 0.65],
    [0.69, 0.44],
    [0.8, 0.08],
    [0.5, 0.3],
    [0.2, 0.08],
    [0.31, 0.44],
    [0.02, 0.65],
    [0.38, 0.65],
    [0.5, 1.0],
  ],
};

// Legacy fallback dictionary for compatibility
export const GLYPH_STROKES = CONTINUOUS_GLYPHS;

/**
 * Generate a continuous single-stroke polyline connecting all glyph characters in sequence
 * using orthogonal street-grid typography, baseline/top transitions, and a closed return loop.
 */
export function generateGlyphPolyline(
  text: string,
  start: LatLng,
  targetDistanceKm: number
): { coordinates: [number, number][]; confidenceScore: number } {
  const clean = text.trim().toUpperCase() || 'RUN';
  const isSpecialShape = clean === 'HEART' || clean === 'STAR';
  const tokens = isSpecialShape ? [clean] : clean.replace(/[^A-Z0-9]/g, '').split('');

  if (tokens.length === 0) {
    tokens.push('R', 'U', 'N');
  }

  // Calculate layout scale in geographic degrees
  const latRad = (start.lat * Math.PI) / 180;
  const kmPerLat = 111.0;
  const kmPerLng = 111.0 * Math.cos(latRad);

  // Estimate stroke units for orthogonal block letters
  const avgStrokeUnits = tokens.length * 3.8 + (tokens.length - 1) * 0.8 + 2.0;
  const boxHeightKm = Math.max(0.15, Math.min(8.0, targetDistanceKm / (avgStrokeUnits * 1.25)));
  const charWidthKm = boxHeightKm * 0.75;
  const spacingKm = boxHeightKm * 0.30;

  const heightDeg = boxHeightKm / kmPerLat;
  const charWidthDeg = charWidthKm / kmPerLng;
  const spacingDeg = spacingKm / kmPerLng;

  const rawPath: [number, number][] = [];
  const topLat = start.lat;
  const bottomLat = start.lat - heightDeg;

  tokens.forEach((char, index) => {
    const glyphPoints = CONTINUOUS_GLYPHS[char] || CONTINUOUS_GLYPHS['O'];
    const leftLng = start.lng + index * (charWidthDeg + spacingDeg);

    const mappedPoints: [number, number][] = glyphPoints.map(([x, y]) => {
      const geoLat = bottomLat + y * heightDeg;
      const geoLng = leftLng + x * charWidthDeg;
      return [geoLat, geoLng];
    });

    if (rawPath.length === 0) {
      rawPath.push(...mappedPoints);
    } else {
      // Connect along top street corridor to next letter
      const nextStart = mappedPoints[0];
      rawPath.push([topLat, nextStart[1]]);
      rawPath.push(...mappedPoints);
    }
  });

  // Return loop: from bottom-right of last letter along bottom street back to start.lng, then up to start.lat
  if (rawPath.length > 0) {
    const lastPoint = rawPath[rawPath.length - 1];
    rawPath.push([bottomLat, lastPoint[1]]);
    rawPath.push([bottomLat, start.lng]);
    rawPath.push([topLat, start.lng]);
  }

  const confidenceScore = Math.max(70, Math.min(96, Math.round(95 - tokens.length * 2.8)));

  return {
    coordinates: rawPath,
    confidenceScore,
  };
}

/**
 * Catmull-Rom spline path smoother for runner GPS art
 */
function smoothPath(points: [number, number][], factor = 3): [number, number][] {
  if (points.length < 3) return points;
  const result: [number, number][] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    result.push(p1);

    for (let t = 1; t < factor; t++) {
      const step = t / factor;
      const lat =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * step +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * step * step +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * step * step * step);
      const lng =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * step +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * step * step +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * step * step * step);
      result.push([lat, lng]);
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

