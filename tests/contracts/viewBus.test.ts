// The view-event bus (contracts v1): the one channel between the UI and the 3D view. A rail click and a
// 3D click both emit selectStage on it, and both sides react, so this decides whether they agree.
import { describe, expect, it } from 'vitest';
import { createViewBus, type ViewEvent, type ViewListener } from '../../src/contracts';

const select = (stage: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10): ViewEvent => ({ type: 'selectStage', stage });

/** A listener that writes `name:stage` (or `name:type`) into calls, for checking who saw what, in order. */
function recorder(calls: string[], name: string): ViewListener {
  return (event) => calls.push(`${name}:${event.type === 'selectStage' ? event.stage : event.type}`);
}

describe('createViewBus', () => {
  it('delivers an event to every listener, in the order they subscribed', () => {
    const bus = createViewBus();
    const calls: string[] = [];
    bus.on(recorder(calls, 'ui'));
    bus.on(recorder(calls, 'scene'));
    bus.on(recorder(calls, 'tour'));
    bus.emit(select(3));
    expect(calls).toEqual(['ui:3', 'scene:3', 'tour:3']);
  });

  it('passes the event object through unchanged, so both sides see the same stage', () => {
    const bus = createViewBus();
    const seen: ViewEvent[] = [];
    bus.on((event) => seen.push(event));
    bus.on((event) => seen.push(event));
    const event = select(7);
    bus.emit(event);
    expect(seen).toEqual([event, event]);
    expect(seen[0]).toBe(event);
  });

  it('delivers every event type on the contract', () => {
    const bus = createViewBus();
    const seen: ViewEvent[] = [];
    bus.on((event) => seen.push(event));
    const events: ViewEvent[] = [select(1), { type: 'overview' }, { type: 'selectBatch', batchId: 12 }, { type: 'tour', on: true }];
    for (const event of events) bus.emit(event);
    expect(seen).toEqual(events);
  });

  it('delivers the overview event to every listener, in order, like any other event', () => {
    // "Whole plant" and Escape emit it; the rail, the panel and the camera must all go back together.
    const bus = createViewBus();
    const calls: string[] = [];
    bus.on(recorder(calls, 'ui'));
    bus.on(recorder(calls, 'scene'));
    bus.emit(select(5));
    bus.emit({ type: 'overview' });
    bus.emit({ type: 'overview' });
    expect(calls).toEqual(['ui:5', 'scene:5', 'ui:overview', 'scene:overview', 'ui:overview', 'scene:overview']);
  });

  it('delivers re-selecting the selected stage again, so the camera can re-fly (no de-duplication)', () => {
    const bus = createViewBus();
    const calls: string[] = [];
    bus.on(recorder(calls, 'scene'));
    bus.emit(select(4));
    bus.emit(select(4));
    expect(calls).toEqual(['scene:4', 'scene:4']);
  });

  it('is fine with no listeners', () => {
    expect(() => createViewBus().emit(select(1))).not.toThrow();
  });

  it('keeps separate buses separate', () => {
    const first = createViewBus();
    const second = createViewBus();
    const calls: string[] = [];
    first.on(recorder(calls, 'first'));
    second.on(recorder(calls, 'second'));
    first.emit(select(2));
    expect(calls).toEqual(['first:2']);
  });

  describe('unsubscribing', () => {
    it('the function on() returns stops that listener, and only that one', () => {
      const bus = createViewBus();
      const calls: string[] = [];
      bus.on(recorder(calls, 'ui'));
      const off = bus.on(recorder(calls, 'scene'));
      bus.on(recorder(calls, 'tour'));
      bus.emit(select(1));
      off();
      bus.emit(select(2));
      expect(calls).toEqual(['ui:1', 'scene:1', 'tour:1', 'ui:2', 'tour:2']);
    });

    it('a function subscribed twice is one listener: called once per event, removed by either unsubscribe', () => {
      // The listeners are a set; a module that re-subscribes on a hot reload gets no double calls.
      const bus = createViewBus();
      const calls: string[] = [];
      const listener = recorder(calls, 'scene');
      const offFirst = bus.on(listener);
      bus.on(listener);
      bus.emit(select(3));
      offFirst();
      bus.emit(select(4));
      expect(calls).toEqual(['scene:3']);
    });

    it('calling it twice is harmless', () => {
      const bus = createViewBus();
      const calls: string[] = [];
      const off = bus.on(recorder(calls, 'scene'));
      bus.on(recorder(calls, 'ui'));
      off();
      expect(() => off()).not.toThrow();
      bus.emit(select(5));
      expect(calls).toEqual(['ui:5']);
    });

    it('a listener that unsubscribes itself while handling an event does not make the next listener miss it', () => {
      const bus = createViewBus();
      const calls: string[] = [];
      const off = bus.on((event) => {
        recorder(calls, 'once')(event);
        off();
      });
      bus.on(recorder(calls, 'next'));
      bus.on(recorder(calls, 'last'));
      bus.emit(select(6));
      bus.emit(select(8));
      expect(calls).toEqual(['once:6', 'next:6', 'last:6', 'next:8', 'last:8']);
    });

    it('a listener removed by an earlier one during an event still gets that event, and none after it', () => {
      // emit() walks a copy of the listeners taken when it starts.
      const bus = createViewBus();
      const calls: string[] = [];
      let offLater = (): void => {};
      bus.on((event) => {
        recorder(calls, 'first')(event);
        offLater();
      });
      offLater = bus.on(recorder(calls, 'later'));
      bus.emit(select(9));
      bus.emit(select(10));
      expect(calls).toEqual(['first:9', 'later:9', 'first:10']);
    });
  });

  describe('subscribing during an event', () => {
    it('a listener added while an event is delivered does not get that event, but gets the next one', () => {
      // What the implementation does: emit() walks a copy of the listeners taken when it starts, so the
      // newcomer waits for the next event. That is the safe choice: an event reaches exactly the listeners
      // there when it was sent, and a listener that subscribes in reaction to an event (say, a tour that
      // starts on a selection) is not handed the very event that started it. A plain Set walk would call it.
      const bus = createViewBus();
      const calls: string[] = [];
      let added = false;
      bus.on((event) => {
        recorder(calls, 'first')(event);
        if (!added) {
          added = true;
          bus.on(recorder(calls, 'added'));
        }
      });
      bus.on(recorder(calls, 'second'));
      bus.emit(select(1));
      bus.emit(select(2));
      expect(calls).toEqual(['first:1', 'second:1', 'first:2', 'second:2', 'added:2']);
    });
  });

  it('delivers an event emitted from inside a listener to everyone at once, before the outer event finishes', () => {
    // E.g. the scene answering a selectStage with a tour event: emit() is synchronous and re-entrant.
    const bus = createViewBus();
    const calls: string[] = [];
    bus.on((event) => {
      recorder(calls, 'scene')(event);
      if (event.type === 'selectStage') bus.emit({ type: 'tour', on: false });
    });
    bus.on(recorder(calls, 'ui'));
    bus.emit(select(5));
    expect(calls).toEqual(['scene:5', 'scene:tour', 'ui:tour', 'ui:5']);
  });
});
