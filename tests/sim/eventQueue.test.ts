import { describe, expect, it } from 'vitest';
import { EventQueue, type QueuedEvent } from '../../src/sim/eventQueue';
import { mulberry32 } from '../helpers/previewMulberry32';

const seqs = (events: readonly QueuedEvent[]) => events.map((event) => event.seq);

/** Pops everything left and returns the seqs in pop order. */
function drain(queue: EventQueue): number[] {
  const out: number[] = [];
  for (let event = queue.pop(); event; event = queue.pop()) out.push(event.seq);
  return out;
}

describe('EventQueue: scheduling', () => {
  it('starts empty', () => {
    const queue = new EventQueue();
    expect(queue.size).toBe(0);
    expect(queue.peek()).toBeUndefined();
    expect(queue.pop()).toBeUndefined();
    expect(queue.popDue(Number.MAX_VALUE)).toEqual([]);
  });

  it('returns the queued event, with seq counting up by 1 from 1', () => {
    const queue = new EventQueue();
    const first = queue.schedule(10, 'fillerFault', { filler: 'A' });
    const second = queue.schedule(5, 'truckArrives');
    const third = queue.schedule(10, 'palletFull', 42);
    expect(first).toEqual({ seq: 1, timeS: 10, type: 'fillerFault', payload: { filler: 'A' } });
    expect(second).toMatchObject({ seq: 2, timeS: 5, type: 'truckArrives' });
    expect(second.payload).toBeUndefined();
    expect(third.seq).toBe(3);
    expect(third.payload).toBe(42);
    expect(queue.size).toBe(3);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws a RangeError for time %s and queues nothing',
    (timeS) => {
      const queue = new EventQueue();
      queue.schedule(1, 'ok');
      expect(() => queue.schedule(timeS, 'bad')).toThrow(RangeError);
      expect(queue.size).toBe(1);
      expect(drain(queue)).toEqual([1]);
    },
  );
});

describe('EventQueue: order', () => {
  it('peeks and pops the earliest event first', () => {
    const queue = new EventQueue();
    queue.schedule(30, 'c');
    queue.schedule(10, 'a');
    queue.schedule(20, 'b');
    expect(queue.peek()).toMatchObject({ timeS: 10, type: 'a' });
    expect(queue.size).toBe(3); // peek leaves it queued
    expect(queue.pop()).toMatchObject({ timeS: 10, type: 'a' });
    expect(queue.pop()).toMatchObject({ timeS: 20, type: 'b' });
    expect(queue.pop()).toMatchObject({ timeS: 30, type: 'c' });
    expect(queue.pop()).toBeUndefined();
    expect(queue.size).toBe(0);
  });

  it('pops events at the same time in the order they were scheduled (lowest seq first)', () => {
    const queue = new EventQueue();
    queue.schedule(5, 'a'); // seq 1
    queue.schedule(1, 'b'); // seq 2
    queue.schedule(5, 'c'); // seq 3
    queue.schedule(1, 'd'); // seq 4
    queue.schedule(5, 'e'); // seq 5
    expect(drain(queue)).toEqual([2, 4, 1, 3, 5]);
  });

  it('keeps insertion order across many ties, as a heap must be made to', () => {
    const queue = new EventQueue();
    const byTime: number[][] = [[], [], []];
    for (let i = 0; i < 200; i++) byTime[i % 3].push(queue.schedule(i % 3, `e${i}`).seq);
    expect(drain(queue)).toEqual(byTime.flat());
  });
});

describe('EventQueue: popDue', () => {
  it('takes every event with timeS <= nowS, in pop order, and leaves the rest', () => {
    const queue = new EventQueue();
    queue.schedule(20, 'b'); // seq 1
    queue.schedule(10, 'a'); // seq 2
    queue.schedule(30, 'd'); // seq 3
    queue.schedule(20, 'c'); // seq 4
    expect(queue.popDue(9.999)).toEqual([]);
    expect(seqs(queue.popDue(20))).toEqual([2, 1, 4]); // 20 itself is due
    expect(queue.size).toBe(1);
    expect(queue.peek()?.timeS).toBe(30);
    expect(queue.popDue(29.999_999)).toEqual([]);
    expect(seqs(queue.popDue(30))).toEqual([3]);
    expect(queue.popDue(1e12)).toEqual([]);
    expect(queue.size).toBe(0);
  });

  it('returns [] when nothing is queued', () => {
    expect(new EventQueue().popDue(100)).toEqual([]);
  });
});

describe('EventQueue: cancel', () => {
  it('removes a queued event and returns true', () => {
    const queue = new EventQueue();
    const a = queue.schedule(10, 'a');
    const b = queue.schedule(20, 'b');
    const c = queue.schedule(30, 'c');
    expect(queue.cancel(b.seq)).toBe(true);
    expect(queue.size).toBe(2);
    expect(drain(queue)).toEqual([a.seq, c.seq]);
  });

  it('moves peek on when the head is cancelled', () => {
    const queue = new EventQueue();
    const a = queue.schedule(10, 'a');
    const b = queue.schedule(20, 'b');
    expect(queue.peek()?.seq).toBe(a.seq);
    queue.cancel(a.seq);
    expect(queue.peek()?.seq).toBe(b.seq);
    expect(queue.size).toBe(1);
  });

  it('returns false for a seq already cancelled, already popped or never issued, and changes nothing', () => {
    const queue = new EventQueue();
    const a = queue.schedule(10, 'a');
    const b = queue.schedule(20, 'b');
    queue.schedule(30, 'c');
    expect(queue.cancel(b.seq)).toBe(true);
    expect(queue.cancel(b.seq)).toBe(false);
    expect(queue.pop()?.seq).toBe(a.seq);
    expect(queue.cancel(a.seq)).toBe(false);
    expect(queue.cancel(999)).toBe(false);
    expect(queue.cancel(0)).toBe(false);
    expect(queue.size).toBe(1);
  });

  it('never lets a cancelled event out through popDue', () => {
    const queue = new EventQueue();
    const events = [5, 5, 6, 7, 7, 8].map((timeS, i) => queue.schedule(timeS, `e${i}`));
    queue.cancel(events[0].seq);
    queue.cancel(events[3].seq);
    queue.cancel(events[5].seq);
    expect(seqs(queue.popDue(10))).toEqual([events[1].seq, events[2].seq, events[4].seq]);
    expect(queue.size).toBe(0);
    expect(queue.peek()).toBeUndefined();
  });

  it('can cancel every event', () => {
    const queue = new EventQueue();
    const events = [3, 1, 2].map((timeS) => queue.schedule(timeS, 'x'));
    for (const event of events) expect(queue.cancel(event.seq)).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.peek()).toBeUndefined();
    expect(queue.pop()).toBeUndefined();
  });
});

