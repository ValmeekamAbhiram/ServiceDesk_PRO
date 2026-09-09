import type { Priority, SlaState, TicketStatus, AssetStatus, AssetType, ArticleStatus, Role, UserStatus } from '@shared/enums';
import {
  articleStatusMeta,
  assetStatusMeta,
  assetTypeMeta,
  priorityMeta,
  roleMeta,
  slaStateMeta,
  ticketStatusMeta,
  userStatusMeta,
} from '@shared/labels';
import { Badge } from '@/components/ui/Badge';

/**
 * One badge per enum, each reading its label and tone from `@shared/labels`.
 *
 * They are trivial wrappers and they earn their place by being the only way an enum
 * reaches the screen: no component spells out "In progress" or picks amber for at-risk,
 * so adding a status is a change to the shared map and nothing else.
 */

export const StatusBadge = ({ status, dot = true }: { status: TicketStatus; dot?: boolean }) => {
  const meta = ticketStatusMeta(status);
  return (
    <Badge tone={meta.tone} dot={dot}>
      {meta.label}
    </Badge>
  );
};

export const PriorityBadge = ({ priority }: { priority: Priority }) => {
  const meta = priorityMeta(priority);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};

export const SlaBadge = ({ state }: { state: SlaState }) => {
  const meta = slaStateMeta(state);
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
};

export const RoleBadge = ({ role }: { role: Role }) => {
  const meta = roleMeta(role);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};

export const UserStatusBadge = ({ status }: { status: UserStatus }) => {
  const meta = userStatusMeta(status);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};

export const AssetTypeBadge = ({ type }: { type: AssetType }) => {
  const meta = assetTypeMeta(type);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};

export const AssetStatusBadge = ({ status }: { status: AssetStatus }) => {
  const meta = assetStatusMeta(status);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};

export const ArticleStatusBadge = ({ status }: { status: ArticleStatus }) => {
  const meta = articleStatusMeta(status);
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
};
