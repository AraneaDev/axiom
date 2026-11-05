-- Queries compare custom field numbers and dates by value, on these columns. The text stays the
-- truth; a value that isn't a number or a date leaves them empty and then never matches.
ALTER TABLE "custom_field_values" ADD COLUMN "numberValue" DOUBLE PRECISION;
ALTER TABLE "custom_field_values" ADD COLUMN "dateValue" TIMESTAMP(3);

-- The same reading as typedCustomFieldValue in src/lib/query-engine/custom-fields.ts. One bad value
-- must not stop the migration, so the casts catch their own failures. A date without a zone means
-- UTC there, so cf_date carries that zone itself: it may not read the session's, which is the
-- installer's, and a SET in this file does not reach the statements after it under migrate deploy.

CREATE FUNCTION pg_temp.cf_number(input TEXT) RETURNS DOUBLE PRECISION AS $$
DECLARE
  parsed DOUBLE PRECISION;
BEGIN
  IF btrim(input) !~ '^-?\d+(\.\d+)?$' THEN RETURN NULL; END IF;
  parsed := btrim(input)::DOUBLE PRECISION;
  RETURN parsed;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.cf_date(input TEXT) RETURNS TIMESTAMP(3) AS $$
BEGIN
  IF btrim(input) !~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$' THEN
    RETURN NULL;
  END IF;
  IF left(btrim(input), 4) = '0000' THEN RETURN NULL; END IF;
  RETURN (btrim(input)::TIMESTAMPTZ AT TIME ZONE 'UTC')::TIMESTAMP(3);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET timezone = 'UTC';

UPDATE "custom_field_values"
SET "numberValue" = pg_temp.cf_number("value"),
    "dateValue" = pg_temp.cf_date("value");

DROP FUNCTION pg_temp.cf_number(TEXT);
DROP FUNCTION pg_temp.cf_date(TEXT);
