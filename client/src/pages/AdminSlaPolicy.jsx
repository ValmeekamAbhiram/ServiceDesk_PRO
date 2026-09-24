/**
 * ServiceDesk Pro — the SLA policy.
 *
 * One document, edited in one form. What makes this page worth more than a settings
 * table is that its two halves do not reach the same tickets, and an administrator who
 * does not know that will read the difference as a bug:
 *
 *  - **Business hours and the at-risk threshold apply at once, to every open ticket.**
 *    Neither is copied onto a ticket; the engine reads them from the policy each time
 *    it evaluates a countdown. Widening the working day moves every deadline on the
 *    board.
 *  - **The per-priority budgets apply to tickets raised afterwards.** `dueAt` is
 *    snapshotted when the ticket is raised, because the deadline was a commitment made
 *    at that moment — shortening a budget today must not retroactively breach
 *    yesterday's tickets.
 *
 * The page says so in as many words, next to the fields each rule governs. Both are
 * enforced on the server; this is the explanation, not the mechanism.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Timer } from 'lucide-react';
import { PRIORITIES, Priority } from '@shared/enums';
import { formatMinuteOfDay, formatMinutes, parseMinuteOfDay } from '@shared/utils';
import { useSlaPolicy, useUpdateSlaPolicy } from '@/api/admin';
import { applyServerErrors } from '@/lib/form';
import { toast } from '@/stores/toast.store';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { PriorityBadge } from '@/components/domain/MetaBadge';
/** 0 = Sunday, matching `businessHours.workingDays`. Ordered the way a week reads. */
const DAYS = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 0, label: 'Sun' },
];
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time such as 09:00.');
const budget = z.coerce
    .number({ invalid_type_error: 'Minutes, as a number.' })
    .int('Whole minutes only.')
    .min(1, 'At least a minute.')
    .max(100_000, 'Longer than any desk commits to.');
const pair = z.object({ responseMinutes: budget, resolutionMinutes: budget });
/**
 * Mirrors `sla-policy.schema.ts`; the server re-checks every rule.
 *
 * The four budgets are spelled out rather than built with `z.record` so that
 * `targets.URGENT.responseMinutes` is a real, typed field path — a record would hand
 * `setError` a key react-hook-form cannot resolve to a control, and the message would
 * be stored and never shown.
 */
const schema = z
    .object({
    timezone: z.string().trim().min(1, 'Name the timezone the desk works in.'),
    startTime: time,
    endTime: time,
    workingDays: z.array(z.number()).min(1, 'The desk has to be open on at least one day.'),
    atRiskThresholdPercent: z.coerce
        .number({ invalid_type_error: 'A whole percent.' })
        .int('Whole percent.')
        .min(1, 'At least 1%.')
        .max(99, 'At 100% a target would breach before it was ever at risk.'),
    targets: z.object({
        [Priority.LOW]: pair,
        [Priority.MEDIUM]: pair,
        [Priority.HIGH]: pair,
        [Priority.URGENT]: pair,
    }),
})
    .refine((values) => parseMinuteOfDay(values.endTime) > parseMinuteOfDay(values.startTime), {
    path: ['endTime'],
    message: 'The day has to end after it starts.',
});
/* The server's paths are nested under `businessHours`, so those four never match a
 * control here and fall through to the banner — which is exactly what
 * `applyServerErrors` returns them for. The budgets do match, field for field. */
