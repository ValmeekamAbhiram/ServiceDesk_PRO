/**
 * ServiceDesk Pro — what the LLM path accepts from a provider.
 *
 * No network, no database: `interpretReply()` is the whole of the trust boundary
 * between a model's reply and a suggestion shown to a user, so the interesting cases
 * are just objects handed to a function.
 *
 * The premise throughout is that the reply is *untrusted*. The ticket text goes into
 * the prompt, so someone will eventually paste instructions into a ticket and get the
 * model to obey them. That is fine as long as the hole the answer must fit through is
 * small enough, and this suite is the description of that hole.
 */
import { describe, expect, it } from 'vitest';
import { Priority } from '@shared/enums';
import { interpretReply } from '@/modules/suggestions/suggestion.llm';
const CANDIDATES = [
    { id: 'cat-network', name: 'Network', defaultPriority: Priority.HIGH, keywords: ['vpn'] },
    { id: 'cat-hardware', name: 'Hardware', defaultPriority: Priority.MEDIUM, keywords: ['laptop'] },
];
/** An Anthropic messages response carrying `text` as its only content block. */
const reply = (text) => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
});
/** A Google Gemini generateContent response with candidates and parts. */
const geminiReply = (text) => ({
    candidates: [
        {
            content: {
                parts: [{ text }],
                role: 'model',
            },
            finishReason: 'STOP',
        },
    ],
});
const GOOD = JSON.stringify({
    categoryId: 'cat-network',
    priority: 'URGENT',
    confidence: 0.8,
    reason: 'The whole office has lost the VPN.',
});
describe('accepting a usable reply', () => {
    it('reads a clean JSON object', () => {
        const result = interpretReply(reply(GOOD), CANDIDATES);
        expect(result).toEqual({
            categoryId: 'cat-network',
            categoryName: 'Network',
            priority: Priority.URGENT,
            confidence: 0.8,
            reason: 'The whole office has lost the VPN.',
        });
    });
    it('salvages an object inside a markdown fence', () => {
        const fenced = `Here you go:\n\`\`\`json\n${GOOD}\n\`\`\`\nHope that helps!`;
        expect(interpretReply(reply(fenced), CANDIDATES)?.categoryId).toBe('cat-network');
    });
    it('joins several text blocks before parsing', () => {
        const split = {
            content: [
                { type: 'text', text: '{ "categoryId": "cat-hardware", "priority": "LOW",' },
                { type: 'text', text: '"confidence": 0.4, "reason": "Sounds like a spare part." }' },
            ],
        };
        expect(interpretReply(split, CANDIDATES)?.categoryName).toBe('Hardware');
    });
    it('accepts "none of these fit" as a real answer', () => {
        const none = JSON.stringify({
            categoryId: null,
            priority: 'MEDIUM',
            confidence: 0.3,
            reason: 'Nothing here matches the configured categories.',
        });
        const result = interpretReply(reply(none), CANDIDATES);
        expect(result?.categoryId).toBeNull();
        expect(result?.categoryName).toBeNull();
    });
    it('interprets a Google Gemini candidate reply', () => {
        const result = interpretReply(geminiReply(GOOD), CANDIDATES);
        expect(result).toEqual({
            categoryId: 'cat-network',
            categoryName: 'Network',
            priority: Priority.URGENT,
            confidence: 0.8,
            reason: 'The whole office has lost the VPN.',
        });
    });
    it('interprets Gemini reply with multi-part text', () => {
        const multiPartGemini = {
            candidates: [
                {
                    content: {
                        parts: [
                            { text: '{\n"categoryId": "cat-hardware",\n"priority": "HIGH",' },
                            { text: '\n"confidence": 0.9,\n"reason": "Printer hardware failure."\n}' },
                        ],
                    },
                },
            ],
        };
        const result = interpretReply(multiPartGemini, CANDIDATES);
        expect(result?.categoryId).toBe('cat-hardware');
        expect(result?.categoryName).toBe('Hardware');
        expect(result?.priority).toBe(Priority.HIGH);
    });
});
describe('refusing what it must not pass on', () => {
    it('drops a category that was never offered', () => {
        // The single most important assertion in this file. A model that has been talked
        // into naming someone else's category, or into inventing one, gets "no category".
        const invented = JSON.stringify({
            categoryId: 'cat-payroll',
            priority: 'HIGH',
            confidence: 0.9,
            reason: 'Filed under Payroll.',
        });
        const result = interpretReply(reply(invented), CANDIDATES);
        expect(result?.categoryId).toBeNull();
        expect(result?.categoryName).toBeNull();
        /* The rest of the reply still stands; only the id it made up is discarded. */
        expect(result?.priority).toBe(Priority.HIGH);
    });
    it('rejects a priority that is not one of the four', () => {
        const shouting = JSON.stringify({
            categoryId: 'cat-network',
            priority: 'CATASTROPHIC',
            confidence: 0.9,
            reason: 'Everything is on fire.',
        });
        expect(interpretReply(reply(shouting), CANDIDATES)).toBeNull();
    });
    it('caps a confidence of 1, the most a model is allowed to claim', () => {
        const cocky = JSON.stringify({
            categoryId: 'cat-network',
            priority: 'HIGH',
            confidence: 1,
            reason: 'Certain.',
        });
        expect(interpretReply(reply(cocky), CANDIDATES)?.confidence).toBe(0.95);
    });
    /*
     * A number outside 0-1 is not an overconfident answer, it is evidence the model
     * was not answering the question asked, so the whole reply goes and the offline
     * classifier speaks instead. Clamping 999 to 0.95 would dress that up as a
     * considered judgement.
     */
    it('rejects a confidence outside 0-1, or one that is not a number at all', () => {
        /* JSON has no NaN, so a model that cannot commit sends null - which bare
         * coercion would have read as a confident 0. */
        for (const confidence of [-1, 1.5, 5, 999, null, true, 'very high', '']) {
            const wild = JSON.stringify({
                categoryId: 'cat-network',
                priority: 'HIGH',
                confidence,
                reason: 'Unsure.',
            });
            expect(interpretReply(reply(wild), CANDIDATES)).toBeNull();
        }
    });
    it('truncates a reason long enough to be an essay', () => {
        const rambling = JSON.stringify({
            categoryId: 'cat-network',
            priority: 'HIGH',
            confidence: 0.7,
            reason: 'x'.repeat(5_000),
        });
        expect(interpretReply(reply(rambling), CANDIDATES)?.reason).toHaveLength(240);
    });
    it('returns null for prose instead of JSON', () => {
        expect(interpretReply(reply('I am sorry, I cannot help with that.'), CANDIDATES)).toBeNull();
    });
    it('returns null for a reply missing a required key', () => {
        const partial = JSON.stringify({ categoryId: 'cat-network', confidence: 0.5 });
        expect(interpretReply(reply(partial), CANDIDATES)).toBeNull();
    });
    it('returns null for an empty reason', () => {
        const blank = JSON.stringify({
            categoryId: 'cat-network',
            priority: 'HIGH',
            confidence: 0.5,
            reason: '   ',
        });
        expect(interpretReply(reply(blank), CANDIDATES)).toBeNull();
    });
    it('survives a response with no content, the wrong shape, or nothing at all', () => {
        for (const payload of [{}, { content: 'not an array' }, { content: [] }, null, undefined, 42]) {
            expect(interpretReply(payload, CANDIDATES)).toBeNull();
        }
    });
    it('ignores non-text blocks such as a tool call', () => {
        const mixed = { content: [{ type: 'tool_use', name: 'publish_article', input: {} }] };
        expect(interpretReply(mixed, CANDIDATES)).toBeNull();
    });
});
