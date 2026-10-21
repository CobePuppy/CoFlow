export async function fileContent(tx: any, file: any, number?: number) {
  const revision = await tx.spaceFileRevision.findUnique({
    where: {
      fileId_number: { fileId: file.id, number: number ?? file.contentVersion },
    },
  });
  return revision
    ? {
        ...file,
        key: revision.key,
        size: revision.size,
        mime: revision.mime,
        name: number === undefined ? file.name : revision.name,
        selectedContentVersion: number ?? file.contentVersion,
      }
    : null;
}
