/**
 * ServiceDesk Pro — client-side attachment limits.
 *
 * These mirror `server/src/modules/attachments/upload.middleware.ts`. The server is the
 * authority and re-checks every one of them: size while streaming, MIME type against an
 * allow-list, and extension cross-checked against that MIME type. Nothing here is a
 * security control — a hand-written `fetch` skips all of it.
 *
 * It exists so the file picker filters sensibly and so a 12 MB video is refused in the
 * browser instead of being uploaded for ten seconds and then rejected. Duplicating the
 * list is the cost of not shipping the server's module to the browser; if the two ever
 * disagree, the server wins and the user sees its message.
 */
/** Keep in step with `MAX_FILES` in the upload middleware. */
export const MAX_FILES = 5;
/** Keep in step with `MAX_UPLOAD_MB` (default 10) in the server env schema. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.txt', '.log',
    '.csv', '.zip', '.doc', '.docx', '.xls', '.xlsx',
];
/** Ready for an `<input type="file" accept="...">`. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.join(',');
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
/**
 * Returns the reason a file cannot be attached, or `null` if it can. Extension rather
 * than `file.type`, because browsers disagree about the MIME type of `.log` and `.csv`
 * and the server's cross-check is the one that matters.
 */
export function rejectionReasonFor(file) {
    const dot = file.name.lastIndexOf('.');
    const extension = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return `${file.name}: that file type is not accepted.`;
    }
    if (file.size > MAX_FILE_BYTES) {
        return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)}.`;
    }
    if (file.size === 0)
        return `${file.name} is empty.`;
    return null;
}
