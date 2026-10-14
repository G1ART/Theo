import { Suspense } from "react";
import { PageShellSkeleton } from "@/components/ds/PageShellSkeleton";
import { SearchClient } from "./SearchClient";

export default function SearchPage() {
  return (
    <Suspense fallback={<PageShellSkeleton variant="default" />}>
      <SearchClient />
    </Suspense>
  );
}
