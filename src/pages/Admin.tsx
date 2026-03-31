import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { Navigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle, XCircle, Users, Shield } from "lucide-react";

interface UserRow {
  user_id: string;
  display_name: string | null;
  is_approved: boolean;
  created_at: string;
  tier: string;
  upgrade_requested: boolean;
}

const Admin = () => {
  const { isAdmin, loading: approvalLoading } = useApproval();
  const { t, direction } = useLanguage();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, is_approved, created_at")
      .order("created_at", { ascending: false });

    const { data: subs } = await supabase
      .from("subscriptions")
      .select("user_id, tier, upgrade_requested");

    if (profiles) {
      const subMap = new Map((subs || []).map((s) => [s.user_id, s]));
      setUsers(
        profiles.map((p) => ({
          ...p,
          tier: subMap.get(p.user_id)?.tier || "free",
          upgrade_requested: subMap.get(p.user_id)?.upgrade_requested || false,
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin]);

  const toggleApproval = async (userId: string, approve: boolean) => {
    const { error } = await supabase
      .from("profiles")
      .update({ is_approved: approve })
      .eq("user_id", userId);

    if (error) {
      toast.error(t("admin.update_error"));
    } else {
      toast.success(approve ? t("admin.approved") : t("admin.rejected"));
      setUsers((prev) =>
        prev.map((u) => (u.user_id === userId ? { ...u, is_approved: approve } : u))
      );
    }
  };

  const changeTier = async (userId: string, newTier: "free" | "pro") => {
    const updates: Record<string, unknown> = {
      tier: newTier,
      upgrade_requested: false,
    };
    if (newTier === "pro") {
      updates.transcription_limit = 999999;
      updates.tts_character_limit = 999999;
    } else {
      updates.transcription_limit = 300;
      updates.tts_character_limit = 10000;
    }
    const { error } = await supabase
      .from("subscriptions")
      .update(updates)
      .eq("user_id", userId);

    if (error) {
      toast.error(t("admin.update_error"));
    } else {
      toast.success(newTier === "pro" ? t("admin.upgraded_pro") : t("admin.downgraded_free"));
      setUsers((prev) =>
        prev.map((u) =>
          u.user_id === userId ? { ...u, tier: newTier, upgrade_requested: false } : u
        )
      );
    }
  };

  if (approvalLoading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6" dir={direction}>
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("admin.title")}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              {t("admin.user_management")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">{t("admin.no_users")}</p>
            ) : (
              <div className="divide-y divide-border">
                {users.map((user) => (
                  <div
                    key={user.user_id}
                    className="flex items-center justify-between py-4 gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">
                        {user.display_name || t("admin.unnamed")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(user.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={user.is_approved ? "default" : "destructive"}>
                        {user.is_approved ? t("admin.status_approved") : t("admin.status_pending")}
                      </Badge>
                      {user.is_approved ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleApproval(user.user_id, false)}
                          className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        >
                          <XCircle className="h-4 w-4 me-1" />
                          {t("admin.revoke")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => toggleApproval(user.user_id, true)}
                        >
                          <CheckCircle className="h-4 w-4 me-1" />
                          {t("admin.approve")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Admin;
