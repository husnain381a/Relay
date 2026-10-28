"use client";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="fatal">
      <div className="brand-mark">r</div>
      <h1>Let’s reconnect.</h1>
      <p>{error.message || "The page could not be loaded."}</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
