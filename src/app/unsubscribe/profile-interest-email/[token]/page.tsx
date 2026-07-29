import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { messages } from "@/lib/i18n/messages";

/**
 * QA 2026-07-29 (PART E.2) — profile-interest email unsubscribe landing
 * page. Mirrors `src/app/unsubscribe/inquiry-email/[token]/page.tsx`
 * exactly: a Server Component that calls the anon-granted unsubscribe RPC
 * once on render. The token minted per-send in
 * `external_artist_profile_interest_email_log` is the sole credential.
 */

type Props = {
  params: Promise<{ token: string }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UnsubscribeProfileInterestEmailPage({ params }: Props) {
  const { token } = await params;
  let success = false;

  if (token && UUID_RE.test(token)) {
    const { data, error } = await supabase.rpc(
      "unsubscribe_external_artist_profile_interest_emails",
      { p_token: token }
    );
    if (!error && data === true) {
      success = true;
    }
  }

  const title = success
    ? messages.en["unsubscribeProfileInterestEmail.title"]
    : messages.en["unsubscribeProfileInterestEmail.failureTitle"];
  const titleKo = success
    ? messages.ko["unsubscribeProfileInterestEmail.title"]
    : messages.ko["unsubscribeProfileInterestEmail.failureTitle"];
  const body = success
    ? messages.en["unsubscribeProfileInterestEmail.body"]
    : messages.en["unsubscribeProfileInterestEmail.failureBody"];
  const bodyKo = success
    ? messages.ko["unsubscribeProfileInterestEmail.body"]
    : messages.ko["unsubscribeProfileInterestEmail.failureBody"];

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className={`w-full rounded-2xl border px-6 py-8 ${
          success
            ? "border-emerald-200 bg-emerald-50"
            : "border-zinc-200 bg-zinc-50"
        }`}
      >
        <h1
          className={`text-lg font-semibold ${
            success ? "text-emerald-900" : "text-zinc-900"
          }`}
        >
          {title}
        </h1>
        <p className={`mt-2 text-sm ${success ? "text-emerald-800" : "text-zinc-600"}`}>
          {body}
        </p>

        <hr className="my-6 border-zinc-200" />

        <h2
          className={`text-lg font-semibold ${
            success ? "text-emerald-900" : "text-zinc-900"
          }`}
        >
          {titleKo}
        </h2>
        <p className={`mt-2 text-sm ${success ? "text-emerald-800" : "text-zinc-600"}`}>
          {bodyKo}
        </p>

        <Link
          href="/"
          className="mt-8 inline-block rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {messages.en["unsubscribeProfileInterestEmail.backCta"]} /{" "}
          {messages.ko["unsubscribeProfileInterestEmail.backCta"]}
        </Link>
      </div>
    </div>
  );
}
