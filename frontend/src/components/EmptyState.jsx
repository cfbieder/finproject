import voidIllustration from "../assets/illustrations/undraw_void_wez2.svg";
import noDataIllustration from "../assets/illustrations/undraw_empty_4zx0.svg";
import emptyIllustration from "../assets/illustrations/undraw_no-data_ig65.svg";
import walletIllustration from "../assets/illustrations/undraw_wallet_diag.svg";
import financeIllustration from "../assets/illustrations/undraw_finance_m6vw.svg";
import searchingIllustration from "../assets/illustrations/undraw_searching_no1g.svg";
import uploadIllustration from "../assets/illustrations/undraw_upload_cucu.svg";
import aiAvatarIllustration from "../assets/illustrations/undraw_finance-guy-avatar_vhop.svg";
import "./EmptyState.css";

const illustrations = {
  void: voidIllustration,
  "no-data": noDataIllustration,
  empty: emptyIllustration,
  wallet: walletIllustration,
  finance: financeIllustration,
  searching: searchingIllustration,
  upload: uploadIllustration,
  "ai-review": aiAvatarIllustration,
};

/**
 * Reusable empty state with illustration.
 *
 * @param {Object} props
 * @param {string} [props.message] - Text to display
 * @param {"void"|"no-data"|"empty"|"wallet"|"finance"|"searching"|"upload"|"ai-review"} [props.variant] - Which illustration to use
 * @param {React.ReactNode} [props.children] - Optional extra content below the message
 */
export default function EmptyState({ message = "No data to display", variant = "void", children }) {
  const src = illustrations[variant] || illustrations.void;

  return (
    <div className="empty-state">
      <img
        className="empty-state__illustration"
        src={src}
        alt=""
        aria-hidden="true"
      />
      <p className="empty-state__message">{message}</p>
      {children}
    </div>
  );
}
