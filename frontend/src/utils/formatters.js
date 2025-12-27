/**
 * Formatting Utilities
 *
 * Common formatting functions for currency, numbers, and other data types
 */

/**
 * Shared currency formatter instance.
 * Configured for USD with 2 decimal places.
 */
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a number as USD currency, handling negative values with parentheses.
 * Negative values are displayed as (amount) instead of -amount.
 *
 * @param {number} value - Numeric value to format
 * @returns {string} Formatted currency string
 *
 * @example
 * formatCurrency(1234.56);   // '$1,234.56'
 * formatCurrency(-1234.56);  // '($1,234.56)'
 * formatCurrency(null);      // '$0.00'
 */
export function formatCurrency(value) {
  const amount = value ?? 0;
  return amount < 0
    ? `(${currencyFormatter.format(Math.abs(amount))})`
    : currencyFormatter.format(amount);
}

/**
 * Formats a number as a percentage with specified decimal places.
 *
 * @param {number} value - Numeric value to format (e.g., 0.15 for 15%)
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted percentage string
 *
 * @example
 * formatPercentage(0.1534);      // '15.34%'
 * formatPercentage(0.1534, 1);   // '15.3%'
 * formatPercentage(1.5);         // '150.00%'
 */
export function formatPercentage(value, decimals = 2) {
  if (typeof value !== 'number') {
    return '0.00%';
  }
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Formats a rate value as percentage (value is already in percentage form).
 * Used for inflation rates, interest rates, etc.
 *
 * @param {number} rate - Rate value (e.g., 2.5 for 2.5%)
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted rate string
 *
 * @example
 * formatRate(2.5);    // '2.50%'
 * formatRate(2.567);  // '2.57%'
 */
export function formatRate(rate, decimals = 2) {
  return typeof rate === 'number' ? `${rate.toFixed(decimals)}%` : '0.00%';
}

/**
 * Formats a foreign exchange rate with specified decimal places.
 *
 * @param {number} rate - FX rate value
 * @param {number} decimals - Number of decimal places (default: 4)
 * @returns {string} Formatted FX rate or '-' if invalid
 *
 * @example
 * formatFxRate(1.2345);   // '1.2345'
 * formatFxRate(1.23);     // '1.2300'
 * formatFxRate(null);     // '-'
 */
export function formatFxRate(rate, decimals = 4) {
  return typeof rate === 'number' ? rate.toFixed(decimals) : '-';
}

/**
 * Formats a number with thousands separators.
 *
 * @param {number} value - Numeric value to format
 * @param {number} decimals - Number of decimal places (default: 0)
 * @returns {string} Formatted number string
 *
 * @example
 * formatNumber(1234567);      // '1,234,567'
 * formatNumber(1234.567, 2);  // '1,234.57'
 */
export function formatNumber(value, decimals = 0) {
  if (typeof value !== 'number') {
    return '0';
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Formats a number as compact notation (K, M, B).
 *
 * @param {number} value - Numeric value to format
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted compact number string
 *
 * @example
 * formatCompactNumber(1234);       // '1.2K'
 * formatCompactNumber(1234567);    // '1.2M'
 * formatCompactNumber(1234567890); // '1.2B'
 */
export function formatCompactNumber(value, decimals = 1) {
  if (typeof value !== 'number') {
    return '0';
  }

  const formatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return formatter.format(value);
}

/**
 * Parses a currency string back to a number.
 * Handles parentheses for negative values and removes currency symbols.
 *
 * @param {string} currencyString - Currency string to parse
 * @returns {number} Parsed numeric value
 *
 * @example
 * parseCurrency('$1,234.56');   // 1234.56
 * parseCurrency('($1,234.56)'); // -1234.56
 * parseCurrency('invalid');     // 0
 */
export function parseCurrency(currencyString) {
  if (typeof currencyString !== 'string') {
    return 0;
  }

  // Remove currency symbols and commas
  let cleaned = currencyString.replace(/[$,]/g, '');

  // Handle parentheses for negative values
  const isNegative = cleaned.includes('(') && cleaned.includes(')');
  cleaned = cleaned.replace(/[()]/g, '');

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    return 0;
  }

  return isNegative ? -parsed : parsed;
}
