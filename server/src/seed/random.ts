/**
 * ServiceDesk Pro — deterministic randomness for the seeder.
 *
 * The seed data has to *look* random — tickets spread unevenly across three months,
 * a plausible mix of priorities, some technicians busier than others — while being
 * exactly reproducible. Two reasons that matters more than it sounds:
 *
 *  - A screenshot in a report, or a number quoted in a viva ("the dashboard shows a
 *    68% on-time rate"), stays true after the next reseed.
 *  - When something looks wrong on the dashboard, `npm run seed:reset` reproduces the
 *    same database, so the bug can be found instead of guessed at.
 *
 * `Math.random()` gives neither. This is mulberry32: thirty-two bits of state, four
 * lines, and a fixed default seed. Not cryptographic and never used for anything that
 * needs to be — passwords and tokens use `node:crypto` elsewhere.
 */

/** Changing this changes every generated ticket. It is the only knob. */
export const DEFAULT_SEED = 20_260_904;

export class Rng {
  private state: number;

  constructor(seed: number = DEFAULT_SEED) {
    /* `>>> 0` keeps the state an unsigned 32-bit integer, which is what the
     * generator's arithmetic assumes; a negative seed would otherwise halve the
     * period on the first step. */
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability. `chance(0.25)` is one in four. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick was given an empty list.');
    /* The non-null assertion is safe because of the guard above, and the alternative —
     * returning `T | undefined` — would push a pointless null check into every one of
     * the fifty-odd call sites in `seed.ts`. */
    return items[this.int(0, items.length - 1)]!;
  }

  /**
   * Pick from a list of `[item, weight]` pairs.
   *
   * This is what makes the priority mix believable: an unweighted `pick` over the four
   * priorities would make a quarter of every desk's tickets URGENT, and a dashboard
   * where 25% of the work is on fire teaches the reader nothing about the widget.
   */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (total <= 0) throw new Error('Rng.weighted needs at least one positive weight.');

    let roll = this.next() * total;
    for (const [item, weight] of entries) {
      roll -= weight;
      if (roll < 0) return item;
    }
    /* Floating-point arithmetic can leave `roll` a hair above zero on the last entry. */
    return entries[entries.length - 1]![0];
  }

  /** A shuffled copy. The input is not modified. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /**
   * A working-hours instant somewhere in `[from, to)`.
   *
   * Tickets are raised by people at their desks, so uniform-over-milliseconds would be
   * wrong in a visible way: a third of the seeded tickets would arrive at 3am and the
   * SLA clock — which only runs Monday to Friday, 09:00 to 18:00 — would start on the
   * next working morning for all of them. Landing on a weekday afternoon by default,
   * with a tenth of tickets deliberately out of hours, exercises both paths through
   * `startTicketSla` and still looks like a real week.
   *
   * `recencyBias` above 1 pulls instants towards `to`. A desk that files tickets at a
   * steady rate really is uniform across the window, and uniform is what an honest
   * simulation of one would use — but the seeded queue's *outcome* depends on age, so a
   * uniform three months leaves ninety of a hundred and twenty tickets older than three
   * weeks and therefore closed, and the live queue a demo is meant to show has five rows
   * in it. A bias of 1.6 leaves the history intact and roughly doubles the density of the
   * last fortnight, which is the difference between a dashboard and an empty one.
   */
  businessInstant(from: Date, to: Date, recencyBias = 1): Date {
    const span = Math.max(to.getTime() - from.getTime(), 1);
    /* `u ** bias` is skewed towards 0, and it is measured backwards from `to`, so the
     * result is skewed towards the recent end. */
    const age = span * this.next() ** recencyBias;
    const at = new Date(to.getTime() - Math.floor(age));

    if (this.chance(0.1)) return at; // out of hours on purpose

    const day = at.getDay();
    if (day === 0) at.setDate(at.getDate() + 1); // Sunday -> Monday
    if (day === 6) at.setDate(at.getDate() + 2); // Saturday -> Monday
    at.setHours(this.int(9, 17), this.int(0, 59), this.int(0, 59), 0);

    /* Both adjustments above move time *forwards*, so an instant drawn just short of `to`
     * can end up past it — nudge a Sunday to Monday, or set 17:40 on a morning when the
     * seed is running at 09:00, and the result is a ticket raised in the future. Nothing
     * downstream tolerates that: its SLA deadline would precede its creation and the list
     * would say it was raised in six hours. Stepping back three days keeps a weekday and a
     * working hour; the window is months wide, so one step is always enough. */
    while (at.getTime() > to.getTime()) at.setDate(at.getDate() - 3);
    return at;
  }
}
