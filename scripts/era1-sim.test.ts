import { it } from 'vitest';
import { playEra1 } from './era1-sim';

it('plays era 1 up to scoring', () => {
  playEra1();
}, 180000);
