/**
 * Date Helper Utilities
 *
 * Common date formatting and manipulation functions
 */

/**
 * Formats a Date object to YYYY-MM-DD string in local timezone.
 *
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date string (YYYY-MM-DD)
 *
 * @example
 * formatLocalDate(new Date(2024, 0, 15)); // '2024-01-15'
 */
export function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

/**
 * Gets today's date as YYYY-MM-DD string.
 *
 * @returns {string} Today's date in YYYY-MM-DD format
 *
 * @example
 * getToday(); // '2024-01-15'
 */
export function getToday() {
  return formatLocalDate(new Date());
}

/**
 * Gets the first day of January of the current year in local timezone.
 *
 * @returns {string} ISO date string for January 1st of current year (YYYY-01-01)
 *
 * @example
 * getYearStart(); // '2024-01-01'
 */
export function getYearStart() {
  const now = new Date();
  const januaryFirst = new Date(now.getFullYear(), 0, 1);
  return formatLocalDate(januaryFirst);
}

/**
 * Gets the last day of the current month in local timezone.
 *
 * @returns {string} ISO date string for last day of current month
 *
 * @example
 * // If current date is January 15, 2024
 * getMonthEnd(); // '2024-01-31'
 */
export function getMonthEnd() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return formatLocalDate(lastDay);
}

/**
 * Gets the first day of the current month in local timezone.
 *
 * @returns {string} ISO date string for first day of current month
 *
 * @example
 * // If current date is January 15, 2024
 * getMonthStart(); // '2024-01-01'
 */
export function getMonthStart() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  return formatLocalDate(firstDay);
}

/**
 * Converts YYYY-MM-DD string to month/year format for display.
 *
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {{month: string, year: string}} Object with month (01-12) and year
 *
 * @example
 * parseMonthYear('2024-01-15'); // { month: '01', year: '2024' }
 */
export function parseMonthYear(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return { month: '', year: '' };
  }

  const [year, month] = dateStr.split('-');
  return { month: month || '', year: year || '' };
}

/**
 * Builds a YYYY-MM-DD date string from month and year.
 * Always uses the first day of the month.
 *
 * @param {string} month - Month string (01-12)
 * @param {string} year - Year string (YYYY)
 * @returns {string} Date string in YYYY-MM-DD format
 *
 * @example
 * buildDateFromMonthYear('03', '2024'); // '2024-03-01'
 */
export function buildDateFromMonthYear(month, year) {
  if (!month || !year) {
    return '';
  }
  return `${year}-${month}-01`;
}

/**
 * Gets an array of month options for dropdowns.
 *
 * @returns {Array<{value: string, label: string}>} Array of month options
 *
 * @example
 * getMonthOptions(); // [{ value: '01', label: 'January' }, ...]
 */
export function getMonthOptions() {
  return [
    { value: "01", label: "January" },
    { value: "02", label: "February" },
    { value: "03", label: "March" },
    { value: "04", label: "April" },
    { value: "05", label: "May" },
    { value: "06", label: "June" },
    { value: "07", label: "July" },
    { value: "08", label: "August" },
    { value: "09", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];
}

/**
 * Gets an array of year options for dropdowns.
 * Returns years from startYear to endYear inclusive.
 *
 * @param {number} startYear - First year to include
 * @param {number} endYear - Last year to include
 * @returns {Array<string>} Array of year strings
 *
 * @example
 * getYearOptions(2020, 2024); // ['2020', '2021', '2022', '2023', '2024']
 */
export function getYearOptions(startYear, endYear) {
  const years = [];
  for (let year = startYear; year <= endYear; year++) {
    years.push(String(year));
  }
  return years;
}

/**
 * Gets year options centered around the current year.
 *
 * @param {number} yearsBefore - Number of years before current year (default: 5)
 * @param {number} yearsAfter - Number of years after current year (default: 5)
 * @returns {Array<string>} Array of year strings
 *
 * @example
 * // If current year is 2024
 * getYearOptionsAroundNow(2, 2); // ['2022', '2023', '2024', '2025', '2026']
 */
export function getYearOptionsAroundNow(yearsBefore = 5, yearsAfter = 5) {
  const currentYear = new Date().getFullYear();
  return getYearOptions(currentYear - yearsBefore, currentYear + yearsAfter);
}
