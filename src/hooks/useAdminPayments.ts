import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import type { AdminPayment, IncomeSummary } from "@/components/admin/types";

export function useAdminPayments() {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [incomeSummary, setIncomeSummary] = useState<IncomeSummary | null>(null);
  const [incomeLoading, setIncomeLoading] = useState(false);
  const [userPayments, setUserPayments] = useState<AdminPayment[]>([]);

  const recordPayment = async (payment: {
    user_id: string;
    amount_pkr: number;
    payment_type: string;
    payment_method?: string;
    payment_reference?: string;
    tier_at_payment?: string;
    notes?: string;
    payment_date?: string;
  }) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not authenticated");
        return false;
      }

      const { error } = await supabase.from("admin_payments").insert({
        user_id: payment.user_id,
        amount_pkr: payment.amount_pkr,
        payment_type: payment.payment_type,
        payment_method: payment.payment_method || null,
        payment_reference: payment.payment_reference || null,
        tier_at_payment: payment.tier_at_payment || null,
        notes: payment.notes || null,
        payment_date: payment.payment_date || new Date().toISOString().split("T")[0],
        recorded_by: user.id,
      } as never);

      if (error) {
        toast.error(`${t("admin.payment_save_error")}: ${error.message}`);
        return false;
      }

      toast.success(t("admin.payment_saved"));
      return true;
    } catch {
      toast.error(t("admin.payment_save_error"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const fetchIncomeSummary = async (dateFrom?: string | null, dateTo?: string | null) => {
    setIncomeLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_income_summary", {
        p_date_from: dateFrom || undefined,
        p_date_to: dateTo || undefined,
      });

      if (error) {
        console.error("[AdminPayments] income summary error:", error);
        return;
      }

      setIncomeSummary(data as unknown as IncomeSummary);
    } catch (e) {
      console.error("[AdminPayments] income summary failed:", e);
    } finally {
      setIncomeLoading(false);
    }
  };

  const fetchUserPayments = async (userId: string) => {
    const { data, error } = await supabase
      .from("admin_payments")
      .select("*")
      .eq("user_id", userId)
      .order("payment_date", { ascending: false });

    if (error) {
      console.error("[AdminPayments] user payments error:", error);
      return;
    }

    setUserPayments((data || []) as unknown as AdminPayment[]);
  };

  return {
    recordPayment,
    saving,
    fetchIncomeSummary,
    incomeSummary,
    incomeLoading,
    fetchUserPayments,
    userPayments,
  };
}
