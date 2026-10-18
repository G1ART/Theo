/**
 * How the viewer and a profile follow each other, counting accepted follows
 * only. "mutual" is the audience that opens price and availability on works
 * shared with mutual connections.
 */
export type FollowRelation = "mutual" | "following" | "followsYou";

export function followRelation(viewerFollows: boolean, followsViewer: boolean): FollowRelation | null {
  if (viewerFollows && followsViewer) return "mutual";
  if (viewerFollows) return "following";
  if (followsViewer) return "followsYou";
  return null;
}
