import React from "react";
import { useAccount } from "@/contexts/AccountContext";
import Loading from "@/components/loading";
import LoginDialog from "@/components/Login";

/**
 * 后台鉴权守卫：未登录时只渲染登录界面，不渲染任何后台页面/侧边栏，
 * 避免「页面能进、只是接口被拒」导致的误操作。登录成功后刷新页面，
 * 由 /api/me 重新判定后进入后台。
 */
const AdminGate = ({ children }: { children: React.ReactNode }) => {
  const { account, loading } = useAccount();

  if (loading) {
    return <Loading />;
  }

  if (!account?.logged_in) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <LoginDialog
          autoOpen
          showSettings={false}
          onLoginSuccess={() => window.location.reload()}
        />
      </div>
    );
  }

  return <>{children}</>;
};

export default AdminGate;
