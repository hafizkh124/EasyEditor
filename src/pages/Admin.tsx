import { useEffect, useState } from "react";
import { useSeo } from "@/hooks/useSeo";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { Navigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Shield, CreditCard, Database, Wallet } from "lucide-react";
import UserManagement from "@/components/admin/UserManagement";
import UpgradeRequests from "@/components/admin/UpgradeRequests";
import CorpusPanel from "@/components/admin/CorpusPanel";
import IncomeDashboard from "@/components/admin/IncomeDashboard";
import { useAdminUsers } from "@/hooks/useAdminUsers";

const Admin = () => {
  useSeo({ title: "Admin — Al-Ulama Easy Editor", description: "Admin panel for approving registrations and managing Al-Ulama Easy Editor accounts.", path: "/admin", noindex: true });

  const { user } = useAuth();
  const { isAdmin, loading: approvalLoading } = useApproval();
  const { t, direction } = useLanguage();
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    if (!user || approvalLoading) return;

    const verifyAdminRole = async () => {
      if (import.meta.env.DEV) console.log("[Admin] Verifying access...");
      setVerifying(true);

      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (error) {
        if (import.meta.env.DEV) console.error("[Admin] Role verification failed:", error.message);
        setVerified(false);
      } else {
        setVerified(data !== null);
      }

      setVerifying(false);
    };

    verifyAdminRole();
  }, [user, approvalLoading]);

  const {
    users,
    loading,
    filters,
    setFilters,
    pagination,
    setPage,
    setPageSize,
    approveWithPlan,
    revokeApproval,
    rejectUser,
    unrejectUser,
    renewSubscription,
    changeTier,
    approveUpgrade,
    rejectUpgrade,
    tierLabel,
  } = useAdminUsers(verified);

  if (approvalLoading || verifying) return null;
  if (!isAdmin || !verified) return <Navigate to="/dashboard" replace />;

  const upgradeRequests = users.filter((u) => u.upgrade_requested);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6" dir={direction}>
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("admin.title")}</h1>
        </div>

        <Tabs defaultValue="users">
          <TabsList className="mb-4 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{t("admin.user_management")}</span>
            </TabsTrigger>
            <TabsTrigger value="upgrades" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{t("admin.upgrade_requests")}</span>
              {upgradeRequests.length > 0 && (
                <Badge className="ms-1 h-5 min-w-5 rounded-full px-1.5 text-xs">
                  {upgradeRequests.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="income" className="flex items-center gap-2">
              <Wallet className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{t("admin.income_tab")}</span>
            </TabsTrigger>
            <TabsTrigger value="corpus" className="flex items-center gap-2">
              <Database className="h-4 w-4 flex-shrink-0" />
              <span className="hidden sm:inline">{t("admin.corpus_tab")}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <UserManagement
              users={users}
              loading={loading}
              filters={filters}
              setFilters={setFilters}
              pagination={pagination}
              setPage={setPage}
              setPageSize={setPageSize}
              onApprove={approveWithPlan}
              onRevoke={revokeApproval}
              onReject={rejectUser}
              onUnreject={unrejectUser}
              onRenew={renewSubscription}
              onChangeTier={changeTier}
              tierLabel={tierLabel}
            />
          </TabsContent>

          <TabsContent value="upgrades">
            <UpgradeRequests
              requests={upgradeRequests}
              loading={loading}
              onApprove={approveUpgrade}
              onReject={rejectUpgrade}
              tierLabel={tierLabel}
            />
          </TabsContent>

          <TabsContent value="income">
            <IncomeDashboard />
          </TabsContent>

          <TabsContent value="corpus">
            <CorpusPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Admin;