const FIELDS = [
    'timezone',
    'startTime',
    'endTime',
    'workingDays',
    'atRiskThresholdPercent',
    ...PRIORITIES.flatMap((priority) => [`targets.${priority}.responseMinutes`, `targets.${priority}.resolutionMinutes`]),
];
export default function AdminSlaPolicy() {
    const policy = useSlaPolicy();
    return (<div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Service levels</h1>
        <p className="text-xs text-ink-subtle">
          When the desk is open, and how long it has to answer and to fix. Every countdown in
          the application is measured against these numbers.
        </p>
      </div>

      {policy.isLoading ? (<Card className="space-y-3 p-5">
          <Skeleton className="h-4 w-40"/>
          <Skeleton className="h-9 w-full"/>
          <Skeleton className="h-9 w-full"/>
          <Skeleton className="h-24 w-full"/>
        </Card>) : policy.data ? (
        /* Keyed on `updatedAt` so a save made in another tab re-seeds the form with what
         * was actually stored, instead of leaving a stale draft on screen that would
         * write the old numbers back on the next submit. */
        <PolicyForm key={policy.data.updatedAt} policy={policy.data}/>) : (<Card className="p-5 text-sm text-ink-subtle">The policy could not be loaded.</Card>)}
    </div>);
}
function PolicyForm({ policy }) {
    const update = useUpdateSlaPolicy();
    const [formError, setFormError] = useState(null);
    const form = useForm({
        resolver: zodResolver(schema),
        defaultValues: {
            timezone: policy.businessHours.timezone,
            startTime: formatMinuteOfDay(policy.businessHours.startMinute),
            endTime: formatMinuteOfDay(policy.businessHours.endMinute),
            workingDays: [...policy.businessHours.workingDays],
            atRiskThresholdPercent: policy.atRiskThresholdPercent,
            targets: {
                [Priority.LOW]: { ...policy.targets[Priority.LOW] },
                [Priority.MEDIUM]: { ...policy.targets[Priority.MEDIUM] },
                [Priority.HIGH]: { ...policy.targets[Priority.HIGH] },
                [Priority.URGENT]: { ...policy.targets[Priority.URGENT] },
            },
        },
    });
    const { errors, isDirty } = form.formState;
    const workingDays = form.watch('workingDays');
    const toggleDay = (value) => {
        const next = workingDays.includes(value)
            ? workingDays.filter((day) => day !== value)
            : [...workingDays, value];
        form.setValue('workingDays', next.sort((a, b) => a - b), {
            shouldDirty: true,
            shouldValidate: true,
        });
    };
    const submit = form.handleSubmit(async (values) => {
        setFormError(null);
        const payload = {
            businessHours: {
                timezone: values.timezone.trim(),
                startMinute: parseMinuteOfDay(values.startTime),
                endMinute: parseMinuteOfDay(values.endTime),
                workingDays: values.workingDays,
            },
            atRiskThresholdPercent: values.atRiskThresholdPercent,
            targets: values.targets,
        };
        try {
            await update.mutateAsync(payload);
            /* Reset to the submitted values so the form is clean again and the Save button
             * goes back to disabled — the fetched copy will agree, but this does not wait
             * for it. */
            form.reset(values);
            toast.success('Service levels saved.');
        }
        catch (error) {
            setFormError(applyServerErrors(error, form, FIELDS));
        }
    });
    return (<form className="space-y-4" onSubmit={submit} noValidate>
      {formError && (<div role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {formError}
        </div>)}

      <Card>
        <CardHeader title={<span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-ink-subtle" aria-hidden="true"/>
              Working hours
            </span>} subtitle="Applies immediately, to every open ticket. Deadlines are counted in business time, so a ticket raised at 17:55 on Friday has five minutes of Friday and then waits for Monday."/>
        <CardBody className="space-y-4">
          <p className="text-2xs text-ink-subtle">
            Currently {policy.businessHours.label}.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Timezone" htmlFor="timezone" error={errors.timezone?.message} hint="An IANA name, such as Asia/Kolkata." required>
              <Input id="timezone" {...form.register('timezone')} invalid={Boolean(errors.timezone)} placeholder="Asia/Kolkata" autoComplete="off"/>
            </Field>
            <Field label="Opens at" htmlFor="startTime" error={errors.startTime?.message} required>
              <Input id="startTime" type="time" {...form.register('startTime')} invalid={Boolean(errors.startTime)}/>
            </Field>
            <Field label="Closes at" htmlFor="endTime" error={errors.endTime?.message} required>
              <Input id="endTime" type="time" {...form.register('endTime')} invalid={Boolean(errors.endTime)}/>
            </Field>
          </div>

          <fieldset>
            <legend className="text-xs font-medium text-ink-muted">Open on</legend>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DAYS.map((day) => {
            const on = workingDays.includes(day.value);
            return (<label key={day.value} className={on
                    ? 'chip cursor-pointer border-brand-300 bg-brand-50 text-brand-700'
                    : 'chip cursor-pointer'}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleDay(day.value)}/>
                    {day.label}
                  </label>);
        })}
            </div>
            {errors.workingDays && (<p role="alert" className="mt-1.5 text-xs text-danger-fg">
                {errors.workingDays.message}
              </p>)}
          </fieldset>

          <Field label="Warn at" htmlFor="atRiskThresholdPercent" error={errors.atRiskThresholdPercent?.message} hint="Percent of the budget consumed before a ticket is flagged at risk. Applies immediately." className="max-w-[12rem]" required>
            <Input id="atRiskThresholdPercent" type="number" min={1} max={99} {...form.register('atRiskThresholdPercent')} invalid={Boolean(errors.atRiskThresholdPercent)}/>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-ink-subtle" aria-hidden="true"/>
              Response and resolution budgets
            </span>} subtitle="In business minutes. These apply to tickets raised from now on — a ticket's deadline is fixed when it is raised, so shortening a budget today cannot breach yesterday's tickets."/>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Priority</th>
                <th scope="col">First response within</th>
                <th scope="col">Resolved within</th>
                <th scope="col">In force now</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITIES.map((priority) => (<BudgetRow key={priority} priority={priority} form={form} current={policy.targets[priority]}/>))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {isDirty && (<p className="mr-auto text-2xs text-ink-subtle">
            Unsaved changes. Working hours and the warning threshold take effect the moment you
            save.
          </p>)}
        <Button variant="ghost" onClick={() => {
            form.reset();
            setFormError(null);
        }} disabled={!isDirty || update.isPending}>
          Discard
        </Button>
        <Button type="submit" loading={update.isPending} disabled={!isDirty}>
          Save service levels
        </Button>
      </div>
    </form>);
}
/**
 * One row per priority, taking the form object rather than raw values so the two inputs
 * stay registered under their own typed paths and a server-side rejection can land on
 * the exact box that caused it.
 */
