require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const Fuse    = require('fuse.js');
const multer  = require('multer');
const crypto  = require('crypto');

async function shopifyAdmin(query, variables = {}) {
  const rawDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const token     = process.env.SHOPIFY_ADMIN_API_TOKEN;

  if (!rawDomain || !token) {
    throw new Error('SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_API_TOKEN env vars are not set.');
  }

  const domain = rawDomain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const url    = `https://${domain}/admin/api/2024-10/graphql.json`;

  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (netErr) {
    throw new Error(`Network error reaching Shopify Admin API at ${url}: ${netErr.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Shopify Admin API responded ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

async function stageUpload(filename, mimeType, fileSize) {
  const data = await shopifyAdmin(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
       stagedUploadsCreate(input: $input) {
         stagedTargets {
           url
           resourceUrl
           parameters { name value }
         }
         userErrors { field message }
       }
     }`,
    {
      input: [{
        resource:   'FILE',
        filename,
        mimeType,
        httpMethod: 'POST',
        fileSize:   String(fileSize),
      }],
    }
  );

  const errs = data.stagedUploadsCreate.userErrors;
  if (errs.length) throw new Error(`stagedUploadsCreate: ${errs[0].message}`);
  return data.stagedUploadsCreate.stagedTargets[0];
}

async function pushToStaged(target, buffer, mimeType, filename) {
  const fd = new FormData();
  target.parameters.forEach(({ name, value }) => fd.append(name, value));
  fd.append('file', new Blob([buffer], { type: mimeType }), filename);

  const res = await fetch(target.url, { method: 'POST', body: fd });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Staged push failed ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function registerFile(resourceUrl) {
  const data = await shopifyAdmin(
    `mutation fileCreate($files: [FileCreateInput!]!) {
       fileCreate(files: $files) {
         files {
           ... on GenericFile { id url }
           ... on MediaImage   { id image { url } }
         }
         userErrors { field message }
       }
     }`,
    {
      files: [{
        originalSource: resourceUrl,
        contentType:    'FILE',
      }],
    }
  );

  const errs = data.fileCreate.userErrors;
  if (errs.length) throw new Error(`fileCreate: ${errs[0].message}`);

  const file = data.fileCreate.files[0];
  return file?.url ?? file?.image?.url ?? resourceUrl;
}

const app  = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_HOSTNAMES = (process.env.SHOPIFY_STORE_URLS || '')
  .split(',')
  .map((s) => {
    s = s.trim().replace(/\/+$/, '');
    try { return new URL(s).hostname; } catch { return s; }
  })
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_HOSTNAMES.length === 0) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_HOSTNAMES.some(
      (h) => host === h || host === `www.${h}` || `www.${host}` === h
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
  })
);

app.use(express.json());

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml',
  'image/webp', 'application/pdf', 'application/postscript',
]);
const ALLOWED_EXT = /\.(png|jpe?g|svg|webp|pdf|ai|eps)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

const logos = require('./logos');

const fuseOptions = {
    includeScore: true,
    threshold: 0.4,
    keys: ['company']
};

const fuse = new Fuse(logos, fuseOptions);

const { handleLiveViewsRequest } = require('./live-views');

app.get('/api/live-views', handleLiveViewsRequest);
app.get('/api/live-views/:productId', handleLiveViewsRequest);
app.post('/api/live-views', handleLiveViewsRequest);

app.get('/api/shopify-check', async (_req, res) => {
  const rawDomain = process.env.SHOPIFY_STORE_DOMAIN || '';
  const token     = process.env.SHOPIFY_ADMIN_API_TOKEN || '';
  const domain    = rawDomain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  const info = {
    domain_raw:       rawDomain,
    domain_cleaned:   domain,
    domain_ends_with: domain.endsWith('.myshopify.com'),
    token_present:    Boolean(token),
    token_prefix:     token ? token.slice(0, 6) + '…' : null,
  };

  try {
    const data = await shopifyAdmin(`{ shop { name myshopifyDomain } }`);
    return res.json({ ok: true, ...info, shop: data.shop });
  } catch (err) {
    return res.status(500).json({ ok: false, ...info, error: err.message });
  }
});

app.get('/api/logos', (req, res) => {
    res.json({
        success: true,
        count: logos.length,
        data: logos
    });
});

app.get('/api/logos/:companyName', (req, res) => {
    const query = req.params.companyName;

    const results = fuse.search(query);

    if (results.length > 0) {
        const bestMatch = results[0].item;

        res.json({
            success: true,
            confidenceScore: results[0].score,
            data: bestMatch
        });
    } else {
        res.status(404).json({ success: false, message: "Company logo not found" });
    }
});

