// Solar Genesis palette — the brand foundation (see frontend/SPEC.md §1.1)
export const NIGHT = '#0A0E27';
export const INDIGO = '#3D1B6E';
export const DAWN = '#C44536';
export const AMBER = '#F4A261';
export const APEX = '#FFEFD5';

export const APEX_DIM = 'rgba(255, 239, 213, 0.65)';
export const APEX_MUTE = 'rgba(255, 239, 213, 0.32)';

// Avatar lightness stops — the gap that wasn't in the 6-byte deck spec.
// L1 is the lighter hue (gradient origin), L2 the deeper hue (gradient terminus).
export const AVATAR_L1 = 58;
export const AVATAR_L2 = 44;

// Glyph ink — near-apex, slightly translucent so the gradient reads through edges.
export const GLYPH = APEX;

export const GLYPH_NAMES = ['sun', 'aperture', 'orbit', 'arc', 'diamond', 'chain'] as const;
export const COMP_NAMES = ['radial', 'linear', 'banded', 'split'] as const;
