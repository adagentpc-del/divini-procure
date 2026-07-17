/**
 * NotFound - 404 page shown when no route matches.
 * Zero em dashes by convention.
 */
import React from "react";
import { Link } from "react-router-dom";

export default function NotFound() {
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
      <p style={{ fontSize: "5rem", fontWeight: 800, color: "#d1d5db", margin: 0, lineHeight: 1 }}>
        404
      </p>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: "1rem 0 0.5rem" }}>
        Page not found
      </h1>
      <p style={{ color: "#6b7280", maxWidth: "360px", marginBottom: "1.5rem", lineHeight: 1.6 }}>
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        to="/"
        style={{
          background: "#2563eb",
          color: "#fff",
          textDecoration: "none",
          borderRadius: "8px",
          padding: "0.625rem 1.5rem",
          fontSize: "0.95rem",
          fontWeight: 600,
        }}
      >
        Go home
      </Link>
    </div>
  );
}
