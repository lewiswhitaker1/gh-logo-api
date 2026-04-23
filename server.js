const express = require('express');
const cors    = require('cors');
const Fuse    = require('fuse.js');
const multer  = require('multer');
const crypto  = require('crypto');

// ── Shopify Admin API helpers ─────────────────────────────────────────────────
// Required env vars (set in Vercel dashboard):
//   SHOPIFY_STORE_DOMAIN     e.g.  grouphoodies.myshopify.com
//   SHOPIFY_ADMIN_API_TOKEN  from Shopify Admin → Apps → Develop apps →
//                            create a private app with write_files + read_files scopes

async function shopifyAdmin(query, variables = {}) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token  = process.env.SHOPIFY_ADMIN_API_TOKEN;

  if (!domain || !token) {
    throw new Error('SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_API_TOKEN env vars are not set.');
  }

  const res = await fetch(
    `https://${domain}/admin/api/2024-10/graphql.json`,
    {
      method:  'POST',
      headers: {
        'Content-Type':             'application/json',
        'X-Shopify-Access-Token':   token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  if (!res.ok) throw new Error(`Shopify Admin API responded ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// Step 1 – Ask Shopify for a pre-signed staging URL
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

// Step 2 – Push the file to Shopify's staging bucket (S3 / GCS)
async function pushToStaged(target, buffer, mimeType, filename) {
  const fd = new FormData();
  // Shopify requires their signed parameters to be added first, file last
  target.parameters.forEach(({ name, value }) => fd.append(name, value));
  fd.append('file', new Blob([buffer], { type: mimeType }), filename);

  const res = await fetch(target.url, { method: 'POST', body: fd });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Staged push failed ${res.status}: ${body.slice(0, 300)}`);
  }
}

// Step 3 – Register the staged file in Shopify's Files section and get the CDN URL
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
  // GenericFile exposes .url; MediaImage exposes .image.url
  return file?.url ?? file?.image?.url ?? resourceUrl;
}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
// Reads SHOPIFY_STORE_URLS env var (comma-separated) so only your store can
// call these endpoints in production. Falls back to allowing all in dev.
const ALLOWED_ORIGINS = (process.env.SHOPIFY_STORE_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. Postman, server-to-server)
      if (!origin) return callback(null, true);
      // Allow all in dev / if no origins configured
      if (ALLOWED_ORIGINS.length === 0) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
  })
);

// ── Multer — in-memory storage for Vercel Blob uploads ────────────────────────
const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml',
  'image/webp', 'application/pdf', 'application/postscript',
]);
const ALLOWED_EXT = /\.(png|jpe?g|svg|webp|pdf|ai|eps)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB (requires Vercel Pro; Hobby cap is 4.5 MB)
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

