// Body of every bare repository's post-receive hook.
// Self-contained on purpose: Node runs this file directly in development and
// dist/git/post-receive-hook.js in production. No project imports.
// The API URL and secret come from the environment of the git process.
// A failure here never fails the push; it is reported on stderr.

export {};

async function main(): Promise<void> {
  const repoId = process.argv[2];
  const baseUrl = process.env.AXIOM_INTERNAL_URL || 'http://localhost:3000';
  const secret = process.env.HOOK_SECRET;

  if (!repoId || !secret) {
    process.stderr.write('axiom: post-receive hook skipped, repo id or HOOK_SECRET missing\n');
    return;
  }

  let input = '';
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) input += String(chunk);

  const updates = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/));

  await Promise.all(
    updates.map(async ([before, after, ref]) => {
      try {
        const res = await fetch(`${baseUrl}/api/internal/hooks/post-receive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Hook-Secret': secret },
          body: JSON.stringify({ repo: repoId, ref, before, after }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          process.stderr.write(`axiom: post-receive for ${ref} returned ${res.status}\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`axiom: post-receive for ${ref} failed: ${message}\n`);
      }
    }),
  );
}

main()
  .catch((err) => {
    process.stderr.write(`axiom: post-receive hook error: ${String(err)}\n`);
  })
  .finally(() => {
    process.exitCode = 0;
  });
