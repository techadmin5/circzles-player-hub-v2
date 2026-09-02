"use client";

import { ErrorState } from "@/components/ui";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto max-w-3xl px-4 py-10"><ErrorState message="Something went wrong while rendering this section." /><button className="btn btn-primary mt-4" onClick={reset}>Try again</button></main>;
}
