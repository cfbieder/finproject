import { Component } from "react";
import EmptyState from "./EmptyState.jsx";

/**
 * Route-level error boundary (CR037 P4).
 *
 * Without one, a single render-time throw in any lazy-loaded page unmounts
 * the whole app under the shared Suspense. Mounted keyed by pathname in
 * AppShell, so navigating to another page automatically clears the error.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Page crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <EmptyState
        variant="void"
        message="Something went wrong rendering this page."
      >
        <p style={{ color: "var(--ink-secondary)" }}>
          {String(this.state.error?.message || this.state.error)}
        </p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </EmptyState>
    );
  }
}