app.post('/api/upload-artwork', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  const { buffer, originalname, mimetype, size } = req.file;

  try {
    const target = await stageUpload(originalname, mimetype, size);

    await pushToStaged(target, buffer, mimetype, originalname);

    const cdnUrl = await registerFile(target.resourceUrl);

    console.log(`[upload-artwork] stored on Shopify CDN: ${cdnUrl} (${size} bytes)`);

    return res.status(200).json({
      url:      cdnUrl,
      filename: originalname,
      size,
      type:     mimetype,
    });
  } catch (err) {
    console.error('[upload-artwork] error:', err.message, err.stack);
    return res.status(500).json({
      error: err.message || 'Upload failed. Please try again or email your artwork after checkout.',
    });
  }
});

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(422).json({ error: 'File is too large. Maximum size is 20 MB.' });
  }
  if (err.message?.startsWith('File type not allowed')) {
    return res.status(422).json({ error: err.message });
  }
  console.error('[server error]', err);
  return res.status(500).json({ error: 'Internal server error.' });
});

function verifyWebhookHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  try {
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');
    const a = Buffer.from(computed);
    const b = Buffer.from(hmacHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

app.post(
  '/api/webhooks/order-created',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    if (!verifyWebhookHmac(req.body, hmac)) {
      console.warn('[webhook] rejected — invalid HMAC');
      return res.status(401).send('Unauthorized');
    }

    res.status(200).send('OK');

    let order;
    try {
      order = JSON.parse(req.body.toString());
    } catch {
      console.error('[webhook] could not parse order JSON');
      return;
    }

    const artworkLines = [];
    for (const item of order.line_items ?? []) {
      const prop = (name) =>
        (item.properties ?? []).find((p) => p.name === name)?.value ?? null;

      const artworkUrl = prop('Artwork URL');
      if (!artworkUrl) continue;

      const parts = [`• ${item.name} (qty ${item.quantity})`];
      const position = prop('Logo Position');
      const decoType = prop('Decoration Type');
      const filename  = prop('Artwork Filename');
      const notes     = prop('Decoration Notes');

      if (decoType) parts.push(`  Decoration : ${decoType}`);
      if (position) parts.push(`  Position   : ${position}`);
      if (filename) parts.push(`  Filename   : ${filename}`);
      if (notes)    parts.push(`  Notes      : ${notes}`);
      parts.push(`  Artwork    : ${artworkUrl}`);

      artworkLines.push(parts.join('\n'));
    }

    if (artworkLines.length === 0) {
      console.log(`[webhook] order #${order.order_number} — no artwork properties, skipping`);
      return;
    }

    const section   = `━━ Artwork Files ━━\n${artworkLines.join('\n\n')}`;
    const existing  = (order.note ?? '').trim();
    const newNote   = existing ? `${existing}\n\n${section}` : section;

    try {
      const data = await shopifyAdmin(
        `mutation orderUpdate($input: OrderInput!) {
           orderUpdate(input: $input) {
             order { id orderNumber note }
             userErrors { field message }
           }
         }`,
        { input: { id: `gid://shopify/Order/${order.id}`, note: newNote } }
      );

      const errs = data.orderUpdate.userErrors;
      if (errs.length) {
        console.error(`[webhook] orderUpdate userErrors for #${order.order_number}:`, errs);
      } else {
        console.log(`[webhook] order #${order.order_number} note updated with ${artworkLines.length} artwork link(s)`);
      }
    } catch (err) {
      console.error(`[webhook] failed to update order #${order.order_number}:`, err.message);
    }
  }
);

// ---------------------------------------------------------------------------
// TIERED VOLUME PRICING ENDPOINTS
// ---------------------------------------------------------------------------
const {
  DEFAULT_TIERS,
  EXCLUDED_VENDORS,
  calculateCartDiscounts
} = require("./discount-rules");

const path = require("path");

// Serve storefront JS script
app.get(["/volume-pricing-storefront.js", "/api/volume-pricing-storefront.js"], (req, res) => {
  res.sendFile(path.join(__dirname, "volume-pricing-storefront.js"));
});

// 1. Tiers endpoint
app.get(["/api/volume-pricing/tiers", "/api/tiers"], (req, res) => {
  console.log(`[VolumePricing API] GET /tiers requested`);
  res.json({
    success: true,
    tiers: DEFAULT_TIERS,
    excludedVendors: EXCLUDED_VENDORS
  });
});

// 2. Calculate volume pricing for cart
app.post(["/api/volume-pricing/calculate", "/api/calculate"], (req, res) => {
  try {
    const { items, customTiers } = req.body;
    console.log(`[VolumePricing API] POST /calculate requested with ${items?.length || 0} item(s)`);

    if (!items || !Array.isArray(items)) {
      console.warn(`[VolumePricing API] Invalid payload received in /calculate:`, req.body);
      return res.status(400).json({
        success: false,
        error: "Invalid request payload. Expected { items: [...] }"
      });
    }

    const tiers = Array.isArray(customTiers) && customTiers.length > 0 
      ? customTiers 
      : DEFAULT_TIERS;

    const result = calculateCartDiscounts({ items }, tiers);
    console.log(`[VolumePricing API] Discount calculation complete. Applied: ${result.applied}, Total discount: £${result.totalDiscountAmount}`);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("[VolumePricing API Error] Error calculating discount:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error while calculating discount"
    });
  }
});

