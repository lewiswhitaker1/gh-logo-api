/**
 * Volume Pricing Storefront Script
 * Connects Shopify Theme Cart / Checkout buttons to your unified Vercel API.
 */

(function () {
  // Replace window.VOLUME_PRICING_API_URL with your Vercel URL if different
  const API_BASE_URL = window.VOLUME_PRICING_API_URL || "";

  async function getShopifyCart() {
    const res = await fetch("/cart.js");
    return await res.json();
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

    const res = await fetch(`${API_BASE_URL}/api/volume-pricing/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    return await res.json();
  }

  async function proceedToDiscountedCheckout() {
    try {
      const cart = await getShopifyCart();
      if (!cart || !cart.items || cart.items.length === 0) {
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

      const res = await fetch(`${API_BASE_URL}/api/volume-pricing/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (data.success && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        window.location.href = "/checkout";
      }
    } catch (err) {
      console.error("Volume Pricing Checkout Error:", err);
      window.location.href = "/checkout";
    }
  }

  window.VolumePricing = {
    calculateDiscount,
    proceedToDiscountedCheckout
  };
})();
