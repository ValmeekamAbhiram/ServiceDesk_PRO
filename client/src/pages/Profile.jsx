/**
 * ServiceDesk Pro — your own account.
 *
 * Three things, and it is worth naming what is deliberately absent from each.
 *
 *  - **Details.** Name, job title, phone. Not email: it is the login identity, and there
 *    is no verification step in this build that could make a new address provably yours,
 *    so letting it be edited here would turn "fix a typo" into "change who signs in".
 *    Not role or status either — `PATCH /users/me` does not accept those fields at all,
 *    which is a stronger guarantee than a disabled select box.
 *  - **Password.** Changing it revokes every session, including this one, and the server
 *    answers with a replacement token pair. The store swaps them in, so the tab you are
 *    standing in survives and every other device is signed out. That is the point.
 *  - **Role.** Shown, with what it allows, and read-only. An administrator grants roles
 *    on the People page; nobody grants their own.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { ROLE_META } from '@shared/labels';
import { useUpdateOwnProfile } from '@/api/users';
import { applyServerErrors } from '@/lib/form';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from '@/stores/toast.store';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { RoleBadge, UserStatusBadge } from '@/components/domain/MetaBadge';
/** Mirrors `updateOwnProfileSchema`; the server re-checks all of it. */
const detailsSchema = z.object({
    name: z.string().trim().min(2, 'Please give your full name.').max(120, 'Keep it under 120 characters.'),
    jobTitle: z.string().trim().max(120, 'Keep it under 120 characters.').optional(),
    phone: z.string().trim().max(40, 'Keep it under 40 characters.').optional(),
});
const DETAIL_FIELDS = ['name', 'jobTitle', 'phone'];
/** Mirrors `passwordField` in `auth.schema.ts`, and the same rules Register applies. */
const passwordSchema = z
    .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
        .string()
        .min(8, 'Use at least 8 characters.')
        .max(72, 'Use at most 72 characters.')
        .regex(/[A-Za-z]/, 'Include at least one letter.')
        .regex(/[0-9]/, 'Include at least one number.'),
    confirmPassword: z.string(),
})
    /* Confirmation is a client-only field. The server has no use for it, so it is checked
     * here and never sent. */
    .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
})
    .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'The new password must be different from the current one.',
    path: ['newPassword'],
});
const PASSWORD_FIELDS = ['currentPassword', 'newPassword'];
export default function Profile() {
    const user = useAuthStore((state) => state.user);
    const applyProfile = useAuthStore((state) => state.applyProfile);
    const changePassword = useAuthStore((state) => state.changePassword);
    if (!user)
        return null;
    return (<div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Your account</h1>
        <p className="text-xs text-ink-subtle">
          What colleagues see next to your tickets and comments.
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <Avatar name={user.name} size="lg"/>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
          <p className="truncate text-xs text-ink-subtle">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <RoleBadge role={user.role}/>
            <UserStatusBadge status={user.status}/>
          </div>
        </div>
        <div className="w-full max-w-xs rounded-lg border border-info-border bg-info-bg px-3 py-2 text-xs text-info-fg">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true"/>
            {ROLE_META[user.role].label}
          </p>
          <p className="mt-1">{ROLE_META[user.role].description}</p>
          <p className="mt-1 text-info-fg/80">
            Only an administrator can change this, and never their own.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailsCard user={user} onSaved={(fields) => applyProfile(fields)}/>
        <PasswordCard onChange={changePassword}/>
      </div>
    </div>);
}
function DetailsCard({ user, onSaved, }) {
    const update = useUpdateOwnProfile();
    const [formError, setFormError] = useState(null);
    const form = useForm({
        resolver: zodResolver(detailsSchema),
        defaultValues: {
            name: user.name,
            jobTitle: user.jobTitle ?? '',
            phone: user.phone ?? '',
        },
    });
    const submit = form.handleSubmit(async (values) => {
        setFormError(null);
        /* An empty box means "not recorded", which is `null`, not `''` — one absent value in
         * the database rather than two. */
        const payload = {
            name: values.name.trim(),
            jobTitle: values.jobTitle?.trim() ? values.jobTitle.trim() : null,
            phone: values.phone?.trim() ? values.phone.trim() : null,
        };
        try {
            await update.mutateAsync(payload);
            onSaved(payload);
            form.reset({ name: payload.name, jobTitle: payload.jobTitle ?? '', phone: payload.phone ?? '' });
            toast.success('Saved.');
        }
        catch (error) {
            setFormError(applyServerErrors(error, form, DETAIL_FIELDS));
        }
    });
    return (<Card className="p-5">
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <h2 className="text-sm font-semibold text-ink">Details</h2>
          <p className="text-xs text-ink-subtle">Your name shows on every ticket you touch.</p>
        </div>

        {formError && (<div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
            {formError}
          </div>)}

        <Field label="Full name" htmlFor="name" error={form.formState.errors.name?.message} required>
          <Input id="name" {...form.register('name')} invalid={Boolean(form.formState.errors.name)}/>
        </Field>

        {/* Read-only rather than absent, so nobody hunts for it. `disabled` is a courtesy;
          * the endpoint does not accept an email at all. */}
        <Field label="Email" htmlFor="email" hint="Your sign-in address. Ask an administrator if it needs to change.">
          <Input id="email" value={user.email} disabled readOnly/>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job title" htmlFor="jobTitle" error={form.formState.errors.jobTitle?.message}>
            <Input id="jobTitle" {...form.register('jobTitle')} placeholder="Accounts assistant"/>
          </Field>
          <Field label="Phone" htmlFor="phone" error={form.formState.errors.phone?.message} hint="Optional. Helps a technician reach you.">
            <Input id="phone" type="tel" {...form.register('phone')} placeholder="+91 98765 43210"/>
          </Field>
        </div>

        <div className="flex justify-end">
          <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
            Save details
          </Button>
        </div>
      </form>
    </Card>);
}
function PasswordCard({ onChange, }) {
    const [formError, setFormError] = useState(null);
    const [saving, setSaving] = useState(false);
    const form = useForm({
        resolver: zodResolver(passwordSchema),
        defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    });
    const submit = form.handleSubmit(async (values) => {
        setFormError(null);
        setSaving(true);
        try {
            await onChange(values.currentPassword, values.newPassword);
            /* Cleared on success so a password is not left sitting in three form fields. */
            form.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
            toast.success('Password changed. Any other device you were signed in on has been signed out.');
        }
        catch (error) {
            setFormError(applyServerErrors(error, form, PASSWORD_FIELDS));
        }
        finally {
            setSaving(false);
        }
    });
    return (<Card className="p-5">
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div>
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
            <KeyRound className="h-4 w-4 text-ink-subtle" aria-hidden="true"/>
            Password
          </h2>
          <p className="text-xs text-ink-subtle">
            Changing it signs you out everywhere else. This tab stays signed in.
          </p>
        </div>

        {formError && (<div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
            {formError}
          </div>)}

        {/* `autoComplete` values are the ones password managers look for; getting them
          * wrong is how a manager saves the old password over the new one. */}
        <Field label="Current password" htmlFor="currentPassword" error={form.formState.errors.currentPassword?.message} required>
          <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} invalid={Boolean(form.formState.errors.currentPassword)}/>
        </Field>

        <Field label="New password" htmlFor="newPassword" error={form.formState.errors.newPassword?.message} hint="At least 8 characters, with a letter and a number." required>
          <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} invalid={Boolean(form.formState.errors.newPassword)}/>
        </Field>

        <Field label="Confirm new password" htmlFor="confirmPassword" error={form.formState.errors.confirmPassword?.message} required>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register('confirmPassword')} invalid={Boolean(form.formState.errors.confirmPassword)}/>
        </Field>

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Change password
          </Button>
        </div>
      </form>
    </Card>);
}
