/**
 * ServiceDesk Pro — the conversation on a ticket.
 *
 * Two things here are authorization-shaped and neither is enforced here. Internal notes
 * are filtered out of the response *by the server* before it answers, so the requester
 * never receives one to hide; and the INTERNAL option only appears for someone holding
 * `TICKET_COMMENT_INTERNAL`, which the service checks again on the way in. Deleting the
 * visibility toggle from this file would change nothing about who can post what.
 *
 * The badge on an internal note is therefore for the author's benefit — a technician
 * needs to be able to see, at a glance, that what they wrote is not visible to the
 * person waiting for an answer.
 */
import { useState } from 'react';
import { Lock, Send } from 'lucide-react';
import { CommentVisibility, Permission } from '@shared/enums';
import { relativeTime } from '@shared/utils';
import { useAddComment } from '@/api/tickets';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { AttachmentList } from '@/components/domain/AttachmentList';
import { AttachmentPicker } from '@/components/domain/AttachmentPicker';
import { useNow } from '@/hooks/useNow';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
function CommentCard({ comment, now }) {
    const internal = comment.visibility === CommentVisibility.INTERNAL;
    return (<li className={cn('rounded-card border px-4 py-3', internal ? 'border-warning-border bg-warning-bg' : 'border-line bg-surface')}>
      <div className="flex items-center gap-2">
        <Avatar name={comment.authorLabel} size="sm"/>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">{comment.authorLabel}</p>
          <p className="text-2xs text-ink-subtle">
            <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt, now)}</time>
            {comment.edited && <span> &middot; edited</span>}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {comment.isFirstResponse && <Badge tone="success">First response</Badge>}
          {internal && (<Badge tone="warning">
              <Lock className="h-3 w-3" aria-hidden="true"/>
              Internal note
            </Badge>)}
        </div>
      </div>
      {/* `whitespace-pre-wrap` and nothing else: the body is stored and rendered as
            plain text, so a pasted `<script>` is characters, not markup. */}
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{comment.body}</p>
      <AttachmentList attachments={comment.attachments} className="mt-3"/>
    </li>);
}
export function CommentThread({ ticketId, comments, loading, canReply, }) {
    const now = useNow();
    const canPostInternal = useAuthStore((state) => state.can(Permission.TICKET_COMMENT_INTERNAL));
    const add = useAddComment(ticketId);
    const [body, setBody] = useState('');
    const [internal, setInternal] = useState(false);
    const [files, setFiles] = useState([]);
    const post = async () => {
        const trimmed = body.trim();
        if (!trimmed) {
            toast.error('Write something before posting.');
            return;
        }
        try {
            await add.mutateAsync({
                input: {
                    body: trimmed,
                    visibility: internal ? CommentVisibility.INTERNAL : CommentVisibility.PUBLIC,
                },
                files,
            });
            setBody('');
            setFiles([]);
            /* Visibility is deliberately *not* reset: someone leaving internal notes is
             * usually leaving several, and silently flipping back to public is how a private
             * note ends up in front of the requester. */
        }
        catch (error) {
            toast.error(error instanceof ApiClientError ? error.message : 'That reply could not be posted.');
        }
    };
    return (<div className="space-y-4">
      {loading ? (<div className="flex items-center gap-2 text-xs text-ink-subtle">
          <Spinner className="h-4 w-4"/>
          Loading the conversation…
        </div>) : comments.length === 0 ? (<p className="text-xs text-ink-subtle">No replies yet.</p>) : (<ul className="space-y-3">
          {comments.map((comment) => (<CommentCard key={comment.id} comment={comment} now={now}/>))}
        </ul>)}

      {canReply ? (<div className="space-y-3 rounded-card border border-line bg-surface-sunken p-3">
          <Textarea id="reply" rows={4} value={body} onChange={(event) => setBody(event.target.value)} placeholder={internal ? 'A note for the team only…' : 'Add a reply…'} aria-label="Reply"/>
          <AttachmentPicker id="reply-files" files={files} onChange={setFiles}/>
          <div className="flex flex-wrap items-center gap-3">
            {canPostInternal && (<label className="flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" className="h-3.5 w-3.5 rounded border-line-strong text-brand-600" checked={internal} onChange={(event) => setInternal(event.target.checked)}/>
                Internal note — the requester will not see this
              </label>)}
            <Button className="ml-auto" size="sm" onClick={post} loading={add.isPending} disabled={body.trim().length === 0}>
              <Send className="h-4 w-4" aria-hidden="true"/>
              {internal ? 'Post note' : 'Reply'}
            </Button>
          </div>
        </div>) : (<p className="rounded-card border border-line bg-surface-sunken px-4 py-3 text-xs text-ink-subtle">
          This ticket is closed. Reopen it to carry on the conversation.
        </p>)}
    </div>);
}
