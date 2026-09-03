"use client";

import { ErrorState } from "@/components/ui/kit";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--cz-void)] p-4">
      <div className="w-full max-w-md">
        <ErrorState message="Something went wrong while rendering this section." onRetry={reset} />
      </div>
    </div>
  );
}
