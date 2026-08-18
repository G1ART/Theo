"use client";

/**
 * Shared 주최 + 장소 fields for exhibition create and edit.
 * Host = who is putting on the show (feed credits). Venue = optional
 * building/space, only when different from host.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/useT";
import { pickLegacyForSave } from "@/lib/i18n/pickLocalized";
import { BilingualFieldPair } from "@/components/i18n/BilingualFieldPair";
import { AiTranslationDraftButton } from "@/components/i18n/AiTranslationDraftButton";
import { HostVenueSuggest } from "@/components/exhibitions/HostVenueSuggest";
import {
  listMyHostVenueSuggestions,
  type HostVenueSuggestion,
} from "@/lib/supabase/exhibitions";
import { searchPeople } from "@/lib/supabase/artists";
import { formatDisplayName, formatUsername } from "@/lib/identity/format";

export type HostProfileMode = "text" | "me" | "search";

export type HostProfileOption = {
  id: string;
  username: string | null;
  display_name: string | null;
  display_name_ko?: string | null;
  display_name_en?: string | null;
};

export type HostVenueNameFields = {
  legacy: string;
  ko: string;
  en: string;
};

type Props = {
  radioName: string;
  forProfileId?: string | null;
  hostProfileMode: HostProfileMode;
  onHostProfileModeChange: (mode: HostProfileMode) => void;
  hostNameKo: string;
  hostNameEn: string;
  onHostNamesChange: (next: HostVenueNameFields) => void;
  hostSelected: HostProfileOption | null;
  onHostSelectedChange: (profile: HostProfileOption | null) => void;
  venueNameKo: string;
  venueNameEn: string;
  onVenueNamesChange: (next: HostVenueNameFields) => void;
};

function namesFromSuggestion(s: HostVenueSuggestion): HostVenueNameFields {
  const legacy = s.host_name ?? s.label;
  return {
    legacy,
    ko: s.host_name_ko ?? "",
    en: s.host_name_en ?? legacy,
  };
}

export function ExhibitionHostVenueFields({
  radioName,
  forProfileId,
  hostProfileMode,
  onHostProfileModeChange,
  hostNameKo,
  hostNameEn,
  onHostNamesChange,
  hostSelected,
  onHostSelectedChange,
  venueNameKo,
  venueNameEn,
  onVenueNamesChange,
}: Props) {
  const { t, locale } = useT();
  const [meSuggestion, setMeSuggestion] = useState<HostVenueSuggestion | null>(null);
  const [hostSearch, setHostSearch] = useState("");
  const [hostResults, setHostResults] = useState<HostProfileOption[]>([]);
  const [hostSearching, setHostSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listMyHostVenueSuggestions({ forProfileId }).then(({ data }) => {
      if (!cancelled) {
        setMeSuggestion(data.find((s) => s.kind === "me") ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [forProfileId]);

  const runHostSearch = useCallback(async () => {
    const q = hostSearch.trim();
    if (!q || q.length < 2) {
      setHostResults([]);
      return;
    }
    setHostSearching(true);
    const { data } = await searchPeople({ q, limit: 10 });
    setHostResults(
      (data ?? []).map((p) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        display_name_ko: p.display_name_ko ?? null,
        display_name_en: p.display_name_en ?? null,
      }))
    );
    setHostSearching(false);
  }, [hostSearch]);

  useEffect(() => {
    const tmr = setTimeout(runHostSearch, 300);
    return () => clearTimeout(tmr);
  }, [hostSearch, runHostSearch]);

  function clearSearch() {
    setHostSearch("");
    setHostResults([]);
  }

  function selectMe() {
    onHostProfileModeChange("me");
    onHostSelectedChange(null);
    clearSearch();
    if (meSuggestion) {
      onHostNamesChange(namesFromSuggestion(meSuggestion));
    }
  }

  function onPickSuggestion(s: HostVenueSuggestion) {
    const linkedMe = s.kind === "me" || s.host_profile_id === forProfileId;
    if (linkedMe) {
      onHostProfileModeChange("me");
      onHostSelectedChange(null);
      clearSearch();
    } else if (s.host_profile_id) {
      onHostProfileModeChange("search");
      onHostSelectedChange({
        id: s.host_profile_id,
        username: null,
        display_name: s.label,
      });
      clearSearch();
    } else {
      onHostProfileModeChange("text");
      onHostSelectedChange(null);
      clearSearch();
    }
    onHostNamesChange(namesFromSuggestion(s));
  }

  return (
    <>
      <div>
        <p className="mb-1 text-sm font-medium text-zinc-700">
          {t("exhibition.hostVenue")}
        </p>
        <p className="mb-3 text-xs text-zinc-500">{t("exhibition.hostHint")}</p>

        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioName}
              checked={hostProfileMode === "me"}
              onChange={selectMe}
              className="rounded border-zinc-300"
            />
            <span className="text-sm">{t("exhibition.hostVenueMe")}</span>
          </label>
          {hostProfileMode === "me" && (
            <p className="text-xs text-zinc-500">
              {t("exhibition.hostMeFollowsProfile")}
            </p>
          )}

          <HostVenueSuggest forProfileId={forProfileId} onPick={onPickSuggestion} />

          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioName}
              checked={hostProfileMode === "search"}
              onChange={() => {
                onHostProfileModeChange("search");
                onHostSelectedChange(null);
              }}
              className="rounded border-zinc-300"
            />
            <span className="text-sm text-zinc-600">
              {t("exhibition.hostSearchAccount")}
            </span>
          </label>
          {hostProfileMode === "search" && (
            <div>
              <input
                type="text"
                value={hostSearch}
                onChange={(e) => setHostSearch(e.target.value)}
                placeholder={t("exhibition.searchHost")}
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              {hostSearching && (
                <p className="mt-1 text-xs text-zinc-500">{t("common.loading")}</p>
              )}
              {hostResults.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto rounded border border-zinc-200 bg-white text-sm">
                  {hostResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onHostSelectedChange(p);
                          setHostSearch("");
                          setHostResults([]);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50"
                      >
                        {formatDisplayName(p, t, locale)}
                        {p.username && (
                          <span className="ml-1 text-xs text-zinc-500">
                            {formatUsername(p)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {hostSelected && (
                <p className="mt-1 text-xs text-zinc-600">
                  {t("common.selected")}: {formatDisplayName(hostSelected, t, locale)}
                </p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioName}
              checked={hostProfileMode === "text"}
              onChange={() => {
                onHostProfileModeChange("text");
                onHostSelectedChange(null);
                clearSearch();
              }}
              className="rounded border-zinc-300"
            />
            <span className="text-sm text-zinc-600">
              {t("exhibition.hostTextOnly")}
            </span>
          </label>
          {hostProfileMode === "text" && (
            <BilingualFieldPair
              label={null}
              addKoKey="bilingual.addKoHost"
              addEnKey="bilingual.addEnHost"
              placeholderKo={t("exhibition.hostName")}
              placeholderEn={t("exhibition.hostName")}
              valueKo={hostNameKo}
              valueEn={hostNameEn}
              onChangeKo={(v) => {
                onHostNamesChange({
                  legacy: pickLegacyForSave(v || null, hostNameEn || null) ?? "",
                  ko: v,
                  en: hostNameEn,
                });
              }}
              onChangeEn={(v) => {
                onHostNamesChange({
                  legacy: pickLegacyForSave(hostNameKo || null, v || null) ?? "",
                  ko: hostNameKo,
                  en: v,
                });
              }}
              renderSecondaryAssist={({ secondaryLang }) => {
                const primaryLang: "ko" | "en" =
                  secondaryLang === "ko" ? "en" : "ko";
                const src = primaryLang === "ko" ? hostNameKo : hostNameEn;
                return (
                  <AiTranslationDraftButton
                    sourceText={src}
                    sourceLocale={primaryLang}
                    targetLocale={secondaryLang}
                    fieldKind="host_name"
                    onDraft={(text) => {
                      if (secondaryLang === "ko") {
                        onHostNamesChange({
                          legacy:
                            pickLegacyForSave(text || null, hostNameEn || null) ??
                            "",
                          ko: text,
                          en: hostNameEn,
                        });
                      } else {
                        onHostNamesChange({
                          legacy:
                            pickLegacyForSave(hostNameKo || null, text || null) ??
                            "",
                          ko: hostNameKo,
                          en: text,
                        });
                      }
                    }}
                    compact
                  />
                );
              }}
            />
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-zinc-700">
          {t("exhibition.venue")}
        </p>
        <p className="mb-2 text-xs text-zinc-500">{t("exhibition.venueHint")}</p>
        <BilingualFieldPair
          label={null}
          addKoKey="bilingual.addKoVenue"
          addEnKey="bilingual.addEnVenue"
          placeholderKo={t("exhibition.venuePlaceholder")}
          placeholderEn={t("exhibition.venuePlaceholder")}
          valueKo={venueNameKo}
          valueEn={venueNameEn}
          onChangeKo={(v) => {
            onVenueNamesChange({
              legacy: pickLegacyForSave(v || null, venueNameEn || null) ?? "",
              ko: v,
              en: venueNameEn,
            });
          }}
          onChangeEn={(v) => {
            onVenueNamesChange({
              legacy: pickLegacyForSave(venueNameKo || null, v || null) ?? "",
              ko: venueNameKo,
              en: v,
            });
          }}
        />
      </div>
    </>
  );
}
