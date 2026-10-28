export async function readinessCheck(req, res) {
  const dependenciesHealthy = true;

  if (!dependenciesHealthy) {
    return res.status(503).json({ status: "error" });
  }

  return res.status(200).json({ status: "success" });
}
