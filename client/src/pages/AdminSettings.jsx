/**
 * ServiceDesk Pro — system settings, and the Time Machine.
 *
 * Two panels on one page because they are the same kind of thing — deployment-wide
 * switches nobody but an administrator should see — but they are gated differently, and
 * the difference matters:
 *
 *  - **Settings** need `settings:manage`. The route is behind that permission, and the
 *    server checks it again on the PATCH.
 *  - **The Time Machine** needs `demo:control` *and* demo mode to be effective, which
 *    means both `DEMO_MODE` in the environment and the stored `demoModeRequested`. It is
 *    never available in production: `env.demoMode` is `DEMO_MODE && !isProduction`, so
 *    the panel cannot be reached on a production build even by an administrator who
 *    turns the stored flag on. This page renders nothing at all in that case rather
 *    than a disabled control, because a greyed-out "advance the clock" button invites
 *    someone to go looking for the reason it is greyed out.
 *
 * Every switch here is an AND of an environment flag and a stored flag, so a setting can
 * turn a feature off but never on. The form says which half is holding a feature down,
 * because a toggle that appears to work and then does nothing is the worst of the three
 * possible behaviours.
 */
import { useState } from 'react';
import { AlertTriangle, Clock, RotateCcw, Save } from 'lucide-react';
import { ClockMode, Permission } from '@shared/enums';
import { relativeTime } from '@shared/utils';
import { useAdvanceClock, useDemoClock, useResetClock, useSettings, useUpdateSettings, } from '@/api/admin';
import { ApiClientError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { useNow } from '@/hooks/useNow';
import { toast } from '@/stores/toast.store';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Toggle } from '@/components/ui/Toggle';
/** The jumps a demo actually needs: past a response target, past a resolution target, a day. */
const JUMPS = [
    { minutes: 15, label: '+15 min' },
    { minutes: 60, label: '+1 hour' },
    { minutes: 240, label: '+4 hours' },
    { minutes: 1440, label: '+1 day' },
];
export default function AdminSettings() {
    const settings = useSettings();
    return (<div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
        <p className="text-xs text-ink-subtle">
          Deployment-wide switches. Changes are recorded in the audit trail with the field that
          moved and who moved it.
        </p>
      </div>

      {settings.isLoading ? (<Card className="space-y-3 p-5">
          <Skeleton className="h-4 w-40"/>
          <Skeleton className="h-9 w-full"/>
          <Skeleton className="h-9 w-full"/>
        </Card>) : settings.data ? (<>
          {/* Keyed so a change saved elsewhere re-seeds the boxes instead of leaving a
              * stale draft that would write the old values back. */}
          <SettingsForm key={settings.data.updatedAt} settings={settings.data}/>
          <TimeMachine available={settings.data.demoMode}/>
        </>) : (<Card className="p-5 text-sm text-ink-subtle">Settings could not be loaded.</Card>)}
    </div>);
}
/**
 * Deliberately not react-hook-form.
 *
 * Four independent fields, two of which are switches that should save on the spot rather
 * than wait for a submit, and no cross-field rules. A form library here would be more
 * ceremony than the page has substance.
 */
function SettingsForm({ settings }) {
    const update = useUpdateSettings();
    const [organizationName, setOrganizationName] = useState(settings.organizationName);
    const [supportEmail, setSupportEmail] = useState(settings.supportEmail);
    const [error, setError] = useState(null);
    const dirty = organizationName.trim() !== settings.organizationName ||
        supportEmail.trim() !== settings.supportEmail;
    const save = async (patch, done) => {
        setError(null);
        try {
            await update.mutateAsync(patch);
            toast.success(done);
        }
        catch (failure) {
            setError(failure instanceof ApiClientError ? failure.message : 'That could not be saved.');
        }
    };
    return (<Card>
      <CardHeader title="Organisation" subtitle="The name shown in the header, and the address the desk is reached at."/>
      <CardBody className="space-y-4">
        {error && (<div role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
            {error}
          </div>)}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name" htmlFor="organizationName" hint="Shown under the product name in the sidebar.">
            <Input id="organizationName" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} maxLength={160}/>
          </Field>
          <Field label="Support email" htmlFor="supportEmail" hint="Offered in the sidebar footer as the address to write to.">
            <Input id="supportEmail" type="email" value={supportEmail} onChange={(event) => setSupportEmail(event.target.value)}/>
          </Field>
        </div>

        <div className="flex justify-end">
          <Button size="sm" loading={update.isPending} disabled={!dirty} onClick={() => void save({ organizationName: organizationName.trim(), supportEmail: supportEmail.trim() }, 'Saved.')}>
            <Save className="h-4 w-4" aria-hidden="true"/>
            Save
          </Button>
        </div>

        <div className="space-y-4 border-t border-line pt-4">
          <Toggle id="aiSuggestions" label="Offline ticket suggestions" description="Suggests a category and priority from the words in a title. It never assigns, never changes a ticket on its own, and a technician can ignore it." 
    /* The stored flag, not the effective one — otherwise turning it on while the
     * environment has AI disabled would flip the switch back on the next read
     * and look like the save failed. */
    checked={settings.aiSuggestionsRequested} 
    /* `aiSuggestionsEnabled` is the AND. If it is false while the request is
     * true, the environment is what is holding it down. */
    note={settings.aiSuggestionsRequested && !settings.aiSuggestionsEnabled
            ? 'Switched off for this deployment by AI_ENABLED, so this has no effect until that changes.'
            : undefined} disabled={update.isPending} onChange={(next) => void save({ aiSuggestionsEnabled: next }, next ? 'Suggestions on.' : 'Suggestions off.')}/>

          <Toggle id="demoMode" label="Demo mode" description="Unlocks the Time Machine below, which moves the clock the SLA engine reads. Intended for a demonstration, never for a live desk." checked={settings.demoModeRequested} note={settings.demoModeRequested && !settings.demoMode
            ? 'Unavailable in this environment — DEMO_MODE is off, and it is forced off in production.'
            : undefined} disabled={update.isPending} onChange={(next) => void save({ demoModeRequested: next }, next ? 'Demo mode on.' : 'Demo mode off. The clock is back to real time.')}/>
        </div>
      </CardBody>
    </Card>);
}
/**
 * The Time Machine.
 *
 * `available` is the *effective* demo flag, so this renders nothing on a production
 * build and nothing when an administrator has switched demo mode off — no disabled
 * buttons, no explanatory box, nothing. A destructive control that is merely greyed out
 * is still an advertisement for itself.
 *
 * The permission is checked here as well as on the route, because this component is one
 * import away from being dropped onto a page that forgot the guard.
 */
