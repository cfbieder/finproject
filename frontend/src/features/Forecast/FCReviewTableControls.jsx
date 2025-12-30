export default function FCReviewTableControls({ scrollTableByYears, zoomLevel, onZoomIn, onZoomOut }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      {/* Zoom Controls */}
      {onZoomIn && onZoomOut && (
        <>
          <button
            type="button"
            onClick={onZoomOut}
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "1.1rem",
            }}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--muted)",
              fontWeight: 600,
              minWidth: "3rem",
              textAlign: "center",
            }}
          >
            {Math.round((zoomLevel || 1) * 100)}%
          </span>
          <button
            type="button"
            onClick={onZoomIn}
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "1.1rem",
            }}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <div
            style={{
              width: "1px",
              height: "1.5rem",
              background: "var(--border)",
              margin: "0 0.25rem",
            }}
          />
        </>
      )}

      {/* Scroll Controls */}
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
