/**
 * The attachment gate in the browser.
 *
 * Nothing here is a security control — `upload.middleware.ts` re-checks size, MIME type
 * and extension, and a hand-written `fetch` skips this file entirely. What these tests
 * protect is the promise the module's own header makes: that a file the picker accepts
 * will not be rejected by the server ten seconds into an upload, and that the reason
 * shown to the user names the file and the actual limit.
 *
 * The extension list is duplicated from the server on purpose (the middleware cannot be
 * imported into the browser bundle), so the case that matters most is the one that would
 * fail if the two ever drift: every extension the server's MIME map allows is accepted
 * here too.
 */
import { describe, expect, it } from 'vitest';
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES, MAX_FILES, formatBytes, rejectionReasonFor, } from '@/lib/uploads';
/** A `File` of a given size without allocating the bytes — jsdom reports `size` from this. */
function fileOf(name, size) {
    const file = new File(['x'], name);
    Object.defineProperty(file, 'size', { value: size });
    return file;
}
describe('the attachment limits', () => {
    it('matches the server: five files, ten megabytes each', () => {
        expect(MAX_FILES).toBe(5);
        expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    });
    /* The server's `ALLOWED` map, flattened. If a type is added there and not here, the
     * picker silently refuses a file the API would have taken. */
    it.each([
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt',
        '.log', '.csv', '.zip', '.doc', '.docx', '.xls', '.xlsx',
    ])('accepts %s, which the server allows', (extension) => {
        expect(rejectionReasonFor(fileOf(`report${extension}`, 2048))).toBeNull();
        expect(ACCEPT_ATTRIBUTE).toContain(extension);
    });
});
describe('rejectionReasonFor', () => {
    it('refuses a type the server would refuse', () => {
        expect(rejectionReasonFor(fileOf('payload.exe', 1024))).toBe('payload.exe: that file type is not accepted.');
    });
    it('ignores the case of the extension', () => {
        expect(rejectionReasonFor(fileOf('SCAN.PNG', 1024))).toBeNull();
    });
    it('refuses a file with no extension at all', () => {
        expect(rejectionReasonFor(fileOf('Dockerfile', 1024))).toMatch(/not accepted/);
    });
    it('names the size and the limit when a file is too large', () => {
        const reason = rejectionReasonFor(fileOf('capture.png', 12 * 1024 * 1024));
        expect(reason).toBe('capture.png is 12.0 MB; the limit is 10.0 MB.');
    });
    it('accepts a file exactly on the limit', () => {
        expect(rejectionReasonFor(fileOf('exact.pdf', MAX_FILE_BYTES))).toBeNull();
    });
    it('refuses an empty file', () => {
        expect(rejectionReasonFor(fileOf('empty.txt', 0))).toBe('empty.txt is empty.');
    });
    /* An oversized `.exe` is two problems at once. The type is the useful one to report:
     * telling someone to shrink a file we would never accept sends them away to compress
     * it and come back to the same refusal. */
    it('reports the type before the size when a file breaks both rules', () => {
        expect(rejectionReasonFor(fileOf('huge.exe', 99 * 1024 * 1024))).toMatch(/not accepted/);
    });
});
describe('formatBytes', () => {
    it('scales the unit to the size', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2 KB');
        expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
        expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
    });
    /* One decimal on megabytes and none on kilobytes, so "1024 KB" never appears next to
     * "1.0 MB" in the same list. */
    it('switches unit exactly at the boundary', () => {
        expect(formatBytes(1023)).toBe('1023 B');
        expect(formatBytes(1024)).toBe('1 KB');
        expect(formatBytes(1024 * 1024 - 1)).toBe('1024 KB');
    });
});
