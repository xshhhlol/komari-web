import { IconButton } from "@radix-ui/themes";
import { useContext } from "react";
import { ThemeContext } from "../contexts/ThemeContext";
import { MoonIcon, SunIcon } from "@radix-ui/react-icons";
import { useTranslation } from "react-i18next";

// 浅色 / 深色切换：点一下直接切换，图标显示当前模式。
const ThemeSwitch = () => {
  const { appearance, setAppearance } = useContext(ThemeContext);
  const [t] = useTranslation();
  const isDark = appearance === "dark";
  return (
    <IconButton
      variant="soft"
      title={
        isDark
          ? t("theme.switch_to_light", "切换到浅色")
          : t("theme.switch_to_dark", "切换到深色")
      }
      onClick={() => setAppearance(isDark ? "light" : "dark")}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </IconButton>
  );
};

export default ThemeSwitch;
