export default function FCReviewTableControls({ scrollTableByYears }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      <button
        type="button"
        onClick={() => scrollTableByYears("left")}
        style={{
          padding: "0.4rem 0.75rem",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          cursor: "pointer",
          fontWeight: 600,
        }}
        aria-label="Scroll left 10 years"
      >
        ← 10y
      </button>
      <button
        type="button"
        onClick={() => scrollTableByYears("right")}
        style={{
          padding: "0.4rem 0.75rem",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          cursor: "pointer",
          fontWeight: 600,
        }}
        aria-label="Scroll right 10 years"
      >
        10y →
      </button>
    </div>
  );
}
