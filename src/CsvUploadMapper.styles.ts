import type { CSSProperties } from "react";

const styles: Record<string, CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: 12 },
  panel: {
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    padding: 12,
  },
  header: { fontSize: 16, fontWeight: 600, marginBottom: 8 },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  select: { padding: "6px 8px" },
  button: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #c0c0c0",
    background: "#f7f7f7",
    cursor: "pointer",
  },
  buttonPrimary: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #1976d2",
    background: "#1976d2",
    color: "white",
    cursor: "pointer",
  },
  buttonDanger: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #d32f2f",
    background: "#d32f2f",
    color: "white",
    cursor: "pointer",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  },
  th: {
    textAlign: "left",
    borderBottom: "1px solid #e0e0e0",
    padding: "8px",
    background: "#fafafa",
  },
  td: {
    borderBottom: "1px solid #f0f0f0",
    padding: "6px 8px",
    verticalAlign: "top",
  },
  input: {
    width: "100%",
    padding: "6px 8px",
    boxSizing: "border-box",
    borderRadius: 4,
    border: "1px solid #ccc",
  },
  cellErrorText: { color: "#d32f2f", fontSize: 12 },
  badgeError: {
    display: "inline-block",
    background: "#ffebee",
    color: "#d32f2f",
    border: "1px solid #ffcdd2",
    borderRadius: 4,
    padding: "2px 6px",
    marginLeft: 6,
    fontSize: 12,
  },
  toolbar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
};

export default styles;
