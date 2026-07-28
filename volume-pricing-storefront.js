/**
 * Volume Pricing Storefront Script (with Toggleable Debug Logging)
 * Connects Shopify Theme Cart / Checkout buttons to your unified Vercel API.
 */

(function () {
  // Debug mode toggle (defaults to true or checks URL parameter ?debug=true / window.VOLUME_PRICING_DEBUG)
  const isDebug = window.VOLUME_PRICING_DEBUG !== undefined
    ? Boolean(window.VOLUME_PRICING_DEBUG)
    : (new URLSearchParams(window.location.search).get('debug') === 'true' || true);

  const API_BASE_URL = window.VOLUME_PRICING_API_URL || "";

  function log(message, ...args) {
    if (isDebug) {
      console.log(`🏷️ [VolumePricing] ${message}`, ...args);
    }
  }

  function logGroup(title, callback) {
    if (isDebug) {
      console.group(`🏷️ [VolumePricing] ${title}`);
      try { callback(); } finally { console.groupEnd(); }
    } else {
      callback();
    }
  }

  function logError(message, ...args) {
    console.error(`❌ [VolumePricing Error] ${message}`, ...args);
  }

  log("Script initialized", { API_BASE_URL, isDebug });

  async function getShopifyCart() {
    log("Fetching Shopify cart from /cart.js...");
    const res = await fetch("/cart.js");
    const cart = await res.json();
    log("Shopify cart fetched:", { itemCount: cart.item_count, totalDiscount: cart.total_discount, items: cart.items });
    return cart;
  }

  async function calculateDiscount(cartItems) {
    const payload = {
      items: cartItems.map((item) => ({
        id: item.variant_id || item.id,
        productId: item.product_id,
        vendor: item.vendor,
        title: item.title || item.product_title,
        quantity: item.quantity,
        price: item.price / 100,
        properties: item.properties
      }))
    };

    const targetUrl = `${API_BASE_URL}/api/volume-pricing/calculate`;
    log("Calculating discount via API:", { targetUrl, payload });

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    log("Discount calculation response received:", data);
    return data;
  }

  async function proceedToDiscountedCheckout() {
    logGroup("Proceeding to Checkout", async () => {
      try {
        const cart = await getShopifyCart();
        if (!cart || !cart.items || cart.items.length === 0) {
          log("Cart is empty, redirecting to /cart");
          window.location.href = "/cart";
          return;
        }

        const payload = {
          shop: window.Shopify ? window.Shopify.shop : undefined,
          items: cart.items.map((item) => ({
            id: item.variant_id || item.id,
            productId: item.product_id,
            vendor: item.vendor,
            title: item.title || item.product_title,
            quantity: item.quantity,
            price: item.price / 100,
            properties: item.properties
          }))
        };

        const targetUrl = `${API_BASE_URL}/api/volume-pricing/create-checkout`;
        log("Sending checkout payload to API:", { targetUrl, payload });

        const res = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        log("HTTP Response status from API:", res.status);
        const data = await res.json();
        log("Checkout API response payload:", data);

        if (data.success && data.checkoutUrl) {
          log(`🚀 Redirecting to discounted checkout URL: ${data.checkoutUrl}`);
          // Slight delay if in debug mode so logs can be read in console
          if (isDebug) {
            console.log("⏱️ Pausing 2 seconds for debug console inspection before redirecting...");
            setTimeout(() => {
              window.location.href = data.checkoutUrl;
            }, 2000);
          } else {
            window.location.href = data.checkoutUrl;
          }
        } else {
          logError("API returned unsuccessful response or missing checkoutUrl. Falling back to standard /checkout:", data);
          window.location.href = "/checkout";
        }
      } catch (err) {
        logError("Exception during proceedToDiscountedCheckout. Falling back to /checkout:", err);
        window.location.href = "/checkout";
      }
    });
  }

  window.VolumePricing = {
    isDebug,
    calculateDiscount,
    proceedToDiscountedCheckout
  };
})();
