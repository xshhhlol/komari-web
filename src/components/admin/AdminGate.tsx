import React from "react";
import {
  Button,
  Card,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import Loading from "@/components/loading";

/**
 * 自包含登录表单：直接 POST /api/login，成功后刷新页面。
 * 不依赖 /api/me 的返回（访客态在某些部署下可能拿不到账户态），
 * 因此即便守卫判断为「未登录」也始终能正常登录。
 */
const LoginGate = () => {
  const [t] = useTranslation();
  const { publicInfo } = usePublicInfo();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [twoFac, setTwoFac] = React.useState("");
  const [require2FA, setRequire2FA] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);

  const passwordLoginEnabled = !publicInfo?.disable_password_login;
  const oauthEnabled = !!publicInfo?.oauth_enable;
  const isFormValid = !passwordLoginEnabled || (!!username && !!password);

  const submit = async () => {
    if (!isFormValid) {
      setErrorMsg(`${t("login.username")} / ${t("login.password")}`);
      return;
    }
    setErrorMsg("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          ...(twoFac ? { "2fa_code": twoFac } : {}),
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.status === 200) {
        window.location.reload();
        return;
      }
      if (data?.message === "2FA code is required") {
        setRequire2FA(true);
        return;
      }
      setErrorMsg(data?.message || "Login failed");
    } catch (e) {
      setErrorMsg("Network error");
    } finally {
      setIsLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isLoading) {
      e.preventDefault();
      submit();
    }
  };

  const oauthLabel = t("login.login_with", {
    provider:
      publicInfo?.oauth_provider === "generic"
        ? "OAuth"
        : publicInfo?.oauth_provider
        ? publicInfo.oauth_provider.charAt(0).toUpperCase() +
          publicInfo.oauth_provider.slice(1)
        : "",
  });

  return (
    <Flex align="center" justify="center" style={{ minHeight: "80vh" }} p="4">
      <Card style={{ width: "100%", maxWidth: 380 }}>
        <Flex direction="column" gap="3" p="2">
          <Heading size="5">{t("login.title")}</Heading>
          <Text size="2" color="gray">
            {t("login.desc")}
          </Text>

          {passwordLoginEnabled && (
            <>
              <label>
                <Text as="div" size="2" mb="1" weight="bold">
                  {t("login.username")}
                </Text>
                <TextField.Root
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="admin"
                  disabled={isLoading}
                  autoFocus
                />
              </label>
              <label>
                <Text as="div" size="2" mb="1" weight="bold">
                  {t("login.password")}
                </Text>
                <TextField.Root
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onKeyDown}
                  type="password"
                  placeholder={t("login.password_placeholder")}
                  disabled={isLoading}
                />
              </label>
              <label hidden={!require2FA}>
                <Text as="div" size="2" mb="1" weight="bold">
                  {t("login.two_factor")}
                </Text>
                <TextField.Root
                  value={twoFac}
                  onChange={(e) => setTwoFac(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="000000"
                  disabled={isLoading}
                />
              </label>
              {errorMsg && (
                <Text size="2" color="red">
                  {errorMsg}
                </Text>
              )}
              <Button onClick={submit} disabled={isLoading || !isFormValid}>
                {isLoading ? "..." : t("login.title")}
              </Button>
            </>
          )}

          {oauthEnabled && (
            <Button
              variant={passwordLoginEnabled ? "soft" : "solid"}
              disabled={isLoading}
              onClick={() => {
                window.location.href = "/api/oauth";
              }}
            >
              {oauthLabel}
            </Button>
          )}
        </Flex>
      </Card>
    </Flex>
  );
};

/**
 * 后台鉴权守卫：未登录只渲染登录表单（不渲染侧边栏/任何后台页面），
 * 登录成功刷新后由 /api/me 判定为已登录再进入。加载中显示 Loading。
 */
const AdminGate = ({ children }: { children: React.ReactNode }) => {
  const { account, loading } = useAccount();

  if (loading) {
    return <Loading />;
  }
  if (account?.logged_in) {
    return <>{children}</>;
  }
  return <LoginGate />;
};

export default AdminGate;
