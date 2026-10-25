"use client";

import { useT } from "@/lib/i18n/useT";

/** Red words beside an empty required label. Not a button. */
export function FieldRequiredNote() {
  const { t } = useT();
  return (
    <span className="text-[11px] font-normal text-red-600">
      {t("upload.fieldRequired")}
    </span>
  );
}
