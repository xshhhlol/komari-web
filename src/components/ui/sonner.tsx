import { useContext } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { ThemeContext } from "@/contexts/ThemeContext"

const Toaster = ({ ...props }: ToasterProps) => {
  // 跟随面板的浅色 / 深色设置
  const { appearance } = useContext(ThemeContext)

  return (
    <Sonner
      theme={appearance}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
