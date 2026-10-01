"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="empty">
      <h1>Something went wrong</h1>
      <p className="muted">{error.message}</p>
      <button className="btn" type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
