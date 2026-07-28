/**
 * Volume Pricing Storefront Script (Robust Form & Event Listener)
 * Connects Shopify Theme Cart / Checkout buttons to gh-logo-api.vercel.app
 */

(function () {
  const API_BASE_URL = window.VOLUME_PRICING_API_URL || "https://gh-logo-api.vercel.app";
  const isDebug = window.VOLUME_PRICING_DEBUG !== undefined
    ? Boolean(window.VOLUME_PRICING_DEBUG)
    : (new URLSearchParams(window.location.search).get('debug') === 'true' || true);

  function log(message, ...args) {
    if (isDebug) {
      console.log(`🏷️ [VolumePricing] ${message}`, ...args);
    }
  }

  function logError(message, ...args) {
    console.error(`❌ [VolumePricing Error] ${message}`, ...args);
  }

  // Visual confirmation in DevTools Console
  console.info(`🟢 [VolumePricing] Script active & connected to ${API_BASE_URL}`);

  async function getShopifyCart() {
    log("Fetching Shopify cart from /cart.js...");
    const res = await fetch("/cart.js", { credentials: "same-origin" });
    const cart = await res.json();
    log("Shopify cart payload:", { itemCount: cart.item_count, totalDiscount: cart.total_discount, items: cart.items });
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
    log("Calling /calculate API:", { targetUrl, payload });

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    log("Calculation response:", data);
    return data;
  }

  async function proceedToDiscountedCheckout() {
    console.group("🏷️ [VolumePricing] Intercepted Checkout Request");
    try {
      const cart = await getShopifyCart();
      if (!cart || !cart.items || cart.items.length === 0) {
        log("Cart is empty, redirecting to /cart");
        window.location.href = "/cart";
        console.groupEnd();
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
      log("POSTing payload to Vercel /create-checkout:", { targetUrl, payload });

      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      log("Vercel API HTTP Status:", res.status);
      const data = await res.json();
      log("Vercel API Response Data:", data);

      if (data.success && data.checkoutUrl) {
        log(`🚀 SUCCESS! Redirecting to discounted draft order checkout URL:\n${data.checkoutUrl}`);
        console.groupEnd();

        if (isDebug) {
          console.log("⏱️ Pausing 2.5 seconds so you can inspect Vercel response before browser redirect...");
          setTimeout(() => {
            window.location.href = data.checkoutUrl;
          }, 2500);
        } else {
          window.location.href = data.checkoutUrl;
        }
      } else {
        logError("Vercel API did not return checkoutUrl. Falling back to standard /checkout:", data);
        console.groupEnd();
        window.location.href = "/checkout";
      }
    } catch (err) {
      logError("Exception while creating checkout. Falling back to /checkout:", err);
      console.groupEnd();
      window.location.href = "/checkout";
    }
  }

  // 1. Capture Form Submit on Cart Forms
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const isCartForm = form && (
      form.action?.includes('/cart') || 
      form.querySelector('[name="checkout"]') ||
      form.getAttribute('id')?.includes('cart')
    );

    const isCheckoutSubmit = e.submitter && (
      e.submitter.name === 'checkout' || 
      e.submitter.getAttribute('href')?.includes('/checkout') ||
      e.submitter.className?.includes('checkout')
    );

    if (isCartForm || isCheckoutSubmit) {
      log("Intercepted Cart Form Submit!", { form, submitter: e.submitter });
      e.preventDefault();
      e.stopPropagation();
      proceedToDiscountedCheckout();
    }
  }, true);

  // 2. Capture Direct Clicks on Checkout Buttons
  document.addEventListener('click', (e) => {
    const checkoutSelector = 'button[name="checkout"], input[name="checkout"], a[href="/checkout"], a[href*="/checkout"], .cart__checkout, [data-checkout-button]';
    const btn = e.target.closest(checkoutSelector);

    if (btn) {
      log("Intercepted Checkout Click!", { element: btn });
      e.preventDefault();
      e.stopPropagation();
      proceedToDiscountedCheckout();
    }
  }, true);

  window.VolumePricing = {
    isDebug,
    calculateDiscount,
    proceedToDiscountedCheckout
  };
})();
