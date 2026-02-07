import PropTypes from "prop-types";
import "./LoadingSpinner.css";

export default function LoadingSpinner({ size = "md", label = "Loading..." }) {
  return (
    <div className={`loading-spinner loading-spinner--${size}`} role="status">
      <div className="loading-spinner__ring" />
      {label && <span className="loading-spinner__label">{label}</span>}
    </div>
  );
}

LoadingSpinner.propTypes = {
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  label: PropTypes.string,
};
