import { HelpPanel } from "frontend";

// HelpPanel — slide-in help drawer (keyboard shortcuts + getting-around guide).
// Renders as a fixed scrim + right-side aside; for the card we neutralize the
// fixed positioning so the panel renders in normal flow.

const Frame = ({ children }: { children: any }) => (
  <>
    <style>{`
      .help-scrim {
        position: static !important;
        inset: auto !important;
        background: transparent !important;
        display: block !important;
      }
      .help-panel {
        position: static !important;
        inset: auto !important;
        width: 100% !important;
        max-width: 420px !important;
        height: auto !important;
        max-height: none !important;
        box-shadow: none !important;
        transform: none !important;
      }
    `}</style>
    {children}
  </>
);

export const Open = () => (
  <Frame>
    <HelpPanel open onClose={() => {}} />
  </Frame>
);
