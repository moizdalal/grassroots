-- page_metrics — real-user perf telemetry for the admin health tab.
--
-- One row per page view. Captures Core Web Vitals + a few timing
-- baselines. The client beacon (public/perf-beacon.js) snapshots on
-- visibility=hidden so CLS / INP are fully settled before we record.
--
-- Insert path:  POST /api/metrics/page-load  (server uses service role)
-- Read path:    POST /api/admin/health-summary (admin-gated; calls
--               the aggregation RPCs defined below)
--
-- RLS posture: tight by default. Browsers have no SELECT / INSERT;
-- everything flows through server endpoints that hold the service-role
-- key and enforce the rules themselves.

CREATE TABLE IF NOT EXISTS public.page_metrics (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Page identity
  pathname TEXT NOT NULL,            -- /dashboard.html, /listing.html, etc.

  -- Coarse device + connection bucket (no full UA)
  device_class TEXT CHECK (device_class IN ('mobile','tablet','desktop')),
  connection_type TEXT,              -- '4g' | '3g' | 'slow-2g' | 'unknown'

  -- Core Web Vitals (millisecond integers; cls stored * 1000 to avoid float
  -- precision issues in aggregations). NULL when the browser doesn't expose
  -- the metric (e.g. older Safari for INP).
  lcp_ms INTEGER,                    -- Largest Contentful Paint
  inp_ms INTEGER,                    -- Interaction to Next Paint
  cls_x1000 INTEGER,                 -- Cumulative Layout Shift * 1000

  -- Surrounding timings
  ttfb_ms INTEGER,                   -- Time to First Byte
  fcp_ms INTEGER,                    -- First Contentful Paint
  load_event_ms INTEGER              -- load event (navigation timing)
);

-- Hot path: filter by recorded_at DESC for "last N days".
CREATE INDEX IF NOT EXISTS page_metrics_recorded_at_idx
  ON public.page_metrics (recorded_at DESC);

-- Per-route aggregations.
CREATE INDEX IF NOT EXISTS page_metrics_pathname_recorded_at_idx
  ON public.page_metrics (pathname, recorded_at DESC);

-- Lock the table down. The ingest + admin-read endpoints both use the
-- service-role key, which bypasses RLS, so we don't grant anon /
-- authenticated any policy at all.
ALTER TABLE public.page_metrics ENABLE ROW LEVEL SECURITY;

-- Make sure no leftover GRANTs on public role can read rows.
REVOKE ALL ON public.page_metrics FROM anon, authenticated;

/* ==============================================================
   AGGREGATION FUNCTIONS
   These are called by the admin health-summary endpoint. Defined
   SECURITY DEFINER so they can read page_metrics with the table
   owner's grant even though anon/authenticated have no select.
   EXECUTE is granted only to the service_role so a leaked anon key
   can't pull aggregate stats either.
   ============================================================== */

-- Overall p50 / p75 / p95 across all routes for the last N days.
CREATE OR REPLACE FUNCTION public.page_metrics_overall(days_back INT)
RETURNS TABLE (
  total_samples BIGINT,
  lcp_p50 INT,
  lcp_p75 INT,
  lcp_p95 INT,
  inp_p75 INT,
  cls_p75 INT,
  ttfb_p75 INT,
  fcp_p75 INT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT AS total_samples,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY lcp_ms)::INT AS lcp_p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp_ms)::INT AS lcp_p75,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY lcp_ms)::INT AS lcp_p95,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY inp_ms)::INT AS inp_p75,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY cls_x1000)::INT AS cls_p75,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY ttfb_ms)::INT AS ttfb_p75,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY fcp_ms)::INT AS fcp_p75
  FROM public.page_metrics
  WHERE recorded_at > NOW() - (days_back * INTERVAL '1 day')
$$;

-- Per-pathname rollup, ordered by sample count desc.
CREATE OR REPLACE FUNCTION public.page_metrics_by_route(days_back INT, max_routes INT)
RETURNS TABLE (
  pathname TEXT,
  samples BIGINT,
  lcp_p50 INT,
  lcp_p75 INT,
  lcp_p95 INT,
  cls_p75 INT,
  inp_p75 INT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pathname,
    COUNT(*)::BIGINT AS samples,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY lcp_ms)::INT AS lcp_p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp_ms)::INT AS lcp_p75,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY lcp_ms)::INT AS lcp_p95,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY cls_x1000)::INT AS cls_p75,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY inp_ms)::INT AS inp_p75
  FROM public.page_metrics
  WHERE recorded_at > NOW() - (days_back * INTERVAL '1 day')
    AND lcp_ms IS NOT NULL
  GROUP BY pathname
  ORDER BY samples DESC
  LIMIT max_routes
$$;

-- Daily LCP p75 trend across the window so the admin chart shows
-- whether perf is getting better or worse over time.
CREATE OR REPLACE FUNCTION public.page_metrics_daily_trend(days_back INT)
RETURNS TABLE (
  day DATE,
  samples BIGINT,
  lcp_p75 INT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (recorded_at AT TIME ZONE 'UTC')::DATE AS day,
    COUNT(*)::BIGINT AS samples,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp_ms)::INT AS lcp_p75
  FROM public.page_metrics
  WHERE recorded_at > NOW() - (days_back * INTERVAL '1 day')
    AND lcp_ms IS NOT NULL
  GROUP BY 1
  ORDER BY 1
$$;

-- Slowest individual page loads in the window. Useful for spot-checking
-- "what page is people hating right now" without doing your own SQL.
CREATE OR REPLACE FUNCTION public.page_metrics_slowest(days_back INT, max_rows INT)
RETURNS TABLE (
  recorded_at TIMESTAMPTZ,
  pathname TEXT,
  device_class TEXT,
  connection_type TEXT,
  lcp_ms INT,
  cls_x1000 INT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT recorded_at, pathname, device_class, connection_type, lcp_ms, cls_x1000
  FROM public.page_metrics
  WHERE recorded_at > NOW() - (days_back * INTERVAL '1 day')
    AND lcp_ms IS NOT NULL
  ORDER BY lcp_ms DESC
  LIMIT max_rows
$$;

REVOKE EXECUTE ON FUNCTION public.page_metrics_overall(INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.page_metrics_by_route(INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.page_metrics_daily_trend(INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.page_metrics_slowest(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.page_metrics_overall(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.page_metrics_by_route(INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.page_metrics_daily_trend(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.page_metrics_slowest(INT, INT) TO service_role;
