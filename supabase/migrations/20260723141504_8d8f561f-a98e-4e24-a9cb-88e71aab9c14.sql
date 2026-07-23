DROP POLICY IF EXISTS "Deny token_wallets insert by users" ON public.token_wallets;
DROP POLICY IF EXISTS "Deny token_wallets delete by users" ON public.token_wallets;

CREATE POLICY "Deny token_wallets insert by non-admins"
  ON public.token_wallets
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Deny token_wallets delete by non-admins"
  ON public.token_wallets
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));