// Extracted logo data from the provided HTML
const logos = [
    { company: "ADC", url: "https://www.pencarrie.com/storage/phoenix/brands/e6iKTlXTcXCqF3hgLBsA5LvoblUyBvyUIhidkxRK.jpg" },
    { company: "Anthem", url: "https://www.pencarrie.com/storage/phoenix/brands/2uvnvDjUbGneMO0asopLsjSfCuB5uIDi5w3duDkI.jpeg" },
    { company: "AWDis", url: "https://www.pencarrie.com/storage/phoenix/brands/2tonGcZ9LoNqlx5K7NNj8aJFAMyOVPLF5ckXbWD4.jpg" },
    { company: "AWDis Academy", url: "https://www.pencarrie.com/storage/phoenix/brands/ljKkbJlYYLtnZl756TgYGnt2juEk0NUrrrASD0PI.jpeg" },
    { company: "Babybugz", url: "https://www.pencarrie.com/storage/phoenix/brands/un40vaCVBNke9ywAXD6nHGvH3CoawXdLzEeVeNyi.jpg" },
    { company: "BagBase", url: "https://www.pencarrie.com/storage/phoenix/brands/sWx7kj0pkDABXfF7EBnjM1MbyUYUh5B69QHB2Ql2.jpeg" },
    { company: "Beechfield", url: "https://www.pencarrie.com/storage/phoenix/brands/1Ug3X8SGp1veWxsAy1IZ5LVdpmQoC1fT2gcslTbx.jpeg" },
    { company: "Bella+Canvas", url: "https://www.pencarrie.com/storage/phoenix/brands/6ThuRZtYguzXqSuE2ngLDPtLCykKQbIH203hODob.jpeg" },
    { company: "Brand Lab", url: "https://www.pencarrie.com/storage/phoenix/brands/INRJBVzfbtLqrOFGkHawytVCUXpC6Wh7t7OBZ2yy.jpg" },
    { company: "Brook Taverner", url: "https://www.pencarrie.com/storage/phoenix/brands/rxuqWoj0zVLGFafcn2kFVDAD40SF6LR5hAWToBd6.jpg" },
    { company: "Canterbury", url: "https://www.pencarrie.com/storage/phoenix/brands/dTcuunqYdGkzdDAaAWLP8xGPb562lnQUkoRwgubq.jpg" },
    { company: "Comfort Grip", url: "https://www.pencarrie.com/storage/phoenix/brands/CyzgvNQ0nymt9eLvisSLsdas24skHGKSFeUvoaB3.jpeg" },
    { company: "Craghoppers", url: "https://www.pencarrie.com/storage/phoenix/brands/xjcuKxKJ4qqESJgD9j6p8cQzfFWeV77cLOs2sFxZ.jpg" },
    { company: "Dennys", url: "https://www.pencarrie.com/storage/phoenix/brands/fwfyuZcVoThomVzWeVZi2NoZnQp8G191WmZ6KrdE.jpeg" },
    { company: "Ecologie", url: "https://www.pencarrie.com/storage/phoenix/brands/1mTKOmigsosJ5ZMXkfIIwBXmb8qxrQ77xX854in2.jpeg" },
    { company: "Finden & Hales", url: "https://www.pencarrie.com/storage/phoenix/brands/u0bXgPoW9whqojVOQBIjBFW7qlqlPoDo4x33V6xC.jpeg" },
    { company: "Flexfit", url: "https://www.pencarrie.com/storage/phoenix/brands/fBaN2gnlaE0r8vAqTpgIMbSHgL54BW2ABLnyT9ot.jpeg" },
    { company: "Front Row", url: "https://www.pencarrie.com/storage/phoenix/brands/pOtZrk0mS97FRK0ubyRwB0Ia5SROqGUOepI3lwCe.jpg" },
    { company: "Fruit of the Loom", url: "https://www.pencarrie.com/storage/phoenix/brands/rBINAYEDBk5aGdUXwl3QoISCPmg4fjk95xg98az4.jpg" },
    { company: "Gildan", url: "https://www.pencarrie.com/storage/phoenix/brands/Fet72DUN7iJm3xpVj2gcHMF8cxvqdHrea7tKe5Jh.jpeg" },
    { company: "Henbury", url: "https://www.pencarrie.com/storage/phoenix/brands/OnSbLu3Ppn2K8mRfLM03sMFsv21LcJY22Kdlvj0X.jpeg" },
    { company: "Joseph Alan", url: "https://www.pencarrie.com/storage/phoenix/brands/YM7MFVH2j1zYRGJP8S8PIX0q5QqDUBupbK5XdFMN.jpeg" },
    { company: "Just Cool", url: "https://www.pencarrie.com/storage/phoenix/brands/d0BgGBrXku2P4FJTj7P6xz7ElSEzZrtATccrtkBY.jpeg" },
    { company: "Just Hoods", url: "https://www.pencarrie.com/storage/phoenix/brands/ikaGj0mdJI40Ie38QK0ZKIrZtWmtEoZ7iVeYNyCT.jpeg" },
    { company: "Just Polos", url: "https://www.pencarrie.com/storage/phoenix/brands/X9ek5MBS7qwx5tGlcC5H8fL2r942lJmcaVXvPUvh.jpeg" },
    { company: "Just Ts", url: "https://www.pencarrie.com/storage/phoenix/brands/6CYYkWIyW4lWKkIaAoEhc6mkB4Hc3TSx8exrznZZ.jpeg" },
    { company: "K-UP", url: "https://www.pencarrie.com/storage/phoenix/brands/o4lbSfigEf6qydYHSFToCzOcZbDE2zpQ04jYv13A.jpeg" },
    { company: "Kariban", url: "https://www.pencarrie.com/storage/phoenix/brands/2cbL6EDgJQBHa2oS0QTc5Ibcb3GRYFeFiuScIVrW.jpg" },
    { company: "Kimood", url: "https://www.pencarrie.com/storage/phoenix/brands/vWBIqKLQ3jIDLTtKDAQzB1bBm72PJy2SLRcaGxPt.jpg" },
    { company: "Kustom Kit", url: "https://www.pencarrie.com/storage/phoenix/brands/FvZ1wOez9aDllqnlqBAuJv35YqO2sTfbWbmfnSxQ.jpg" },
    { company: "Larkwood", url: "https://www.pencarrie.com/storage/phoenix/brands/LLrbCVvAOcyJpMVMOtvgCGmFcvEFusSS89OdAu4Q.jpeg" },
    { company: "Le Chef", url: "https://www.pencarrie.com/storage/phoenix/brands/6h1BgioZs4uugGbuL97w5e9AZKE6mrvXcqm5su7o.jpeg" },
    { company: "Madeira", url: "https://www.pencarrie.com/storage/phoenix/brands/zPBz2WMKfkY75AJnC8inxNMTMio9haZHLJjAdJyl.jpg" },
    { company: "Magic Touch", url: "https://www.pencarrie.com/storage/phoenix/brands/ZhuuKRMgNu5vsSrTCHWnX27DjSwsw5gXlwf727n3.jpeg" },
    { company: "Mantis", url: "https://www.pencarrie.com/storage/phoenix/brands/vR2A4UiwLd1fRDDTtThFCSD94v1mRbOCE0PnUiA0.jpeg" },
    { company: "Mumbles", url: "https://www.pencarrie.com/storage/phoenix/brands/aI4RVsRUEpEV7zJhfHdFEc7KCPFiXq2e7Ht1rgpt.jpeg" },
    { company: "Native Spirit", url: "https://www.pencarrie.com/storage/phoenix/brands/9M8AKkySxEYPIqZ0qkdSFY4daeyeXMtxbGDslqDl.jpg" },
    { company: "Neoblu", url: "https://www.pencarrie.com/storage/phoenix/brands/ECJX44fYo2dH6vTFTvFT2urey4zOhBeq2W2xJE5G.jpg" },
    { company: "Onna by Premier", url: "https://www.pencarrie.com/storage/phoenix/brands/TmT5q4fTjQv9uOYaQvIGYMM1LPAw9Iy3IbWQYAPL.jpg" },
    { company: "Portwest", url: "https://www.pencarrie.com/storage/phoenix/brands/4VX28BiIvvMjkW2FiJARPLbjX5LeU3ZoJwYXNJda.jpg" },
    { company: "Premier", url: "https://www.pencarrie.com/storage/phoenix/brands/1nubfb0c7zslQ86lV6cmOxjwHqbcLjMXv2HpBw3o.jpeg" },
    { company: "PRO RTX", url: "https://www.pencarrie.com/storage/phoenix/brands/ctvroJyZOU1Ey4HdcO6qIFgfG66rPQKE0QkYoST0.jpeg" },
    { company: "PRO RTX High Vis", url: "https://www.pencarrie.com/storage/phoenix/brands/N9LTAj7wPcJ0E6Ncp8cmblDt2dewwullyBiu8J23.jpeg" },
    { company: "Kariban Proact", url: "https://www.pencarrie.com/storage/phoenix/brands/5jgfVuEsWxa3Kqa75vecVBMVexv6vn70a9k5IqZ4.jpeg" },
    { company: "Quadra", url: "https://www.pencarrie.com/storage/phoenix/brands/yO4Ow4tD8mSBQMkjP9SyXQCcZ6CP1eaaQ7bcpoBT.jpeg" },
    { company: "Ravine", url: "https://www.pencarrie.com/storage/phoenix/brands/P6LaR4fNHm9ZQwQmockHIzwmOkrM2BH7kNw5tkrv.jpg" },
    { company: "Reg. High Vis.", url: "https://www.pencarrie.com/storage/phoenix/brands/xlaHZ8vsV2iCnStt52VF26GBZMIcBUIn1qOaOrGQ.jpeg" },
    { company: "Regatta HM", url: "https://www.pencarrie.com/storage/phoenix/brands/kSF51VPa4ZZMaGZJ07AyQZhfVkDrb79bouSl42Qn.jpeg" },
    { company: "Regatta", url: "https://www.pencarrie.com/storage/phoenix/brands/CGSzCcTDnFVjyQQ5exxkWdYixRYc1GGiguD8zCEh.jpeg" },
    { company: "Reg. Safety F/W", url: "https://www.pencarrie.com/storage/phoenix/brands/kxklny1yvRhzvMvmpvkHJ2GCo75kt9z9AfmKlWMF.jpeg" },
    { company: "Result", url: "https://www.pencarrie.com/storage/phoenix/brands/RBOr6RTWCKH9QMQSMJsUmARbR85UhtZdRmB5Tmfu.jpeg" },
    { company: "Result Core", url: "https://www.pencarrie.com/storage/phoenix/brands/VBLKj6bTK1PRnG7zcLoGGC5DHV1IBT8Da1dru0Wh.jpeg" },
    { company: "Result Ess. Hygiene", url: "https://www.pencarrie.com/storage/phoenix/brands/qovW97WBieII3zgjKOkjLHNlD3N3L7tIKfJ9ncQh.jpeg" },
    { company: "Result Headwear", url: "https://www.pencarrie.com/storage/phoenix/brands/30pmJmwTUTO6A1XNPVPMoA6RKfyRtvv4SEWTk0mZ.jpeg" },
    { company: "Res. Gen. Recycled", url: "https://www.pencarrie.com/storage/phoenix/brands/gOwWKOHgZyf2AUS7SIe9UvaAfwbPtWgDftuPpAiN.jpg" },
    { company: "Result Safe-Guard", url: "https://www.pencarrie.com/storage/phoenix/brands/1GwTAlGvnymHFRCFGv3hXk1INaABawIAY20RaU5d.jpg" },
    { company: "Result Urban", url: "https://www.pencarrie.com/storage/phoenix/brands/kSoNyycXDnbHOBf5O9DFQHQApOnooIPNXK06YRB0.jpeg" },
    { company: "Result Winter Ess.", url: "https://www.pencarrie.com/storage/phoenix/brands/80KvArud26V4Jxc8i0VTcsxE5hdgqv21XZPrkSir.jpeg" },
    { company: "Result Work-Guard", url: "https://www.pencarrie.com/storage/phoenix/brands/K6MIoebUSqEmaU1lcFdWnunJ80NWuKp7xDCKBHqK.jpg" },
    { company: "Russell Athletic", url: "https://www.pencarrie.com/storage/phoenix/brands/VbKvbXYQ3noSwQcuyx0tOm7y56Jpw9uRuqZspuIh.jpg" },
    { company: "Russell Athletic Collection", url: "https://www.pencarrie.com/storage/phoenix/brands/pDGxgxMlqpIwjvS94WY8owSrT4RhyE3IuaEe6iSo.jpg" },
    { company: "SF Clothing", url: "https://www.pencarrie.com/storage/phoenix/brands/y2a7dTEN42JL7eUT5skP8AxHxLxGDTq8FZcH2bjq.jpg" },
    { company: "So Denim", url: "https://www.pencarrie.com/storage/phoenix/brands/ChnJ24NKNvUjsCFkS8X6GmMUMChmE6O1PcsFvZPa.jpeg" },
    { company: "SOLS", url: "https://www.pencarrie.com/storage/phoenix/brands/Epd6rZCLqjK3o4oDDsUNbtiRvHVFbdCRFnHsohYx.jpeg" },
    { company: "Spasso", url: "https://www.pencarrie.com/storage/phoenix/brands/YvFEbLITkfyi9pSfjeF1ndSzJ3a5zzH5eQkguw7F.jpg" },
    { company: "Spiro", url: "https://www.pencarrie.com/storage/phoenix/brands/YUfvUhqHkPPRih8WyxxT1WasSQzYubV0QbHWF2Lu.jpeg" },
    { company: "Splashmac", url: "https://www.pencarrie.com/storage/phoenix/brands/McIpLDo63UWY5JbugPt6KslhSuc2fhFcjbgovr9B.jpeg" },
    { company: "Stormtech", url: "https://www.pencarrie.com/storage/phoenix/brands/OPc0RAEaPqGFir584upppSavbRmZshFQXeNywKU3.jpg" },
    { company: "Supacolour", url: "https://www.pencarrie.com/img/supacolour.png" },
    { company: "Tee Jays", url: "https://www.pencarrie.com/storage/phoenix/brands/MFckIqCODEggtYrKH7Lae0ngNipe4JlXKillAXQy.jpeg" },
    { company: "Tombo", url: "https://www.pencarrie.com/storage/phoenix/brands/0mPtu0TiT9ctJTGVcCQc0BiUUb1ao4PocMwMnJLq.jpeg" },
    { company: "Towel City", url: "https://www.pencarrie.com/storage/phoenix/brands/1JyhNZFY67gHJ4vizDmIkwc7wX7a66xhv4Ek585z.jpeg" },
    { company: "Warrior", url: "https://www.pencarrie.com/storage/phoenix/brands/FCWiuIZIz7mjSG2Y7oO9IAffQKdMuXbD6IE0I8IS.jpeg" },
    { company: "Westford Mill", url: "https://www.pencarrie.com/storage/phoenix/brands/TWKqDfkt7q6qgw5aYbMd3ttUX3YxBB8eEBnBlmLn.jpg" },
    { company: "WK Designed To Work", url: "https://www.pencarrie.com/storage/phoenix/brands/PVx8gxkqrgwr6r1IMhAtLqhjiPN86kNHbGdDUwFK.jpg" },
    { company: "Xpres", url: "https://www.pencarrie.com/storage/phoenix/brands/WRQRCTx9Zk55fs5BF05k8Yp5FItcLgZWORsHEMaD.jpeg" },
    { company: "Yoko", url: "https://www.pencarrie.com/storage/phoenix/brands/oE81VRI18x6E7QjiS4P21aR0tAyf76RAjISfw0fA.jpeg" }
];

