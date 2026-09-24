/**
 * ServiceDesk Pro — one ticket.
 *
 * Every write on this page carries `ticket.version`. If somebody else changed the ticket
 * first the server answers `VERSION_CONFLICT` with the current version, and the handler
 * here refetches and says so rather than retrying — a silent retry would apply a change
 * the person made against a ticket they were no longer looking at.
 *
 * The controls shown are driven by two server-supplied facts and never by a role check
 * written here: `ticket.allowedTransitions` (from `TICKET_TRANSITIONS`) decides which
 * statuses the dropdown offers, and `can()` on the auth store's permission list decides
 * whether the assign and status panels appear at all. Both are re-checked server-side.
 *
 * `useWatchTicket` joins this ticket's socket room, so a comment or a status change from
 * someone else lands here without a refresh. The socket only carries the ticket id; the
 * data is refetched through the endpoint that enforces read scope.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowLeft, MessageSquare, RotateCcw, Server, UserPlus } from 'lucide-react';
import { Permission, TicketStatus } from '@shared/enums';
import { PRIORITY_META, TICKET_STATUS_META } from '@shared/labels';
import { relativeTime } from '@shared/utils';
import { useAssignTicket, useChangeStatus, useReopenTicket, useTicket, useTicketComments, } from '@/api/tickets';
import { useAssignees } from '@/api/reference';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { Select, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { AttachmentList } from '@/components/domain/AttachmentList';
import { CommentThread } from '@/components/domain/CommentThread';
import { PriorityBadge, StatusBadge } from '@/components/domain/MetaBadge';
import { SlaCountdown } from '@/components/domain/SlaCountdown';
import { TicketTimeline } from '@/components/domain/TicketTimeline';
import { useNow } from '@/hooks/useNow';
import { useWatchTicket } from '@/hooks/useRealtime';
import { ApiClientError } from '@/lib/api';
/** Statuses after which the conversation is over until somebody reopens. */
const SETTLED = [TicketStatus.CLOSED];
/**
 * One place to turn a failed write into something readable. A version conflict is its
 * own case because the fix — look at it again — is different from every other failure.
 */