function BudgetRow({ priority, form, current, }) {
    const errors = form.formState.errors.targets?.[priority];
    return (<tr>
      <td>
        <PriorityBadge priority={priority}/>
      </td>
      <td>
        <Input type="number" min={1} aria-label={`First response minutes for ${priority.toLowerCase()} priority`} className="w-28" {...form.register(`targets.${priority}.responseMinutes`)} invalid={Boolean(errors?.responseMinutes)}/>
        {errors?.responseMinutes && (<p role="alert" className="mt-1 text-2xs text-danger-fg">
            {errors.responseMinutes.message}
          </p>)}
      </td>
      <td>
        <Input type="number" min={1} aria-label={`Resolution minutes for ${priority.toLowerCase()} priority`} className="w-28" {...form.register(`targets.${priority}.resolutionMinutes`)} invalid={Boolean(errors?.resolutionMinutes)}/>
        {errors?.resolutionMinutes && (<p role="alert" className="mt-1 text-2xs text-danger-fg">
            {errors.resolutionMinutes.message}
          </p>)}
      </td>
      {/* The stored figures, spelled out in hours and days. They are what every open
          * ticket at this priority is still being measured against. */}
      <td className="text-2xs text-ink-subtle">
        {formatMinutes(current.responseMinutes)} then {formatMinutes(current.resolutionMinutes)}
      </td>
    </tr>);
}
