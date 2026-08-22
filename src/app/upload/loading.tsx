/**
 * Replaces only the form slot (layout chrome stays mounted). An empty
 * fallback here would flash white in the center column while the
 * client page hydrates.
 */
export default function UploadLoading() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="h-12 w-full rounded-xl bg-zinc-100" />
      <div className="h-12 w-full rounded-xl bg-zinc-100" />
      <div className="h-32 w-full rounded-xl bg-zinc-100" />
      <div className="h-9 w-32 rounded-full bg-zinc-200" />
    </div>
  );
}
