/**
 * ServiceDesk Pro — warranty status for one asset.
 *
 * `warrantyDaysRemaining` is signed and computed on the server from the actor's clock,
 * so it moves with the demo Time Machine and there is no date arithmetic here to
 * disagree with it. Negative means the warranty has already lapsed.
 *
 * The thresholds are presentation-only — nothing is enforced on a lapsed warranty, it
 * is simply the thing somebody needs to notice before they promise a free repair.
 */

import type { AssetDto } from '@shared/types';
import { Badge } from '@/components/ui/Badge';

export function WarrantyChip({ asset }: { asset: Pick<AssetDto, 'warrantyDaysRemaining'> }) {
  const days = asset.warrantyDaysRemaining;

  if (days === null) return <span className="text-xs text-ink-subtle">Not recorded</span>;
  if (days < 0) {
    const ago = Math.abs(days);
    return <Badge tone="danger">Expired {ago === 1 ? 'yesterday' : `${ago} days ago`}</Badge>;
  }
  if (days === 0) return <Badge tone="danger">Expires today</Badge>;
  if (days <= 30) return <Badge tone="warning">{days} days left</Badge>;
  if (days <= 90) return <Badge tone="info">{days} days left</Badge>;
  return <Badge tone="success">{days} days left</Badge>;
}
