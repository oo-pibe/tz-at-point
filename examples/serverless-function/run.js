// Calls the handler the way the platform would, and prints what it returns.
import { FIXTURES, kickoffs } from './api/kickoffs.js';

for (const k of kickoffs(FIXTURES)) {
  console.log(`${k.home} v ${k.away}`.padEnd(28), k.utc, '→', String(k.localKickoff).padEnd(22), k.timeZone);
}
