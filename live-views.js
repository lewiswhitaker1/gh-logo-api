const crypto = require('crypto');

// In-memory cache for tracking client viewer counts: key -> { count: number, timestamp: number }
const viewingCache = new Map();
const TTL_MS = 5 * 60 * 1000; // 5 minutes window

/**
 * Clean up expired cache entries older than 10 minutes to prevent memory leaks
 */
function sweepExpiredEntries() {
  const now = Date.now();
  for (const [key, record] of viewingCache.entries()) {
    if (now - record.timestamp > TTL_MS * 2) {
      viewingCache.delete(key);
    }
  }
}

/**
 * Extract client IP address from proxy headers or socket
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Generate a consistent SHA-256 fingerprint hash for the client
 */
function getClientFingerprint(req) {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || 'unknown-ua';
  const acceptLang = req.headers['accept-language'] || '';
  const customFp = req.headers['x-client-fingerprint'] || req.query?.fp || '';
  
  const raw = `${ip}::${ua}::${acceptLang}::${customFp}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * Get or update the viewer count for a given client fingerprint and product ID
 */
function getViewingCount(fingerprint, productId) {
  sweepExpiredEntries();
  
  const key = `${fingerprint}:${productId}`;
  const now = Date.now();
  const existing = viewingCache.get(key);
  
  let viewingCount;
  let isCached = false;
  let ttlSecondsRemaining = Math.floor(TTL_MS / 1000);
  
  if (existing && (now - existing.timestamp) <= TTL_MS) {
    // Within 5 minutes: vary previous count by +-3, clamped to [1, 20]
    const delta = Math.floor(Math.random() * 7) - 3; // Integer between -3 and +3
    viewingCount = Math.min(20, Math.max(1, existing.count + delta));
    isCached = true;
    ttlSecondsRemaining = Math.max(0, Math.floor((TTL_MS - (now - existing.timestamp)) / 1000));
    
    // Update count while keeping initial timestamp of 5-minute window
    viewingCache.set(key, { count: viewingCount, timestamp: existing.timestamp });
  } else {
    // New or expired session: random integer between 1 and 20
    viewingCount = Math.floor(Math.random() * 20) + 1;
    viewingCache.set(key, { count: viewingCount, timestamp: now });
  }
  
  return { viewingCount, isCached, ttlSecondsRemaining };
}

/**
 * Main Express route handler for live views
 */
function handleLiveViewsRequest(req, res) {
  const productId = req.query.productId || req.query.id || req.params.productId || req.body?.productId || req.body?.id;
  
  if (!productId) {
    return res.status(400).json({
      success: false,
      error: 'Product ID is required. Pass ?productId=<id> or ?id=<id> in query parameters or request body.'
    });
  }
  
  const fingerprint = getClientFingerprint(req);
  const { viewingCount, isCached, ttlSecondsRemaining } = getViewingCount(fingerprint, String(productId));
  
  return res.json({
    success: true,
    productId: String(productId),
    viewingCount,
    isCached,
    ttlSecondsRemaining,
    clientIp: getClientIp(req)
  });
}

module.exports = {
  handleLiveViewsRequest,
  getViewingCount,
  getClientFingerprint,
  getClientIp,
  viewingCache
};
