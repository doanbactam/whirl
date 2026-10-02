"use client";

export default function SlotsError({ reset }: { reset: () => void }) {
  return (
    <section className="rounded-2xl border border-neutral-200 p-8 dark:border-neutral-800">
      <h1 className="text-xl font-semibold">The arcade lost its connection</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Your tokens and prizes are saved to your account. Reconnect to see the
        latest balance before spinning again.
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-full bg-[#0c82f2] px-5 py-2 text-sm font-medium text-white"
      >
        Reconnect
      </button>
    </section>
  );
}
