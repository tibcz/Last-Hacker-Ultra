/**
 * The one job of a backyard ultra: never get easier.
 *
 * `hour` is 1-based. Every parameter any challenge family uses is derived from
 * it through this module, so the whole curve is tunable in one place.
 */

/** Headline number shown on the board. Strictly increasing, exponential-ish. */
export function ultraIndex(hour) {
  return Math.round(100 * Math.pow(1.155, hour - 1));
}

/** Coarse band, used for copy and colour on the board. */
export function band(hour) {
  if (hour <= 4) return 'warmup';
  if (hour <= 10) return 'steady';
  if (hour <= 18) return 'grind';
  if (hour <= 28) return 'attrition';
  if (hour <= 40) return 'deep';
  return 'nightmare';
}

export const BAND_LABEL = {
  warmup: 'WARM-UP',
  steady: 'STEADY STATE',
  grind: 'THE GRIND',
  attrition: 'ATTRITION',
  deep: 'DEEP HOURS',
  nightmare: 'NIGHTMARE',
};

/** Smooth 0..1 ramp across the first `span` hours, then saturating. */
export function ramp(hour, span) {
  return 1 - Math.exp(-hour / span);
}

/** Geometric growth helper: value at hour 1 is `base`, multiplying every `per` hours. */
export function growth(hour, base, factor, per) {
  return base * Math.pow(factor, (hour - 1) / per);
}
