/**
 * Vercel Artwork Upload API
 * ─────────────────────────────────────────────────────────────────────────────
 * SETUP
 * 1. npm install @vercel/blob
 * 2. In Vercel dashboard → Storage → Create Blob store → link to this project
 * 3. Add environment variables in Vercel dashboard:
 *      BLOB_READ_WRITE_TOKEN   — auto-created when you link the Blob store
 *      SHOPIFY_STORE_URLS      — comma-separated list of allowed origins
 *                                e.g.  https://grouphoodies.co.uk,https://www.grouphoodies.co.uk
 *
 * COPY THIS FILE TO YOUR PROJECT
 * ─ Next.js App Router  →  app/api/upload-artwork/route.js   (this file, no changes needed)
 * ─ Next.js Pages Router → pages/api/upload-artwork.js       (see bottom of this file)
 * ─ Plain Express/Hono  → see bottom of this file
 *
 * THEN IN SHOPIFY
 * Set the "Artwork upload URL" block setting in the Logo Customiser block to:
 *   https://your-vercel-app.vercel.app/api/upload-artwork
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { put } from '@vercel/blob';

// ── Config ────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = (process.env.SHOPIFY_STORE_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp',
  'application/pdf',
  'application/postscript',       // .ai / .eps
  'image/x-eps',
]);

const ALLOWED_EXTENSIONS = /\.(png|jpe?g|svg|webp|pdf|ai|eps)$/i;

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// ── CORS helpers ──────────────────────────────────────────────────────────────

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length === 0) return true; // dev: allow all if not configured
  return ALLOWED_ORIGINS.some(
    (allowed) => origin === allowed || origin.endsWith(`.${new URL(allowed).hostname}`)
  );
}

function corsHeaders(origin) {
  const allowed = isOriginAllowed(origin);
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : (ALLOWED_ORIGINS[0] ?? '*'),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  };
}

// ── Route handlers (Next.js App Router) ──────────────────────────────────────

export async function OPTIONS(request) {
  const origin = request.headers.get('origin') ?? '';
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(request) {
  const origin  = request.headers.get('origin') ?? '';
  const headers = corsHeaders(origin);

  // Block disallowed origins in production
  if (ALLOWED_ORIGINS.length > 0 && !isOriginAllowed(origin)) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400, headers });
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'No file provided' }, { status: 400, headers });
  }

  // ── Validate ────────────────────────────────────────────────────────────────

  if (!ALLOWED_MIME_TYPES.has(file.type) && !ALLOWED_EXTENSIONS.test(file.name)) {
    return Response.json(
      { error: `File type not allowed. Please upload PNG, JPEG, SVG, PDF, AI, or EPS.` },
      { status: 422, headers }
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { error: `File is too large. Maximum size is ${MAX_SIZE_BYTES / (1024 * 1024)} MB.` },
      { status: 422, headers }
    );
  }

  // ── Upload to Vercel Blob ────────────────────────────────────────────────────

  try {
    const shopDomain  = (formData.get('shop') ?? 'unknown').replace(/[^a-z0-9.-]/gi, '_');
    const timestamp   = Date.now();
    const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const pathname    = `artwork/${shopDomain}/${timestamp}-${safeName}`;

    const blob = await put(pathname, file, {
      access:            'public',
      addRandomSuffix:   false,
      contentType:       file.type || 'application/octet-stream',
    });

    console.info(`[upload-artwork] stored ${blob.pathname} (${file.size} bytes) from ${origin}`);

    return Response.json(
      {
        url:       blob.url,
        pathname:  blob.pathname,
        filename:  file.name,
        size:      file.size,
        type:      file.type,
      },
      { status: 200, headers }
    );
  } catch (err) {
    console.error('[upload-artwork] Blob put error:', err);
    return Response.json(
      { error: 'Upload failed. Please try again or email your artwork after checkout.' },
      { status: 500, headers }
    );
  }
}

/*
 ═══════════════════════════════════════════════════════════════════════════════
  PAGES ROUTER VERSION  (pages/api/upload-artwork.js)
  Copy everything below this comment into that file instead.
 ═══════════════════════════════════════════════════════════════════════════════

import { put } from '@vercel/blob';
import formidable from 'formidable';
import fs from 'fs';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const origin  = req.headers.origin ?? '';
  const headers = corsHeaders(origin);  // reuse helper above

  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
  const [fields, files] = await form.parse(req);
  const file = Array.isArray(files.file) ? files.file[0] : files.file;

  if (!file) return res.status(400).json({ error: 'No file provided' });

  const stream   = fs.createReadStream(file.filepath);
  const pathname = `artwork/${Date.now()}-${file.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const blob     = await put(pathname, stream, { access: 'public', contentType: file.mimetype });

  return res.status(200).json({ url: blob.url, filename: file.originalFilename });
}
*/
