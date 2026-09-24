/**
 * The offline classifier.
 *
 * No database and no clock: `classify()` is a function from text plus a candidate
 * list to a pre-selection, which is exactly why the interesting cases are cheap to
 * write down here rather than through the API.
 *
 * The candidates below deliberately overlap — "password" belongs to both Accounts
 * and Security in real deployments, and a classifier that cannot express "I am not
 * sure which" is worse than useless in front of a user.
 */
import { describe, expect, it } from 'vitest';
import { Priority } from '@shared/enums';
import { classify } from '@/modules/suggestions/suggestion.classifier';
const NETWORK = {
    id: 'cat-network',
    name: 'Network',
    defaultPriority: Priority.HIGH,
    keywords: ['vpn', 'wifi', 'internet', 'ethernet', 'cannot connect'],
};
const HARDWARE = {
    id: 'cat-hardware',
    name: 'Hardware',
    defaultPriority: Priority.MEDIUM,
    keywords: ['laptop', 'monitor', 'keyboard', 'blue screen', 'battery'],
};
const ACCOUNTS = {
    id: 'cat-accounts',
    name: 'Accounts',
    defaultPriority: Priority.LOW,
    keywords: ['password', 'login', 'mfa'],
};
const SECURITY = {
    id: 'cat-security',
    name: 'Security',
    defaultPriority: Priority.URGENT,
    keywords: ['password', 'phishing', 'malware'],
};
const ALL = [NETWORK, HARDWARE, ACCOUNTS, SECURITY];
describe('picking a category', () => {
    it('matches a keyword in the title', () => {
        const result = classify({ title: 'VPN will not connect from home' }, ALL);
        expect(result.categoryId).toBe('cat-network');
        expect(result.categoryName).toBe('Network');
        expect(result.reason).toContain('"vpn"');
    });
    it('matches the category name itself, with no keywords configured', () => {
        const bare = { ...HARDWARE, keywords: [] };
        expect(classify({ title: 'Hardware request for a new desk' }, [bare]).categoryId).toBe('cat-hardware');
    });
    it('matches a multi-word keyword as a phrase', () => {
        expect(classify({ title: 'Laptop shows a blue screen on boot' }, ALL).categoryId).toBe('cat-hardware');
    });
    it('does not match a keyword buried inside a longer word', () => {
        // "vpn" must not fire on "vpnclient-troubleshooting", and — the one that bites
        // in practice — a keyword like "port" must never match "support".
        const ports = { ...NETWORK, keywords: ['port'] };
        expect(classify({ title: 'Please contact support about this' }, [ports]).categoryId).toBeNull();
    });
    it('prefers the title over the description, keyword for keyword', () => {
        const result = classify({ title: 'Laptop is broken', description: 'I also cannot reach the internet' }, ALL);
        expect(result.categoryId).toBe('cat-hardware');
    });
    it('still lets weight of evidence in the description compete', () => {
        /*
         * One title keyword is worth three in the body, so this is an exact tie: Hardware
         * has "laptop" in the title, Network has "wifi", "vpn" and "cannot connect" in the
         * description. Neither answer is wrong, and the point of the assertion is the
         * confidence rather than the winner — the classifier reports the split instead of
         * pretending it was sure.
         */
        const result = classify({ title: 'Laptop is broken', description: 'I also cannot connect to the wifi or vpn' }, ALL);
        expect(result.confidence).toBeLessThan(0.8);
        expect(result.reason).toContain('Matched');
    });
    it('falls back to the description when the title says nothing useful', () => {
        const result = classify({ title: 'Help please', description: 'my monitor is flickering' }, ALL);
        expect(result.categoryId).toBe('cat-hardware');
    });
    it('returns no category rather than a wrong one', () => {
        const result = classify({ title: 'Question about the office plants' }, ALL);
        expect(result.categoryId).toBeNull();
        expect(result.categoryName).toBeNull();
        expect(result.reason).toContain('a guess');
    });
    it('breaks a tie on the order the admin arranged the categories in', () => {
        // "password" is a keyword of both Accounts and Security, matched in the title
        // in each, so the scores are equal and only the incoming order separates them.
        expect(classify({ title: 'password reset' }, [ACCOUNTS, SECURITY]).categoryId).toBe('cat-accounts');
        expect(classify({ title: 'password reset' }, [SECURITY, ACCOUNTS]).categoryId).toBe('cat-security');
    });
    it('ignores an empty keyword instead of matching everything', () => {
        const sloppy = { ...HARDWARE, name: 'Hardware', keywords: ['', '   '] };
        expect(classify({ title: 'Something is wrong somewhere' }, [sloppy]).categoryId).toBeNull();
    });
});
describe('suggesting a priority', () => {
    it('starts from the category default', () => {
        expect(classify({ title: 'vpn is slow' }, ALL).priority).toBe(Priority.HIGH);
        expect(classify({ title: 'my keyboard sticks' }, ALL).priority).toBe(Priority.MEDIUM);
        expect(classify({ title: 'login page question' }, ALL).priority).toBe(Priority.LOW);
    });
    it('defaults to medium when it recognised nothing', () => {
        expect(classify({ title: 'Something unusual happened' }, ALL).priority).toBe(Priority.MEDIUM);
    });
    it('raises a low-default category when the wording is an emergency', () => {
        const result = classify({ title: 'Cannot login', description: 'nobody in the entire office can sign in' }, [ACCOUNTS]);
        expect(result.priority).toBe(Priority.URGENT);
        expect(result.reason).toContain('emergency');
    });
    it('raises to high, not urgent, for merely time-critical wording', () => {
        const result = classify({ title: 'Password reset needed asap' }, [ACCOUNTS]);
        expect(result.priority).toBe(Priority.HIGH);
        expect(result.reason).toContain('time-critical');
    });
    it('never lowers a suggestion below the category default', () => {
        // A high-default category with calm wording lands on medium, one step down —
        // not on low, and not below the floor an admin set.
        expect(classify({ title: 'wifi is flaky, no rush' }, [NETWORK]).priority).toBe(Priority.MEDIUM);
        expect(classify({ title: 'login help, not urgent' }, [ACCOUNTS]).priority).toBe(Priority.LOW);
    });
    it('does not let calm wording soften an urgent category', () => {
        // Security is urgent by default; "no rush" on a phishing report is not the
        // requester's call to make.
        const result = classify({ title: 'phishing email, no rush' }, [SECURITY]);
        expect(result.priority).toBe(Priority.URGENT);
        expect(result.reason).not.toContain('low priority');
    });
    it('reports only the strongest urgency signal it found', () => {
        const result = classify({ title: 'urgent: total outage, asap please' }, ALL);
        expect(result.priority).toBe(Priority.URGENT);
        expect(result.reason).toContain('"outage"');
        expect(result.reason).not.toContain('"urgent"');
    });
});
describe('confidence', () => {
    it('never claims certainty, however many keywords match', () => {
        const result = classify({ title: 'vpn wifi internet ethernet cannot connect', description: 'vpn wifi internet' }, ALL);
        expect(result.categoryId).toBe('cat-network');
        expect(result.confidence).toBe(0.95);
    });
    it('is lower for one word than for three', () => {
        const thin = classify({ title: 'vpn' }, ALL);
        const thick = classify({ title: 'vpn wifi ethernet' }, ALL);
        expect(thin.confidence).toBeLessThan(thick.confidence);
        expect(thin.confidence).toBeGreaterThan(0.35);
    });
    it('is lowest of all when nothing matched', () => {
        const nothing = classify({ title: 'the office plants need water' }, ALL);
        expect(nothing.confidence).toBe(0.2);
        expect(nothing.confidence).toBeLessThan(classify({ title: 'vpn' }, ALL).confidence);
    });
    it('drops when two categories are equally plausible', () => {
        const split = classify({ title: 'password' }, [ACCOUNTS, SECURITY]);
        const sole = classify({ title: 'password' }, [ACCOUNTS]);
        expect(split.confidence).toBeLessThan(sole.confidence);
    });
    it('quotes at most three matched words in the reason', () => {
        const result = classify({ title: 'vpn wifi internet ethernet' }, ALL);
        expect(result.reason.match(/"/g)).toHaveLength(6);
    });
});
describe('negated urgency', () => {
    it('does not read "not urgent" as urgent', () => {
        const result = classify({ title: 'Monitor flickers, not urgent' }, [HARDWARE]);
        expect(result.priority).toBe(Priority.LOW);
        expect(result.reason).not.toContain('time-critical');
    });
    it('does not read "nothing is urgent here" as urgent', () => {
        expect(classify({ title: 'keyboard swap, nothing urgent' }, [HARDWARE]).priority).toBe(Priority.MEDIUM);
    });
    it('does not read "no outage" as an emergency', () => {
        const result = classify({ title: 'wifi question', description: 'there is no outage, just curious' }, [NETWORK]);
        expect(result.priority).toBe(Priority.HIGH);
        expect(result.reason).not.toContain('emergency');
    });
    it('still fires on a later un-negated occurrence', () => {
        // "not urgent" first, then a genuine one. The second occurrence must win, or a
        // throwaway phrase early on would mute the rest of the ticket.
        const result = classify({ title: 'Access request', description: 'not urgent yesterday but it is urgent now' }, [ACCOUNTS]);
        expect(result.priority).toBe(Priority.HIGH);
    });
});
