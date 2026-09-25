import { describe, expect, it } from 'vitest';

import { fieldForImage, initialsFor, sanitiseField } from '../src/text';

describe('sanitiseField', () => {
  it('strips emoji, ZWJ sequences and control characters, then collapses whitespace', () => {
    expect(sanitiseField('🚀 Jamie   Fox 🔥')).toBe('Jamie Fox');
    expect(sanitiseField('Family: 👨‍👩‍👧‍👦 Chen')).toBe('Family: Chen');
    expect(sanitiseField('Flag \u{1F1FA}\u{1F1F8} Rivera')).toBe('Flag Rivera');
    // The keycap combiner only wraps a preceding character (here the digit "1", not itself pictographic);
    // stripping it and the variation selector leaves the digit in place, unlike a true pictographic emoji.
    expect(sanitiseField('Keycap 1⃣ Team')).toBe('Keycap 1 Team');
    expect(sanitiseField('Tab\tHere')).toBe('Tab Here');
  });
});

describe('fieldForImage', () => {
  it('returns null for null, undefined and empty input', () => {
    expect(fieldForImage(null)).toBeNull();
    expect(fieldForImage(undefined)).toBeNull();
    expect(fieldForImage('   ')).toBeNull();
  });

  it('keeps a field fully covered by the card fonts', () => {
    expect(fieldForImage('Founder at Analytical Engines')).toBe('Founder at Analytical Engines');
    expect(fieldForImage('Nguyễn Thị Phương')).toBe('Nguyễn Thị Phương');
    expect(fieldForImage('Екатерина Смирнова')).toBe('Екатерина Смирнова');
    expect(fieldForImage('Ελένη Παπαδοπούλου')).toBe('Ελένη Παπαδοπούλου');
  });

  it('drops a CJK field entirely', () => {
    expect(fieldForImage('田中太郎')).toBeNull();
  });

  it('drops a field that is emoji-only once sanitised', () => {
    expect(fieldForImage('🔥🔥🔥')).toBeNull();
  });
});

describe('initialsFor', () => {
  it('takes the first grapheme of each of the first two words, upper-cased', () => {
    expect(initialsFor('Marcus Chen')).toBe('MC');
    expect(initialsFor('Priya Natarajan')).toBe('PN');
  });

  it('handles a single word', () => {
    expect(initialsFor('Cher')).toBe('C');
  });

  it('returns null when there is nothing to take initials from', () => {
    expect(initialsFor('')).toBeNull();
  });

  it('returns null for a name the card fonts cannot draw (falls back to the bubble mark)', () => {
    expect(initialsFor('田中太郎')).toBeNull();
  });
});
