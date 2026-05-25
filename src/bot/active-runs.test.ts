import { describe, expect, it } from 'vitest';
import type { AgentRun } from '../agent/types';
import { ActiveRuns } from './active-runs';

function run(stops: string[], id: string): AgentRun {
  return {
    events: (async function* () {})(),
    stop: async () => {
      stops.push(id);
    },
    waitForExit: async () => true,
  };
}

describe('ActiveRuns project interrupts', () => {
  it('interrupts project root and thread runs only', () => {
    const active = new ActiveRuns();
    const stops: string[] = [];
    active.register('oc_a', run(stops, 'root'));
    active.register('oc_a:thread', run(stops, 'thread'));
    active.register('oc_b', run(stops, 'other'));

    expect(active.interruptProject('oc_a')).toBe(2);
    expect(stops.sort()).toEqual(['root', 'thread']);
    expect(active.interrupt('oc_b')).toBe(true);
  });
});
