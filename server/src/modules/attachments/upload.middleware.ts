/**
 * ServiceDesk Pro — file upload middleware.
 *
 * One multer instance, configured once, wrapped so that its errors arrive at the
 * error handler as ordinary `AppError`s instead of multer's own shapes.
 *
 * The validation is deliberately three-layered, because a filename is attacker
 * input and each layer catches what the others miss:
 *
 *   1. **size** — multer's own `limits.fileSize`, enforced while streaming, so an
 *      oversized upload is cut off rather than buffered and then refused;
 *   2. **MIME type** — an allow-list, never a deny-list. A deny-list is a promise
 *      to have thought of every dangerous type, which nobody can keep;
 *   3. **extension**, checked separately *and* cross-checked against the MIME type.
 *      `report.pdf.exe` passes a naive extension check and `payload.png` claiming
 *      `application/x-msdownload` passes a naive MIME check; requiring the two to
 *      agree rejects both.
 *
 * The name on disk is generated here and never derived from the client's filename,
 * so path traversal is closed at the source rather than sanitised after the fact.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer, { MulterError } from 'multer';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '@/config/env';
import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  UploadRejectedError,
} from '@/utils/errors';

/**
 * MIME type → the extensions it may legitimately carry. Being a map rather than
 * two lists is what makes the cross-check possible.
 */
const ALLOWED: Record<string, readonly string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.log'],
  'text/csv': ['.csv'],
  'application/zip': ['.zip'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED);
/** Ready for an `<input accept="...">`. */
export const ACCEPT_ATTRIBUTE = [...ALLOWED_MIME_TYPES, ...Object.values(ALLOWED).flat()].join(',');

/** Files per request. More than a handful in one go is a client bug, not a use case. */
const MAX_FILES = 5;

/** Created eagerly: a missing directory should fail at boot, not on the first upload. */
fs.mkdirSync(env.uploadDir, { recursive: true });

/** `.tar.gz` is two extensions; only the last one decides how a file is opened. */
function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

function storedNameFor(extension: string): string {
  /* Random rather than sequential: a predictable name would let anyone who can
   * reach the download route enumerate other people's files. */
  return `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${extension}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, done) => done(null, env.uploadDir),
  filename: (_req, file, done) => done(null, storedNameFor(extensionOf(file.originalname))),
});

const upload = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: MAX_FILES, fields: 20 },
  fileFilter: (_req, file, done) => {
    const permitted = ALLOWED[file.mimetype];
    if (!permitted) {
      done(new UnsupportedMediaTypeError(file.mimetype, ALLOWED_MIME_TYPES));
      return;
    }
    const extension = extensionOf(file.originalname);
    if (!extension) {
      done(new UploadRejectedError('That file has no extension, so its type cannot be confirmed.'));
      return;
    }
    /* The cross-check. Either field alone can be forged; agreeing is harder. */
    if (!permitted.includes(extension)) {
      done(
        new UploadRejectedError(
          `A ${file.mimetype} file cannot have a "${extension}" extension.`,
          { mimeType: file.mimetype, extension, expected: permitted }
        )
      );
      return;
    }
    done(null, true);
  },
});

/**
 * Multer reports its own refusals as `MulterError`, which the error handler would
 * otherwise render as a 500. Translating here keeps the mapping in one place and
 * means every route gets the same message for the same mistake.
 */
function translate(error: unknown): unknown {
  if (!(error instanceof MulterError)) return error;
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return new PayloadTooLargeError(env.maxUploadBytes);
    case 'LIMIT_FILE_COUNT':
      return new UploadRejectedError(`Please attach at most ${MAX_FILES} files at a time.`);
    case 'LIMIT_UNEXPECTED_FILE':
      return new UploadRejectedError(`Unexpected file field "${error.field}".`);
    default:
      return new UploadRejectedError('That upload could not be accepted.', { code: error.code });
  }
}

/**
 * `field` is the form field name. Uploads are always optional at this layer — a
 * ticket with no attachment is the common case, and whether a file is *required*
 * is a per-route question the route answers itself.
 */
export function acceptFiles(field = 'files'): RequestHandler {
  const inner = upload.array(field, MAX_FILES);
  return (req: Request, res: Response, next: NextFunction) => {
    inner(req, res, (error: unknown) => next(error ? translate(error) : undefined));
  };
}

/** The same, for routes that take exactly one file. */
export function acceptFile(field = 'file'): RequestHandler {
  const inner = upload.single(field);
  return (req: Request, res: Response, next: NextFunction) => {
    inner(req, res, (error: unknown) => next(error ? translate(error) : undefined));
  };
}

/** Normalises `req.file` and `req.files` into one list, whichever variant ran. */
export function uploadedFiles(req: Request): Express.Multer.File[] {
  if (Array.isArray(req.files)) return req.files;
  return req.file ? [req.file] : [];
}

/**
 * Deletes files multer already wrote. Call this when a request fails *after* the
 * upload succeeded — otherwise a rejected ticket leaves its attachment on disk
 * forever, referenced by nothing.
 */
export async function discardFiles(files: readonly Express.Multer.File[]): Promise<void> {
  await Promise.all(
    files.map((file) => fs.promises.unlink(file.path).catch(() => undefined))
  );
}

/**
 * Deletes whatever multer wrote if the request ends up failing.
 *
 * Multer runs before validation and before the service, so by the time a request is
 * rejected the bytes are already on disk. Without this, every failed submit leaves a
 * file nothing references — and the one thing worse than a full disk is a full disk
 * of files nobody can account for.
 *
 * Hooking `finish` rather than doing it in the error handler covers every failure
 * path at once: a validation error, a service error, a permission check, or a
 * handler that simply returns a 4xx.
 */
export function cleanupOnFailure(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (res.statusCode < 400) return;
      const files = uploadedFiles(req);
      if (files.length > 0) void discardFiles(files);
    });
    next();
  };
}