function TimeMachine({ available }) {
    const canControl = useAuthStore((state) => state.can(Permission.DEMO_CONTROL));
    const enabled = available && canControl;
    const clock = useDemoClock(enabled);
    const advance = useAdvanceClock();
    const reset = useResetClock();
    const now = useNow();
    if (!enabled)
        return null;
    const state = clock.data;
    const shifted = state ? state.offsetMs !== 0 : false;
    const busy = advance.isPending || reset.isPending;
    const move = async (minutes) => {
        try {
            const next = await advance.mutateAsync(minutes);
            toast.success(`The desk's clock is now ${next.offsetLabel}.`);
        }
        catch (error) {
            toast.error(error instanceof ApiClientError ? error.message : 'The clock did not move.');
        }
    };
    return (<Card className="border-warning-border">
      <CardHeader title={<span className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-warning-fg" aria-hidden="true"/>
            Time Machine
            <Badge tone="warning">Demo</Badge>
          </span>} subtitle="Moves the clock the SLA engine reads, so a deadline can be crossed in front of an audience instead of in four hours' time. No stored timestamp is rewritten — a ticket raised ten minutes ago still says ten minutes ago."/>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-2xs text-warning-fg">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true"/>
          <p>
            Every signed-in browser is told about the jump and refetches. A jump longer than
            the access-token lifetime also expires the tokens issued before it, so the next
            request refreshes the session — expected, and handled without a sign-in.
          </p>
        </div>

        {clock.isLoading || !state ? (<Skeleton className="h-16 w-full"/>) : (<dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-2xs uppercase tracking-wide text-ink-subtle">The desk reads</dt>
              <dd className="font-medium tabular-nums text-ink">{stamp(state.simulatedTime)}</dd>
              <dd className="text-2xs text-ink-subtle">
                <time dateTime={state.simulatedTime}>{relativeTime(state.simulatedTime, now)}</time>
              </dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-ink-subtle">Real time</dt>
              <dd className="tabular-nums text-ink-muted">{stamp(state.realTime)}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wide text-ink-subtle">Offset</dt>
              <dd>
                <Badge tone={shifted ? 'warning' : 'neutral'}>{state.offsetLabel}</Badge>
                {state.mode === ClockMode.REAL && (<span className="ml-1.5 text-2xs text-ink-subtle">real clock</span>)}
              </dd>
            </div>
          </dl>)}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {JUMPS.map((jump) => (<Button key={jump.minutes} size="sm" variant="secondary" disabled={busy} onClick={() => void move(jump.minutes)}>
              {jump.label}
            </Button>))}
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true"/>
          <Button size="sm" variant="ghost" disabled={busy || !shifted} loading={reset.isPending} onClick={() => {
            void reset
                .mutateAsync()
                .then(() => toast.success('Back to real time.'))
                .catch((error) => toast.error(error instanceof ApiClientError ? error.message : 'The clock did not move.'));
        }}>
            <RotateCcw className="h-4 w-4" aria-hidden="true"/>
            Back to real time
          </Button>
        </div>
      </CardBody>
    </Card>);
}
/** Absolute stamp, used for both clocks so the two are comparable at a glance. */
function stamp(iso) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
