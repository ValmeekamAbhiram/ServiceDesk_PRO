import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
/**
 * Merge class names, letting a caller's class win over a component's default.
 *
 * `clsx` alone would emit both `px-3` and a caller's `px-6`, and which one applies
 * would depend on their order in the stylesheet rather than on intent. `twMerge`
 * resolves that to the last one.
 */
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
