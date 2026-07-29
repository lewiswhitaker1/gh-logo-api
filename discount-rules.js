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

// Tiered Decoration Application Pricing (Price per application based on quantity)
const PRINT_TIERS = [
  { minQuantity: 1000, price: 1.25 },
  { minQuantity: 750,  price: 1.50 },
  { minQuantity: 500,  price: 2.00 },
  { minQuantity: 250,  price: 2.50 },
  { minQuantity: 100,  price: 3.50 },
  { minQuantity: 25,   price: 4.50 },
  { minQuantity: 9,    price: 5.99 },
  { minQuantity: 1,    price: 7.99 }
];

const EMBROIDERY_TIERS = [
  { minQuantity: 1000, price: 1.25 },
  { minQuantity: 750,  price: 1.75 },
  { minQuantity: 500,  price: 2.25 },
  { minQuantity: 250,  price: 2.75 },
  { minQuantity: 100,  price: 3.75 },
  { minQuantity: 25,   price: 4.75 },
  { minQuantity: 9,    price: 6.25 },
  { minQuantity: 1,    price: 7.99 }
];

/**
 * Gets the unit price per application based on total quantity and decoration type
 */
function getDecorationUnitPrice(type, totalQty) {
  const normType = String(type).toLowerCase();
  const tiers = normType.includes('embroider') ? EMBROIDERY_TIERS : PRINT_TIERS;
  const sortedTiers = [...tiers].sort((a, b) => b.minQuantity - a.minQuantity);
  for (const tier of sortedTiers) {
    if (totalQty >= tier.minQuantity) {
      return tier.price;
    }
  }
  return 0;
}

/**
 * Parses line item properties to extract count of print and embroidery positions
 */
function parseDecorationCounts(properties) {
  let printCount = 0;
  let embroideryCount = 0;

  if (!properties) return { printCount, embroideryCount };

  const propsObj = {};
  if (Array.isArray(properties)) {
    properties.forEach((p) => {
      if (p && p.name) propsObj[p.name] = p.value;
    });
  } else if (typeof properties === "object") {
    Object.assign(propsObj, properties);
  }

  if (propsObj['_print_count'] !== undefined) printCount = parseInt(propsObj['_print_count'], 10) || 0;
  if (propsObj['_embroidery_count'] !== undefined) embroideryCount = parseInt(propsObj['_embroidery_count'], 10) || 0;

  if (printCount === 0 && embroideryCount === 0 && propsObj['Decoration Type']) {
    const decoType = String(propsObj['Decoration Type']).toLowerCase();
    const positions = propsObj['Logo Position'] ? String(propsObj['Logo Position']).split(',').length : 1;

    if (decoType.includes('print') && !decoType.includes('embroidery')) {
      printCount = positions;
    } else if (decoType.includes('embroidery') || decoType.includes('embroider')) {
      if (!decoType.includes('print')) {
        embroideryCount = positions;
      } else {
        const parts = decoType.split(',');
        parts.forEach((part) => {
          if (part.toLowerCase().includes('print')) printCount++;
          if (part.toLowerCase().includes('embroidery') || part.toLowerCase().includes('embroider')) embroideryCount++;
        });
      }
    }
  }

  return { printCount, embroideryCount };
}

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
      const { printCount, embroideryCount } = parseDecorationCounts(item.properties);
      const printUnitPrice = getDecorationUnitPrice('print', group.totalQuantity);
      const embroideryUnitPrice = getDecorationUnitPrice('embroidery', group.totalQuantity);
      const decorationFeePerUnit = (printCount * printUnitPrice) + (embroideryCount * embroideryUnitPrice);

      const lineOriginalTotal = item.unitPrice * item.quantity;
      const lineDiscountAmount = (lineOriginalTotal * (discountPercentage / 100));
      const lineDiscountedTotal = lineOriginalTotal - lineDiscountAmount;
      const baseDiscountedUnitPrice = item.quantity > 0 ? (lineDiscountedTotal / item.quantity) : item.unitPrice;

      const finalUnitPrice = parseFloat((baseDiscountedUnitPrice + decorationFeePerUnit).toFixed(2));
      const finalLineTotal = parseFloat((finalUnitPrice * item.quantity).toFixed(2));

      groupDiscountTotal += lineDiscountAmount;

      processedItems.push({
        id: item.id,
        productId: group.productId,
        vendor: group.vendor,
        quantity: item.quantity,
        originalUnitPrice: item.unitPrice,
        discountedUnitPrice: finalUnitPrice,
        baseDiscountedUnitPrice: parseFloat(baseDiscountedUnitPrice.toFixed(2)),
        decorationFeePerUnit: parseFloat(decorationFeePerUnit.toFixed(2)),
        printCount,
        embroideryCount,
        printUnitPrice,
        embroideryUnitPrice,
        originalLineTotal: parseFloat(lineOriginalTotal.toFixed(2)),
        lineDiscountAmount: parseFloat(lineDiscountAmount.toFixed(2)),
        discountedLineTotal: finalLineTotal,
        appliedPercentage: discountPercentage,
        isExcluded,
        properties: item.properties
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
  PRINT_TIERS,
  EMBROIDERY_TIERS,
  EXCLUDED_VENDORS,
  getDiscountPercentage,
  getDecorationUnitPrice,
  parseDecorationCounts,
  calculateCartDiscounts
};