// Configure Fuse.js options
const fuseOptions = {
    // isCaseSensitive: false, // Default is false
    includeScore: true,
    // Threshold determines how "fuzzy" the search is. 
    // 0.0 requires a perfect match, 1.0 matches anything. 0.4 is a good sweet spot for typos.
    threshold: 0.4,
    keys: ['company'] // Tell Fuse to search within the 'company' property
};

// Initialize Fuse with your data and options
const fuse = new Fuse(logos, fuseOptions);

// Endpoint to retrieve all logos
app.get('/api/logos', (req, res) => {
    res.json({
        success: true,
        count: logos.length,
        data: logos
    });
});

// Updated fuzzy-search endpoint
app.get('/api/logos/:companyName', (req, res) => {
    const query = req.params.companyName;

    // Perform the fuzzy search
    const results = fuse.search(query);

    // Fuse returns an array of matches ordered by best match first
    if (results.length > 0) {
        // We grab the highest scoring match (index 0) and extract the actual item
        const bestMatch = results[0].item;

        res.json({
            success: true,
            confidenceScore: results[0].score, // Optional: Shows how close the match was (closer to 0 is better)
            data: bestMatch
        });
    } else {
        res.status(404).json({ success: false, message: "Company logo not found" });
    }
});

// ── POST /api/upload-artwork ──────────────────────────────────────────────────
// Receives a multipart file upload from the Shopify logo-customiser block,
// uploads it to Shopify's own CDN via the Admin API staged upload flow,
// and returns the permanent Shopify CDN URL.
//
// No external storage needed — files land in Shopify Admin → Content → Files.
//
// Required env vars in Vercel:
//   SHOPIFY_STORE_DOMAIN      grouphoodies.myshopify.com
//   SHOPIFY_ADMIN_API_TOKEN   from a private app with write_files scope
app.post('/api/upload-artwork', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  const { buffer, originalname, mimetype, size } = req.file;

  try {
    // 1. Get a pre-signed staging URL from Shopify
    const target = await stageUpload(originalname, mimetype, size);

    // 2. Upload the file directly to Shopify's staging bucket (S3/GCS)
    await pushToStaged(target, buffer, mimetype, originalname);

    // 3. Register the staged file → moves it to Shopify CDN and returns final URL
    const cdnUrl = await registerFile(target.resourceUrl);

    console.log(`[upload-artwork] stored on Shopify CDN: ${cdnUrl} (${size} bytes)`);

    return res.status(200).json({
      url:      cdnUrl,
      filename: originalname,
      size,
      type:     mimetype,
    });
  } catch (err) {
    console.error('[upload-artwork] error:', err.message);
    return res.status(500).json({
      error: err.message || 'Upload failed. Please try again or email your artwork after checkout.',
    });
  }
});

