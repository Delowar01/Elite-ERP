import "./print.css";

// Print routes render the bare A4 document without the app shell — same root layout
// (fonts/session cookies still apply), no sidebar/topbar.
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="print-root">{children}</div>;
}
