"use client";

import { useState } from "react";
import { BodyPortal } from "@/components/ui/BodyPortal";
import { useT } from "@/lib/i18n/useT";
import {
  PROFILE_CONTENT_KINDS,
  type ProfileContentKind,
} from "@/lib/studio/profileContentKind";
import { MAX_TAB_LABEL_LEN } from "@/lib/studio/studioPortfolioConfig";
import { layer } from "@/lib/ui/layers";

const KIND_KEY: Record<ProfileContentKind, { label: string; hint: string }> = {
  artwork: { label: "profile.kind.artwork", hint: "profile.kind.artworkHint" },
  print_edition: { label: "profile.kind.printEdition", hint: "profile.kind.printEditionHint" },
  art_goods: { label: "profile.kind.artGoods", hint: "profile.kind.artGoodsHint" },
  collected: { label: "profile.kind.collected", hint: "profile.kind.collectedHint" },
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (label: string, kind: ProfileContentKind) => void;
};

/** Semi-popup: pick a kind, then type a name. Not a new page. */
export function ProfileTabCreateDialog({ open, onClose, onCreate }: Props) {
  const { t } = useT();
  const [kind, setKind] = useState<ProfileContentKind | null>(null);
  const [name, setName] = useState("");

  if (!open) return null;

  function close() {
    setKind(null);
    setName("");
    onClose();
  }

  return (
    <BodyPortal>
      <div className={`fixed inset-0 ${layer.scrim} flex items-center justify-center bg-black/50 p-4`}>
        <div
          role="dialog"
          aria-labelledby="profile-tab-create-title"
          className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        >
          <h2 id="profile-tab-create-title" className="text-lg font-semibold text-zinc-900">
            {t("profile.tabs.createTitle")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{t("profile.tabs.createHint")}</p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROFILE_CONTENT_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`rounded-xl border px-3 py-3 text-left text-sm ${
                  kind === option
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 text-zinc-800 hover:border-zinc-400"
                }`}
              >
                <span className="block font-medium">{t(KIND_KEY[option].label)}</span>
                <span className={`mt-1 block text-xs ${kind === option ? "text-zinc-200" : "text-zinc-500"}`}>
                  {t(KIND_KEY[option].hint)}
                </span>
              </button>
            ))}
          </div>
          <label className="mt-4 block text-sm text-zinc-700">
            {t("studio.portfolio.tabName")}
            <input
              type="text"
              maxLength={MAX_TAB_LABEL_LEN}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("studio.portfolio.newTabPlaceholder")}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm text-zinc-700"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={!kind || name.trim().length === 0}
              onClick={() => {
                if (!kind || name.trim().length === 0) return;
                onCreate(name.trim(), kind);
                close();
              }}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {t("studio.portfolio.addCustomTab")}
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}
