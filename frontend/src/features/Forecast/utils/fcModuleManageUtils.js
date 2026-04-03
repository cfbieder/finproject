/**
 * FC Module Manage Utility Functions
 * Pure utility functions for forecast module management
 */

/**
 * Formats transfer entries for the edit form by ensuring consistent date formatting.
 * Extracts year from date and formats as YYYY-07-01 for fiscal year convention.
 * Handles both Amount (for Invest/Dispose) and Value (for IncomePct) fields.
 *
 * @param {Array<Object>} transfers - Array of transfer objects with Date and Amount/Value properties
 * @returns {Array<Object>} Formatted transfer array with normalized dates
 */
export const formatTransferForm = (transfers) => {
  if (!Array.isArray(transfers)) {
    return [];
  }
  return transfers.map((entry) => {
    const date = entry?.Date ? new Date(entry.Date) : null;
    const year =
      date && !Number.isNaN(date.getTime()) ? date.getFullYear() : null;

    // Handle both Amount (for Invest/Dispose) and Value (for IncomePct)
    const hasAmount = entry?.Amount !== undefined;
    const hasValue = entry?.Value !== undefined;

    const dateEnd = entry?.DateEnd ? new Date(entry.DateEnd) : null;
    const endYear =
      dateEnd && !Number.isNaN(dateEnd.getTime()) ? dateEnd.getFullYear() : null;

    return {
      Date: year ? `${year}-07-01` : "",
      Amount: hasAmount ? (entry?.Amount ?? "") : (hasValue ? entry?.Value ?? "" : ""),
      Value: hasValue ? entry?.Value ?? "" : undefined,
      Flag: entry?.Flag ?? "",
      ...(endYear ? { DateEnd: `${endYear}-07-01` } : {}),
    };
  });
};

/**
 * Normalizes transfer data for API submission by validating dates and amounts.
 * Filters out invalid entries and ensures proper data types.
 * Handles both Amount (for Invest/Dispose) and Value (for IncomePct) fields.
 *
 * @param {Array<Object>} transfers - Array of transfer objects to normalize
 * @returns {Array<Object>} Validated transfer array with ISO date strings and numeric amounts/values
 */
export const normalizeTransfers = (transfers) => {
  if (!Array.isArray(transfers)) {
    return [];
  }
  return transfers
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const dateValue = entry.Date ? new Date(entry.Date) : null;
      const date =
        dateValue && !Number.isNaN(dateValue.getTime())
          ? dateValue.toISOString()
          : null;

      // Handle both Amount (for Invest/Dispose) and Value (for IncomePct)
      const hasValue = entry.Value !== undefined;
      const rawValue = hasValue ? entry.Value : entry.Amount;
      const parsedValue =
        rawValue === "" || rawValue === null || rawValue === undefined
          ? null
          : Number(rawValue);
      const numericValue = Number.isNaN(parsedValue) ? null : parsedValue;

      const flag = entry.Flag ?? "";
      if (!date || (numericValue === null && !flag)) {
        return null;
      }

      // Return appropriate structure based on whether it's IncomePct (Value) or Invest/Dispose (Amount)
      if (hasValue) {
        return { Date: date, Value: numericValue };
      }

      // Include DateEnd for Periodic transfers
      const dateEndValue = entry.DateEnd ? new Date(entry.DateEnd) : null;
      const dateEnd =
        dateEndValue && !Number.isNaN(dateEndValue.getTime())
          ? dateEndValue.toISOString()
          : null;

      return { Date: date, Amount: numericValue, Flag: flag, ...(dateEnd ? { DateEnd: dateEnd } : {}) };
    })
    .filter(Boolean);
};

/**
 * Normalizes unmatched items payload from API response.
 * Handles both array and object payloads with various property names.
 *
 * @param {Array|Object} payload - Raw API response containing unmatched items
 * @returns {Array<Object>} Normalized array of {name, category} objects
 */
export const normalizeUnmatchedItems = (payload) => {
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
    ? payload.items
    : [];

  const normalized = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item) {
      continue;
    }

    if (typeof item === "string") {
      normalized.push({ name: item, category: "" });
      continue;
    }

    if (typeof item === "object") {
      const name =
        item.name ??
        item.Name ??
        item.account ??
        item.Account ??
        item.value ??
        "";
      const category = item.category ?? item.Category ?? "";
      normalized.push({ name, category });
      continue;
    }
  }
  return normalized;
};
