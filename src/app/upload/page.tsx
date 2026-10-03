"use client";

import { Suspense } from "react";
import BulkUploadPage from "./bulk/page";

/**
 * Upload entry is the artwork workspace (Bulk selected).
 * The one-work form lives at /upload/single.
 */
export default function UploadEntryPage() {
  return (
    <Suspense fallback={null}>
      <BulkUploadPage />
    </Suspense>
  );
}
