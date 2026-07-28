/**
 * Tiered Volume Pricing Discount Rules Engine
 */

const EXCLUDED_VENDORS = ["Group Hoodies"];

// Default tier configuration (minimum quantity to discount percentage)
const DEFAULT_TIERS = [
  { minQuantity: 250, percentage: 23.0 },
  { minQuantity: 100, percentage: 20.0 },
  { minQuantity: 75,  percentage: 17.0 },
  { minQuantity: 50,  percentage: 15.0 },
  { minQuantity: 25,  percentage: 13.0 },
  { minQuantity: 10,  percentage: 10.0 }
];

/**
 * Gets the applicable discount percentage based on total quantity
 */
function getDiscountPercentage(totalQty, tiers = DEFAULT_TIERS) {
  const sortedTiers = [...tiers].sort((a, b) => b.minQuantity - a.minQuantity);
  for (const tier of sortedTiers) {
    if (totalQty >= tier.minQuantity) {
      return tier.percentage;
    }
  }
  return 0;
}

/**
 * Calculates volume pricing for a given cart object strictly PER PRODUCT ID
 * 
 * Cart format expected:
 * {
 *   items: [
 *     { id: 'var_1', productId: 'prod_1', vendor: 'Gildan', quantity: 15, price: 10.00 },
 *     ...
 *   ]
 * }
 */
function calculateCartDiscounts(cart, tiers = DEFAULT_TIERS) {
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    return {
      applied: false,
      totalDiscountAmount: 0,
      discounts: [],
      items: []
    };
  }

  // 1. Group items strictly by product ID & compute total quantity per product
  const productGroups = {};

  for (const item of cart.items) {
    const productId = item.productId || item.id;
    const vendor = item.vendor || "";
    const qty = parseInt(item.quantity, 10) || 0;
    const price = parseFloat(item.price) || 0;

    if (!productGroups[productId]) {
      productGroups[productId] = {
        productId,
        vendor,
        totalQuantity: 0,
        items: []
      };
    }

    productGroups[productId].totalQuantity += qty;
    productGroups[productId].items.push({
      ...item,
      quantity: qty,
      unitPrice: price
    });
  }

  // 2. Evaluate each product group against tiers & vendor exclusions
  let totalDiscountAmount = 0;
  const appliedDiscounts = [];
  const processedItems = [];

  for (const productId of Object.keys(productGroups)) {
    const group = productGroups[productId];
    const isExcluded = EXCLUDED_VENDORS.some(
      (v) => v.toLowerCase() === group.vendor.toLowerCase()
    );

    let discountPercentage = 0;

    if (!isExcluded) {
      discountPercentage = getDiscountPercentage(group.totalQuantity, tiers);
    }

    let groupDiscountTotal = 0;

    for (const item of group.items) {
      const lineOriginalTotal = item.unitPrice * item.quantity;
      const lineDiscountAmount = (lineOriginalTotal * (discountPercentage / 100));
      const lineDiscountedTotal = lineOriginalTotal - lineDiscountAmount;
      const discountedUnitPrice = item.quantity > 0 ? (lineDiscountedTotal / item.quantity) : item.unitPrice;

      groupDiscountTotal += lineDiscountAmount;

      processedItems.push({
        id: item.id,
        productId: group.productId,
        vendor: group.vendor,
        quantity: item.quantity,
        originalUnitPrice: item.unitPrice,
        discountedUnitPrice: parseFloat(discountedUnitPrice.toFixed(2)),
        originalLineTotal: parseFloat(lineOriginalTotal.toFixed(2)),
        lineDiscountAmount: parseFloat(lineDiscountAmount.toFixed(2)),
        discountedLineTotal: parseFloat(lineDiscountedTotal.toFixed(2)),
        appliedPercentage: discountPercentage,
        isExcluded
      });
    }

    if (discountPercentage > 0) {
      appliedDiscounts.push({
        productId: group.productId,
        totalQuantity: group.totalQuantity,
        discountPercentage,
        discountAmount: parseFloat(groupDiscountTotal.toFixed(2)),
        message: `${discountPercentage}% Volume Discount (${group.totalQuantity}+ items)`
      });

      totalDiscountAmount += groupDiscountTotal;
    }
  }

  return {
    applied: appliedDiscounts.length > 0,
    totalDiscountAmount: parseFloat(totalDiscountAmount.toFixed(2)),
    discounts: appliedDiscounts,
    items: processedItems
  };
}

module.exports = {
  DEFAULT_TIERS,
  EXCLUDED_VENDORS,
  getDiscountPercentage,
  calculateCartDiscounts
};
