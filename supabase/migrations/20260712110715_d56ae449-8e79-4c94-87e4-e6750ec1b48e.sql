
-- Admins can view any wallet (in addition to users reading their own)
DROP POLICY IF EXISTS "Admins read any wallet" ON public.token_wallets;
CREATE POLICY "Admins read any wallet"
  ON public.token_wallets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admins can insert wallets for any user
DROP POLICY IF EXISTS "Admins insert any wallet" ON public.token_wallets;
CREATE POLICY "Admins insert any wallet"
  ON public.token_wallets FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admins can update any wallet (previously no UPDATE policy existed → all updates silently blocked)
DROP POLICY IF EXISTS "Admins update any wallet" ON public.token_wallets;
CREATE POLICY "Admins update any wallet"
  ON public.token_wallets FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
