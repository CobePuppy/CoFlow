// Older backups may predate independent file spaces.
export async function storedFiles(db: any): Promise<{ key: string }[]> {
  const tables =
    await db.$queryRaw`SELECT to_regclass('public."SpaceFile"')::text AS name`;
  const revisions =
    await db.$queryRaw`SELECT to_regclass('public."SpaceFileRevision"')::text AS name`;
  const [attachments, spaces, history] = await Promise.all([
    db.attachment.findMany({ select: { key: true } }),
    tables[0]?.name
      ? db.spaceFile.findMany({ select: { key: true } })
      : Promise.resolve([]),
    revisions[0]?.name
      ? db.spaceFileRevision.findMany({ select: { key: true } })
      : Promise.resolve([]),
  ]);
  return [
    ...new Map(
      [...attachments, ...spaces, ...history].map((f) => [f.key, f]),
    ).values(),
  ] as { key: string }[];
}
