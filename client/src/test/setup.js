import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
/**
 * jsdom does not implement the browser APIs our layout primitives rely on.
 * Stubbing them here keeps individual component tests free of boilerplate.
 */
beforeAll(() => {
    if (!window.matchMedia) {
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: (query) => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: () => { },
                removeListener: () => { },
                addEventListener: () => { },
                removeEventListener: () => { },
                dispatchEvent: () => false,
            }),
        });
    }
    if (!('ResizeObserver' in window)) {
        class ResizeObserverStub {
            observe() { }
            unobserve() { }
            disconnect() { }
        }
        Object.defineProperty(window, 'ResizeObserver', {
            writable: true,
            value: ResizeObserverStub,
        });
    }
    if (!('IntersectionObserver' in window)) {
        class IntersectionObserverStub {
            root = null;
            rootMargin = '';
            thresholds = [];
            observe() { }
            unobserve() { }
            disconnect() { }
            takeRecords() {
                return [];
            }
        }
        Object.defineProperty(window, 'IntersectionObserver', {
            writable: true,
            value: IntersectionObserverStub,
        });
    }
    // Recharts measures its container; jsdom always reports 0x0 without this.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        value: 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        value: 400,
    });
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = () => { };
    }
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
});
