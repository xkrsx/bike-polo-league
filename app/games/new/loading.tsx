export default function NewGameLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-zinc-500">
          BPV winter league 2026/2027
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          New game
        </h1>
      </header>
      <div className="h-28 animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-900" />
      <div className="h-96 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
    </main>
  );
}
