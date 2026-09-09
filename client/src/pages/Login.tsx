/**
 * ServiceDesk Pro — sign in.
 *
 * The client validates only the shape it can be sure about — an address that looks
 * like an address, a password box that is not empty. Everything else comes back from
 * the server, field-mapped, because a client-side rule that disagrees with the
 * server's is worse than no rule at all.
 *
 * A wrong password answers with one message that names neither the address nor the
 * password. That is the server's choice and this page repeats it verbatim rather than
 * trying to be more helpful, since "no account with that email" tells anybody with a
 * list which addresses are worth attacking.
 */

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type Values = z.infer<typeof schema>;

export default function Login() {
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: Values) => {
    setFailure(null);
    try {
      await login(values.email, values.password);
      /* Back to whatever they were trying to reach, or the dashboard. */
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (error) {
      setFailure(applyServerErrors(error, form, ['email', 'password']));
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the account your IT team set up for you."
      footer={
        <p className="text-xs text-ink-muted">
          No account yet?{' '}
          <Link to="/register" className="link">
            Create one
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

        <Field label="Email address" htmlFor="email" error={form.formState.errors.email?.message} required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            invalid={Boolean(form.formState.errors.email)}
            aria-describedby={form.formState.errors.email ? 'email-error' : undefined}
            {...form.register('email')}
          />
        </Field>

        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message} required>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            invalid={Boolean(form.formState.errors.password)}
            aria-describedby={form.formState.errors.password ? 'password-error' : undefined}
            {...form.register('password')}
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
