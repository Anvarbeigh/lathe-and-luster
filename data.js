// Pieces: lathe-turned shapes (profile points r,y) and metals with their own corrosion colours.

export const METALS = [
  { id: 'iron', name: 'Iron', metal: '#9a9ca0', dull: '#5d5852', crust: ['#3a1b0c', '#8c3f16', '#c9752f'], tough: 1.0, mult: 1, unlock: 0, verb: 'Scrub off the rust' },
  { id: 'copper', name: 'Copper', metal: '#f2a07a', dull: '#7a4a35', crust: ['#163a30', '#2f7d68', '#86c9a8'], tough: 1.15, mult: 2.5, unlock: 4, verb: 'Scrub off the verdigris' },
  { id: 'brass', name: 'Brass', metal: '#f0cf78', dull: '#6e5a32', crust: ['#121010', '#3b322a', '#6b5a48'], tough: 1.3, mult: 6, unlock: 10, verb: 'Scrub off the soot' },
  { id: 'silver', name: 'Silver', metal: '#f4f3f0', dull: '#77736c', crust: ['#14111a', '#3c3446', '#6e6478'], tough: 1.45, mult: 14, unlock: 18, verb: 'Scrub off the tarnish' },
  { id: 'gold', name: 'Gold', metal: '#ffcf5a', dull: '#8a6a2a', crust: ['#3a2c1c', '#7a6446', '#b39c78'], tough: 1.6, mult: 30, unlock: 28, verb: 'Wash off the old clay' },
];

// profiles from the bottom centre up the outside (and down the inside for open pieces); y up, r out
export const SHAPES = [
  { id: 'cup', name: 'Cup', base: 8, pts: [[0, 0], [0.36, 0], [0.4, 0.04], [0.37, 0.1], [0.4, 0.42], [0.44, 0.62], [0.41, 0.66], [0.36, 0.6], [0.33, 0.22], [0, 0.2]] },
  { id: 'vase', name: 'Vase', base: 12, pts: [[0, 0], [0.28, 0], [0.31, 0.05], [0.28, 0.1], [0.42, 0.42], [0.46, 0.66], [0.37, 0.96], [0.2, 1.16], [0.17, 1.3], [0.25, 1.4], [0.23, 1.45], [0.14, 1.38], [0, 1.34]] },
  { id: 'goblet', name: 'Goblet', base: 14, pts: [[0, 0], [0.36, 0], [0.38, 0.04], [0.34, 0.08], [0.1, 0.18], [0.065, 0.38], [0.12, 0.46], [0.065, 0.54], [0.11, 0.66], [0.38, 0.86], [0.46, 1.24], [0.43, 1.28], [0.38, 1.22], [0.3, 0.98], [0, 0.9]] },
  { id: 'bell', name: 'Bell', base: 16, pts: [[0, 0.24], [0.38, 0.12], [0.5, 0.02], [0.54, 0], [0.53, 0.06], [0.44, 0.2], [0.35, 0.55], [0.32, 0.88], [0.27, 1.02], [0.12, 1.09], [0.09, 1.17], [0.14, 1.27], [0.09, 1.38], [0, 1.4]] },
  { id: 'candle', name: 'Candlestick', base: 18, pts: [[0, 0], [0.4, 0], [0.42, 0.05], [0.34, 0.12], [0.12, 0.22], [0.09, 0.5], [0.15, 0.56], [0.085, 0.62], [0.075, 1.04], [0.13, 1.11], [0.25, 1.17], [0.26, 1.22], [0.11, 1.24], [0.09, 1.3], [0, 1.3]] },
  { id: 'urn', name: 'Urn', base: 22, pts: [[0, 0], [0.24, 0], [0.26, 0.05], [0.14, 0.12], [0.13, 0.2], [0.4, 0.45], [0.48, 0.7], [0.4, 0.95], [0.29, 1.02], [0.32, 1.08], [0.29, 1.12], [0.14, 1.2], [0.065, 1.3], [0.1, 1.38], [0, 1.42]] },
  { id: 'trophy', name: 'Trophy', base: 26, pts: [[0, 0], [0.34, 0], [0.34, 0.14], [0.28, 0.16], [0.1, 0.22], [0.075, 0.5], [0.13, 0.58], [0.46, 0.84], [0.52, 1.22], [0.49, 1.26], [0.44, 1.2], [0.37, 0.94], [0, 0.87]] },
  { id: 'teapot', name: 'Teapot', base: 30, pts: [[0, 0], [0.3, 0], [0.34, 0.04], [0.47, 0.28], [0.52, 0.52], [0.45, 0.78], [0.29, 0.9], [0.31, 0.94], [0.21, 0.98], [0.075, 1.03], [0.06, 1.1], [0.1, 1.16], [0, 1.18]] },
];

// how many shapes are on offer after n restorations
export const shapesAvailable = (n) => Math.min(SHAPES.length, 2 + Math.floor(n / 2));
export const metalsAvailable = (n) => METALS.filter((m) => n >= m.unlock).length;

export const UPGRADES = [
  { id: 'size', name: 'Brush size', icon: 'i-size', cost: (l) => Math.round(15 * Math.pow(1.75, l)), max: 8 },
  { id: 'power', name: 'Stronger', icon: 'i-power', cost: (l) => Math.round(20 * Math.pow(1.6, l)), max: 15 },
  { id: 'speed', name: 'Faster lathe', icon: 'i-speed', cost: (l) => Math.round(35 * Math.pow(1.85, l)), max: 6 },
  { id: 'helper', name: 'Apprentice', icon: 'i-help', cost: (l) => Math.round(80 * Math.pow(1.9, l)), max: 10 },
];
