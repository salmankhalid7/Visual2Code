export async function generationProcessor(job) {
  const { projectId } = job.data;

  await job.updateProgress(10);
  console.log(`Processing generation for project ${projectId}`);

  // TODO: call the AI provider abstraction and code-generation service here.
  // This is a placeholder so the queue is wired end-to-end.

  await job.updateProgress(100);
  return { projectId, status: "completed" };
}
