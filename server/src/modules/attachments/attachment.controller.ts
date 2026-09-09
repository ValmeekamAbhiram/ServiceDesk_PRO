/**
 * ServiceDesk Pro — attachment download.
 *
 * One endpoint. The service decides whether the caller may have the file; this only
 * streams it.
 *
 * `Content-Disposition: attachment` is deliberate for every type, images included.
 * Serving user-uploaded files inline lets an uploaded SVG or HTML file run script in
 * the app's origin, which is stored XSS with extra steps. A helpdesk gains nothing
 * from previewing files in place that is worth that.
 */

import fs from 'node:fs';
import type { Request, Response } from 'express';
import { requireActor } from '@/middleware';
import { handler } from '@/utils/handler';
import { paramsOf } from '@/utils/input';
import * as service from '@/modules/attachments/attachment.service';
import type { IdParams } from '@/modules/tickets/ticket.schema';

export const download = handler(async (req: Request, res: Response) => {
  const { id } = paramsOf<IdParams>(req);
  const file = await service.openForDownload(id, requireActor(req));

  res.setHeader('Content-Type', file.mimeType);
  /* Quoted and stripped of anything that could break out of the header. */
  const safe = file.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'download';
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  /* Private: these are per-user files, and a shared proxy cache must not keep them. */
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file.absolutePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
});
