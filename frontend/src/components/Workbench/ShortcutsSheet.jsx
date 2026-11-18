/** CR105 S5 — the Workbench's keyboard shortcuts, opened with "?". */
import Modal from "../Modal/Modal.jsx";
import { WORKBENCH_SECTIONS } from "./sections";

const INBOX = [
  ["j / k", "Next / previous transaction"],
  ["a", "Accept the transaction"],
  ["c", "Set its category"],
  ["/", "Search"],
];

function Row({ keys, what }) {
  return (
    <tr>
      <td className="wb-keys__k">
        {keys.split(" ").map((k, i) =>
          k === "/" && keys !== "/" ? (
            <span key={i}> / </span>
          ) : (
            <kbd key={i}>{k}</kbd>
          )
        )}
      </td>
      <td>{what}</td>
    </tr>
  );
}

export default function ShortcutsSheet({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <table className="wb-keys">
        <tbody>
          <tr>
            <th colSpan={2}>Anywhere</th>
          </tr>
          <Row keys="⌘K" what="Search or jump to a page" />
          <Row keys="?" what="This list" />
          <Row keys="Esc" what="Close the side panel" />
          {WORKBENCH_SECTIONS.map((s) => (
            <Row key={s.key} keys={`g ${s.go}`} what={`Go to ${s.label}`} />
          ))}
          <tr>
            <th colSpan={2}>Inbox (Refresh &amp; review)</th>
          </tr>
          {INBOX.map(([k, w]) => (
            <Row key={k} keys={k} what={w} />
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
