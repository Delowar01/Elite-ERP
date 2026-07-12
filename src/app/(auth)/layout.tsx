export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-16"
      style={{
        background:
          "radial-gradient(ellipse 700px 420px at 50% -10%, rgba(232,119,34,0.14), transparent 60%), var(--canvas)",
      }}
    >
      {children}
    </div>
  );
}
