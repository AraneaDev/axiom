export default async function globalTeardown() {
  // Database persists between runs for debugging.
  // Data is cleaned and re-seeded in globalSetup.
  console.log('E2E teardown complete');
}