function reportFailure(error, refresh) {
    if (error instanceof ApiClientError && error.isVersionConflict) {
        refresh();
        toast.warning('Somebody else changed this ticket. Reloaded it — please try again.');
        return;
    }
    toast.error(error instanceof ApiClientError ? error.message : 'That change could not be saved.');
}
/* ─────────────────────────────── status panel ────────────────────────────── */
function StatusPanel({ ticket, refresh }) {
    const change = useChangeStatus(ticket.id);
    const [target, setTarget] = useState('');
    const [note, setNote] = useState('');
    const [confirming, setConfirming] = useState(false);
    /* RESOLVED is the one transition the server requires a note for, so it gets a dialog
     * and the rest apply straight away. */
    const needsNote = target === TicketStatus.RESOLVED;
    const apply = async (status, resolutionNote) => {
        try {
            await change.mutateAsync({
                status,
                version: ticket.version,
                ...(resolutionNote ? { resolutionNote } : {}),
            });
            toast.success(`Moved to ${TICKET_STATUS_META[status].label.toLowerCase()}.`);
            setTarget('');
            setNote('');
            setConfirming(false);
        }
        catch (error) {
            reportFailure(error, refresh);
        }
    };
    if (ticket.allowedTransitions.length === 0) {
        return <p className="text-xs text-ink-subtle">This ticket cannot move anywhere from here.</p>;
    }
    return (<div className="space-y-2">
      <Select id="status" value={target} onChange={(event) => setTarget(event.target.value)}>
        <option value="">Move to…</option>
        {ticket.allowedTransitions.map((status) => (<option key={status} value={status}>
            {TICKET_STATUS_META[status].label}
          </option>))}
      </Select>
      <Button size="sm" fullWidth disabled={!target} loading={change.isPending && !confirming} onClick={() => {
            if (!target)
                return;
            if (needsNote)
                setConfirming(true);
            else
                void apply(target);
        }}>
        {needsNote ? 'Resolve…' : 'Apply'}
      </Button>

      <Modal open={confirming && needsNote} onClose={() => setConfirming(false)} title="Resolve this ticket" description="What fixed it? The requester reads this, and it is what makes the ticket useful to the next person with the same problem." size="md" footer={<>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={change.isPending} disabled={note.trim().length === 0} onClick={() => void apply(TicketStatus.RESOLVED, note.trim())}>
              Mark resolved
            </Button>
          </>}>
        <Field label="Resolution" htmlFor="resolutionNote" required>
          <Textarea id="resolutionNote" rows={5} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Replaced the docking station; the port on the old one was dead."/>
        </Field>
      </Modal>
    </div>);
}
/* ─────────────────────────────── assign panel ────────────────────────────── */
function AssignPanel({ ticket, refresh }) {
    const assign = useAssignTicket(ticket.id);
    const assignees = useAssignees();
    const me = useAuthStore((state) => state.user);
    const set = async (assigneeId) => {
        try {
            await assign.mutateAsync({ assigneeId, version: ticket.version });
            toast.success(assigneeId ? 'Assigned.' : 'Returned to the queue.');
        }
        catch (error) {
            reportFailure(error, refresh);
        }
    };
    /* Only offered when the signed-in user is actually assignable — an admin who is not a
     * technician still appears in the list, so this checks the list rather than the role. */
    const canTakeIt = Boolean(me) && (assignees.data ?? []).some((user) => user.id === me?.id);
    return (<div className="space-y-2">
      <Select id="assignee" value={ticket.assignee?.id ?? ''} disabled={assign.isPending || assignees.isLoading} onChange={(event) => void set(event.target.value || null)}>
        <option value="">Unassigned</option>
        {(assignees.data ?? []).map((user) => (<option key={user.id} value={user.id}>
            {user.name}
          </option>))}
      </Select>
      {canTakeIt && ticket.assignee?.id !== me?.id && (<Button variant="secondary" size="sm" fullWidth loading={assign.isPending} onClick={() => void set(me?.id ?? null)}>
          <UserPlus className="h-4 w-4" aria-hidden="true"/>
          Assign to me
        </Button>)}
    </div>);
}
/* ──────────────────────────────── properties ─────────────────────────────── */
function PropertyRow({ label, children }) {
    return (<div className="grid grid-cols-[minmax(6.5rem,0.8fr)_minmax(0,1.2fr)] items-start gap-3 py-2">
      <dt className="shrink-0 text-xs text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-ink">{children}</dd>
    </div>);
}
function Properties({ ticket, now }) {
    return (<dl className="divide-y divide-line">
      <PropertyRow label="Status">
        <StatusBadge status={ticket.status}/>
      </PropertyRow>
      <PropertyRow label="Priority">
        <PriorityBadge priority={ticket.priority}/>
      </PropertyRow>
      <PropertyRow label="Category">{ticket.category?.label ?? '—'}</PropertyRow>
      <PropertyRow label="Raised by">{ticket.requester?.name ?? 'Deleted user'}</PropertyRow>
      <PropertyRow label="Assigned to">{ticket.assignee?.name ?? 'Nobody yet'}</PropertyRow>
      <PropertyRow label="Device">
        {ticket.asset ? (<Link to={`/assets/${ticket.asset.id}`} className="link inline-flex items-center gap-1">
            <Server className="h-3.5 w-3.5" aria-hidden="true"/>
            {ticket.asset.tag}
          </Link>) : ('—')}
      </PropertyRow>
      <PropertyRow label="Raised">
        <time dateTime={ticket.createdAt}>{relativeTime(ticket.createdAt, now)}</time>
      </PropertyRow>
      <PropertyRow label="Last activity">
        <time dateTime={ticket.updatedAt}>{relativeTime(ticket.updatedAt, now)}</time>
      </PropertyRow>
      {ticket.reopenCount > 0 && (<PropertyRow label="Reopened">
          {ticket.reopenCount} {ticket.reopenCount === 1 ? 'time' : 'times'}
        </PropertyRow>)}
    </dl>);
}
/* ────────────────────────────────── page ─────────────────────────────────── */
export default function TicketDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const now = useNow();
    const ticket = useTicket(id);
    const comments = useTicketComments(id);
    const reopen = useReopenTicket(id ?? '');
    const canUpdate = useAuthStore((state) => state.can(Permission.TICKET_UPDATE));
    const canAssign = useAuthStore((state) => state.can(Permission.TICKET_ASSIGN));
    /* Joins the room for as long as this page is mounted. */
    useWatchTicket(id);
    if (ticket.isLoading) {
        return (<div className="space-y-5" aria-label="Loading ticket">
        <div className="flex items-start gap-3">
          <Skeleton className="h-8 w-20"/>
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-28"/>
            <Skeleton className="h-7 w-full max-w-xl"/>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <Skeleton className="h-48 w-full"/>
            <Skeleton className="h-72 w-full"/>
          </div>
          <div className="space-y-5">
            <Skeleton className="h-40 w-full"/>
            <Skeleton className="h-64 w-full"/>
          </div>
        </div>
      </div>);
    }
    if (ticket.isError || !ticket.data) {
        /* The server answers 404 for a ticket the caller may not see, so this one screen is
         * the honest answer to both "it does not exist" and "it is not yours" — telling the
         * two apart would itself leak which ticket numbers are real. */
        return (<EmptyState icon={<AlertTriangle className="h-5 w-5" aria-hidden="true"/>} title="That ticket is not here" message="It may have been deleted, or it may belong to someone else." action={<Button onClick={() => navigate('/tickets')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true"/>
            Back to tickets
          </Button>}/>);
    }
    const data = ticket.data;
    const refresh = () => void ticket.refetch();
    const reopenable = data.status === TicketStatus.RESOLVED || data.status === TicketStatus.CLOSED;
    const doReopen = async () => {
        try {
            await reopen.mutateAsync({ version: data.version });
            toast.success('Reopened.');
        }
        catch (error) {
            reportFailure(error, refresh);
        }
    };
    return (<div className="space-y-5">
      <header className="rounded-card border border-line bg-surface px-4 py-4 shadow-card sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Link to="/tickets" className="btn btn-ghost btn-sm self-start">
            <ArrowLeft className="h-4 w-4" aria-hidden="true"/>
            Tickets
          </Link>
          <div className="min-w-0 flex-1 sm:border-l sm:border-line sm:pl-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-surface-sunken px-2 py-1 font-mono text-xs font-semibold text-ink-muted">
                {data.number}
              </span>
              <StatusBadge status={data.status}/>
              <PriorityBadge priority={data.priority}/>
            </div>
            <h1 className="mt-2 break-words text-xl font-semibold leading-tight text-ink sm:text-2xl">
              {data.title}
            </h1>
            <p className="mt-1 text-xs text-ink-subtle">
              {data.category?.label ?? 'Uncategorised'} · Updated {relativeTime(data.updatedAt, now)}
            </p>
          </div>
          {reopenable && (<Button variant="secondary" size="sm" className="self-start" loading={reopen.isPending} onClick={() => void doReopen()}>
              <RotateCcw className="h-4 w-4" aria-hidden="true"/>
              Reopen
            </Button>)}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="The problem" subtitle={PRIORITY_META[data.priority].description ?? undefined}/>
            <CardBody className="space-y-4">
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{data.description}</p>
              <AttachmentList attachments={data.attachments}/>
            </CardBody>
          </Card>

          {data.resolutionNote && (<Card className="border-success-border bg-success-bg">
              <CardHeader title="How it was resolved"/>
              <CardBody>
                <p className="whitespace-pre-wrap break-words text-sm text-ink">
                  {data.resolutionNote}
                </p>
              </CardBody>
            </Card>)}

          <Card>
            <CardHeader title={<span className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-ink-subtle" aria-hidden="true"/>
                  Conversation
                </span>} subtitle={`${data.commentCount} ${data.commentCount === 1 ? 'reply' : 'replies'}`}/>
            <CardBody>
              {comments.isError ? (<EmptyState icon={<MessageSquare className="h-5 w-5" aria-hidden="true"/>} title="Conversation unavailable" message="The replies could not be loaded. The rest of the ticket is still available." className="py-8" action={<Button variant="secondary" size="sm" onClick={() => void comments.refetch()}>
                      Try again
                    </Button>}/>) : (<CommentThread ticketId={data.id} comments={comments.data?.items ?? []} loading={comments.isLoading} canReply={!SETTLED.includes(data.status)}/>)}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className={data.sla.breached ? 'border-danger-border' : undefined}>
            <CardHeader title={<span className="flex items-center gap-2">
                  <Activity className={data.sla.breached ? 'h-4 w-4 text-danger-fg' : 'h-4 w-4 text-brand-600'} aria-hidden="true"/>
                  Service level
                </span>} subtitle={data.sla.policyName} action={data.sla.breached ? (<span className="text-xs font-semibold text-danger-fg">Attention required</span>) : undefined}/>
            <CardBody className="space-y-5">
              <SlaCountdown target={data.sla.response} label="First response"/>
              <SlaCountdown target={data.sla.resolution} label="Resolution"/>
            </CardBody>
          </Card>

          {(canUpdate || canAssign) && (<Card>
              <CardHeader title="Work this ticket"/>
              <CardBody className="space-y-4">
                {canAssign && (<Field label="Assignee" htmlFor="assignee">
                    <AssignPanel ticket={data} refresh={refresh}/>
                  </Field>)}
                {canUpdate && (<Field label="Status" htmlFor="status">
                    <StatusPanel ticket={data} refresh={refresh}/>
                  </Field>)}
              </CardBody>
            </Card>)}

          <Card>
            <CardHeader title="Details"/>
            <CardBody>
              <Properties ticket={data} now={now}/>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" subtitle="Newest first"/>
            <CardBody>
              <TicketTimeline history={data.statusHistory}/>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>);
}
