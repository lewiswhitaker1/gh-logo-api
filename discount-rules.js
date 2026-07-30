/**
 * Tiered Volume Pricing & Decoration Pricing Rules Engine
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

// ---------------------------------------------------------------------------
// Decoration pricing tiers (per unit, per position)
// Costs decrease as total order quantity increases.
// ---------------------------------------------------------------------------
const DECORATION_TIERS = [
  { minQuantity: 250, print: 2.00, embroidery: 3.50 },
  { minQuantity: 100, print: 2.50, embroidery: 4.00 },
  { minQuantity: 50,  print: 3.00, embroidery: 5.00 },
  { minQuantity: 25,  print: 4.00, embroidery: 6.00 },
  { minQuantity: 10,  print: 5.00, embroidery: 7.00 },
  { minQuantity: 1,   print: 6.00, embroidery: 8.00 }
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
 * Gets the per-unit decoration cost for a given type and total quantity.
 * @param {'print'|'embroidery'|null} type  - decoration type (null/other = 0)
 * @param {number} totalQty                 - total units in the order/product group
 * @param {Array}  decoTiers                - optional custom decoration tiers
 * @returns {number} cost per unit per position
 */
function getDecorationCostPerUnit(type, totalQty, decoTiers = DECORATION_TIERS) {
  if (!type || (type !== 'print' && type !== 'embroidery')) return 0;
  const sorted = [...decoTiers].sort((a, b) => b.minQuantity - a.minQuantity);
  for (const tier of sorted) {
    if (totalQty >= tier.minQuantity) {
      return tier[type] || 0;
    }
  }
  return 0;
}

/**
 * Extracts decoration info from a cart item's properties.
 * Properties come from the product customiser as an array of {name, value}
 * or as a plain object.
 */
function extractDecorationInfo(properties) {
  const result = {
    embroideryPositions: 0,
    printPositions: 0,
    decorations: []
  };

  if (!properties) {
    return { ...result, type: null, positions: 0 };
  }

  // Normalise: accept both array-of-objects and plain object
  let lookup;
  if (Array.isArray(properties)) {
    lookup = (key) => {
      const p = properties.find((prop) => prop.name === key);
      return p ? p.value : null;
    };
  } else if (typeof properties === 'object') {
    lookup = (key) => properties[key] || null;
  } else {
    return { ...result, type: null, positions: 0 };
  }

  const rawType = (lookup('Decoration Type') || lookup('Decoration') || '').trim();
  const positionStr = lookup('Logo Position') || '';
  const totalPositions = positionStr
    ? positionStr.split(',').map((s) => s.trim()).filter(Boolean).length
    : 0;

  if (!rawType || rawType.toLowerCase().includes('none') || rawType.toLowerCase().includes('plain')) {
    return { ...result, type: null, positions: 0 };
  }

  // Check if rawType has per-position specification like "Centre of Chest (Embroidery), Big Front (Print)"
  if (rawType.includes('(') && rawType.includes(')')) {
    const segments = rawType.split(',').map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const lower = segment.toLowerCase();
      if (lower.includes('embroider')) {
        result.embroideryPositions += 1;
      } else if (lower.includes('print')) {
        result.printPositions += 1;
      }
    }
  } else {
    // Single global type for all positions
    const lower = rawType.toLowerCase();
    const posCount = totalPositions || 1;
    if (lower.includes('embroider')) {
      result.embroideryPositions = posCount;
    } else if (lower.includes('print')) {
      result.printPositions = posCount;
    }
  }

  if (result.embroideryPositions > 0) {
    result.decorations.push({ type: 'embroidery', positions: result.embroideryPositions });
  }
  if (result.printPositions > 0) {
    result.decorations.push({ type: 'print', positions: result.printPositions });
  }

  // Backward-compatible properties
  result.type = result.decorations.length === 1
    ? result.decorations[0].type
    : (result.decorations.length > 1 ? 'mixed' : null);
  result.positions = result.embroideryPositions + result.printPositions;

  return result;
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
function calculateCartDiscounts(cart, tiers = DEFAULT_TIERS, decoTiers = DECORATION_TIERS) {
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
    return {
      applied: false,
      totalDiscountAmount: 0,
      totalDecorationCost: 0,
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

  // 2. Evaluate each product group against tiers, vendor exclusions & decoration
  let totalDiscountAmount = 0;
  let totalDecorationCost = 0;
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

      // ── Decoration pricing ──────────────────────────────────────────────
      const decoInfo = extractDecorationInfo(item.properties);
      let decoCostPerUnit = 0;
      const decoBreakdown = [];

      for (const deco of decoInfo.decorations) {
        const costPerPos = getDecorationCostPerUnit(deco.type, group.totalQuantity, decoTiers);
        const costPerUnitForType = costPerPos * deco.positions;
        decoCostPerUnit += costPerUnitForType;

        decoBreakdown.push({
          type: deco.type,
          positions: deco.positions,
          costPerPos,
          costPerUnit: costPerUnitForType,
          lineTotal: parseFloat((costPerUnitForType * item.quantity).toFixed(2))
        });
      }

      const decoLineTotal = decoCostPerUnit * item.quantity;
      totalDecorationCost += decoLineTotal;

      // Final unit price = discounted garment + decoration surcharge
      const finalUnitPrice = discountedUnitPrice + decoCostPerUnit;
      const finalLineTotal = lineDiscountedTotal + decoLineTotal;

      processedItems.push({
        id: item.id,
        productId: group.productId,
        vendor: group.vendor,
        quantity: item.quantity,
        title: item.title || item.name || null,
        properties: item.properties || null,
        originalUnitPrice: item.unitPrice,
        discountedUnitPrice: parseFloat(discountedUnitPrice.toFixed(2)),
        originalLineTotal: parseFloat(lineOriginalTotal.toFixed(2)),
        lineDiscountAmount: parseFloat(lineDiscountAmount.toFixed(2)),
        discountedLineTotal: parseFloat(lineDiscountedTotal.toFixed(2)),
        appliedPercentage: discountPercentage,
        isExcluded,
        // Decoration fields
        decorationType: decoInfo.type,
        decorationPositions: decoInfo.positions,
        embroideryPositions: decoInfo.embroideryPositions,
        printPositions: decoInfo.printPositions,
        decoBreakdown,
        decorationCostPerUnit: parseFloat(decoCostPerUnit.toFixed(2)),
        decorationLineTotal: parseFloat(decoLineTotal.toFixed(2)),
        // Combined totals (garment after discount + decoration)
        finalUnitPrice: parseFloat(finalUnitPrice.toFixed(2)),
        finalLineTotal: parseFloat(finalLineTotal.toFixed(2))
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
    applied: appliedDiscounts.length > 0 || totalDecorationCost > 0,
    totalDiscountAmount: parseFloat(totalDiscountAmount.toFixed(2)),
    totalDecorationCost: parseFloat(totalDecorationCost.toFixed(2)),
    discounts: appliedDiscounts,
    items: processedItems
  };
}

module.exports = {
  DEFAULT_TIERS,
  DECORATION_TIERS,
  EXCLUDED_VENDORS,
  getDiscountPercentage,
  getDecorationCostPerUnit,
  extractDecorationInfo,
  calculateCartDiscounts
};
