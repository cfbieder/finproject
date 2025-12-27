import PropTypes from "prop-types";

export default function MonthYearPicker({
  monthId,
  yearId,
  monthValue,
  yearValue,
  monthOptions = [],
  yearOptions = [],
  onMonthChange,
  onYearChange,
  rowClassName = "balance-date-picker__row",
  inputClassName = "balance-date-picker__input",
}) {
  return (
    <div className={rowClassName}>
      <select
        id={monthId}
        className={inputClassName}
        value={monthValue ?? ""}
        onChange={(event) => onMonthChange?.(event.target.value)}
      >
        {monthOptions.map((month) => (
          <option key={`${monthId}-${month.value}`} value={month.value}>
            {month.label}
          </option>
        ))}
      </select>
      <select
        id={yearId}
        className={inputClassName}
        value={yearValue ?? ""}
        onChange={(event) => onYearChange?.(event.target.value)}
      >
        {yearOptions.map((year) => (
          <option key={`${yearId}-${year}`} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}

MonthYearPicker.propTypes = {
  monthId: PropTypes.string.isRequired,
  yearId: PropTypes.string.isRequired,
  monthValue: PropTypes.string,
  yearValue: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  monthOptions: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string,
      label: PropTypes.string,
    })
  ),
  yearOptions: PropTypes.arrayOf(
    PropTypes.oneOfType([PropTypes.string, PropTypes.number])
  ),
  onMonthChange: PropTypes.func,
  onYearChange: PropTypes.func,
  rowClassName: PropTypes.string,
  inputClassName: PropTypes.string,
};
