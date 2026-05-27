
-- Lock down write access on sensitive financial tables by adding explicit
-- restrictive deny policies for authenticated users. Service role bypasses
-- RLS and continues to manage these tables via edge functions.

-- safepay_pending_checkouts: service-role only (explicit deny for clarity)
CREATE POLICY "Deny all authenticated access to safepay_pending_checkouts"
ON public.safepay_pending_checkouts
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- subscriptions: block direct INSERT and DELETE by authenticated users
CREATE POLICY "Deny direct subscription insert by users"
ON public.subscriptions
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "Deny direct subscription delete by users"
ON public.subscriptions
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (false);

-- token_transactions: writes are service-role only
CREATE POLICY "Deny token_transactions insert by users"
ON public.token_transactions
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "Deny token_transactions update by users"
ON public.token_transactions
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "Deny token_transactions delete by users"
ON public.token_transactions
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (false);

-- token_wallets: writes are service-role only
CREATE POLICY "Deny token_wallets insert by users"
ON public.token_wallets
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "Deny token_wallets delete by users"
ON public.token_wallets
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (false);

-- topup_requests: prevent users from updating or deleting after submission
CREATE POLICY "Deny topup_requests user update"
ON public.topup_requests
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Deny topup_requests user delete"
ON public.topup_requests
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
