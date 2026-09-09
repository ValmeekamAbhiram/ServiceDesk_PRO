/**
 * ServiceDesk Pro — pick files to attach.
 *
 * Holds nothing itself: the parent owns the `File[]`, because the form that submits
 * them is the thing that needs to know about them. Refusals happen here and are shown
 * as toasts, so a 30 MB video is turned away before it is uploaded — the server checks
 * size, MIME type and extension again regardless, and its answer is the one that counts.
 */

import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/toast.store';
import { ACCEPT_ATTRIBUTE, MAX_FILES, formatBytes, rejectionReasonFor } from '@/lib/uploads';

export function AttachmentPicker({
  id = 'files',
  files,
  onChange,
  label = 'Attach a file',
}: {
  id?: string;
  files: File[];
  onChange: (next: File[]) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (picked: FileList | null) => {
    if (!picked) return;
    const accepted: File[] = [];
    for (const file of Array.from(picked)) {
      const reason = rejectionReasonFor(file);
      if (reason) {
        toast.error(reason);
        continue;
      }
      /* Same name and size twice is almost always a double-click on the picker. */
      const already = [...files, ...accepted].some(
        (existing) => existing.name === file.name && existing.size === file.size
      );
      if (!already) accepted.push(file);
    }
    const room = Math.max(MAX_FILES - files.length, 0);
    if (accepted.length > room) toast.warning(`At most ${MAX_FILES} files can go on one post.`);
    onChange([...files, ...accepted.slice(0, room)]);
    /* Cleared so re-picking the same file fires `change` again. */
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        onChange={(event) => add(event.target.files)}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={files.length >= MAX_FILES}
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      <ul className="space-y-1.5">
        {files.map((file) => (
          <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 text-xs">
            <span className="truncate text-ink">{file.name}</span>
            <span className="tabular text-ink-subtle">{formatBytes(file.size)}</span>
            <button
              type="button"
              className="ml-auto rounded p-1 text-ink-subtle hover:text-danger-fg"
              onClick={() => onChange(files.filter((candidate) => candidate !== file))}
              aria-label={`Remove ${file.name}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
