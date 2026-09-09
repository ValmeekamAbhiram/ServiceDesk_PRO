/**
 * ServiceDesk Pro — the route table.
 *
 * Pages are lazy-loaded, one chunk each, so the sign-in screen does not download the
 * dashboard's charting library. `Suspense` sits inside the shell rather than around it,
 * so the sidebar stays on screen while a page loads instead of the whole frame
 * blinking.
 *
 * Permission gates on admin routes are cosmetic — see `ProtectedRoute.tsx`. They exist
 * so a link that would only 403 shows an explanation instead of an error toast.
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Permission } from '@shared/enums';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/Toaster';
import { Spinner } from '@/components/ui/Spinner';
import { AnonymousRoute, ProtectedRoute, RequirePermission } from '@/routes/ProtectedRoute';

const Login = lazy(() => import('@/pages/Login'));
const Register = lazy(() => import('@/pages/Register'));
const Landing = lazy(() => import('@/pages/Landing'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const TicketList = lazy(() => import('@/pages/TicketList'));
const TicketNew = lazy(() => import('@/pages/TicketNew'));
const TicketDetail = lazy(() => import('@/pages/TicketDetail'));
const AssetList = lazy(() => import('@/pages/AssetList'));
const AssetDetail = lazy(() => import('@/pages/AssetDetail'));
const AssetEdit = lazy(() => import('@/pages/AssetEdit'));
const ArticleList = lazy(() => import('@/pages/ArticleList'));
const ArticleDetail = lazy(() => import('@/pages/ArticleDetail'));
const ArticleEdit = lazy(() => import('@/pages/ArticleEdit'));
const AdminUsers = lazy(() => import('@/pages/AdminUsers'));
const AdminCategories = lazy(() => import('@/pages/AdminCategories'));
const AdminSlaPolicy = lazy(() => import('@/pages/AdminSlaPolicy'));
const AdminAuditLog = lazy(() => import('@/pages/AdminAuditLog'));
const AdminSettings = lazy(() => import('@/pages/AdminSettings'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const Profile = lazy(() => import('@/pages/Profile'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner className="h-5 w-5 text-brand-600" />
      <span className="sr-only">Loading page</span>
    </div>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            <AnonymousRoute>
              <Suspense fallback={<PageLoading />}>
                <Login />
              </Suspense>
            </AnonymousRoute>
          }
        />
        <Route
          path="/register"
          element={
            <AnonymousRoute>
              <Suspense fallback={<PageLoading />}>
                <Register />
              </Suspense>
            </AnonymousRoute>
          }
        />

        <Route
          path="/welcome"
          element={
            <AnonymousRoute>
              <Suspense fallback={<PageLoading />}>
                <Landing />
              </Suspense>
            </AnonymousRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="tickets" element={<TicketList />} />
          <Route path="tickets/new" element={<TicketNew />} />
          <Route path="tickets/:id" element={<TicketDetail />} />
          <Route path="assets" element={<AssetList />} />
          {/* Before `:id`, or "new" would be read as an asset id. */}
          <Route
            path="assets/new"
            element={
              <RequirePermission permission={Permission.ASSET_MANAGE}>
                <AssetEdit />
              </RequirePermission>
            }
          />
          <Route path="assets/:id" element={<AssetDetail />} />
          <Route
            path="assets/:id/edit"
            element={
              <RequirePermission permission={Permission.ASSET_MANAGE}>
                <AssetEdit />
              </RequirePermission>
            }
          />
          <Route path="knowledge" element={<ArticleList />} />
          {/* Before `:id`, same trap as assets. Both write routes need ARTICLE_WRITE;
            * publishing needs ARTICLE_PUBLISH and is a control on the detail page, not a
            * route, because it is a decision about an existing draft. */}
          <Route
            path="knowledge/new"
            element={
              <RequirePermission permission={Permission.ARTICLE_WRITE}>
                <ArticleEdit />
              </RequirePermission>
            }
          />
          <Route path="knowledge/:id" element={<ArticleDetail />} />
          <Route
            path="knowledge/:id/edit"
            element={
              <RequirePermission permission={Permission.ARTICLE_WRITE}>
                <ArticleEdit />
              </RequirePermission>
            }
          />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route
            path="admin/users"
            element={
              <RequirePermission permission={Permission.USER_MANAGE}>
                <AdminUsers />
              </RequirePermission>
            }
          />
          <Route
            path="admin/categories"
            element={
              <RequirePermission permission={Permission.SETTINGS_MANAGE}>
                <AdminCategories />
              </RequirePermission>
            }
          />
          <Route
            path="admin/sla"
            element={
              <RequirePermission permission={Permission.SETTINGS_MANAGE}>
                <AdminSlaPolicy />
              </RequirePermission>
            }
          />
          {/* `AUDIT_READ`, not `SETTINGS_MANAGE`: reading the trail and changing the
            * deployment are different privileges, and the server enforces them apart. */}
          <Route
            path="admin/audit"
            element={
              <RequirePermission permission={Permission.AUDIT_READ}>
                <AdminAuditLog />
              </RequirePermission>
            }
          />
          {/* The Time Machine lives inside this page and hides itself unless demo mode is
            * effective, so the route needs only the settings permission. */}
          <Route
            path="admin/settings"
            element={
              <RequirePermission permission={Permission.SETTINGS_MANAGE}>
                <AdminSettings />
              </RequirePermission>
            }
          />
          <Route path="admin" element={<Navigate to="/admin/users" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

      <Toaster />
    </>
  );
}
