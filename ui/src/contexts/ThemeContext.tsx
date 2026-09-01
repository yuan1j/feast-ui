import React, { createContext, useState, useContext, useEffect } from "react";

type ThemeMode = "light" | "dark";

interface ThemeContextType {
  colorMode: ThemeMode;
  setColorMode: (mode: ThemeMode) => void;
  toggleColorMode: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  colorMode: "light",
  setColorMode: () => {},
  toggleColorMode: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [colorMode, setColorMode] = useState<ThemeMode>(() => {
    const savedTheme = localStorage.getItem("feast-theme");
    return (savedTheme === "dark" ? "dark" : "light") as ThemeMode;
  });

  useEffect(() => {
    localStorage.setItem("feast-theme", colorMode);

    // 切换主题前临时禁用所有 CSS 过渡，避免颜色渐变过渡让人察觉
    const styleEl = document.createElement("style");
    styleEl.id = "theme-no-transition";
    styleEl.textContent =
      "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(styleEl);
    // 强制回流，确保禁用规则立即生效
    void document.body.offsetHeight;

    if (colorMode === "dark") {
      document.body.classList.add("euiTheme--dark");
    } else {
      document.body.classList.remove("euiTheme--dark");
    }

    // 下一帧恢复过渡动画
    requestAnimationFrame(() => {
      styleEl.remove();
    });
  }, [colorMode]);

  const toggleColorMode = () => {
    setColorMode((prevMode) => (prevMode === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ colorMode, setColorMode, toggleColorMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

export default ThemeContext;
