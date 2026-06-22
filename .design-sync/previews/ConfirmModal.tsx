import { ConfirmModal } from "frontend";

// ConfirmModal — styled replacement for window.confirm(), driven by a `state`
// config object. In the real app it renders as a fixed full-screen overlay; for
// the preview card we neutralize the fixed positioning so the dialog renders in
// normal flow (the component and its styling are otherwise unchanged).

const Frame = ({ children }: { children: any }) => (
  <>
    <style>{`
      .confirm-modal__overlay {
        position: static !important;
        inset: auto !important;
        background: transparent !important;
        display: block !important;
        padding: 0 !important;
      }
    `}</style>
    {children}
  </>
);

export const DangerDelete = () => (
  <Frame>
    <ConfirmModal
      state={{
        title: "Delete account?",
        message:
          "This removes “Fidelity — Brokerage” and all 1,204 of its transactions. This action cannot be undone.",
        confirmLabel: "Delete account",
        cancelLabel: "Keep it",
        danger: true,
      }}
      busy={false}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </Frame>
);

export const Confirm = () => (
  <Frame>
    <ConfirmModal
      state={{
        title: "Post budget entries?",
        message: "12 draft entries will be posted to the 2026 base budget.",
        confirmLabel: "Post entries",
        cancelLabel: "Cancel",
      }}
      busy={false}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </Frame>
);

export const Busy = () => (
  <Frame>
    <ConfirmModal
      state={{
        title: "Run forecast?",
        message: "Recomputes all cash-sweep projections for the selected scenario.",
        confirmLabel: "Run forecast",
      }}
      busy={true}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  </Frame>
);
