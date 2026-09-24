import { useEffect, useState } from 'react';
/**
 * A ticking `Date.now()`, shared by every subscriber.
 *
 * One interval for the whole app rather than one per component: a ticket list with
 * fifty SLA countdowns would otherwise hold fifty timers that each re-render one row a
 * second, and they would drift apart so two rows could show different "now".
 *
 * The interval only runs while something is subscribed, and it stops when the tab is
 * hidden — a countdown nobody can see is not worth waking the CPU for. On becoming
 * visible again it publishes immediately, so a tab returned to after ten minutes is
 * correct on the first frame rather than up to a second stale.
 */
const INTERVAL_MS = 1000;
const subscribers = new Set();
let timer = null;
function publish() {
    const now = Date.now();
    for (const subscriber of subscribers)
        subscriber(now);
}
function start() {
    if (timer !== null || document.hidden)
        return;
    timer = window.setInterval(publish, INTERVAL_MS);
}
function stop() {
    if (timer === null)
        return;
    window.clearInterval(timer);
    timer = null;
}
function onVisibilityChange() {
    if (document.hidden) {
        stop();
        return;
    }
    publish();
    if (subscribers.size > 0)
        start();
}
document.addEventListener('visibilitychange', onVisibilityChange);
export function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        subscribers.add(setNow);
        start();
        return () => {
            subscribers.delete(setNow);
            if (subscribers.size === 0)
                stop();
        };
    }, []);
    return now;
}
