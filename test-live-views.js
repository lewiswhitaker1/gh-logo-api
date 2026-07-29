const { handleLiveViewsRequest, getViewingCount, getClientFingerprint, viewingCache } = require('./live-views');

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    }
  };
  return res;
}

function mockReq({ query = {}, params = {}, body = {}, headers = {} }) {
  return {
    query,
    params,
    body,
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0',
      'x-forwarded-for': '203.0.113.195',
      ...headers
    },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('--- RUNNING LIVE-VIEWS API TESTS ---\n');

// Test 1: Missing Product ID returns 400
{
  const req = mockReq({ query: {} });
  const res = mockRes();
  handleLiveViewsRequest(req, res);
  assert(res.statusCode === 400, 'Returns HTTP 400 when productId is missing');
  assert(res.jsonData.success === false, 'success is false when productId is missing');
}

// Test 2: Initial call returns count between 1 and 20
{
  viewingCache.clear();
  const req = mockReq({ query: { productId: 'hoodie-123' } });
  const res = mockRes();
  handleLiveViewsRequest(req, res);
  
  assert(res.statusCode === 200, 'Returns HTTP 200 for valid productId');
  assert(res.jsonData.success === true, 'Response success is true');
  assert(res.jsonData.productId === 'hoodie-123', 'Returns correct productId string');
  assert(typeof res.jsonData.viewingCount === 'number', 'viewingCount is a number');
  assert(res.jsonData.viewingCount >= 1 && res.jsonData.viewingCount <= 20, `viewingCount (${res.jsonData.viewingCount}) is between 1 and 20`);
  assert(res.jsonData.isCached === false, 'Initial call isCached is false');
}

// Test 3: Subsequent calls within 5 mins vary count by +-3
{
  viewingCache.clear();
  const req = mockReq({ query: { productId: 'hoodie-123' } });
  const res1 = mockRes();
  handleLiveViewsRequest(req, res1);
  const count1 = res1.jsonData.viewingCount;
  
  let prevCount = count1;
  let allWithinVariance = true;

  for (let i = 1; i <= 10; i++) {
    const res = mockRes();
    handleLiveViewsRequest(req, res);
    const currCount = res.jsonData.viewingCount;
    const diff = Math.abs(currCount - prevCount);
    
    if (diff > 3 || currCount < 1 || currCount > 20 || !res.jsonData.isCached) {
      allWithinVariance = false;
      console.error(`  Iter ${i}: prev=${prevCount}, curr=${currCount}, diff=${diff}, isCached=${res.jsonData.isCached}`);
    }
    prevCount = currCount;
  }
  
  assert(allWithinVariance, '10 rapid requests stayed within +-3 variance range [1, 20] and set isCached=true');
}

// Test 4: Different product for same client gets distinct fresh count
{
  const req1 = mockReq({ query: { productId: 'hoodie-123' } });
  const req2 = mockReq({ query: { productId: 'shirt-999' } });
  
  const res1 = mockRes();
  const res2 = mockRes();
  handleLiveViewsRequest(req1, res1);
  handleLiveViewsRequest(req2, res2);
  
  assert(res2.jsonData.productId === 'shirt-999', 'Second product ID is set correctly');
  assert(res2.jsonData.isCached === false, 'New product ID for same client triggers initial non-cached count');
}

// Test 5: Different client (User-Agent) gets distinct fresh count for same product
{
  viewingCache.clear();
  const reqClientA = mockReq({ query: { productId: 'hoodie-123' }, headers: { 'user-agent': 'BrowserA/1.0' } });
  const reqClientB = mockReq({ query: { productId: 'hoodie-123' }, headers: { 'user-agent': 'BrowserB/2.0' } });
  
  const fpA = getClientFingerprint(reqClientA);
  const fpB = getClientFingerprint(reqClientB);
  
  assert(fpA !== fpB, 'Different User-Agents produce distinct fingerprints');
  
  const resA = mockRes();
  const resB = mockRes();
  handleLiveViewsRequest(reqClientA, resA);
  handleLiveViewsRequest(reqClientB, resB);
  
  assert(resA.jsonData.isCached === false, 'Client A initial call is non-cached');
  assert(resB.jsonData.isCached === false, 'Client B initial call is non-cached');
}

// Test 6: Simulated expiration after 5 minutes resets session
{
  viewingCache.clear();
  const req = mockReq({ query: { productId: 'expired-test' } });
  const res1 = mockRes();
  handleLiveViewsRequest(req, res1);
  assert(res1.jsonData.isCached === false, 'First call is non-cached');
  
  // Fast-forward timestamp in cache to 6 minutes ago
  const key = `${getClientFingerprint(req)}:expired-test`;
  const record = viewingCache.get(key);
  record.timestamp = Date.now() - (6 * 60 * 1000);
  
  const res2 = mockRes();
  handleLiveViewsRequest(req, res2);
  assert(res2.jsonData.isCached === false, 'Call after 5+ mins expiry returns fresh non-cached count');
}

console.log(`\n--- SUMMARY: ${passed} PASSED, ${failed} FAILED ---`);
process.exit(failed > 0 ? 1 : 0);
