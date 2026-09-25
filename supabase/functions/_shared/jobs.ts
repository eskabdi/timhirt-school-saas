// data_jobs bookkeeping shared by process-import-job and process-export-job.
//
// A PostgREST builder is a thenable with no .catch(): the old
// `.rpc("fail_job", …).catch(() => {})` threw a TypeError inside the error
// path, so a failed job was never marked failed and stayed "running"
// (R6 WP-01). This awaits the call, logs any failure without ids or stacks,
// and never throws, so the caller's own error response still goes out.
export interface FailJobClient {
  rpc(fn: "fail_job", args: { p_job_id: string; p_error_message: string }): PromiseLike<{ error: { message: string } | null }>;
}

export async function failJobQuietly(client: FailJobClient, jobId: string, reason: string, fnName: string): Promise<boolean> {
  try {
    const { error } = await client.rpc("fail_job", { p_job_id: jobId, p_error_message: reason });
    if (!error) return true;
    console.error(`${fnName}: fail_job failed`, { message: error.message });
  } catch (err) {
    console.error(`${fnName}: fail_job failed`, { message: (err as Error).message });
  }
  return false;
}
