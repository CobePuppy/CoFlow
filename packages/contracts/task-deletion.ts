export function canDeleteRequirement(
  task: {
    deletedAt?: unknown;
    data: { productId: string; createdBy?: string };
  },
  userId: string,
  readOnly = false,
  admin = false,
) {
  return (
    !readOnly &&
    !task.deletedAt &&
    (admin || task.data.productId === userId || task.data.createdBy === userId)
  );
}
