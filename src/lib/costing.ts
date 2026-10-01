/**
 * Weighted-average costing. This is the only place stock value is recalculated.
 * Callers persist the returned state together with an inventory transaction.
 */
export type StockCostState = {
  quantityBase: number;
  inventoryValue: number;
  averageCostPerBaseUnit: number;
};

const QTY_EPSILON = 1e-9;

export function currentAverage(state: StockCostState): number {
  if (state.quantityBase !== 0) return state.inventoryValue / state.quantityBase;
  return state.averageCostPerBaseUnit;
}

export function applyInbound(state: StockCostState, quantityAdded: number, valueAdded: number): StockCostState {
  if (!(quantityAdded > 0) || !Number.isFinite(quantityAdded)) {
    throw new Error("Inbound quantity must be positive.");
  }
  if (!Number.isFinite(valueAdded)) {
    throw new Error("Inbound value must be a number.");
  }
  const quantityBase = state.quantityBase + quantityAdded;
  const inventoryValue = state.inventoryValue + valueAdded;
  if (Math.abs(quantityBase) < QTY_EPSILON) {
    return {
      quantityBase: 0,
      inventoryValue: 0,
      averageCostPerBaseUnit: state.averageCostPerBaseUnit,
    };
  }
  return {
    quantityBase,
    inventoryValue,
    averageCostPerBaseUnit: inventoryValue / quantityBase,
  };
}

export function applyOutbound(
  state: StockCostState,
  quantityRemoved: number,
): { state: StockCostState; unitCost: number; totalCost: number } {
  if (!(quantityRemoved > 0) || !Number.isFinite(quantityRemoved)) {
    throw new Error("Outbound quantity must be positive.");
  }
  const unitCost = currentAverage(state);
  let totalCost = quantityRemoved * unitCost;
  let quantityBase = state.quantityBase - quantityRemoved;
  let inventoryValue = state.inventoryValue - totalCost;
  if (Math.abs(quantityBase) < QTY_EPSILON) {
    quantityBase = 0;
    totalCost = state.inventoryValue;
    inventoryValue = 0;
  } else if (Math.abs(inventoryValue) < 1e-9) {
    inventoryValue = 0;
  }
  const averageCostPerBaseUnit = quantityBase !== 0 ? inventoryValue / quantityBase : unitCost;
  return {
    state: { quantityBase, inventoryValue, averageCostPerBaseUnit },
    unitCost,
    totalCost,
  };
}
