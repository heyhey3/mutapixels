"use client";

export function ThemeToggle() {
  function toggle() {
    const current =
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("mutapixels-theme", next);
    } catch {
      // Private windows can block storage; the in-page theme still changes.
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label="Toggle light and dark theme"
      title="Toggle light / dark theme"
    >
      LIGHT / DARK
    </button>
  );
}
