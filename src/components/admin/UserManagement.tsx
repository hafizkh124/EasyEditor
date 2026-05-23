import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useDebounce } from "@/hooks/useDebounce";
import type { UserRow, PaidTier, Tier, UserFilters, PaginationState } from "./types";
import UserSearchBar from "./UserSearchBar";
import UserFiltersComponent from "./UserFilters";
import UserTable from "./UserTable";
import UserPagination from "./UserPagination";
import RecordPaymentDialog from "./RecordPaymentDialog";

interface UserManagementProps {
  users: UserRow[];
  loading: boolean;
  filters: UserFilters;
  setFilters: (update: Partial<UserFilters>) => void;
  pagination: PaginationState;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  onApprove: (userId: string, plan: PaidTier) => void | Promise<void>;
  onRevoke: (userId: string) => void | Promise<void>;
  onReject: (userId: string, reason: string) => void | Promise<void>;
  onUnreject: (userId: string) => void | Promise<void>;
  onRenew: (userId: string) => void | Promise<void>;
  onChangeTier: (userId: string, tier: Tier) => void | Promise<void>;
  tierLabel: (tier: string) => string;
}

const UserManagement = ({
  users,
  loading,
  filters,
  setFilters,
  pagination,
  setPage,
  setPageSize,
  onApprove,
  onRevoke,
  onReject,
  onUnreject,
  onRenew,
  onChangeTier,
  tierLabel,
}: UserManagementProps) => {
  const { t } = useLanguage();
  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebounce(searchInput, 300);
  const [paymentUser, setPaymentUser] = useState<UserRow | null>(null);

  // Sync debounced search to filters
  if (debouncedSearch !== filters.search) {
    setFilters({ search: debouncedSearch });
  }

  return (
    <>
      <Card>
        <CardHeader className="space-y-3 pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            {t("admin.user_management")}
          </CardTitle>
          <UserSearchBar value={searchInput} onChange={setSearchInput} />
          <UserFiltersComponent filters={filters} onChange={setFilters} />
        </CardHeader>
        <CardContent className="pt-0">
          <UserTable
            users={users}
            loading={loading}
            onApprove={onApprove}
            onRevoke={onRevoke}
            onReject={onReject}
            onUnreject={onUnreject}
            onRenew={onRenew}
            onChangeTier={onChangeTier}
            onRecordPayment={(user) => setPaymentUser(user)}
            tierLabel={tierLabel}
          />
          <UserPagination
            pagination={pagination}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </CardContent>
      </Card>

      <RecordPaymentDialog
        user={paymentUser}
        onClose={() => setPaymentUser(null)}
      />
    </>
  );
};

export default UserManagement;
