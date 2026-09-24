/**
 * ServiceDesk Pro — attachments on a ticket or comment.
 *
 * `attachment.url` is a relative API path, and the endpoint behind it re-checks the
 * caller's access to the parent ticket on every request. So these are plain links: no
 * signed URL to expire, nothing to leak if the page is screenshotted, and no second
 * copy of the authorization rule living in the browser.
 */
import { Download, Paperclip } from 'lucide-react';
import { formatBytes } from '@/lib/uploads';
import { cn } from '@/lib/cn';
export function AttachmentList({ attachments, className, }) {
    if (attachments.length === 0)
        return null;
    return (<ul className={cn('space-y-1.5', className)}>
      {attachments.map((attachment) => (<li key={attachment.id}>
          <a href={attachment.url} 
        /* `download` asks the browser to save rather than navigate, which matters
         * for the text and PDF types that would otherwise replace the page. */
        download={attachment.filename} className="group flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-xs hover:border-line-strong">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-subtle" aria-hidden="true"/>
            <span className="truncate font-medium text-ink">{attachment.filename}</span>
            <span className="tabular ml-auto shrink-0 text-ink-subtle">
              {formatBytes(attachment.sizeBytes)}
            </span>
            <Download className="h-3.5 w-3.5 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true"/>
          </a>
        </li>))}
    </ul>);
}
