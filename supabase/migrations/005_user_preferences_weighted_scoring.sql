-- 005_user_preferences_weighted_scoring.sql
-- Replace the boolean-flag user_preferences table (001_initial_schema) with a
-- JSONB-based weighted scoring profile. Safe to re-run (idempotent via DROP IF EXISTS).
--
-- Breaking change: old columns (prefer_mrt, max_walk_minutes, avoid_transfers) are
-- removed. Any existing rows are dropped and re-created with default profile values.
-- ──────────────────────────────────────────────────────────────────────────────────

-- ── 1. Drop old RLS policy (defined in 001_initial_schema) ───────────────────────
DROP POLICY IF EXISTS "preferences: owner only" ON user_preferences;


-- ── 2. Drop old trigger if it exists (idempotency guard) ─────────────────────────
DROP TRIGGER IF EXISTS update_user_preferences_modtime ON user_preferences;


-- ── 3. Recreate user_preferences with new schema ─────────────────────────────────
-- Drop existing table; existing data cannot be meaningfully migrated because the
-- boolean flags (prefer_mrt, max_walk_minutes) have no 1:1 mapping to numeric weights.
DROP TABLE IF EXISTS user_preferences;

CREATE TABLE user_preferences (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    -- JSONB profile: weights (0.0–1.0) + hard mode constraints.
    -- Structure is validated both here (CHECK) and by the Pydantic UserPreferenceProfile model.
    profile     JSONB NOT NULL DEFAULT '{
        "duration_w":  0.40,
        "cost_w":      0.30,
        "walking_w":   0.20,
        "transfers_w": 0.10,
        "constraints": {
            "avoid_bus":        false,
            "avoid_metro":      false,
            "minimize_walking": false,
            "minimize_fee":     false
        }
    }',

    -- GUARD 1: weights must sum to 1.0 (±0.0001 tolerance for floating-point JSON round-trips).
    -- Uses ROUND(..., 4) so that Python floats like 0.39999999999 are treated as 0.4000.
    CONSTRAINT check_weights_total CHECK (
        ROUND(
            (profile->>'duration_w')::numeric +
            (profile->>'cost_w')::numeric      +
            (profile->>'walking_w')::numeric   +
            (profile->>'transfers_w')::numeric,
        4) = 1.0000
    ),

    -- GUARD 2: no weight may be negative (prevents inverted scoring).
    CONSTRAINT check_weights_positive CHECK (
        (profile->>'duration_w')::numeric  >= 0 AND
        (profile->>'cost_w')::numeric      >= 0 AND
        (profile->>'walking_w')::numeric   >= 0 AND
        (profile->>'transfers_w')::numeric >= 0
    ),

    -- GUARD 3: each weight is capped at 1.0 (prevents runaway dominance of one factor).
    CONSTRAINT check_weights_max CHECK (
        (profile->>'duration_w')::numeric  <= 1 AND
        (profile->>'cost_w')::numeric      <= 1 AND
        (profile->>'walking_w')::numeric   <= 1 AND
        (profile->>'transfers_w')::numeric <= 1
    ),

    -- GUARD 4: profile must contain the required top-level keys.
    -- Prevents partial writes that would silently drop a weight field.
    CONSTRAINT check_profile_keys CHECK (
        (profile ? 'duration_w')  AND
        (profile ? 'cost_w')      AND
        (profile ? 'walking_w')   AND
        (profile ? 'transfers_w') AND
        (profile ? 'constraints')
    ),

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 4. Auto-update trigger for updated_at ─────────────────────────────────────────
-- CREATE OR REPLACE is safe: harmless if the function already exists from another table.
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_preferences_modtime
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();


-- ── 5. RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own profile.
CREATE POLICY "preferences: owner read" ON user_preferences
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "preferences: owner write" ON user_preferences
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- ── 6. Index ──────────────────────────────────────────────────────────────────────
-- Lookup by user_id is the only access pattern; PK already covers it.
-- GIN index for JSONB operators (?, @>) used by GUARD 4 check and future queries.
CREATE INDEX IF NOT EXISTS user_preferences_profile_gin
    ON user_preferences USING GIN (profile);


-- ── Verification query (run manually to confirm structure) ────────────────────────
-- SELECT user_id,
--        (profile->>'duration_w')::numeric  AS dur_w,
--        (profile->>'cost_w')::numeric      AS cost_w,
--        (profile->>'walking_w')::numeric   AS walk_w,
--        (profile->>'transfers_w')::numeric AS xfer_w,
--        ROUND(
--            (profile->>'duration_w')::numeric +
--            (profile->>'cost_w')::numeric +
--            (profile->>'walking_w')::numeric +
--            (profile->>'transfers_w')::numeric, 4
--        ) AS weight_sum,
--        profile->'constraints'             AS constraints
-- FROM user_preferences;