describe('EventQueue: clear', () => {
  it('empties the queue, and the queue still works afterwards', () => {
    const queue = new EventQueue();
    const old = queue.schedule(1, 'a');
    queue.schedule(2, 'b');
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.peek()).toBeUndefined();
    expect(queue.pop()).toBeUndefined();
    expect(queue.popDue(100)).toEqual([]);
    expect(queue.cancel(old.seq)).toBe(false);

    const late = queue.schedule(9, 'late');
    const early = queue.schedule(3, 'early');
    expect(queue.size).toBe(2);
    expect(drain(queue)).toEqual([early.seq, late.seq]);
  });
});

describe('EventQueue: against a sorted array', () => {
  it('agrees on every operation over 5,000 seeded random ones', () => {
    const random = mulberry32(81_006);
    const int = (n: number) => Math.floor(random() * n);
    const queue = new EventQueue();
    // The model: queued events, kept sorted by time and then seq.
    let model: { seq: number; timeS: number }[] = [];
    const sortModel = () => model.sort((a, b) => a.timeS - b.timeS || a.seq - b.seq);
    let issued = 0;

    for (let op = 0; op < 5_000; op++) {
      const roll = random();
      if (roll < 0.5) {
        // Few distinct times, so ties are common; some halves to test non-integer times.
        const timeS = int(60) + (random() < 0.2 ? 0.5 : 0);
        const event = queue.schedule(timeS, 'e', op);
        issued++;
        expect(event.seq).toBe(issued);
        model.push({ seq: event.seq, timeS });
        sortModel();
      } else if (roll < 0.65) {
        const event = queue.pop();
        expect(event?.seq).toBe(model.shift()?.seq);
      } else if (roll < 0.75) {
        const nowS = int(60);
        const due = model.filter((event) => event.timeS <= nowS);
        model = model.filter((event) => event.timeS > nowS);
        expect(seqs(queue.popDue(nowS))).toEqual(due.map((event) => event.seq));
      } else {
        const seq = 1 + int(issued + 5); // sometimes popped, cancelled or not yet issued
        const queued = model.some((event) => event.seq === seq);
        expect(queue.cancel(seq), `cancel(${seq})`).toBe(queued);
        model = model.filter((event) => event.seq !== seq);
      }
      expect(queue.size).toBe(model.length);
      expect(queue.peek()?.seq).toBe(model[0]?.seq);
    }
    expect(drain(queue)).toEqual(model.map((event) => event.seq));
  });
});
