/**
 * ErrorBoundary - catches unhandled render-time exceptions and shows a
 * friendly recovery screen instead of a blank white page.
 * Zero em dashes by convention.
 */
import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Log to console so it appears in Sentry / log aggregators.
    console.error("[ErrorBoundary] Unhandled render error:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, sans-serif",
            background: "#f8f9fa",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ef4444"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginBottom: "1.5rem" }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#6b7280", maxWidth: "400px", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            {this.state.message || "An unexpected error occurred. Please reload and try again."}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "0.625rem 1.5rem",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
