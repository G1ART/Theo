"use client";

import Link from "next/link";
import { isIrDemo, IR_PATH } from "@/lib/irDemo/config";
import { useT } from "@/lib/i18n/useT";

export function IrDemoBanner() {
  const { t } = useT();
  if (!isIrDemo()) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[12px] text-amber-950">
      {t("irDemo.banner")}{" "}
      <Link href={IR_PATH} className="underline underline-offset-2">
        {t("irDemo.switchPersona")}
      </Link>
    </div>
  );
}
