/**
 * Stops a demo seed in production: it creates accounts with a published password. Imported before
 * anything else the seed does, so nothing has connected or been written when it stops.
 */
if (process.env.NODE_ENV === 'production') {
  console.error(
    'This seed writes demo data with a published password and does not run in production.\n' +
      'For a first admin and project: ADMIN_PASSWORD=... npm run db:seed:prod',
  );
  process.exit(1);
}
