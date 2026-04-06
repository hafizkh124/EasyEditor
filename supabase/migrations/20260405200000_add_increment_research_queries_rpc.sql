-- Atomic increment for research_queries_used to prevent race conditions
-- when multiple tabs or concurrent requests finish at the same time.

CREATE OR REPLACE FUNCTION public.increment_research_queries(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.subscriptions
  SET research_queries_used = research_queries_used + 1
  WHERE user_id = p_user_id;
END;
$$;

-- Grant execute to authenticated users (they can only increment their own count
-- because the function uses the p_user_id parameter which comes from the
-- verified JWT in the application layer)
GRANT EXECUTE ON FUNCTION public.increment_research_queries(uuid) TO authenticated;
