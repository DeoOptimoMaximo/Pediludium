import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy route. `match` and `team_match` share the source event-id namespace, so there is
 * one canonical detail page (/match/[id]) that resolves match-first with a historical
 * fallback. Old /event/[id] links (and any bookmarks) redirect there.
 */
export default async function EventRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/match/${id}`);
}
