/**
 * ServiceDesk Pro — create an account.
 *
 * Self-registration always produces an EMPLOYEE. The form has no role field and the
 * server ignores one if it is sent — `registerSchema` strips unknown keys, so posting
 * `{ role: 'ADMIN' }` reaches the service as three fields. An administrator grants a
 * role afterwards from the People page; that is the only path to one.
 *
 * The password rules here mirror the server's exactly (eight characters, a letter and
 * a number). Mirroring is a real risk — two copies of a rule drift — so the copy is
 * kept literal and small, and the server remains the one that decides.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle } from 'lucide-react';
import { applyServerErrors } from '@/lib/form';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores/auth.store';
import { AuthLayout } from '@/components/layout/AuthLayout';

const schema = z.object({
  name: z.string().trim().min(2, 'Please give your full name.').max(120),
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .max(72, 'Use at most 72 characters.')
    .regex(/[A-Za-z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.'),
});

type Values = z.infer<typeof schema>;

export default function Register() {
  const register = useAuthStore((state) => state.register);
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = async (values: Values) => {
    setFailure(null);
    try {
      await register(values.name, values.email, values.password);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setFailure(applyServerErrors(error, form, ['name', 'email', 'password']));
    }
  };

  const errors = form.formState.errors;

  return (
    <AuthLayout
      title="Create your account"
      subtitle="You will be able to raise tickets straight away."
      footer={
        <p className="text-xs text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {failure && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg"
          >
            <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{failure}</span>
          </div>
        )}

        <Field label="Full name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="name" autoFocus invalid={Boolean(errors.name)} {...form.register('name')} />
        </Field>

        <Field label="Work email" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" invalid={Boolean(errors.email)} {...form.register('email')} />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={errors.password?.message}
          hint="At least 8 characters, including a letter and a number."
          required
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...form.register('password')}
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
