"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSession } from "@/lib/supabase/auth";
import { isFollowing } from "@/lib/supabase/follows";
import { getProfileById } from "@/lib/supabase/profiles";
import { formatDisplayName } from "@/lib/identity/format";
import { useT } from "@/lib/i18n/useT";
import { FollowButton } from "./FollowButton";
import { MessageRecipientButton } from "./connection/MessageRecipientButton";

type Props = {
  profileId: string;
};

export function ProfileActions({ profileId }: Props) {
  const { t, locale } = useT();
  const [userId, setUserId] = useState<string | null>(null);
  const [following, setFollowing] = useState<boolean>(false);
  const [recipientLabel, setRecipientLabel] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      if (session?.user?.id && session.user.id !== profileId) {
        isFollowing(profileId).then(({ data }) => setFollowing(data ?? false));
        // Lightweight peer-label hydration so the message sheet can show
        // a friendly recipient name. Failure is non-blocking — the button
        // still works with a generic placeholder if the lookup fails.
        void getProfileById(profileId).then(({ data }) => {
          if (!data) {
            setRecipientLabel(null);
            return;
          }
          setRecipientLabel(
            formatDisplayName(data, t, locale) || data.username || null,
          );
        });
      }
      setReady(true);
    });
  }, [profileId, t, locale]);

  if (!ready) return null;
  if (!userId) {
    return (
      <Link
        href="/login"
        className="inline-block rounded border border-zinc-300 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Login
      </Link>
    );
  }
  if (userId === profileId) return null; // Prevent self-follow

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <FollowButton
        targetProfileId={profileId}
        initialFollowing={following}
        size="md"
      />
      <MessageRecipientButton
        recipientId={profileId}
        recipientLabel={recipientLabel}
        size="md"
      />
    </div>
  );
}