// Multer error handler (file too large, wrong type, etc.)
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

// ── POST /api/webhooks/order-created ─────────────────────────────────────────
// Triggered by Shopify when a new order is placed.
// Reads any artwork line item properties and appends them to the order note
// so they are visible immediately when opening the order in the admin.
//
// Setup:
//   1. Shopify Admin → Settings → Notifications → Webhooks
//      → Add webhook: Event = "Order creation"
//        URL = https://your-app.vercel.app/api/webhooks/order-created
//      → Copy the signing secret shown after saving.
//   2. Add to Vercel env vars:
//        SHOPIFY_WEBHOOK_SECRET   (the secret copied above)
//
// The route uses express.raw() so we get the unmodified body needed for
// HMAC verification — this must be registered before any JSON body-parser.

function verifyWebhookHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  try {
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');
    // timingSafeEqual needs same-length buffers
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
    // Always respond 200 quickly so Shopify doesn't retry unnecessarily —
    // we do the actual work after sending the response.
    const hmac = req.headers['x-shopify-hmac-sha256'];
    if (!verifyWebhookHmac(req.body, hmac)) {
      console.warn('[webhook] rejected — invalid HMAC');
      return res.status(401).send('Unauthorized');
    }

    // Acknowledge immediately
    res.status(200).send('OK');

    // Parse order payload
    let order;
    try {
      order = JSON.parse(req.body.toString());
    } catch {
      console.error('[webhook] could not parse order JSON');
      return;
    }

    // Collect artwork details from every line item that has an Artwork URL
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});