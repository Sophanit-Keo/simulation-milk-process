// Timed events for the discrete model (plan 06): a binary min-heap on time,
// with the schedule order breaking ties so equal-time events run first in, first out.

export interface QueuedEvent<P = unknown> {
  /** Order of scheduling, from 1; breaks ties between events at the same time. */
  readonly seq: number;
  readonly timeS: number;
  readonly type: string;
  readonly payload: P;
}

const before = (a: QueuedEvent, b: QueuedEvent): boolean => a.timeS < b.timeS || (a.timeS === b.timeS && a.seq < b.seq);

export class EventQueue {
  private heap: QueuedEvent[] = [];
  // Where each queued event sits in the heap, so cancel() can remove it in O(log n).
  private readonly indexBySeq = new Map<number, number>();
  private lastSeq = 0;

  get size(): number {
    return this.heap.length;
  }

  schedule<P = undefined>(timeS: number, type: string, payload?: P): QueuedEvent<P> {
    if (!Number.isFinite(timeS)) throw new RangeError(`Event time must be a finite number of seconds, got ${timeS}`);
    const event: QueuedEvent<P> = { seq: ++this.lastSeq, timeS, type, payload: payload as P };
    this.heap.push(event);
    this.indexBySeq.set(event.seq, this.heap.length - 1);
    this.siftUp(this.heap.length - 1);
    return event;
  }

  peek(): QueuedEvent | undefined {
    return this.heap[0];
  }

  pop(): QueuedEvent | undefined {
    const top = this.heap[0];
    if (top) this.removeAt(0);
    return top;
  }

  /** Every event due at nowS or earlier, in the order pop() would give them. */
  popDue(nowS: number): QueuedEvent[] {
    const due: QueuedEvent[] = [];
    for (let next = this.peek(); next && next.timeS <= nowS; next = this.peek()) {
      this.removeAt(0);
      due.push(next);
    }
    return due;
  }

  cancel(seq: number): boolean {
    const index = this.indexBySeq.get(seq);
    if (index === undefined) return false;
    this.removeAt(index);
    return true;
  }

  clear(): void {
    this.heap = [];
    this.indexBySeq.clear();
    // seq keeps counting, so a stale seq from before clear() can never cancel a new event.
  }

  private removeAt(index: number): void {
    const removed = this.heap[index];
    const last = this.heap.pop();
    if (!removed || !last) return;
    this.indexBySeq.delete(removed.seq);
    if (index === this.heap.length) return; // removed the last slot, nothing to refill
    this.place(last, index);
    this.siftDown(index);
    this.siftUp(index);
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(this.heap[i], this.heap[parent])) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(index: number): void {
    let i = index;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let first = i;
      if (left < this.heap.length && before(this.heap[left], this.heap[first])) first = left;
      if (right < this.heap.length && before(this.heap[right], this.heap[first])) first = right;
      if (first === i) return;
      this.swap(i, first);
      i = first;
    }
  }

  private swap(a: number, b: number): void {
    const eventA = this.heap[a];
    this.place(this.heap[b], a);
    this.place(eventA, b);
  }

  private place(event: QueuedEvent, index: number): void {
    this.heap[index] = event;
    this.indexBySeq.set(event.seq, index);
  }
}
