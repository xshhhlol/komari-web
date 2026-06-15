import React from "react";
import { Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { useAccount } from "@/contexts/AccountContext";
import Loading from "@/components/loading";

/**
 * 后台内容守卫：只包裹「内容区」（不替换侧边栏/登录入口）。
 * - 加载中：显示 Loading。
 * - 明确判定为未登录访客（/api/me 正常返回 logged_in:false）：不渲染后台页面，
 *   只显示「请先登录」占位；真正的登录入口由 AdminPanelBar 的登录弹窗处理。
 * - /api/me 异常或拿不到账户态：放行（fail-open），避免把用户彻底锁死
 *   （后端接口仍会对未授权请求鉴权拒绝）。
 */
const AdminGate = ({ children }: { children: React.ReactNode }) => {
  const { account, loading, error } = useAccount();
  const [t] = useTranslation();

  if (loading) {
    return <Loading />;
  }

  if (account && account.logged_in === false && !error) {
    return (
      <Flex
        direction="column"
        align="center"
        justify="center"
        gap="2"
        style={{ minHeight: "60vh" }}
      >
        <Text size="5" weight="bold">
          {t("login.title")}
        </Text>
        <Text size="2" color="gray">
          {t("login.desc")}
        </Text>
      </Flex>
    );
  }

  return <>{children}</>;
};

export default AdminGate;
