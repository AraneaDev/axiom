type PrismaDelegate = {
  findUnique: (args: { where: Record<string, unknown> }) => Promise<{ id: string } | null>;
  delete: (args: { where: { id: string } }) => Promise<unknown>;
  create: (args: { data: Record<string, string> }) => Promise<unknown>;
};

/**
 * Generic toggle for many-to-many association records (votes, watches, stars, etc.).
 * If the association exists, removes it and returns false; otherwise creates it and returns true.
 * @param delegate - The Prisma model delegate (e.g. prisma.issueVote)
 * @param uniqueWhere - The compound unique key to find by (e.g. { issueId_userId: ... })
 * @param createData - The data to create if not found (e.g. { issueId, userId })
 */
export async function toggleAssociation(
  delegate: PrismaDelegate,
  uniqueWhere: Record<string, unknown>,
  createData: Record<string, string>,
): Promise<boolean> {
  const existing = await delegate.findUnique({ where: uniqueWhere });

  if (existing) {
    await delegate.delete({ where: { id: existing.id } });
    return false;
  }

  await delegate.create({ data: createData });
  return true;
}