// 3. Draft Order Checkout endpoint
app.post(["/api/volume-pricing/create-checkout", "/api/create-checkout"], async (req, res) => {
  const shop = process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_SHOP_DOMAIN || req.body.shop;
  const accessToken = process.env.SHOPIFY_ADMIN_API_TOKEN;

  const { items, customTiers, note, customer } = req.body;

  console.log(`[VolumePricing API] POST /create-checkout requested for shop: ${shop}`);
  console.log(`[VolumePricing API] Items payload (${items?.length || 0} items):`, JSON.stringify(items));

  if (!items || !Array.isArray(items) || items.length === 0) {
    console.warn(`[VolumePricing API] Empty or invalid items array in /create-checkout`);
    return res.status(400).json({
      success: false,
      error: "Invalid request payload. Expected non-empty items array."
    });
  }

  try {
    const calculation = calculateCartDiscounts({ items }, customTiers);
    console.log(`[VolumePricing API] Calculation summary: Applied=${calculation.applied}, TotalDiscount=£${calculation.totalDiscountAmount}`);

    const draftLineItems = calculation.items.map((item) => {
      const lineItem = {
        quantity: item.quantity
      };

      if (item.id && !isNaN(Number(item.id))) {
        lineItem.variant_id = Number(item.id);
      } else if (item.variant_id && !isNaN(Number(item.variant_id))) {
        lineItem.variant_id = Number(item.variant_id);
      } else {
        lineItem.title = item.title || item.name || `Product (${item.id})`;
      }

      // Set unit price directly to final calculated unit price (discounted garment base + decoration fees)
      if (item.discountedUnitPrice !== undefined && item.discountedUnitPrice > 0) {
        lineItem.price = item.discountedUnitPrice.toFixed(2);
      } else if (item.price !== undefined && item.price > 0) {
        lineItem.price = Number(item.price).toFixed(2);
      }

      if (item.properties) {
        lineItem.properties = Array.isArray(item.properties)
          ? item.properties
          : Object.entries(item.properties).map(([name, value]) => ({ name, value }));
      }

      return lineItem;
    });

    if (!shop || !accessToken) {
      console.warn(`[VolumePricing API Warning] Missing shop domain or access token. Returning fallback calculation response.`);
      return res.json({
        success: true,
        mode: "fallback",
        calculation,
        message: "API keys not set. Calculated payload returned."
      });
    }

    const shopUrl = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
    console.log(`[VolumePricing API] Calling Shopify Admin API draft_orders.json on ${shopUrl}...`);

    const response = await fetch(`https://${shopUrl}/admin/api/2024-10/draft_orders.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({
        draft_order: {
          line_items: draftLineItems,
          note: note || "Created via Tiered Volume Pricing API",
          customer: customer || undefined,
          use_customer_default_address: true
        }
      })
    });

    const data = await response.json();

    if (data.draft_order && data.draft_order.invoice_url) {
      console.log(`[VolumePricing API Success] Draft Order Created! ID: ${data.draft_order.id}, Invoice URL: ${data.draft_order.invoice_url}`);
      return res.json({
        success: true,
        mode: "draft_order",
        checkoutUrl: data.draft_order.invoice_url,
        draftOrderId: data.draft_order.id,
        calculation
      });
    } else {
      console.error("[VolumePricing API Error] Shopify Draft Order Creation Error:", JSON.stringify(data));
      return res.status(400).json({
        success: false,
        error: "Failed to create Shopify Draft Order",
        shopifyErrors: data.errors || data
      });
    }
  } catch (error) {
    console.error("[VolumePricing API Exception] Error creating checkout:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error while creating checkout: " + error.message
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

module.exports = app;