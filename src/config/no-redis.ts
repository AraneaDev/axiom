// Imported first by one-shot scripts: the Redis client is loaded by many modules and would
// connect on import, which a script that only writes to the database has no use for.
process.env.AXIOM_NO_REDIS = '1';
